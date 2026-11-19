// SOLMAR HEAT — game bootstrap and main loop. Wires the city, player,
// vehicles, traffic, pedestrians, police, combat, missions, HUD and audio
// into one playable open world. No network: everything is local.

import * as THREE from 'three';
import { CLOCK, CREW, VEHICLE_TYPES, WANTED, clamp } from './config.js';
import { makeRng, pick, range, chance } from './rng.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { City, LOCATIONS } from './city.js';
import { Player } from './player.js';
import { Vehicle, nearestVehicle, collideVehicles } from './vehicles.js';
import { CameraRig } from './camera.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { Minimap } from './minimap.js';
import { hasSave, saveGame, loadGame } from './save.js';
import { applyShot } from './shots.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '7', 10);
const SHOT = params.get('shot');

class Game {
  constructor() {
    this.rng = makeRng(SEED);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    document.getElementById('game-canvas').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
    this.camera.position.set(0, 40, 80);

    this.input = new Input(this.renderer.domElement);
    this.audio = new AudioEngine();
    this.effects = new Effects(this.scene);
    this.city = new City(this.scene, this.rng);
    this.vehicles = [];
    this.player = new Player(this.scene, this.city, this.effects, this.audio);
    this.cameraRig = new CameraRig(this.camera);
    this.traffic = new Traffic(this.scene, this.city, this.rng, this.vehicles, this.effects, this.audio);
    this.peds = new Pedestrians(this.scene, this.city, this.rng);
    this.police = new Police(this.scene, this.city, this.rng, this.vehicles, this.effects, this.audio);
    this.combat = new Combat(this.scene, this.city, this.effects, this.audio, this.player);
    this.missions = new Missions(this);
    this.hud = new HUD();
    this.minimap = new Minimap(document.getElementById('minimap'));

    this.clockMinutes = CLOCK.startHour * 60;
    this.state = 'menu'; // menu | playing | paused | busted | wasted | failed
    this.crewCooldowns = { getaway: 0, repair: 0, lookout: 0 };
    this.lastShotHeat = 0;
    this.menuOrbit = 0;
    this.failedMission = 0;

    this._spawnParkedCars();
    this._spawnPickups();
    this._wireHud();
    this._wireCombat();
    this._seedWorld();

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Shot mode: skip the menu and jump straight into the staged scene.
    if (SHOT) {
      this.startGame(false);
      applyShot(this, SHOT);
    } else {
      this.hud.showStart(hasSave());
    }
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
    window.__game = this;
  }

