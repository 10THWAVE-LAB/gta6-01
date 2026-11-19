// All sound is synthesised with WebAudio — no audio files, fully offline.
// Engine hum, two-tone siren, gunshots, footsteps, UI, and a small
// procedural island-pop loop (bass + pad + hats).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.musicTimer = null;
    this.musicStep = 0;
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // Shared white-noise buffer for shots, skids, footsteps.
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }

  _tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, filterFreq, type = 'lowpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  uiClick() { this._tone(880, 0.07, 'sine', 0.15); }
  pickup() { this._tone(660, 0.09, 'sine', 0.2); setTimeout(() => this._tone(990, 0.12, 'sine', 0.2), 80); }
  gunshot(big = false) {
    this._noise(big ? 0.28 : 0.16, big ? 0.5 : 0.35, big ? 900 : 1400);
    this._tone(big ? 90 : 120, 0.12, 'sine', 0.4, 40);
  }
  punch() { this._noise(0.08, 0.3, 500); }
  footstep() { this._noise(0.05, 0.08, 400); }
  skid() { this._noise(0.25, 0.12, 2400, 'bandpass'); }
  crash() { this._noise(0.35, 0.5, 300); this._tone(70, 0.3, 'sine', 0.5, 30); }
  explosion() {
    this._noise(0.9, 0.7, 220);
    this._tone(55, 0.8, 'sine', 0.7, 24);
  }
  horn() { this._tone(392, 0.35, 'square', 0.12); this._tone(494, 0.35, 'square', 0.1); }
  missionDone() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.25), i * 130));
  }
  wantedUp() { this._tone(220, 0.15, 'sawtooth', 0.15, 440); }

  // Continuous engine hum; speed01 is 0..1 of top speed.
  setEngine(on, speed01 = 0) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 500;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (!on && this.engineOsc) {
      try { this.engineOsc.stop(); } catch { /* already stopped */ }
      this.engineOsc = null; this.engineGain = null; return;
    }
    if (this.engineOsc) {
      this.engineOsc.frequency.value = 55 + speed01 * 140;
      this.engineGain.gain.value = 0.05 + speed01 * 0.06;
    }
  }

  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0.05;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.sirenTimer = 0;
    }
    if (!on && this.sirenOsc) {
      try { this.sirenOsc.stop(); } catch { /* already stopped */ }
      this.sirenOsc = null; this.sirenGain = null;
    }
  }

  update(dt) {
    if (this.sirenOsc) {
      this.sirenTimer += dt;
      this.sirenOsc.frequency.value = (Math.floor(this.sirenTimer * 1.6) % 2 === 0) ? 720 : 540;
    }
  }

  // Procedural loop: Am – F – C – G bass, soft pad, hats. 8 steps a bar.
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bassNotes = [110, 87.31, 130.81, 98]; // A2 F2 C3 G2
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.musicStep++; return; }
      const bar = Math.floor(this.musicStep / 8) % 4;
      const step = this.musicStep % 8;
      if (step === 0 || step === 4) this._tone(bassNotes[bar], 0.5, 'triangle', 0.16);
      if (step === 0) this._tone(bassNotes[bar] * 2, 1.6, 'sine', 0.05);
      if (step % 2 === 1) this._noise(0.03, 0.03, 6000, 'highpass');
      this.musicStep++;
    }, 230);
  }

  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}
