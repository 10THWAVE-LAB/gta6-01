// DOM HUD: mission tracker, money/clock/stars, health + armour, weapon
// slots, crew call-ins, speedometer, dialogue box, banners, menus and
// busted / wasted / mission-failed overlays.

import { WEAPONS, CREW } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'start-screen', 'pause-menu', 'overlay-busted', 'overlay-wasted',
      'overlay-failed', 'mission-name', 'mission-stage', 'mission-objective', 'mission-next',
      'money', 'clock', 'stars', 'health-fill', 'health-num', 'armour-fill', 'armour-num',
      'speedo', 'speed-num', 'vehicle-name', 'vehicle-damage-fill', 'vehicle-damage-num',
      'dialogue', 'dialogue-speaker', 'dialogue-text', 'banner', 'toast', 'crosshair',
      'vignette', 'failed-reason', 'save-note', 'pause-save-note', 'busted-note', 'wasted-note',
      'btn-new', 'btn-continue', 'btn-resume', 'btn-save', 'btn-restart-mission', 'btn-quit',
      'btn-retry', 'btn-freeroam', 'btn-busted-ok', 'btn-wasted-ok']) {
      this.el[id] = $(id);
    }
    this.slots = [...document.querySelectorAll('.slot')];
    this.crewEls = [...document.querySelectorAll('.crew')];
    this.bannerUntil = 0; // wall-clock: UI timers must not slow with the frame rate
    this.toastUntil = 0;
    this.textT = 0;
    this.flash = 0;
    // Button callbacks are assigned by main.js.
    this.onNewGame = () => {};
    this.onContinue = () => {};
    this.onResume = () => {};
    this.onSave = () => {};
    this.onRestartMission = () => {};
    this.onQuit = () => {};
    this.onRetry = () => {};
    this.onFreeRoam = () => {};
    this.onBustedOk = () => {};
    this.onWastedOk = () => {};
    this.el['btn-new'].onclick = () => this.onNewGame();
    this.el['btn-continue'].onclick = () => this.onContinue();
    this.el['btn-resume'].onclick = () => this.onResume();
    this.el['btn-save'].onclick = () => this.onSave();
    this.el['btn-restart-mission'].onclick = () => this.onRestartMission();
    this.el['btn-quit'].onclick = () => this.onQuit();
    this.el['btn-retry'].onclick = () => this.onRetry();
    this.el['btn-freeroam'].onclick = () => this.onFreeRoam();
    this.el['btn-busted-ok'].onclick = () => this.onBustedOk();
    this.el['btn-wasted-ok'].onclick = () => this.onWastedOk();
  }

  showStart(hasSaveGame) {
    this.el['start-screen'].style.display = 'flex';
    this.el.hud.style.display = 'none';
    this.el['pause-menu'].style.display = 'none';
    this.el['btn-continue'].style.display = hasSaveGame ? 'block' : 'none';
    this.el['save-note'].textContent = hasSaveGame ? 'Saved game found — continue where you left off.' : '';
  }

  showHud() {
    this.el['start-screen'].style.display = 'none';
    this.el.hud.style.display = 'block';
    this.hideOverlays();
  }

  showPause(canRestart) {
    this.el['pause-menu'].style.display = 'flex';
    this.el['btn-restart-mission'].style.display = canRestart ? 'block' : 'none';
  }

  hidePause() { this.el['pause-menu'].style.display = 'none'; }
  hideOverlays() {
    this.el['overlay-busted'].style.display = 'none';
    this.el['overlay-wasted'].style.display = 'none';
    this.el['overlay-failed'].style.display = 'none';
  }

  banner(text, kind = '') {
    this.el.banner.textContent = text;
    this.el.banner.className = `show ${kind}`;
    this.bannerUntil = performance.now() + 3500;
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.className = 'show';
    this.toastUntil = performance.now() + 3000;
  }

  damageFlash() { this.flash = 0.85; }

  showBusted(lost) {
    this.el['overlay-busted'].style.display = 'flex';
    this.el['busted-note'].textContent = `The SPD took $${lost.toLocaleString()} in fines. Your heat is cleared.`;
  }

  showWasted(lost) {
    this.el['overlay-wasted'].style.display = 'flex';
    this.el['wasted-note'].textContent = `The hospital bill was $${lost.toLocaleString()}. You wake up patched up.`;
  }

  showMissionFailed(reason) {
    this.el['overlay-failed'].style.display = 'flex';
    this.el['failed-reason'].textContent = reason;
  }

  update(game, dt) {
    const p = game.player;
    // Banner / toast timers (wall-clock).
    const now = performance.now();
    if (this.bannerUntil && now > this.bannerUntil) { this.el.banner.className = ''; this.bannerUntil = 0; }
    if (this.toastUntil && now > this.toastUntil) { this.el.toast.className = ''; this.toastUntil = 0; }
    // Damage vignette.
    this.flash = Math.max(0, this.flash - dt * 1.8);
    const lowHp = p.health < 30 && !p.dead ? 0.25 + Math.sin(performance.now() / 300) * 0.1 : 0;
    this.el.vignette.style.opacity = Math.min(1, this.flash + lowHp);
    // Bars every frame (cheap).
    this.el['health-fill'].style.width = `${p.health}%`;
    this.el['armour-fill'].style.width = `${p.armour}%`;
    // Crosshair: only on foot with a gun.
    const armed = !p.car && game.combat.current !== 'fists';
    this.el.crosshair.style.display = armed ? 'block' : 'none';
    // Speedo: only while driving.
    if (p.car) {
      this.el.speedo.style.display = 'block';
      this.el['speed-num'].textContent = Math.round(Math.abs(p.car.speed) * 3.6);
      this.el['vehicle-name'].textContent = p.car.def.name;
      const hpPct = Math.max(0, Math.round((p.car.hp / p.car.def.hp) * 100));
      this.el['vehicle-damage-fill'].style.width = `${hpPct}%`;
      this.el['vehicle-damage-num'].textContent = `${hpPct}% CONDITION`;
    } else {
      this.el.speedo.style.display = 'none';
    }
    // Dialogue box.
    const d = game.missions.activeDialogue;
    if (d) {
      this.el.dialogue.style.display = 'block';
      this.el['dialogue-speaker'].textContent = d.speaker;
      this.el['dialogue-text'].textContent = d.text;
    } else {
      this.el.dialogue.style.display = 'none';
    }
    // Weapon slots.
    for (const slot of this.slots) {
      const key = slot.dataset.weapon;
      const locked = !game.combat.unlocked[key];
      slot.classList.toggle('active', game.combat.current === key);
      slot.classList.toggle('locked', locked);
      const ammoEl = slot.querySelector('.slot-ammo');
      if (locked) ammoEl.textContent = 'LOCKED';
      else if (key === 'fists') ammoEl.textContent = '∞';
      else {
        const a = game.combat.ammo[key];
        ammoEl.textContent = game.combat.reloading && game.combat.current === key ? 'RELOADING' : `${a.mag} / ${a.reserve}`;
      }
    }
    // Crew cooldowns.
    for (const c of this.crewEls) {
      const key = c.dataset.crew;
      const left = game.crewCooldowns[key] || 0;
      const cd = c.querySelector('.crew-cd');
      const total = CREW[key].cooldown;
      cd.style.height = left > 0 ? `${(left / total) * 100}%` : '0%';
      const secs = c.querySelector('.crew-secs');
      secs.textContent = left > 0 ? `${Math.ceil(left)}s` : 'READY';
      c.classList.toggle('ready', left <= 0);
    }
    // Text bits at 10 Hz.
    this.textT -= dt;
    if (this.textT > 0) return;
    this.textT = 0.1;
    this.el.money.textContent = `$${p.money.toLocaleString()}`;
    const h = Math.floor(game.clockMinutes / 60) % 24;
    const m = Math.floor(game.clockMinutes % 60);
    this.el.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const stars = game.police.stars;
    this.el.stars.innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    this.el['health-num'].textContent = Math.round(p.health);
    this.el['armour-num'].textContent = Math.round(p.armour);
    // Mission panel.
    const ms = game.missions;
    if (ms.state === 'active') {
      this.el['mission-name'].textContent = `MISSION ${ms.current + 1} — ${ms.def.name.toUpperCase()}`;
      this.el['mission-stage'].textContent = `STAGE ${ms.stage + 1}/${ms.def.stages.length}`;
      this.el['mission-objective'].textContent = ms.objectiveText() || '';
      const next = ms.def.stages[ms.stage + 1];
      this.el['mission-next'].textContent = next ? `NEXT: ${next.label}` : 'FINAL STAGE';
    } else if (ms.state === 'idle' && ms.nextDef) {
      this.el['mission-name'].textContent = `NEXT MISSION — ${ms.nextDef.name.toUpperCase()}`;
      this.el['mission-stage'].textContent = `${ms.completed}/5 COMPLETE`;
      this.el['mission-objective'].textContent = `Reach the amber marker at ${ms.nextDef.start === 'garage' ? "Tomas's Garage" : ms.nextDef.start}.`;
      this.el['mission-next'].textContent = 'Free roam — explore Solmar City';
    } else {
      this.el['mission-name'].textContent = 'STORY COMPLETE';
      this.el['mission-stage'].textContent = '5/5 COMPLETE';
      this.el['mission-objective'].textContent = 'Solmar is yours. Free roam — cause chaos or cruise the beach.';
      this.el['mission-next'].textContent = '';
    }
  }
}
