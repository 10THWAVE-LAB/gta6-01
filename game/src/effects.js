// Particles (sparks, smoke, dust, explosion) and fading skid marks.
// One pooled THREE.Points cloud per effect type keeps draw calls low.

import * as THREE from 'three';

const MAX_PARTICLES = 900;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.55, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Skid marks: pool of dark quads laid flat on the road.
    this.skidPool = [];
    const skidGeo = new THREE.PlaneGeometry(0.35, 1.4);
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.position.y = 0.06;
      scene.add(m);
      this.skidPool.push({ mesh: m, life: 0 });
    }
    this.skidIdx = 0;
    this.flashLight = new THREE.PointLight(0xffa040, 0, 30);
    scene.add(this.flashLight);
    this.flashLife = 0;
  }

  burst(pos, { count = 12, color = 0xffcc66, speed = 6, life = 0.7, up = 3, size = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.parts.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * s, vy: up * Math.random() + 1, vz: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.7), maxLife: life,
        r: c.r, g: c.g, b: c.b, size,
      });
    }
  }

  sparks(pos) { this.burst(pos, { count: 14, color: 0xffd27a, speed: 9, life: 0.5, up: 4 }); }
  smoke(pos) { this.burst(pos, { count: 4, color: 0x555555, speed: 1.5, life: 1.2, up: 2.5 }); }
  dust(pos) { this.burst(pos, { count: 4, color: 0xcbb59a, speed: 1.2, life: 0.6, up: 1 }); }
  blood(pos) { this.burst(pos, { count: 8, color: 0xb02020, speed: 3, life: 0.5, up: 2 }); }
  explosion(pos) {
    this.burst(pos, { count: 60, color: 0xff7a1a, speed: 12, life: 0.9, up: 7 });
    this.burst(pos, { count: 30, color: 0x333333, speed: 4, life: 2.2, up: 5 });
    this.burst(pos, { count: 20, color: 0xffe08a, speed: 16, life: 0.4, up: 5 });
    this.flashLight.position.copy(pos).y += 2;
    this.flashLight.intensity = 60;
    this.flashLife = 0.35;
  }

  skidMark(x, z, heading) {
    const s = this.skidPool[this.skidIdx];
    this.skidIdx = (this.skidIdx + 1) % this.skidPool.length;
    s.mesh.position.set(x, 0.06, z);
    s.mesh.rotation.z = -heading;
    s.mesh.visible = true;
    s.mesh.material.opacity = 0.55;
    s.life = 14; // seconds before fading out
  }

  update(dt) {
    // Particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
    }
    const n = this.parts.length;
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const f = p.life / p.maxLife;
      this.positions[i * 3] = p.x; this.positions[i * 3 + 1] = p.y; this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.r * f + 0.05; this.colors[i * 3 + 1] = p.g * f + 0.05; this.colors[i * 3 + 2] = p.b * f + 0.05;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    // Skid fade
    for (const s of this.skidPool) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      if (s.life < 3) s.mesh.material.opacity = 0.55 * (s.life / 3);
    }

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 200);
    }
  }
}
