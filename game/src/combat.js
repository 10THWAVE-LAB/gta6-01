// Combat: fists, pistol and SMG with ammo and reload, manual ray tests
// (no three.js raycaster needed), Voss guards with health bars, pickups.

import * as THREE from 'three';
import { WEAPONS, clamp } from './config.js';
import { buildPersonMesh } from './player.js';

// Ray vs sphere. Returns distance or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

// Ray vs AABB (buildings: y 0..30). Returns distance or Infinity.
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, b.minX, b.maxX], [oy, dy, 0, 30], [oz, dz, b.minZ, b.maxZ]];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) return Infinity; continue; }
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export class Combat {
  constructor(scene, city, effects, audio, player) {
    this.scene = scene; this.city = city; this.effects = effects;
    this.audio = audio; this.player = player;
    this.unlocked = { fists: true, pistol: true, smg: false };
    this.ammo = {
      fists: { mag: Infinity, reserve: Infinity },
      pistol: { mag: 12, reserve: 60 },
      smg: { mag: 30, reserve: 120 },
    };
    this.current = 'pistol';
    this.fireT = 0;
    this.reloadT = 0;
    this.enemies = []; // { parts, pos, hp, maxHp, shootT, dead, deadT, bar }
    this.pickups = []; // { mesh, type, pos, t }
    this.onShoot = null;   // (pos) => noise: peds flee, police heat
    this.onEnemyKilled = null;
    this.onCarShot = null; // (vehicle)
    // Tracer pool.
    this.tracers = [];
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;
  }

  get weapon() { return WEAPONS[this.current]; }
  get reloading() { return this.reloadT > 0; }

  switchTo(key) {
    if (!this.unlocked[key] || this.current === key) return;
    this.current = key;
    this.reloadT = 0;
    this.audio.uiClick();
  }

  startReload() {
    const w = this.weapon, a = this.ammo[this.current];
    if (this.current === 'fists' || this.reloadT > 0) return;
    if (a.mag >= (this.current === 'pistol' ? 12 : 30) || a.reserve <= 0) return;
    this.reloadT = 1.1;
    this.audio.uiClick();
  }

  _tracer(from, to) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.07;
  }

  // Fire one shot from the camera. vehicles/peds lists for hit tests.
  shoot(camera, vehicles, peds) {
    const w = this.weapon;
    if (this.fireT > 0 || this.reloadT > 0) return;
    this.fireT = 1 / w.rate;
    if (this.current === 'fists') { this._melee(vehicles, peds); return; }
    const a = this.ammo[this.current];
    if (a.mag <= 0) { this.startReload(); return; }
    a.mag -= 1;
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * w.spread * 2;
    dir.y += (Math.random() - 0.5) * w.spread * 2;
    dir.z += (Math.random() - 0.5) * w.spread * 2;
    dir.normalize();
    const muzzle = this.player.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    // Find the nearest hit.
    let best = { dist: w.range, kind: null, obj: null };
    const test = (dist, kind, obj) => { if (dist < best.dist) best = { dist, kind, obj }; };
    for (const c of this.city.colliders) test(rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c), 'wall', c);
    if (dir.y < 0) test(-origin.y / dir.y, 'ground', null);
    for (const e of this.enemies) {
      if (e.dead) continue;
      test(raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y + 1.2, e.pos.z, 0.9), 'enemy', e);
    }
    for (const p of peds.peds) {
      test(raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.pos.x, p.pos.y + 1.1, p.pos.z, 0.8), 'ped', p);
    }
    for (const v of vehicles) {
      if (v.dead) continue;
      const r = v.def.len * 0.5;
      test(raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, v.pos.x, 0.9, v.pos.z, r), 'car', v);
    }
    const hitPos = origin.clone().addScaledVector(dir, best.dist);
    this._tracer(muzzle, hitPos);
    this.audio.gunshot(this.current === 'smg');
    this.effects.burst(muzzle, { count: 3, color: 0xffe08a, speed: 2, life: 0.12, up: 0.5 });
    if (best.kind === 'enemy') {
      best.obj.hp -= w.damage;
      this.effects.blood(hitPos);
      if (best.obj.hp <= 0 && !best.obj.dead) this._killEnemy(best.obj);
    } else if (best.kind === 'ped') {
      this.effects.blood(hitPos);
      peds.remove(best.obj);
      this.onPedShot?.(best.obj);
    } else if (best.kind === 'car') {
      best.obj.damage(w.damage * 0.6, this.effects, this.audio);
      this.effects.sparks(hitPos);
      this.onCarShot?.(best.obj);
    } else if (best.kind === 'wall' || best.kind === 'ground') {
      this.effects.burst(hitPos, { count: 5, color: 0xd8c8a8, speed: 3, life: 0.35, up: 2 });
    }
    this.onShoot?.(this.player.pos);
  }

  _melee(vehicles, peds) {
    const p = this.player;
    this.audio.punch();
    const reach = WEAPONS.fists.range;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    let hit = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      if (Math.hypot(dx, dz) < reach && dx * fx + dz * fz > 0) {
        e.hp -= WEAPONS.fists.damage;
        this.effects.blood(e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)));
        if (e.hp <= 0) this._killEnemy(e);
        hit = true;
      }
    }
    if (!hit) {
      const ped = peds.nearest(p.pos.x + fx * 1.5, p.pos.z + fz * 1.5, 1.6);
      if (ped) { this.effects.blood(ped.pos.clone().add(new THREE.Vector3(0, 1.2, 0))); peds.remove(ped); this.onPedShot?.(ped); }
    }
    this.onShoot?.(p.pos);
  }

  _killEnemy(e) {
    e.dead = true;
    e.deadT = 4;
    e.parts.group.rotation.x = -Math.PI / 2;
    e.parts.group.position.y = 0.3;
    this.effects.blood(e.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    this.onEnemyKilled?.(e);
  }

  spawnEnemy(x, z, hp = 60) {
    const parts = buildPersonMesh(0x1c1c22, 0x2a2a2a, 0xc98a5a, 0x1a1a1a);
    parts.group.position.set(x, 0, z);
    this.scene.add(parts.group);
    // Health bar above the head.
    const barBg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x330000 }));
    barBg.position.y = 2.4;
    const barFg = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.09, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3333 }));
    barFg.position.y = 2.4;
    parts.group.add(barBg, barFg);
    const e = { parts, pos: parts.group.position, hp, maxHp: hp, shootT: 0.8 + Math.random(), dead: false, deadT: 0, barFg };
    this.enemies.push(e);
    return e;
  }

  clearEnemies() {
    for (const e of this.enemies) this.scene.remove(e.parts.group);
    this.enemies = [];
  }

  spawnPickup(type, x, z) {
    const colors = { health: 0x35d05a, armour: 0x3a9ad9, ammo: 0xf2c230, money: 0x2fae5f };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshBasicMaterial({ color: colors[type] }));
    mesh.position.set(x, 1, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, type, pos: mesh.position, t: Math.random() * 6 });
  }

  clearPickups() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
  }

  update(dt, player) {
    this.fireT = Math.max(0, this.fireT - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const a = this.ammo[this.current];
        const cap = this.current === 'pistol' ? 12 : 30;
        const need = cap - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
    }
    // Enemies shoot at the player.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        e.deadT -= dt;
        if (e.deadT <= 0) { this.scene.remove(e.parts.group); this.enemies.splice(i, 1); }
        continue;
      }
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      e.parts.group.lookAt(player.pos.x, 0, player.pos.z);
      e.barFg.scale.x = Math.max(0.01, e.hp / e.maxHp);
      e.barFg.position.x = -(1.06 * (1 - e.hp / e.maxHp)) / 2;
      if (d < 48 && !player.dead) {
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = 0.9 + Math.random() * 0.7;
          const from = e.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
          const to = player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
          this._tracer(from, to);
          this.audio.gunshot(false);
          const hitChance = clamp(0.55 - d / 120, 0.15, 0.5) * (player.car ? 0.6 : 1);
          if (Math.random() < hitChance) player.takeDamage(9, e.pos);
        }
      }
    }
    // Pickups bob, spin, get collected.
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 1 + Math.sin(p.t * 3) * 0.2;
      if (!player.car && Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) < 1.7) {
        if (p.type === 'health') player.heal(50);
        if (p.type === 'armour') player.addArmour(50);
        if (p.type === 'ammo') { this.ammo.pistol.reserve += 24; this.ammo.smg.reserve += 60; }
        if (p.type === 'money') player.addMoney(100);
        this.audio.pickup();
        this.effects.burst(p.pos, { count: 10, color: 0xffe08a, speed: 3, life: 0.5, up: 3 });
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }
}
