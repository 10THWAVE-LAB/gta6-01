// localStorage save / load: position, money, health, mission progress,
// wanted level, unlocked weapons and the game clock.

const KEY = 'solmar-heat-save-v1';

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function saveGame(game) {
  try {
    const data = {
      x: game.player.pos.x, z: game.player.pos.z, heading: game.player.heading,
      money: game.player.money, health: game.player.health, armour: game.player.armour,
      completed: game.missions.completed,
      stars: game.police.stars,
      smg: game.combat.unlocked.smg,
      ammo: game.combat.ammo,
      clockMinutes: game.clockMinutes,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch { return false; }
}

export function loadGame(game) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    game.player.teleport(d.x, d.z, d.heading);
    game.player.money = d.money;
    game.player.health = d.health;
    game.player.armour = d.armour;
    game.missions.completed = d.completed;
    game.missions.state = d.completed >= 5 ? 'done' : 'idle';
    game.missions.current = -1;
    game.police.stars = 0; // never load mid-chase
    game.combat.unlocked.smg = !!d.smg;
    if (d.ammo) game.combat.ammo = d.ammo;
    game.clockMinutes = d.clockMinutes ?? 16 * 60;
    return true;
  } catch { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
