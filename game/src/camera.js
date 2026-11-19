// Third-person camera rig: mouse orbit on foot, chase cam behind the car,
// speed FOV kick and trauma-based shake.

import * as THREE from 'three';
import { clamp, lerp, angleLerp } from './config.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;      // direction the camera looks (radians)
    this.pitch = 0.18; // up/down
    this.dist = 7;
    this.trauma = 0;
    this.fov = 62;
    this.mouseIdle = 0;
    this.holdPitch = null; // when set, the pitch stays framed (screenshot mode)
  }

  addShake(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }

  update(dt, target, targetHeading, speed, driving, mouse) {
    // Mouse look.
    if (mouse.x !== 0 || mouse.y !== 0) {
      this.yaw -= mouse.x * 0.0026;
      this.pitch = clamp(this.pitch + mouse.y * 0.0022, -0.12, 0.62);
      this.mouseIdle = 0;
    } else {
      this.mouseIdle += dt;
    }
    // While driving, the camera drifts back behind the car when idle.
    if (driving && this.mouseIdle > 1.2 && speed > 3) {
      this.yaw = angleLerp(this.yaw, targetHeading, Math.min(1, dt * 1.6));
      if (this.holdPitch === null) this.pitch = lerp(this.pitch, 0.16, Math.min(1, dt * 2));
    }
    if (this.holdPitch !== null) this.pitch = this.holdPitch;
    const wantDist = driving ? 10.5 + Math.min(2.5, speed * 0.05) : 6.5;
    this.dist = lerp(this.dist, wantDist, Math.min(1, dt * 3));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const look = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const eye = target.clone().add(new THREE.Vector3(0, 3.0, 0)).addScaledVector(look, -this.dist);
    if (eye.y < 2.0) eye.y = 2.0;
    // Shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    eye.x += (Math.random() - 0.5) * sh * 0.7;
    eye.y += (Math.random() - 0.5) * sh * 0.5;
    this.camera.position.copy(eye);
    this.camera.lookAt(target.x, target.y + 1.6, target.z);
    // FOV kick with speed.
    const wantFov = 62 + clamp(speed * 0.35, 0, 14);
    this.fov = lerp(this.fov, wantFov, Math.min(1, dt * 4));
    if (Math.abs(this.camera.fov - this.fov) > 0.1) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
