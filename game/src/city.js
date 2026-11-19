// Solmar City: sunset coastal grid city. Builds the ground, roads, blocks,
// buildings with lit windows, palms, beach, sea, pier, harbour and props.
// Returns colliders (AABBs), the road network and named locations.

import * as THREE from 'three';
import { GRID_LINES, ROAD_SPACING, ROAD_WIDTH, WORLD_HALF, BEACH_X, WATER_X, PIER, SKY_TOP, SKY_HORIZON, SUN_COLOR, FOG_COLOR } from './config.js';
import { range, int, pick, chance } from './rng.js';

export const LOCATIONS = {
  garage:    { x: -72, z: -120, name: "Tomas's Garage" },
  motel:     { x: 120, z: -72,  name: 'Palm Court Motel' },
  harbor:    { x: 120, z: 120,  name: 'Solmar Harbor' },
  safehouse: { x: -120, z: 72,  name: 'Safehouse' },
  mansion:   { x: 120, z: 24,   name: 'Voss Mansion' },
  pierEnd:   { x: PIER.x + PIER.len / 2 - 6, z: PIER.z, name: 'Sunset Pier' },
  downtown:  { x: 0, z: 0, name: 'Downtown Solmar' },
  beach:     { x: 205, z: -48, name: 'Sunset Beach' },
};

// Blocks kept open for missions (no random buildings).
const RESERVED = new Set(['-72,-120', '120,-72', '120,120', '72,120', '-120,72', '120,24', '120,72']);
const BLOCK_CENTERS = [-120, -72, -24, 24, 72, 120];

function windowTexture(base, litRatio, rng) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  // Subtle vertical shading.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 6; col++) {
      const lit = rng() < litRatio;
      g.fillStyle = lit ? (rng() < 0.7 ? '#ffd98a' : '#ffeec2') : '#2a3542';
      g.fillRect(6 + col * 20, 8 + row * 20, 13, 12);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dashTexture() {
  // Dash runs along U (the road's length): one tile per ~7 units of road.
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#23262b'; g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#cfcfcf'; g.fillRect(8, 7, 20, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 1);
  return t;
}

