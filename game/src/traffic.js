// AI traffic: cars that follow the road grid with right-hand lanes, turn
// at intersections, brake for the car ahead, and respawn around the player.

import * as THREE from 'three';
import { GRID_LINES, ROAD_WIDTH, clamp, angleLerp } from './config.js';
import { Vehicle } from './vehicles.js';
import { pick, range, chance } from './rng.js';

const TRAFFIC_TYPES = ['sedan', 'sedan', 'suv', 'van', 'taxi', 'sports'];

export class Traffic {
  constructor(scene, city, rng, vehicles, effects, audio) {
    this.scene = scene; this.city = city; this.rng = rng;
    this.vehicles = vehicles; // shared master list
    this.effects = effects; this.audio = audio;
    this.cars = []; // { v, axis, line, dir }
    this.spawnTimer = 0;
  }

  laneOffset(axis, dir) {
    // Right-hand traffic: offset from the centre line.
    if (axis === 'x') return dir > 0 ? 2.6 : -2.6;
    return dir > 0 ? -2.6 : 2.6;
  }

  spawnNear(playerPos, minDist = 40, maxDist = 130) {
    const rng = this.rng;
    for (let tries = 0; tries < 12; tries++) {
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const line = pick(rng, GRID_LINES);
      const dir = chance(rng, 0.5) ? 1 : -1;
      const along = range(rng, -150, 150);
      const off = this.laneOffset(axis, dir);
      const x = axis === 'x' ? along : line + off;
      const z = axis === 'x' ? line + off : along;
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < minDist || d > maxDist) continue;
      if (this.city.pointInCollider(x, z)) continue;
      const type = pick(rng, TRAFFIC_TYPES);
      const v = new Vehicle(this.scene, type, pick(rng, [0x9fb4c7, 0x7a2e2e, 0x2e4a6b, 0xd8d3c8, 0x3d5a3a, 0x8a6b3a, 0xe8632c, 0x22b8a6]),
        x, z, axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
        { driver: 'traffic' });
      v.speed = range(rng, 6, 10);
      this.vehicles.push(v);
      this.cars.push({ v, axis, line, dir, stuckT: 0, targetSpeed: range(rng, 8, 13) });
      return;
    }
  }

  ensureCount(playerPos, want = 14) {
    // Despawn far cars.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const d = Math.hypot(c.v.pos.x - playerPos.x, c.v.pos.z - playerPos.z);
      if (d > 170 || c.v.dead) {
        c.v.dispose(this.scene);
        this.vehicles.splice(this.vehicles.indexOf(c.v), 1);
        this.cars.splice(i, 1);
      }
    }
    this.spawnTimer -= 1 / 60;
    if (this.cars.length < want && this.spawnTimer <= 0) {
      this.spawnNear(playerPos);
      this.spawnTimer = 0.4;
    }
  }

  // Is another vehicle directly ahead within dist?
  blockedAhead(c, dist) {
    const f = c.v.forward;
    for (const o of this.vehicles) {
      if (o === c.v || o.dead) continue;
      const dx = o.pos.x - c.v.pos.x, dz = o.pos.z - c.v.pos.z;
      const ahead = dx * f.x + dz * f.z;
      if (ahead > 0 && ahead < dist && Math.abs(dx * f.z - dz * f.x) < 2.4) return true;
    }
    return false;
  }

  update(dt, playerPos, effects, audio) {
    this.ensureCount(playerPos);
    for (const c of this.cars) {
      const v = c.v;
      if (v.dead) continue;
      // Lane target: a point ahead on the current lane.
      const off = this.laneOffset(c.axis, c.dir);
      let tx, tz;
      if (c.axis === 'x') { tx = v.pos.x + c.dir * 14; tz = c.line + off; }
      else { tx = c.line + off; tz = v.pos.z + c.dir * 14; }
      // Maybe turn at an intersection.
      const cross = GRID_LINES.find((l) => Math.abs((c.axis === 'x' ? v.pos.z : v.pos.x) - l) < 1.5);
      const alongVal = c.axis === 'x' ? v.pos.x : v.pos.z;
      const nearCross = GRID_LINES.some((l) => Math.abs(alongVal - l) < 3);
      if (nearCross && chance(this.rng, dt * 0.35)) {
        const newLine = GRID_LINES.reduce((a, b) => Math.abs(alongVal - a) < Math.abs(alongVal - b) ? a : b);
        c.axis = c.axis === 'x' ? 'z' : 'x';
        c.line = newLine;
        c.dir = chance(this.rng, 0.5) ? 1 : -1;
        if (c.axis === 'x') { tx = v.pos.x + c.dir * 14; tz = c.line + this.laneOffset('x', c.dir); }
        else { tx = c.line + this.laneOffset('z', c.dir); tz = v.pos.z + c.dir * 14; }
      }
      // Steer toward the lane target.
      const wantHeading = Math.atan2(tx - v.pos.x, tz - v.pos.z);
      let dh = wantHeading - v.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const steer = clamp(dh * 1.8, -1, 1);
      const blocked = this.blockedAhead(c, 11);
      const throttle = blocked ? (v.speed > 0.5 ? -1 : 0) : (v.speed < c.targetSpeed ? 0.7 : 0.1);
      v.drive(dt, { throttle, steer, handbrake: false }, this.city, effects, audio);
      // Stuck? Nudge a turn.
      if (Math.abs(v.speed) < 0.5 && !blocked) {
        c.stuckT += dt;
        if (c.stuckT > 2.5) { c.dir *= -1; c.stuckT = 0; }
      } else c.stuckT = 0;
    }
  }
}
