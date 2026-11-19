// Story: five missions, an intro-to-finale arc. Dante Reyes, ex-courier,
// takes on Aurelio Voss, who owns the Solmar docks. Stage types: goto,
// steal, kill, survive, wreck, escape. Dialogue drives the story.

import * as THREE from 'three';
import { LOCATIONS } from './city.js';
import { Vehicle } from './vehicles.js';

const D = (speaker, text, dur = 4.5) => ({ speaker, text, dur });

export const MISSION_DEFS = [
  {
    name: 'First Wheels', reward: 500, start: 'garage',
    intro: [D('TOMAS', 'Dante! I need wheels for the job tonight. Grab any car off the street — just don\'t let the SPD see you take it.')],
    stages: [
      { type: 'steal', label: 'Steal a car' },
      { type: 'goto', label: "Bring the car to Tomas's Garage", pos: 'garage', radius: 10, needCar: true },
    ],
    outro: [D('TOMAS', 'Not bad. She\'s yours now. Bigger work is coming — Voss owns these docks, and we\'re taking them back.')],
  },
  {
    name: 'The Courier', reward: 800, start: 'harbor',
    intro: [D('NIA', 'A package is waiting at the harbor. Voss\'s men watch those docks — get in, get out, no noise.')],
    stages: [
      { type: 'goto', label: 'Pick up the package at the harbor', pos: 'harbor', radius: 9 },
      { type: 'goto', label: 'Deliver the package to the Palm Court Motel', pos: 'motel', radius: 9 },
    ],
    outro: [D('IVY', 'Clean run. The city\'s starting to notice us, Dante. That\'s good — and dangerous.')],
  },
  {
    name: 'Harbor Heat', reward: 1500, start: 'garage',
    intro: [D('TOMAS', 'Voss is moving crates through the harbor tonight. Hit the docks, clear his guards, and bring me that truck.')],
    stages: [
      { type: 'goto', label: 'Reach the harbor docks', pos: 'harbor', radius: 14 },
      { type: 'kill', label: 'Clear the Voss guards', count: 4 },
      { type: 'steal', label: 'Take the Dock Hauler', vehicle: 'truck' },
      { type: 'goto', label: 'Deliver the truck to the garage', pos: 'garage', radius: 10, needCar: true },
    ],
    outro: [D('TOMAS', 'The VK-9 SMG is yours now — you\'ll need it. Voss will come for us after this.')],
  },
  {
    name: 'Heat Wave', reward: 2000, start: 'safehouse',
    intro: [D('NIA', 'Voss called in every favour he has. Three stars are coming for you. Survive — then vanish.')],
    stages: [
      { type: 'survive', label: 'Survive the heat', seconds: 90, stars: 3 },
      { type: 'escape', label: 'Lose the cops and reach the safehouse', pos: 'safehouse', radius: 10 },
    ],
    outro: [D('IVY', 'You outran the whole department. Voss is scared now. Time to finish this.')],
  },
  {
    name: 'The Fall of Voss', reward: 5000, start: 'mansion',
    intro: [D('DANTE', 'This ends tonight. Voss, your docks, your men — all of it.')],
    stages: [
      { type: 'goto', label: 'Confront Voss at his mansion', pos: 'mansion', radius: 12 },
      { type: 'wreck', label: "Wreck Voss's Sovereign before it reaches the pier" },
      { type: 'escape', label: 'Lose the heat — Solmar is yours', pos: null, radius: 0 },
    ],
    outro: [D('DANTE', 'Solmar is ours now. No more Voss. No more fear on these streets.')],
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.current = -1;      // mission index, -1 = none
    this.stage = 0;
    this.state = 'idle';    // idle | active | done
    this.completed = 0;     // missions finished
    this.kills = 0;
    this.surviveT = 0;
    this.heatSet = false;
    this.targetCar = null;  // M5 limo
    this.limoWaypoints = [];
    this.limoWp = 0;
    this.dialogue = [];     // queue of {speaker, text, dur}
    this.activeDialogue = null;
    this.dialogueUntil = 0; // wall-clock so lines don't linger on slow frames
    this.startedAt = 0;
    this.stealArmed = true; // steal stage completes on next car entry

    // Objective beacon: glowing pillar + ring.
    this.beacon = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pillar.position.y = 13;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    this.beacon.add(pillar, ring);
    this.beacon.visible = false;
    game.scene.add(this.beacon);
  }

  get def() { return this.current >= 0 ? MISSION_DEFS[this.current] : null; }
  get stageDef() { return this.def ? this.def.stages[this.stage] : null; }
  get nextDef() { return this.completed < MISSION_DEFS.length ? MISSION_DEFS[this.completed] : null; }

  say(lines) { this.dialogue.push(...lines); }

  objectiveText() {
    if (this.state !== 'active') return null;
    const s = this.stageDef;
    if (!s) return null;
    if (s.type === 'kill') return `${s.label} (${this.kills}/${s.count})`;
    if (s.type === 'survive') return `${s.label} — ${Math.ceil(this.surviveT)}s`;
    if (s.type === 'wreck' && this.targetCar) {
      const hp = Math.max(0, Math.round((this.targetCar.hp / this.targetCar.def.hp) * 100));
      return `${s.label} — ${hp}% left`;
    }
    return s.label;
  }

  objectivePos() {
    if (this.state !== 'active') return null;
    const s = this.stageDef;
    if (!s) return null;
    if (s.type === 'wreck' && this.targetCar) return this.targetCar.pos;
    if (s.type === 'escape' && s.pos) return LOCATIONS[s.pos];
    if (s.pos) return LOCATIONS[s.pos];
    if (s.type === 'kill') return LOCATIONS.harbor;
    return null;
  }

  startMarkerPos() {
    const n = this.nextDef;
    return n ? LOCATIONS[n.start] : null;
  }

  startMission(i) {
    this.current = i;
    this.stage = 0;
    this.state = 'active';
    this.kills = 0;
    this.heatSet = false;
    this.stealArmed = true;
    this.say(this.def.intro);
    this._enterStage();
    this.game.hud.banner(`MISSION ${i + 1} — ${this.def.name}`, 'story');
    this.game.audio.missionDone();
  }

  _enterStage() {
    const s = this.stageDef;
    const g = this.game;
    if (!s) return;
    if (s.type === 'kill') {
      // Voss guards around the harbor.
      const spots = [[108, 108], [132, 116], [112, 132], [136, 130]];
      for (const [x, z] of spots) g.combat.spawnEnemy(x, z, 60);
      g.combat.spawnPickup('health', 120, 108);
      g.combat.spawnPickup('ammo', 108, 126);
      this.say([D('NIA', 'Four guards between you and the truck. Make it loud or make it quiet — your call.')]);
    }
    if (s.type === 'steal' && s.vehicle === 'truck') {
      const truck = new Vehicle(g.scene, 'truck', 0x6b7a8a, 122, 118, Math.PI / 2);
      g.vehicles.push(truck);
      this.say([D('TOMAS', 'There she is — the Dock Hauler. Take her and bring her home.')]);
    }
    if (s.type === 'survive') {
      this.surviveT = s.seconds;
      if (!this.heatSet) { g.police.addHeat(s.stars, true); this.heatSet = true; }
    }
    if (s.type === 'wreck') this._startLimoChase();
    this._updateBeacon();
  }

  _startLimoChase() {
    const g = this.game;
    const limo = new Vehicle(g.scene, 'limo', 0x14100e, 132, 24, Math.PI / 2);
    limo.driver = 'traffic';
    g.vehicles.push(limo);
    this.targetCar = limo;
    // Mansion -> beach boulevard -> pier entrance -> pier end.
    this.limoWaypoints = [
      { x: 144, z: 24 }, { x: 168, z: 12 }, { x: 190, z: 24 }, { x: 236, z: 24 },
    ];
    this.limoWp = 0;
    this.say([D('VOSS', 'You think you can take my city, courier? Drive — to the pier! The boat is waiting!')]);
    g.police.addHeat(2, true);
  }

  _updateBeacon() {
    const pos = this.objectivePos();
    if (pos && this.state === 'active') {
      this.beacon.visible = true;
      this.beacon.position.set(pos.x, 0, pos.z);
    } else if (this.state === 'idle' && this.nextDef) {
      const m = this.startMarkerPos();
      this.beacon.visible = true;
      this.beacon.position.set(m.x, 0, m.z);
    } else {
      this.beacon.visible = false;
    }
  }

  nextStage() {
    this.stage++;
    if (this.stage >= this.def.stages.length) { this._completeMission(); return; }
    this._enterStage();
  }

  _completeMission() {
    const g = this.game;
    const reward = this.def.reward;
    g.player.addMoney(reward);
    this.say(this.def.outro);
    g.hud.banner(`MISSION COMPLETE — +$${reward.toLocaleString()}`, 'good');
    g.audio.missionDone();
    this.completed++;
    this.current = -1;
    this.state = this.completed >= MISSION_DEFS.length ? 'done' : 'idle';
    this.targetCar = null;
    if (this.completed === 3) { // after Harbor Heat: SMG unlocked
      g.combat.unlocked.smg = true;
      g.hud.toast('VK-9 SMG unlocked — press 3');
    }
    if (this.state === 'done') {
      g.hud.banner('STORY COMPLETE — Solmar is yours. Free roam unlocked.', 'good');
      g.saveGame();
    }
    this._updateBeacon();
  }

  failMission(reason) {
    const g = this.game;
    g.combat.clearEnemies();
    if (this.targetCar && !this.targetCar.dead) {
      this.targetCar.dispose(g.scene);
      g.vehicles.splice(g.vehicles.indexOf(this.targetCar), 1);
      this.targetCar = null;
    }
    this.current = -1;
    this.state = 'idle';
    g.hud.showMissionFailed(reason);
  }

  onEnterCar(vehicle) {
    if (this.state !== 'active') return;
    const s = this.stageDef;
    if (s?.type === 'steal' && this.stealArmed) {
      if (s.vehicle && vehicle.type !== s.vehicle) return;
      this.stealArmed = false;
      if (s.vehicle === 'truck') this.game.police.addHeat(2);
      this.nextStage();
    }
  }

  onEnemyKilled() {
    if (this.state !== 'active') return;
    const s = this.stageDef;
    if (s?.type === 'kill') {
      this.kills++;
      if (this.kills >= s.count) this.nextStage();
    }
  }

  onWasted() {
    if (this.state === 'active') this.failMission('You were wasted. The mission failed.');
  }

  onBusted() {
    if (this.state === 'active') this.failMission('Busted by the SPD. The mission failed.');
  }

  update(dt) {
    // Dialogue queue.
    if (!this.activeDialogue && this.dialogue.length > 0) {
      this.activeDialogue = this.dialogue.shift();
      this.dialogueUntil = performance.now() + this.activeDialogue.dur * 1000;
    }
    if (this.activeDialogue && performance.now() > this.dialogueUntil) this.activeDialogue = null;
    // Beacon pulse + follow moving targets.
    if (this.beacon.visible) {
      this.beacon.rotation.y += dt * 0.8;
      const pos = this.objectivePos();
      if (pos) this.beacon.position.set(pos.x, 0, pos.z);
    }
    // Idle: walk into the start marker to begin the next mission.
    if (this.state === 'idle' && this.nextDef) {
      const m = this.startMarkerPos();
      const p = this.game.player.pos;
      if (Math.hypot(p.x - m.x, p.z - m.z) < 7) this.startMission(this.completed);
      return;
    }
    if (this.state !== 'active') return;
    const s = this.stageDef;
    const g = this.game;
    const p = g.player.pos;
    if (s.type === 'goto') {
      const t = LOCATIONS[s.pos];
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < s.radius && (!s.needCar || g.player.car)) {
        // M2: the heat arrives on the delivery leg.
        if (this.current === 1 && this.stage === 1 && !this.heatSet) {
          this.heatSet = true;
          g.police.addHeat(1);
          this.say([D('IVY', 'Cops! Voss tipped them off. Lose them or outrun them — just get to the motel.')]);
        }
        this.nextStage();
      }
    } else if (s.type === 'survive') {
      this.surviveT -= dt;
      if (this.surviveT <= 0) this.nextStage();
    } else if (s.type === 'escape') {
      const heatGone = g.police.stars === 0;
      if (s.pos) {
        const t = LOCATIONS[s.pos];
        if (heatGone && Math.hypot(p.x - t.x, p.z - t.z) < s.radius) this.nextStage();
      } else if (heatGone) this.nextStage();
    } else if (s.type === 'wreck') {
      const limo = this.targetCar;
      if (!limo) return;
      if (limo.dead) {
        g.police.addHeat(2);
        this.say([D('VOSS', 'My car! You\'ll pay for this, Reyes! Every cop in Solmar is coming for you!')]);
        this.nextStage();
        return;
      }
      // Limo AI: follow waypoints toward the pier.
      const wp = this.limoWaypoints[this.limoWp];
      if (wp) {
        const d = Math.hypot(wp.x - limo.pos.x, wp.z - limo.pos.z);
        if (d < 6) {
          this.limoWp++;
          if (this.limoWp >= this.limoWaypoints.length) {
            this.failMission('Voss reached his boat at the pier and escaped.');
            return;
          }
        } else {
          const want = Math.atan2(wp.x - limo.pos.x, wp.z - limo.pos.z);
          let dh = want - limo.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          limo.drive(dt, { throttle: limo.speed < 20 ? 0.9 : 0.2, steer: Math.max(-1, Math.min(1, dh * 2)), handbrake: false },
            g.city, g.effects, g.audio);
        }
      }
    }
  }
}