export class City {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = []; // {minX,maxX,minZ,maxZ}
    this.roads = GRID_LINES.slice();
    this.palmPositions = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._skyAndLights();
    this._ground();
    this._roads();
    this._blocks();
    this._landmarks();
    this._palmsAndProps();
    this._beachAndSea();
    this._pier();
  }

  addCollider(x, z, w, d) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  // Push a circle (x,z,r) out of all AABBs. Returns corrected {x,z}.
  resolveCircle(x, z, r) {
    for (const c of this.colliders) {
      const nx = Math.max(c.minX, Math.min(x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * r; z = nz + (dz / d) * r;
        } else {
          // Centre inside the box: push out along the smallest penetration.
          const pl = x - c.minX + r, pr = c.maxX - x + r;
          const pt = z - c.minZ + r, pb = c.maxZ - z + r;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
          else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
        }
      }
    }
    return { x, z };
  }

  pointInCollider(x, z) {
    return this.colliders.some((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ);
  }

  onRoad(x, z) {
    const near = (v) => GRID_LINES.some((l) => Math.abs(v - l) < ROAD_WIDTH / 2 + 1);
    return near(x) || near(z);
  }

  nearestRoadPoint(x, z) {
    // Snap to the closest road centre line.
    let bx = GRID_LINES[0], bz = GRID_LINES[0];
    for (const l of GRID_LINES) {
      if (Math.abs(x - l) < Math.abs(x - bx)) bx = l;
      if (Math.abs(z - l) < Math.abs(z - bz)) bz = l;
    }
    return Math.abs(x - bx) < Math.abs(z - bz) ? { x: bx, z, along: 'z' } : { x, z: bz, along: 'x' };
  }

  _skyAndLights() {
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY_TOP) }, bottom: { value: new THREE.Color(SKY_HORIZON) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y * 0.5 + 0.5; vec3 c = mix(bottom, top, pow(h, 0.75)); gl_FragColor = vec4(pow(c, vec3(0.4545)), 1.0); }',
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    this.scene.fog = new THREE.Fog(FOG_COLOR, 130, 520);

    const sun = new THREE.DirectionalLight(SUN_COLOR, 2.4);
    sun.position.set(-180, 90, -60);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xffc890, 0x4a3a52, 0.9));
    const amb = new THREE.AmbientLight(0xffd0a0, 0.25);
    this.scene.add(amb);

    // Low sun disc in the west.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(34, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false, transparent: true, opacity: 0.95 }),
    );
    disc.position.set(-560, 58, -140);
    disc.lookAt(0, 58, 0);
    this.scene.add(disc);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(60, 32),
      new THREE.MeshBasicMaterial({ color: 0xff9a56, fog: false, transparent: true, opacity: 0.35 }),
    );
    glow.position.copy(disc.position).x += 2;
    glow.lookAt(0, 58, 0);
    this.scene.add(glow);
  }

  _ground() {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshLambertMaterial({ color: 0x8a8d90 }),
    );
    g.rotation.x = -Math.PI / 2; g.position.y = -0.05;
    this.group.add(g);
  }

  _roads() {
    const dash = dashTexture();
    const roadMat = new THREE.MeshLambertMaterial({ map: dash, color: 0xffffff });
    const len = WORLD_HALF * 2 + 60;
    for (const l of GRID_LINES) {
      const rx = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_WIDTH), roadMat);
      rx.rotation.x = -Math.PI / 2; rx.position.set(0, 0.02, l);
      this.group.add(rx);
      const rz = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_WIDTH), roadMat);
      rz.rotation.x = -Math.PI / 2; rz.rotation.z = Math.PI / 2; rz.position.set(l, 0.02, 0);
      this.group.add(rz);
    }
    // Sidewalk slabs per block.
    const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a8 });
    for (const bx of BLOCK_CENTERS) for (const bz of BLOCK_CENTERS) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(ROAD_SPACING - ROAD_WIDTH + 4, 0.25, ROAD_SPACING - ROAD_WIDTH + 4), walkMat);
      slab.position.set(bx, 0.1, bz);
      this.group.add(slab);
    }
  }

  _building(x, z, w, h, d, texBase) {
    const tex = windowTexture(texBase, 0.42, this.rng);
    tex.repeat.set(Math.max(1, Math.round(w / 10)), Math.max(1, Math.round(h / 12)));
    const side = new THREE.MeshLambertMaterial({ map: tex });
    const roof = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roof, roof, side, side]);
    m.position.set(x, h / 2 + 0.22, z);
    this.group.add(m);
    this.addCollider(x, z, w, d);
    // Rooftop AC unit for silhouette variety.
    if (chance(this.rng, 0.5)) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), roof);
      ac.position.set(x + range(this.rng, -w / 4, w / 4), h + 0.7, z + range(this.rng, -d / 4, d / 4));
      this.group.add(ac);
    }
    return m;
  }

  _blocks() {
    const bases = ['#7a6a58', '#5d6b7a', '#8a7a6a', '#6b5a6e', '#746a5a', '#5a6e62'];
    for (const bx of BLOCK_CENTERS) for (const bz of BLOCK_CENTERS) {
      if (RESERVED.has(`${bx},${bz}`)) continue;
      const downtown = Math.abs(bx) <= 24 && Math.abs(bz) <= 24;
      const count = downtown ? int(this.rng, 1, 2) : int(this.rng, 1, 3);
      for (let i = 0; i < count; i++) {
        const w = range(this.rng, 12, 20), d = range(this.rng, 12, 20);
        const h = downtown ? range(this.rng, 22, 46) : range(this.rng, 7, 20);
        const ox = count === 1 ? 0 : range(this.rng, -8, 8);
        const oz = count === 1 ? 0 : range(this.rng, -8, 8);
        this._building(bx + ox, bz + oz, w, h, d, pick(this.rng, bases));
      }
      // A palm or two on the block corner.
      if (chance(this.rng, 0.6)) this.palmPositions.push({ x: bx + 15, z: bz + 15 });
    }
  }

  _landmarks() {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xd8cfc0 });
    const accent = new THREE.MeshLambertMaterial({ color: 0x2e8f86 });
    // Tomas's garage: low workshop with a teal awning.
    const g = LOCATIONS.garage;
    const shop = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 12), wallMat);
    shop.position.set(g.x - 6, 3.2, g.z - 8);
    this.group.add(shop); this.addCollider(g.x - 6, g.z - 8, 18, 12);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 5), accent);
    awn.position.set(g.x - 6, 5.2, g.z - 1);
    this.group.add(awn);
    // Palm Court Motel: long two-storey block.
    const m = LOCATIONS.motel;
    this._building(m.x, m.z - 6, 26, 9, 10, '#c9a06a');
    // Harbor: container stacks + warehouse.
    const h = LOCATIONS.harbor;
    const contColors = [0xc25a3a, 0x3a7ac2, 0x4a9a5a, 0xc2a23a];
    for (let i = 0; i < 10; i++) {
      const cx = h.x - 14 + (i % 5) * 7;
      const cz = h.z - 10 + Math.floor(i / 5) * 8;
      const stack = int(this.rng, 1, 3);
      for (let s = 0; s < stack; s++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(6, 2.6, 2.6),
          new THREE.MeshLambertMaterial({ color: pick(this.rng, contColors) }),
        );
        box.position.set(cx, 1.5 + s * 2.7, cz);
        this.group.add(box);
      }
      this.addCollider(cx, cz, 6, 2.6);
    }
    const wh = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 14), new THREE.MeshLambertMaterial({ color: 0x9a938a }));
    wh.position.set(h.x + 12, 4.2, h.z + 10);
    this.group.add(wh); this.addCollider(h.x + 12, h.z + 10, 20, 14);
    // Safehouse: small bungalow with a porch.
    const s = LOCATIONS.safehouse;
    const house = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 8), new THREE.MeshLambertMaterial({ color: 0xe8dcc8 }));
    house.position.set(s.x, 2.7, s.z);
    this.group.add(house); this.addCollider(s.x, s.z, 10, 8);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(8, 3, 4), new THREE.MeshLambertMaterial({ color: 0xa34a2e }));
    roof.position.set(s.x, 6.7, s.z); roof.rotation.y = Math.PI / 4;
    this.group.add(roof);
    // Voss mansion: white villa + wall near the beach.
    const v = LOCATIONS.mansion;
    this._building(v.x, v.z, 22, 11, 16, '#e8e2d4');
    const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 2.2, 0.6), wallMat);
    wall.position.set(v.x - 2, 1.3, v.z + 12);
    this.group.add(wall); this.addCollider(v.x - 2, v.z + 12, 30, 0.6);
  }

  _makePalm(x, z, s = 1) {
    const palm = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 7 * s, 6), trunkMat);
    trunk.position.y = 3.5 * s;
    trunk.rotation.z = range(this.rng, -0.12, 0.12);
    palm.add(trunk);
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f9e44, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * s, 3.4 * s), frondMat);
      const a = (i / 7) * Math.PI * 2;
      frond.position.set(Math.cos(a) * 1.2 * s, 7 * s, Math.sin(a) * 1.2 * s);
      frond.rotation.set(Math.PI / 2.6, a, 0, 'YXZ');
      frond.rotation.y = -a + Math.PI / 2;
      frond.rotation.x = -0.9;
      palm.add(frond);
    }
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 6, 6), new THREE.MeshLambertMaterial({ color: 0x5a3a1a }));
    nut.position.y = 6.8 * s;
    palm.add(nut);
    palm.position.set(x, 0, z);
    this.group.add(palm);
  }

  _palmsAndProps() {
    // Palm boulevard along the beach road.
    for (let z = -168; z <= 168; z += 16) {
      this._makePalm(172, z + range(this.rng, -2, 2), range(this.rng, 0.9, 1.25));
      if (chance(this.rng, 0.5)) this._makePalm(186, z + 8, range(this.rng, 0.8, 1.1));
    }
    for (const p of this.palmPositions) this._makePalm(p.x, p.z, range(this.rng, 0.85, 1.1));
    // Streetlights at intersections.
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });
    for (const x of GRID_LINES) for (const z of GRID_LINES) {
      if (!chance(this.rng, 0.5)) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
      pole.position.set(x + 7, 3.5, z + 7);
      this.group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), lampMat);
      lamp.position.set(x + 7, 7.1, z + 7);
      this.group.add(lamp);
    }
    // Beach umbrellas.
    const umbColors = [0xe8632c, 0x2e8f86, 0xf2c230, 0xd9455f];
    for (let i = 0; i < 14; i++) {
      const x = range(this.rng, 190, 240), z = range(this.rng, -160, 160);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), poleMat);
      pole.position.set(x, 1.2, z);
      this.group.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(2, 0.8, 8), new THREE.MeshLambertMaterial({ color: pick(this.rng, umbColors) }));
      top.position.set(x, 2.6, z);
      this.group.add(top);
    }
  }

  _beachAndSea() {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(WATER_X - BEACH_X + 30, 900),
      new THREE.MeshLambertMaterial({ color: 0xe8d5a8 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((BEACH_X + WATER_X) / 2, 0.01, 0);
    this.group.add(sand);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 1200),
      new THREE.MeshPhongMaterial({ color: 0x1a7a8a, shininess: 90, transparent: true, opacity: 0.94 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(WATER_X + 250, 0.05, 0);
    this.group.add(sea);
    // Foam line where the waves meet the sand.
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 900),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(WATER_X - 1, 0.08, 0);
    this.group.add(foam);
  }

  _pier() {
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(PIER.len, 0.5, PIER.w), wood);
    deck.position.set(PIER.x, 0.6, PIER.z);
    this.group.add(deck);
    for (let i = 0; i < 8; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 6), wood);
      post.position.set(PIER.x - PIER.len / 2 + 8 + i * 11, -0.6, PIER.z + PIER.w / 2 - 0.5);
      this.group.add(post);
    }
    // Hut at the end of the pier.
    const hut = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), new THREE.MeshLambertMaterial({ color: 0xc9b18a }));
    hut.position.set(PIER.x + PIER.len / 2 - 8, 2.8, PIER.z);
    this.group.add(hut);
    this.addCollider(PIER.x + PIER.len / 2 - 8, PIER.z, 6, 6);
    const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(5, 2.5, 4), new THREE.MeshLambertMaterial({ color: 0xa34a2e }));
    hutRoof.position.set(PIER.x + PIER.len / 2 - 8, 6, PIER.z);
    hutRoof.rotation.y = Math.PI / 4;
    this.group.add(hutRoof);
    // String lights along the pier.
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    for (let i = 0; i < 10; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), bulbMat);
      bulb.position.set(PIER.x - PIER.len / 2 + 5 + i * 9, 3.4, PIER.z - PIER.w / 2 + 0.4);
      this.group.add(bulb);
    }
  }
}
