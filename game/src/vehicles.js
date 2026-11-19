// Cars: box-built models, arcade driving physics, collisions, damage,
// smoke and explosion. One class serves player, traffic and police cars.

import * as THREE from 'three';
import { VEHICLE_TYPES, clamp, lerp, angleLerp } from './config.js';

const WHEEL_R = 0.36;

export class Vehicle {
  constructor(scene, type, color, x, z, heading, opts = {}) {
    this.scene = scene;
    this.type = type;
    this.def = VEHICLE_TYPES[type];
    this.color = color ?? this.def.colors[0];
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.hp = this.def.hp;
    this.dead = false;
    this.driver = opts.driver || null; // 'player' | 'traffic' | 'police' | null
    this.siren = false;
    this.flashT = 0;
    this.smokeT = 0;
    this.hornT = 0;
    this.id = Vehicle.nextId++;
    this.group = new THREE.Group();
    this._buildMesh();
    this.group.position.copy(this.pos);
    this.group.rotation.y = heading;
    scene.add(this.group);
  }

  _buildMesh() {
    const d = this.def;
    const bodyMat = new THREE.MeshLambertMaterial({ color: this.color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x18222e });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
    const bodyH = this.type === 'suv' || this.type === 'van' || this.type === 'truck' ? 0.95 : 0.62;
    const body = new THREE.Mesh(new THREE.BoxGeometry(d.wid, bodyH, d.len), bodyMat);
    body.position.y = 0.55 + (bodyH - 0.62) / 2;
    this.group.add(body);
    if (this.type !== 'truck') {
      const cabLen = this.type === 'van' ? d.len * 0.42 : d.len * 0.5;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(d.wid * 0.88, 0.55, cabLen), glassMat);
      cab.position.set(0, 0.55 + bodyH + 0.12, this.type === 'van' ? d.len * 0.22 : -d.len * 0.05);
      this.group.add(cab);
    } else {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(d.wid * 0.95, 0.9, 1.4), bodyMat);
      cab.position.set(0, 1.1, d.len / 2 - 0.9);
      this.group.add(cab);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(d.wid, 1.3, d.len * 0.6), new THREE.MeshLambertMaterial({ color: 0x8a7a5a }));
      bed.position.set(0, 1.05, -d.len * 0.14);
      this.group.add(bed);
    }
    // Headlights + tail lights.
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xcc2222 });
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), hlMat);
      hl.position.set(s * (d.wid / 2 - 0.3), 0.62, d.len / 2 + 0.02);
      this.group.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), tlMat);
      tl.position.set(s * (d.wid / 2 - 0.3), 0.62, -d.len / 2 - 0.02);
      this.group.add(tl);
    }
    // Wheels.
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz, front] of [
      [-d.wid / 2, d.len / 2 - 0.8, true], [d.wid / 2, d.len / 2 - 0.8, true],
      [-d.wid / 2, -d.len / 2 + 0.8, false], [d.wid / 2, -d.len / 2 + 0.8, false],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, WHEEL_R, wz);
      const w = new THREE.Mesh(wheelGeo, darkMat);
      pivot.add(w);
      this.group.add(pivot);
      this.wheels.push({ pivot, mesh: w, front });
    }
    // Police light bar / taxi sign.
    if (this.type === 'police') {
      const bar = new THREE.Group();
      this.lightL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      this.lightR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
      this.lightL.position.x = -0.3; this.lightR.position.x = 0.3;
      bar.add(this.lightL, this.lightR);
      bar.position.set(0, 1.35, -0.1);
      this.group.add(bar);
      // White doors stripe.
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(d.wid + 0.02, 0.3, d.len * 0.5), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
      stripe.position.y = 0.62;
      this.group.add(stripe);
    }
    if (this.type === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff2a0 }));
      sign.position.set(0, 1.42, 0);
      this.group.add(sign);
    }
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get radius() { return this.def.len / 2; }

  damage(amount, effects, audio) {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true; this.speed = 0;
      effects.explosion(this.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      audio?.explosion();
      // Burnt shell.
      this.group.traverse((o) => { if (o.isMesh) o.material = o.material.clone?.() ?? o.material; });
      this.group.children.forEach((c) => { if (c.material?.color) c.material.color.set(0x1a1a1a); });
    }
  }

  // control: { throttle: -1..1, steer: -1..1, handbrake: bool }
  drive(dt, control, city, effects, audio) {
    if (this.dead) { this.speed *= 0.9; return; }
    const d = this.def;
    const fwd = Math.abs(this.speed) < 0.5 ? 1 : Math.sign(this.speed);
    // Acceleration / braking / reverse.
    if (control.throttle > 0) this.speed += d.accel * control.throttle * dt;
    else if (control.throttle < 0) {
      if (this.speed > 0.5) this.speed -= d.accel * 2.2 * dt; // brake
      else this.speed += d.accel * 0.6 * control.throttle * dt; // reverse
    }
    // Drag + rolling resistance.
    this.speed -= this.speed * 0.35 * dt;
    if (Math.abs(this.speed) < 0.05 && control.throttle === 0) this.speed = 0;
    this.speed = clamp(this.speed, -d.top * 0.4, d.top);
    if (control.handbrake) {
      this.speed -= this.speed * 1.8 * dt;
      if (Math.abs(this.speed) > 8 && Math.random() < 0.5) {
        const back = this.pos.clone().addScaledVector(this.forward, -d.len / 2);
        effects.skidMark(back.x, back.z, this.heading);
      }
    }
    // Steering: less at speed, reversed when reversing.
    const steerTarget = control.steer * clamp(1.15 - Math.abs(this.speed) / d.top * 0.75, 0.35, 1.15);
    this.steer = lerp(this.steer, steerTarget, Math.min(1, dt * 8));
    const turnRate = this.steer * (0.9 + clamp(Math.abs(this.speed) / 10, 0, 1.1)) * fwd;
    this.heading += turnRate * dt * clamp(Math.abs(this.speed) / 6, 0, 1) * (control.handbrake ? 1.5 : 1);
    // Move.
    const step = this.forward.multiplyScalar(this.speed * dt);
    const nx = this.pos.x + step.x;
    const nz = this.pos.z + step.z;
    const before = this.cityResolve(nx, nz, city);
    const hitWall = before.hit;
    this.pos.x = before.x; this.pos.z = before.z;
    if (hitWall && Math.abs(this.speed) > 4) {
      const impact = Math.abs(this.speed);
      this.damage(impact * 1.4, effects, audio);
      effects.sparks(this.pos.clone().addScaledVector(this.forward, d.len / 2));
      audio?.crash();
      this.speed *= -0.25;
    }
    // Smoke when hurt.
    if (this.hp < 50 && !this.dead) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        effects.smoke(this.pos.clone().add(new THREE.Vector3(0, 1, d.len / 3)));
        this.smokeT = 0.2;
      }
    }
    this.syncMesh(dt);
  }

  cityResolve(x, z, city) {
    // Two circles: front and rear, so the car cannot clip corners.
    const f = this.forward;
    const r = this.def.wid * 0.72;
    const fx = x + f.x * this.def.len * 0.32, fz = z + f.z * this.def.len * 0.32;
    const bx = x - f.x * this.def.len * 0.32, bz = z - f.z * this.def.len * 0.32;
    const rf = city.resolveCircle(fx, fz, r);
    const rb = city.resolveCircle(bx, bz, r);
    const hit = rf.x !== fx || rf.z !== fz || rb.x !== bx || rb.z !== bz;
    const cx = (rf.x + rb.x) / 2, cz = (rf.z + rb.z) / 2;
    return { x: clamp(cx, -260, 258), z: clamp(cz, -260, 260), hit };
  }

  syncMesh(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    for (const w of this.wheels) {
      w.mesh.rotation.x += (this.speed / WHEEL_R) * dt;
      if (w.front) w.pivot.rotation.y = this.steer * 0.45;
    }
    if (this.type === 'police' && this.siren) {
      this.flashT += dt;
      const on = Math.floor(this.flashT * 6) % 2 === 0;
      this.lightL.material.color.set(on ? 0xff2222 : 0x551111);
      this.lightR.material.color.set(on ? 0x111155 : 0x2244ff);
    }
  }

  dispose(scene) { scene.remove(this.group); }
}
Vehicle.nextId = 1;

// ---- Helpers over the whole car list ----
export function nearestVehicle(vehicles, x, z, maxDist) {
  let best = null, bd = maxDist;
  for (const v of vehicles) {
    if (v.dead) continue;
    const d = Math.hypot(v.pos.x - x, v.pos.z - z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// Circle-circle push between cars; returns pairs that crashed hard.
export function collideVehicles(vehicles, effects, audio, onCrash) {
  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    if (a.dead) continue;
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      if (b.dead) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const min = (a.def.wid + b.def.wid) / 2 + 0.4;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = dx / d, nz = dz / d;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
      const relSpeed = Math.abs(a.speed - b.speed);
      if (relSpeed > 5) {
        a.damage(relSpeed * 0.9, effects, audio);
        b.damage(relSpeed * 0.9, effects, audio);
        effects.sparks(new THREE.Vector3((a.pos.x + b.pos.x) / 2, 0.8, (a.pos.z + b.pos.z) / 2));
        a.speed *= 0.6; b.speed *= 0.6;
        onCrash?.(a, b, relSpeed);
      } else if (relSpeed > 1) {
        a.speed *= 0.92; b.speed *= 0.92;
      }
      // Near-stationary contact only pushes apart — no speed grind.
    }
  }
}
