// Wanted level, SPD patrol cars that chase and ram, and the police
// helicopter at 3+ stars. Lose them by breaking line of sight and distance.

import * as THREE from 'three';
import { WANTED, GRID_LINES, clamp } from './config.js';
import { Vehicle } from './vehicles.js';
import { pick, range, chance } from './rng.js';

export class Police {
  constructor(scene, city, rng, vehicles, effects, audio) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.vehicles = vehicles; this.effects = effects; this.audio = audio;
    this.stars = 0;
    this.cops = []; // { v }
    this.heli = null;
    this.heliAngle = 0;
    this.escapeT = 0;
    this.decayT = 0;
    this.bustedT = 0;
    this.revealT = 0; // Nia's lookout: police marked on the minimap
    this.spawnT = 0;
    this.time = 0; // game-time clock for the response window
    this.lastHeatAt = -100;
    // Last reported position: cops converge here, not on the live player.
    // It refreshes only while a unit is close (or the heli watches a car),
    // so breaking contact and hiding genuinely loses them.
    this.lastKnown = null;
  }

  addHeat(n, silent = false) {
    if (n <= 0) return;
    const before = this.stars;
    this.stars = clamp(this.stars + n, 0, WANTED.maxStars);
    if (this.stars > before && !silent) this.audio.wantedUp();
    this.lastHeatAt = this.time;
    this.escapeT = 0; this.decayT = 0;
  }

  clear() {
    this.stars = 0;
    this.escapeT = 0; this.decayT = 0; this.bustedT = 0;
  }

  nearestCopDist(playerPos) {
    // Patrol cars only: the helicopter circles overhead but cannot make
    // the arrest, so it does not keep the player "spotted" on its own.
    let d = Infinity;
    for (const c of this.cops) d = Math.min(d, Math.hypot(c.v.pos.x - playerPos.x, c.v.pos.z - playerPos.z));
    return d;
  }

  spawnCop(targetPos) {
    // Reinforcements respond to the reported location, not the live player.
    const rng = this.rng;
    for (let tries = 0; tries < 10; tries++) {
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const line = pick(rng, GRID_LINES);
      const along = range(rng, -150, 150);
      const x = axis === 'x' ? along : line;
      const z = axis === 'x' ? line : along;
      const d = Math.hypot(x - targetPos.x, z - targetPos.z);
      if (d < 55 || d > 110) continue;
      const v = new Vehicle(this.scene, 'police', 0x1d2733, x, z,
        Math.atan2(targetPos.x - x, targetPos.z - z), { driver: 'police' });
      v.siren = true;
      v.speed = 12;
      this.vehicles.push(v);
      this.cops.push({ v });
      return;
    }
  }

  _buildHeli() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x223344 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 4.6), bodyMat);
    g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.4), new THREE.MeshLambertMaterial({ color: 0x18222e }));
    glass.position.set(0, 0.3, 1.8);
    g.add(glass);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4), bodyMat);
    tail.position.set(0, 0.2, -4);
    g.add(tail);
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rotor.add(blade);
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI / 2;
    rotor.add(blade2);
    rotor.position.y = 1.1;
    g.add(rotor);
    // Searchlight cone (kept faint — a beam, not a wall) + ground pool.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(5, 34, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }),
    );
    cone.position.y = -17;
    cone.rotation.x = Math.PI;
    g.add(cone);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(6, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -23.4;
    g.add(pool);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfff2a0 }));
    lamp.position.set(0, -0.9, 2);
    g.add(lamp);
    this.scene.add(g);
    return { group: g, rotor };
  }

  update(dt, player, onBusted) {
    const pp = player.pos;
    this.time += dt;
    // Refresh the reported position while a unit is close; the helicopter
    // keeps eyes on a car, but a runner on foot can slip under cover.
    const nearNow = this.nearestCopDist(pp);
    if (this.stars > 0 && (nearNow < 90 || (this.heli && player.car))) {
      this.lastKnown = { x: pp.x, z: pp.z };
    }
    // Spawn / despawn patrol cars. Reinforcements only join an active
    // chase nearby or the first moments after fresh heat — otherwise a
    // hidden player would never shake the pursuit.
    const want = this.stars > 0 ? WANTED.maxCops[this.stars] : 0;
    this.spawnT -= dt;
    const hotChase = nearNow < 130 || (this.time - this.lastHeatAt) < 6;
    if (this.cops.length < want && this.spawnT <= 0 && hotChase) {
      this.spawnCop(this.lastKnown || pp);
      this.spawnT = 1.2;
    }
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      const d = Math.hypot(c.v.pos.x - pp.x, c.v.pos.z - pp.z);
      if (c.v.dead || (this.stars === 0 && d > 90) || d > 260) {
        c.v.dispose(this.scene);
        this.vehicles.splice(this.vehicles.indexOf(c.v), 1);
        this.cops.splice(i, 1);
      }
    }
    // Chase AI: hot pursuit while the player is in sight, otherwise drive
    // to the last reported position and search there. A unit that falls
    // far behind loses the trail and gives up, so outrunning the police
    // and laying low can actually shake them.
    for (const c of this.cops) {
      const v = c.v;
      if (v.dead) continue;
      const distToPlayer = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (distToPlayer > 150) {
        v.drive(dt, { throttle: 0, steer: 0, handbrake: false }, this.city, this.effects, this.audio);
        continue;
      }
      const inSight = distToPlayer < 90;
      const target = inSight ? pp : (this.lastKnown || pp);
      // Arrived at the last known spot with nobody there: stop and look.
      if (!inSight && this.lastKnown && Math.hypot(v.pos.x - target.x, v.pos.z - target.z) < 10) {
        v.drive(dt, { throttle: 0, steer: 0, handbrake: false }, this.city, this.effects, this.audio);
        continue;
      }
      const lead = inSight && player.car ? 0.9 : 0.25;
      const px = target.x + (inSight && player.car ? Math.sin(player.heading) * player.car.speed * lead : 0);
      const pz = target.z + (inSight && player.car ? Math.cos(player.heading) * player.car.speed * lead : 0);
      const wantHeading = Math.atan2(px - v.pos.x, pz - v.pos.z);
      let dh = wantHeading - v.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const dist = Math.hypot(px - v.pos.x, pz - v.pos.z);
      const steer = clamp(dh * 2.2, -1, 1);
      let throttle = 1;
      if (dist < 4 && !player.car) throttle = 0; // stop beside a fleeing runner
      if (Math.abs(dh) > 1.4 && v.speed > 12) throttle = 0.2;
      v.drive(dt, { throttle, steer, handbrake: Math.abs(dh) > 1.9 }, this.city, this.effects, this.audio);
    }
    // Helicopter at 3+ stars.
    if (this.stars >= WANTED.heliAtStars && !this.heli) this.heli = this._buildHeli();
    if (this.stars < WANTED.heliAtStars && this.heli) {
      this.scene.remove(this.heli.group);
      this.heli = null;
    }
    if (this.heli) {
      this.heliAngle += dt * 0.18;
      const hx = pp.x + Math.cos(this.heliAngle) * 30;
      const hz = pp.z + Math.sin(this.heliAngle) * 30;
      this.heli.group.position.set(hx, 24, hz);
      this.heli.group.lookAt(pp.x, 0, pp.z);
      this.heli.rotor.rotation.y += dt * 22;
    }
    // Siren hums while any cop is near.
    const near = this.nearestCopDist(pp);
    this.audio.setSiren(this.stars > 0 && near < 130);
    // Escape: no unit close for a while -> stars decay.
    if (this.stars > 0) {
      if (near > WANTED.escapeRadius) {
        this.escapeT += dt;
        if (this.escapeT > WANTED.escapeTime) {
          this.decayT += dt;
          if (this.decayT > WANTED.decayEvery) {
            this.stars -= 1;
            this.decayT = 0;
            this.escapeT = WANTED.escapeTime; // keep decaying
          }
        }
      } else { this.escapeT = 0; this.decayT = 0; }
    }
    // Busted: on foot, slow, cop right beside you.
    if (this.stars > 0 && !player.car && player.speed < 1.5) {
      if (near < 7) {
        this.bustedT += dt;
        if (this.bustedT > 3) { onBusted?.(); this.bustedT = 0; }
      } else this.bustedT = 0;
    } else this.bustedT = 0;
    if (this.revealT > 0) this.revealT -= dt;
  }
}
