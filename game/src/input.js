// Keyboard + mouse input with edge detection and pointer-lock camera look.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressedSet = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.mousePressed = false;
    this.locked = false;
    this.canvas = canvas;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); });

    document.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this.mousePressed = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('click', () => {
      if (!this.locked && this.wantLock) this._requestLock();
    });
    this.wantLock = false;
  }

  down(code) { return this.keys.has(code); }
  // Consuming edge check: true once per press, even across substeps.
  pressed(code) {
    if (!this.pressedSet.has(code)) return false;
    this.pressedSet.delete(code);
    return true;
  }
  consumeMousePressed() {
    const p = this.mousePressed;
    this.mousePressed = false;
    return p;
  }
  clearMouse() {
    this.mouseDown = false; this.mousePressed = false;
    this.mouseDX = 0; this.mouseDY = 0; this.pressedSet.clear();
  }
  consumeMouse() { const d = { x: this.mouseDX, y: this.mouseDY }; this.mouseDX = 0; this.mouseDY = 0; return d; }
  endFrame() { this.pressedSet.clear(); this.mousePressed = false; }
  _requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {}); // no gesture yet (e.g. automated run)
    } catch { /* pointer lock unavailable */ }
  }
  lock() { this.wantLock = true; if (!this.locked) this._requestLock(); }
  unlock() { this.wantLock = false; document.exitPointerLock?.(); }

  // WASD as a -1..1 pair, forward = W.
  moveAxes() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    return { x, y };
  }
}
