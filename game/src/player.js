// Dante Reyes on foot: third-person character, run/jump, enter/exit cars,
// health + armour. The mesh is built from boxes with a walk-cycle swing.

import * as THREE from 'three';
import { PLAYER, clamp, angleLerp } from './config.js';

export function buildPersonMesh(shirt, pants, skin, hair) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.34), mat(shirt));
  torso.position.y = 1.12;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), mat(skin));
  head.position.y = 1.78;
  g.add(head);
  const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.44), mat(hair));
  hairM.position.y = 2.0;
  g.add(hairM);
  const mkLimb = (w, h, d, x, y, color) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const legL = mkLimb(0.24, 0.8, 0.26, -0.17, 0.8, pants);
  const legR = mkLimb(0.24, 0.8, 0.26, 0.17, 0.8, pants);
  const armL = mkLimb(0.18, 0.7, 0.2, -0.42, 1.45, shirt);
  const armR = mkLimb(0.18, 0.7, 0.2, 0.42, 1.45, shirt);
  return { group: g, legL, legR, armL, armR, torso, head };
}

export class Player {
  constructor(scene, city, effects, audio) {
    this.scene = scene; this.city = city; this.effects = effects; this.audio = audio;
    const m = buildPersonMesh(0x2e8f86, 0x2a2f3a, 0xc98a5a, 0x1a1a1a);
    this.mesh = m.group;
    this.limbs = m;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, 0, -24);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.onGround = true;
    this.walkPhase = 0;
    this.moving = false;
    this.running = false;
    this.health = PLAYER.maxHealth;
    this.armour = 0;
    this.money = PLAYER.startMoney;
    this.car = null; // Vehicle when driving
    this.stepTimer = 0;
    this.dead = false;
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  get speed() { return this.car ? Math.abs(this.car.speed) : this.vel.length(); }

  teleport(x, z, heading = 0) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel.set(0, 0, 0);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;
  }

  takeDamage(amount, fromPos) {
    if (this.dead) return false;
    let rest = amount;
    if (this.armour > 0) {
      const absorbed = Math.min(this.armour, rest * 0.6);
      this.armour -= absorbed; rest -= absorbed;
    }
    this.health -= rest;
    this.effects.blood(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    if (this.health <= 0) { this.health = 0; this.dead = true; }
    return this.dead;
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, PLAYER.maxHealth); }
  addArmour(amount) { this.armour = clamp(this.armour + amount, 0, PLAYER.maxArmour); }
  addMoney(amount) { this.money += amount; }

  // On-foot movement, camera-relative. camYaw: direction the camera looks.
  updateOnFoot(dt, input, camYaw) {
    const axes = input.moveAxes();
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    this.running = run && (axes.x !== 0 || axes.y !== 0);
    // Camera-relative move direction.
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    let mx = 0, mz = 0;
    if (axes.y !== 0 || axes.x !== 0) {
      mx = sin * axes.y + cos * axes.x;
      mz = cos * axes.y - sin * axes.x;
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      this.heading = angleLerp(this.heading, Math.atan2(mx, mz), Math.min(1, dt * 12));
    }
    this.moving = axes.x !== 0 || axes.y !== 0;
    this.vel.x = mx * speed;
    this.vel.z = mz * speed;
    // Jump + gravity.
    if (input.pressed('Space') && this.onGround) { this.vel.y = PLAYER.jumpSpeed; this.onGround = false; }
    this.vel.y -= PLAYER.gravity * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    // World bounds + building collisions.
    this.pos.x = clamp(this.pos.x, -WORLD_BOUND, WORLD_BOUND);
    this.pos.z = clamp(this.pos.z, -WORLD_BOUND, WORLD_BOUND);
    const fixed = this.city.resolveCircle(this.pos.x, this.pos.z, PLAYER.radius);
    this.pos.x = fixed.x; this.pos.z = fixed.z;
    // Walk animation.
    if (this.moving && this.onGround) {
      this.walkPhase += dt * (run ? 13 : 9);
      const s = Math.sin(this.walkPhase) * (run ? 0.85 : 0.6);
      this.limbs.legL.rotation.x = s; this.limbs.legR.rotation.x = -s;
      this.limbs.armL.rotation.x = -s * 0.8; this.limbs.armR.rotation.x = s * 0.8;
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.audio.footstep(); this.stepTimer = run ? 0.28 : 0.4; }
    } else {
      this.limbs.legL.rotation.x *= 0.8; this.limbs.legR.rotation.x *= 0.8;
      this.limbs.armL.rotation.x *= 0.8; this.limbs.armR.rotation.x *= 0.8;
    }
    this.syncMesh();
  }

  enterCar(car) {
    this.car = car;
    car.driver = 'player';
    this.mesh.visible = false;
    this.pos.copy(car.pos);
    this.heading = car.heading;
  }

  exitCar() {
    if (!this.car) return;
    const car = this.car;
    car.driver = null;
    car.speed = 0;
    // Step out on the left side.
    const side = new THREE.Vector3(Math.cos(car.heading), 0, -Math.sin(car.heading));
    this.pos.copy(car.pos).addScaledVector(side, 2.2);
    this.pos.y = 0;
    const fixed = this.city.resolveCircle(this.pos.x, this.pos.z, PLAYER.radius);
    this.pos.x = fixed.x; this.pos.z = fixed.z;
    this.heading = car.heading;
    this.car = null;
    this.mesh.visible = true;
    this.syncMesh();
  }

  update(dt) {
    if (this.car) {
      this.pos.copy(this.car.pos);
      this.pos.y = 0;
      this.heading = this.car.heading;
    }
  }
}

const WORLD_BOUND = 260;
