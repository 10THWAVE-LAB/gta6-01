// 2D canvas minimap: whole-city view with roads, beach, sea, pier,
// player arrow, cars, police, enemies and the mission marker.

import { GRID_LINES, ROAD_WIDTH, BEACH_X, WATER_X, PIER } from './config.js';

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width; // square
    this.world = 560; // world units across the map
    this.pulse = 0;
  }

  _toMap(x, z) {
    const s = this.size / this.world;
    return { x: this.size / 2 + x * s, y: this.size / 2 + z * s };
  }

  render(game) {
    const ctx = this.ctx;
    const S = this.size;
    const s = S / this.world;
    this.pulse += 0.06;
    // Background: city ground.
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, S, S);
    // Sea + beach on the east.
    const seaX = this._toMap(WATER_X, 0).x;
    ctx.fillStyle = '#155e6e';
    ctx.fillRect(seaX, 0, S - seaX, S);
    const beachX = this._toMap(BEACH_X, 0).x;
    ctx.fillStyle = '#c9b183';
    ctx.fillRect(beachX, 0, seaX - beachX, S);
    // Blocks.
    ctx.fillStyle = '#333945';
    for (let bx = -144; bx <= 96; bx += 48) {
      for (let bz = -144; bz <= 96; bz += 48) {
        const a = this._toMap(bx + 8, bz + 8);
        const b = this._toMap(bx + 40, bz + 40);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
    }
    // Roads.
    ctx.strokeStyle = '#565d68';
    ctx.lineWidth = ROAD_WIDTH * s;
    for (const l of GRID_LINES) {
      const a = this._toMap(-178, l), b = this._toMap(178, l);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = this._toMap(l, -178), d = this._toMap(l, 178);
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    // Pier.
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = PIER.w * s;
    const p0 = this._toMap(PIER.x - PIER.len / 2, PIER.z);
    const p1 = this._toMap(PIER.x + PIER.len / 2, PIER.z);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    // Mission marker: pulsing amber diamond.
    const mp = game.missions.objectivePos() || game.missions.startMarkerPos();
    if (mp) {
      const m = this._toMap(mp.x, mp.z);
      const r = 5 + Math.sin(this.pulse) * 1.5;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - r); ctx.lineTo(m.x + r, m.y); ctx.lineTo(m.x, m.y + r); ctx.lineTo(m.x - r, m.y);
      ctx.closePath(); ctx.fill();
    }
    // Cars: tiny white dots. Police: flashing blue.
    const showCops = game.police.stars > 0 || game.police.revealT > 0;
    for (const v of game.vehicles) {
      if (v.dead || v === game.player.car) continue;
      const p = this._toMap(v.pos.x, v.pos.z);
      if (v.type === 'police') {
        if (!showCops) continue;
        ctx.fillStyle = Math.floor(this.pulse * 2) % 2 === 0 ? '#3a7bff' : '#ff3a3a';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
      }
    }
    // Helicopter.
    if (game.police.heli) {
      const h = game.police.heli.group.position;
      const p = this._toMap(h.x, h.z);
      ctx.fillStyle = '#3a7bff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2); ctx.stroke();
    }
    // Enemies: red dots.
    for (const e of game.combat.enemies) {
      if (e.dead) continue;
      const p = this._toMap(e.pos.x, e.pos.z);
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow, rotated by heading.
    const pp = this._toMap(game.player.pos.x, game.player.pos.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(Math.atan2(Math.sin(game.player.heading), Math.cos(game.player.heading)) + 0);
    ctx.rotate(game.player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // North.
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 13);
  }
}
