// Pedestrians: sidewalk walkers with a walk cycle who flee from gunshots,
// explosions and speeding cars. Built from the same box person as the player.

import * as THREE from 'three';
import { GRID_LINES, ROAD_WIDTH, clamp } from './config.js';
import { buildPersonMesh } from './player.js';
import { pick, range, chance } from './rng.js';

const SHIRTS = [0xe8632c, 0x2e8f86, 0xf2c230, 0xd9455f, 0x6a8ac2, 0x9a6ac2, 0x4a9a5a, 0xe8e8e8];
const PANTS = [0x2a2f3a, 0x4a3a2a, 0x3a4a5a, 0x5a5a5a];
const SKINS = [0xc98a5a, 0x8a5a3a, 0xe8b88a, 0x6a4a2a];

export class Pedestrians {
  constructor(scene, city, rng) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.peds = []; // { mesh parts, pos, heading, speed, state, fleeT, phase }
    this.spawnTimer = 0;
  }

  spawnNear(playerPos) {
    const rng = this.rng;
    for (let tries = 0; tries < 10; tries++) {
      // Stand on a sidewalk: just off a road line, on a block edge.
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const line = pick(rng, GRID_LINES);
      const along = range(rng, -150, 150);
      const side = chance(rng, 0.5) ? 1 : -1;
      const off = (ROAD_WIDTH / 2 + 2.5) * side;
      const x = axis === 'x' ? along : line + off;
      const z = axis === 'x' ? line + off : along;
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < 12 || d > 120) continue;
      if (this.city.pointInCollider(x, z)) continue;
      const parts = buildPersonMesh(pick(rng, SHIRTS), pick(rng, PANTS), pick(rng, SKINS), pick(rng, [0x1a1a1a, 0x4a2a1a, 0x8a8a8a, 0x2a1a0a]));
      parts.group.position.set(x, 0, z);
      this.scene.add(parts.group);
      const dir = chance(rng, 0.5) ? 1 : -1;
      this.peds.push({
        parts, pos: parts.group.position,
        heading: axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
        axis, dir, speed: range(rng, 1.4, 2.4), state: 'walk', fleeT: 0,
        phase: range(rng, 0, 6), fleeFrom: new THREE.Vector3(),
      });
      return;
    }
  }

  ensureCount(playerPos, want = 22) {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z) > 150) {
        this.scene.remove(p.parts.group);
        this.peds.splice(i, 1);
      }
    }
    this.spawnTimer -= 1 / 60;
    if (this.peds.length < want && this.spawnTimer <= 0) {
      this.spawnNear(playerPos);
      this.spawnTimer = 0.25;
    }
  }

  // Loud event: everyone nearby runs away from it.
  alert(pos, radius) {
    for (const p of this.peds) {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < radius && p.state !== 'flee') {
        p.state = 'flee';
        p.fleeT = range(this.rng, 2.5, 5);
        p.fleeFrom.copy(pos);
      }
    }
  }

  update(dt, playerPos, playerCar) {
    this.ensureCount(playerPos);
    for (const p of this.peds) {
      // A fast car bearing down also scares them.
      if (p.state === 'walk' && playerCar && Math.abs(playerCar.speed) > 12) {
        const d = Math.hypot(p.pos.x - playerCar.pos.x, p.pos.z - playerCar.pos.z);
        if (d < 8) { p.state = 'flee'; p.fleeT = 3; p.fleeFrom.copy(playerCar.pos); }
      }
      let speed = p.speed;
      if (p.state === 'flee') {
        speed = 6.5;
        p.fleeT -= dt;
        const away = Math.atan2(p.pos.x - p.fleeFrom.x, p.pos.z - p.fleeFrom.z);
        p.heading = away;
        if (p.fleeT <= 0) p.state = 'walk';
      } else {
        // Keep walking along the sidewalk; turn around at the block edge.
        const alongVal = p.axis === 'x' ? p.pos.x : p.pos.z;
        if (Math.abs(alongVal) > 165 || chance(this.rng, dt * 0.02)) p.dir *= -1;
        p.heading = p.axis === 'x' ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
      }
      p.pos.x += Math.sin(p.heading) * speed * dt;
      p.pos.z += Math.cos(p.heading) * speed * dt;
      p.pos.x = clamp(p.pos.x, -170, 250);
      p.pos.z = clamp(p.pos.z, -170, 170);
      const fixed = this.city.resolveCircle(p.pos.x, p.pos.z, 0.5);
      p.pos.x = fixed.x; p.pos.z = fixed.z;
      p.parts.group.rotation.y = p.heading;
      // Walk cycle.
      p.phase += dt * (p.state === 'flee' ? 13 : 8);
      const s = Math.sin(p.phase) * (p.state === 'flee' ? 0.9 : 0.55);
      p.parts.legL.rotation.x = s; p.parts.legR.rotation.x = -s;
      p.parts.armL.rotation.x = -s * 0.8; p.parts.armR.rotation.x = s * 0.8;
    }
  }

  // Nearest ped to a point (for punching / running over).
  nearest(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const p of this.peds) {
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  remove(ped) {
    this.scene.remove(ped.parts.group);
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
  }
}