  _spawnParkedCars() {
    const types = ['sedan', 'sedan', 'suv', 'van', 'sports', 'taxi'];
    for (let i = 0; i < 20; i++) {
      const axis = chance(this.rng, 0.5) ? 'x' : 'z';
      const line = pick(this.rng, [-144, -96, -48, 0, 48, 96, 144]);
      const along = range(this.rng, -150, 150);
      const side = chance(this.rng, 0.5) ? 4.6 : -4.6;
      const x = axis === 'x' ? along : line + side;
      const z = axis === 'x' ? line + side : along;
      if (this.city.pointInCollider(x, z)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 7)) continue;
      const type = pick(this.rng, types);
      const v = new Vehicle(this.scene, type, pick(this.rng, VEHICLE_TYPES[type].colors),
        x, z, axis === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI));
      this.vehicles.push(v);
    }
    // A guaranteed sports car near the start for the first mission.
    const v = new Vehicle(this.scene, 'sports', 0xe8632c, -48, -108, 0);
    this.vehicles.push(v);
  }

  _spawnPickups() {
    this.combat.spawnPickup('health', -48, -100);
    this.combat.spawnPickup('armour', 24, 24);
    this.combat.spawnPickup('ammo', -96, 48);
    this.combat.spawnPickup('health', 144, 96);
    this.combat.spawnPickup('money', 0, 96);
    this.combat.spawnPickup('ammo', 96, -96);
  }

  _seedWorld() {
    // Pre-populate traffic and pedestrians around the start so the city
    // is alive from the first frame.
    for (let i = 0; i < 12; i++) this.traffic.spawnNear(this.player.pos, 15, 130);
    for (let i = 0; i < 18; i++) this.peds.spawnNear(this.player.pos);
  }

  _wireHud() {
    this.hud.onNewGame = () => { this.audio.init(); this.audio.uiClick(); this.startGame(true); };
    this.hud.onContinue = () => {
      this.audio.init(); this.audio.uiClick();
      this.startGame(false);
      if (loadGame(this)) this.hud.toast('Save loaded — welcome back to Solmar');
    };
    this.hud.onResume = () => this.resume();
    this.hud.onSave = () => {
      const ok = this.saveGame();
      this.hud.el['pause-save-note'].textContent = ok ? 'Progress saved.' : 'Save failed — storage unavailable.';
    };
    this.hud.onRestartMission = () => {
      const idx = this.missions.current >= 0 ? this.missions.current : this.failedMission;
      this.resume();
      this.missions.startMission(idx);
    };
    this.hud.onQuit = () => {
      this.saveGame();
      this.state = 'menu';
      this.input.unlock();
      this.audio.setEngine(false);
      this.audio.setSiren(false);
      this.hud.showStart(hasSave());
    };
    this.hud.onRetry = () => {
      this.hud.hideOverlays();
      this.state = 'playing';
      this.missions.startMission(this.failedMission);
    };
    this.hud.onFreeRoam = () => { this.hud.hideOverlays(); this.state = 'playing'; };
    this.hud.onBustedOk = () => this._respawnAfter('busted');
    this.hud.onWastedOk = () => this._respawnAfter('wasted');
  }

  _wireCombat() {
    this.combat.onShoot = (pos) => {
      this.peds.alert(pos, 45);
      const now = performance.now() / 1000;
      if (this.police.nearestCopDist(pos) < 70 && now - this.lastShotHeat > 6) {
        this.police.addHeat(WANTED.shootNearCop);
        this.lastShotHeat = now;
      }
    };
    this.combat.onPedShot = (ped) => {
      this.peds.alert(ped.pos, 50);
      if (this.police.nearestCopDist(ped.pos) < 70) this.police.addHeat(WANTED.hitPed);
    };
    this.combat.onCarShot = (v) => {
      if (v.type === 'police') this.police.addHeat(1);
    };
    this.combat.onEnemyKilled = () => this.missions.onEnemyKilled();
  }

  saveGame() { return saveGame(this); }

  startGame(fresh) {
    if (fresh) {
      this.player.money = 250;
      this.player.health = 100;
      this.player.armour = 0;
      this.missions.completed = 0;
      this.missions.state = 'idle';
      this.player.teleport(-60, -96, 0);
    }
    this.state = 'playing';
    this.hud.showHud();
    this.input.clearMouse(); // the menu click must not fire a shot
    this.input.lock();
    this.audio.init();
    this.audio.startMusic();
    if (!SHOT) this.hud.banner('SOLMAR HEAT — steal a car, follow the amber marker', 'story');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    this.hud.showPause(this.missions.state === 'active');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hidePause();
    this.input.clearMouse();
    this.input.lock();
    this.audio.uiClick();
  }

  _respawnAfter(kind) {
    this.hud.hideOverlays();
    const lost = Math.max(50, Math.round(this.player.money * 0.1));
    this.player.money = Math.max(0, this.player.money - lost);
    this.player.health = 100;
    this.player.armour = 0;
    this.player.dead = false;
    if (this.player.car) { this.player.car.driver = null; this.player.car = null; this.player.mesh.visible = true; }
    this.police.clear();
    // Hospital / police station respawns downtown.
    if (kind === 'wasted') this.player.teleport(0, -48, 0);
    else this.player.teleport(-48, 48, 0);
    this.state = 'playing';
    this.input.lock();
  }

  _onBusted() {
    if (this.state !== 'playing') return;
    this.missions.onBusted();
    if (this.missions.state === 'idle' && this.state === 'playing') {
      // Mission failed overlay takes precedence; otherwise show busted.
      if (document.getElementById('overlay-failed').style.display === 'flex') return;
    }
    this.state = 'busted';
    this.input.unlock();
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    const lost = Math.max(50, Math.round(this.player.money * 0.1));
    this.hud.showBusted(lost);
  }

  _onWasted() {
    if (this.state !== 'playing') return;
    this.missions.onWasted();
    if (document.getElementById('overlay-failed').style.display === 'flex') return;
    this.state = 'wasted';
    this.input.unlock();
    this.audio.setEngine(false);
    this.audio.setSiren(false);
    const lost = Math.max(50, Math.round(this.player.money * 0.1));
    this.hud.showWasted(lost);
  }

  _tryEnterCar() {
    const p = this.player;
    if (p.car) { p.exitCar(); this.audio.uiClick(); return; }
    const car = nearestVehicle(this.vehicles, p.pos.x, p.pos.z, 3.6);
    if (!car) return;
    // Stealing: the SPD notices if a unit is close.
    const witnessed = this.police.nearestCopDist(p.pos) < 55 || car.type === 'police';
    const wasTraffic = car.driver === 'traffic';
    const wasPolice = car.driver === 'police';
    if (wasTraffic) {
      const ti = this.traffic.cars.findIndex((c) => c.v === car);
      if (ti >= 0) this.traffic.cars.splice(ti, 1);
    }
    if (wasPolice) {
      const ci = this.police.cops.findIndex((c) => c.v === car);
      if (ci >= 0) this.police.cops.splice(ci, 1);
    }
    car.siren = false;
    p.enterCar(car);
    this.audio.uiClick();
    this.missions.onEnterCar(car);
    if (witnessed) {
      this.police.addHeat(car.type === 'police' ? 2 : WANTED.stealCar);
      this.hud.toast(car.type === 'police' ? 'You stole a cop car! The SPD is coming.' : 'The SPD saw that!');
    } else if (wasTraffic || wasPolice) {
      this.hud.toast(`Stole the ${car.def.name} — clean getaway`);
    }
  }

  _crewAction(key) {
    if (this.crewCooldowns[key] > 0) return;
    const p = this.player;
    if (key === 'getaway') {
      if (p.car) { this.hud.toast("You're already rolling — Ivy keeps the car warm"); return; }
      const v = new Vehicle(this.scene, 'sports', 0x22b8a6,
        p.pos.x + Math.sin(p.heading + 1.2) * 4, p.pos.z + Math.cos(p.heading + 1.2) * 4, p.heading);
      this.vehicles.push(v);
      this.crewCooldowns.getaway = CREW.getaway.cooldown;
      this.hud.toast('Ivy dropped a Veloce GT beside you — press E to take it');
      this.audio.pickup();
    } else if (key === 'repair') {
      if (!p.car) { this.hud.toast('Get in a car first — Tomas fixes rides, not people'); return; }
      p.car.hp = p.car.def.hp;
      p.car.dead = false;
      this.crewCooldowns.repair = CREW.repair.cooldown;
      this.hud.toast('Tomas patched your ride — good as new');
      this.audio.pickup();
    } else if (key === 'lookout') {
      this.police.revealT = 25;
      this.crewCooldowns.lookout = CREW.lookout.cooldown;
      this.hud.toast("Nia's eyes are out — police marked on the map for 25s");
      this.audio.pickup();
    }
  }

  _updatePlaying(dt) {
    const input = this.input;
    const p = this.player;
    this.clockMinutes += dt * CLOCK.minutesPerSecond;
    for (const k of Object.keys(this.crewCooldowns)) {
      this.crewCooldowns[k] = Math.max(0, this.crewCooldowns[k] - dt);
    }
    // Global keys.
    if (input.pressed('KeyP') || input.pressed('Escape')) { this.pause(); return; }
    if (input.pressed('KeyM')) {
      this.audio.setMuted(!this.audio.muted);
      this.hud.toast(this.audio.muted ? 'Sound muted (M)' : 'Sound on (M)');
    }
    if (input.pressed('KeyR')) this.combat.startReload();
    if (input.pressed('Digit1')) this.combat.switchTo('fists');
    if (input.pressed('Digit2')) this.combat.switchTo('pistol');
    if (input.pressed('Digit3')) this.combat.switchTo('smg');
    if (input.pressed('KeyZ')) this._crewAction('getaway');
    if (input.pressed('KeyX')) this._crewAction('repair');
    if (input.pressed('KeyC')) this._crewAction('lookout');
    if (input.pressed('KeyE')) this._tryEnterCar();
    if (input.pressed('KeyH') && p.car) this.audio.horn();

    // Player / driving.
    const mouse = input.consumeMouse();
    if (p.car) {
      const axes = input.moveAxes();
      if (this.autoDrive) { axes.y = 1; axes.x = 0; } // screenshot autopilot
      const handbrake = input.down('Space');
      p.car.drive(dt, { throttle: axes.y, steer: axes.x, handbrake }, this.city, this.effects, this.audio);
      p.update(dt);
      this.audio.setEngine(true, Math.abs(p.car.speed) / p.car.def.top);
      if (handbrake && Math.abs(p.car.speed) > 10) this.audio.skid();
      // Running over pedestrians.
      const ped = this.peds.nearest(p.pos.x, p.pos.z, 2.1);
      if (ped && Math.abs(p.car.speed) > 5) {
        this.effects.blood(ped.pos.clone().add(new THREE.Vector3(0, 1, 0)));
        this.peds.remove(ped);
        this.peds.alert(p.pos, 40);
        if (this.police.nearestCopDist(p.pos) < 70) this.police.addHeat(WANTED.hitPed);
        this.cameraRig.addShake(0.25);
      }
      if (p.car.dead) {
        // Car blew up under the player.
        p.exitCar();
        p.takeDamage(25);
        this.cameraRig.addShake(0.7);
        this.hud.damageFlash();
      }
    } else {
      p.updateOnFoot(dt, input, this.cameraRig.yaw);
      this.audio.setEngine(false);
      // Shooting.
      const w = this.combat.weapon;
      const wantFire = w.auto ? input.mouseDown : input.consumeMousePressed();
      if (wantFire) {
        this.combat.shoot(this.camera, this.vehicles, this.peds);
        this.cameraRig.addShake(w.kick * 8);
      }
    }

    this.traffic.update(dt, p.pos, this.effects, this.audio);
    this.peds.update(dt, p.pos, p.car);
    this.police.update(dt, p, () => this._onBusted());
    this.combat.update(dt, p);
    this.missions.update(dt);
    collideVehicles(this.vehicles, this.effects, this.audio, (a, b) => {
      if (a === p.car || b === p.car) {
        this.cameraRig.addShake(0.3);
        if (a.type === 'police' || b.type === 'police') {
          const now = performance.now() / 1000;
          if (now - this.lastShotHeat > 6) { this.police.addHeat(WANTED.ramCop); this.lastShotHeat = now; }
        }
      }
    });
    this.effects.update(dt);
    this.audio.update(dt);

    // Camera follows the player (or the car).
    const target = p.pos.clone();
    this.cameraRig.update(dt, target, p.heading, p.speed, !!p.car, mouse);

    // Wasted?
    if (p.dead) { this._onWasted(); return; }
    // Fell in the sea? Push back to the beach.
    if (p.pos.x > 252) { p.pos.x = 250; this.hud.toast("The sea is not a shortcut"); }
  }

  _updateMenu(dt) {
    // Slow cinematic orbit over the city behind the title screen.
    this.menuOrbit += dt * 0.05;
    const cx = Math.cos(this.menuOrbit) * 120;
    const cz = Math.sin(this.menuOrbit) * 120;
    this.camera.position.set(cx, 55, cz);
    this.camera.lookAt(0, 0, 0);
    this.traffic.update(dt, new THREE.Vector3(0, 0, 0), this.effects, this.audio);
    this.peds.update(dt, new THREE.Vector3(0, 0, 0), null);
    this.effects.update(dt);
  }

  _loop() {
    // Fixed 1/60 substeps: slow frames must not slow the game down.
    const rawDt = Math.min(this.clock.getDelta(), 0.25);
    this._acc = (this._acc || 0) + rawDt;
    const step = 1 / 60;
    let n = 0;
    while (this._acc >= step && n < 30) {
      if (this.state === 'playing') this._updatePlaying(step);
      else if (this.state === 'menu') this._updateMenu(step);
      this._acc -= step;
      n++;
    }
    if (n === 30) this._acc = 0; // hopelessly behind: drop the backlog
    if (this.state === 'playing') {
      this.hud.update(this, rawDt);
      this.minimap.render(this);
    }
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}

new Game();
