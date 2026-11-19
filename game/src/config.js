// SOLMAR HEAT — shared constants, tuning and original fiction.
// City: Solmar City. Player: Dante Reyes, ex-courier. Crew: Ivy (driver),
// Tomas (mechanic), Nia (lookout). Antagonist: Aurelio Voss of the docks.

export const GAME_TITLE = 'SOLMAR HEAT';
export const GAME_SUBTITLE = 'An open-world crime story in Solmar City';

// ---- World layout (grid city, beach on the east) ----
export const ROAD_SPACING = 48;          // distance between parallel roads
export const ROAD_WIDTH = 12;            // drivable width of a road
export const GRID_LINES = [-144, -96, -48, 0, 48, 96, 144]; // road centre lines
export const WORLD_HALF = 178;           // playable city bounds (x/z)
export const BEACH_X = 178;              // sand starts here
export const WATER_X = 252;              // sea starts here
export const PIER = { x: 236, z: 24, len: 92, w: 10 }; // pier into the sea

// ---- Sunset grade ----
export const SKY_TOP = 0x2e4a7a;
export const SKY_HORIZON = 0xff9a56;
export const SUN_COLOR = 0xffd9a0;
export const FOG_COLOR = 0xf7a56e;

// ---- Player tuning ----
export const PLAYER = {
  walkSpeed: 6, runSpeed: 11, jumpSpeed: 8.5, gravity: 24,
  radius: 0.7, height: 1.8, maxHealth: 100, maxArmour: 100,
  startMoney: 250,
};

// ---- Vehicles: name, top speed (m/s), accel, grip, seats, colour set ----
export const VEHICLE_TYPES = {
  sedan:    { name: 'Marlin S',     top: 30, accel: 14, grip: 8.5,  len: 4.4, wid: 2.0, hp: 100, colors: [0x9fb4c7, 0x7a2e2e, 0x2e4a6b, 0xd8d3c8] },
  sports:   { name: 'Veloce GT',    top: 42, accel: 22, grip: 10.5, len: 4.2, wid: 2.0, hp: 80,  colors: [0xe8632c, 0xf2c230, 0x22b8a6, 0xd9455f] },
  suv:      { name: 'Bison 4x4',    top: 28, accel: 12, grip: 7.5,  len: 4.8, wid: 2.2, hp: 140, colors: [0x3d5a3a, 0x5a5a5a, 0x8a6b3a] },
  van:      { name: 'Hauler Van',   top: 24, accel: 10, grip: 7.0,  len: 5.2, wid: 2.2, hp: 150, colors: [0xdadada, 0x4a6b8a, 0xb08a3a] },
  taxi:     { name: 'Comet Taxi',   top: 30, accel: 14, grip: 8.5,  len: 4.4, wid: 2.0, hp: 100, colors: [0xf2c230] },
  police:   { name: 'SPD Interceptor', top: 38, accel: 20, grip: 10, len: 4.6, wid: 2.1, hp: 120, colors: [0x1d2733] },
  limo:     { name: 'Voss Sovereign', top: 34, accel: 15, grip: 8.0, len: 6.0, wid: 2.1, hp: 220, colors: [0x14100e] },
  truck:    { name: 'Dock Hauler',  top: 22, accel: 9,  grip: 6.5,  len: 6.4, wid: 2.4, hp: 200, colors: [0x6b7a8a] },
};

// ---- Weapons ----
export const WEAPONS = {
  fists:  { name: 'Fists',   slot: 1, damage: 12, rate: 2.6, range: 2.6, auto: false, ammo: Infinity, reserve: Infinity, spread: 0,    kick: 0 },
  pistol: { name: 'P-9 Pistol', slot: 2, damage: 25, rate: 4.0, range: 70,  auto: false, ammo: 12, reserve: 60, spread: 0.012, kick: 0.02 },
  smg:    { name: 'VK-9 SMG', slot: 3, damage: 16, rate: 11,  range: 55,  auto: true,  ammo: 30, reserve: 120, spread: 0.03, kick: 0.012 },
};

// ---- Wanted system ----
export const WANTED = {
  maxStars: 5,
  stealCar: 1, hitPed: 1, shootNearCop: 1, killCop: 2, ramCop: 1,
  escapeRadius: 110,   // no cop inside this radius -> escape timer runs
  escapeTime: 5,       // seconds hidden before a star drops
  decayEvery: 3,       // then a star every N seconds
  maxCops: [0, 2, 3, 4, 5, 6],
  heliAtStars: 3,
};

// ---- Crew call-ins (cooldown seconds) ----
export const CREW = {
  getaway: { key: 'KeyZ', name: 'GETAWAY', who: 'Ivy — Driver', cooldown: 45,
             desc: 'Ivy drops a fast Veloce GT beside you' },
  repair:  { key: 'KeyX', name: 'QUICK FIX', who: 'Tomas — Mechanic', cooldown: 60,
             desc: 'Tomas patches your ride back to full health' },
  lookout: { key: 'KeyC', name: 'EYES OUT', who: 'Nia — Lookout', cooldown: 50,
             desc: 'Nia marks every police unit for 25 seconds' },
};

// ---- Game clock ----
export const CLOCK = { startHour: 16, minutesPerSecond: 0.5 }; // 16:00 sunset

// ---- Mission list (full data lives in missions.js) ----
export const MISSION_NAMES = [
  'First Wheels', 'The Courier', 'Harbor Heat', 'Heat Wave', 'The Fall of Voss',
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
