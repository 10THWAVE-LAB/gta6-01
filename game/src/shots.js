// Honest screenshot setups: deterministic in-game states reached through
// the real game code (?shot=chase|city|driving|mission). Nothing is staged
// outside the game — the same systems run, the camera just starts framed.

import { Vehicle } from './vehicles.js';

function putPlayerInCar(game, type, x, z, heading, speed = 0) {
  const v = new Vehicle(game.scene, type, 0xe8632c, x, z, heading);
  game.vehicles.push(v);
  v.speed = speed;
  game.player.enterCar(v);
  game.cameraRig.yaw = heading;
  game.cameraRig.pitch = 0.16;
  return v;
}

// Clear AI traffic from a stretch of the beach boulevard so the chase
// frame stays clean (the cars respawn around the player anyway).
function clearBoulevard(game, zMin, zMax) {
  for (let i = game.traffic.cars.length - 1; i >= 0; i--) {
    const c = game.traffic.cars[i];
    if (Math.abs(c.v.pos.x - 144) < 10 && c.v.pos.z > zMin && c.v.pos.z < zMax) {
      c.v.dispose(game.scene);
      game.vehicles.splice(game.vehicles.indexOf(c.v), 1);
      game.traffic.cars.splice(i, 1);
    }
  }
}

export function applyShot(game, shot) {
  const g = game;
  if (shot === 'chase') {
    // Cover: police chase on the beach boulevard, 3 stars, heli, M5 live.
    putPlayerInCar(g, 'sports', 144, -70, 0, 28);
    g.missions.startMission(4);
    g.missions.stage = 1;
    g.missions._enterStage();
    const limo = g.missions.targetCar;
    limo.pos.set(144, 0, -25);
    limo.heading = 0;
    limo.speed = 18;
    g.missions.limoWaypoints = [{ x: 144, z: 80 }, { x: 168, z: 40 }, { x: 190, z: 24 }, { x: 236, z: 24 }];
    g.missions.limoWp = 0;
    g.police.stars = 3;
    g.police.heliAngle = 1.0; // heli starts ahead-right of the player, in frame
    for (let i = 0; i < 3; i++) g.police.spawnCop(g.player.pos);
    // Two units in frame: one ahead-left of the player, one alongside.
    const cops = g.police.cops;
    if (cops[0]) { cops[0].v.pos.set(137, 0, -38); cops[0].v.heading = 0; cops[0].v.speed = 24; }
    if (cops[1]) { cops[1].v.pos.set(151, 0, -58); cops[1].v.heading = 0; cops[1].v.speed = 26; }
    g.autoDrive = true;
    g.cameraRig.pitch = 0.42;
    g.cameraRig.holdPitch = 0.42; // tilt up: heli + beacon in frame
    clearBoulevard(g, -140, 80);
    g.missions.say([{ speaker: 'VOSS', text: "You think you can take my city, courier? Drive — to the pier!", dur: 6 }]);
  } else if (shot === 'driving') {
    // Sunset cruise down the beach boulevard with a delivery live.
    putPlayerInCar(g, 'sports', 144, -110, 0, 30);
    g.autoDrive = true;
    clearBoulevard(g, -140, 60);
    g.missions.startMission(1);
    g.missions.stage = 1;
    g.missions.heatSet = true;
    g.missions._updateBeacon();
    g.missions.say([{ speaker: 'IVY', text: 'Cops! Voss tipped them off. Lose them or outrun them — just get to the motel.', dur: 6 }]);
  } else if (shot === 'mission') {
    // Harbor Heat: on foot, pistol out, Voss guards ahead.
    g.missions.startMission(2);
    g.missions.stage = 1;
    g.missions._enterStage();
    g.player.teleport(120, 96, 0);
    g.player.armour = 50;
    g.combat.switchTo('pistol');
    g.cameraRig.yaw = 0; // guards + containers are south of the player
    g.cameraRig.pitch = 0.2;
    g.missions.say([{ speaker: 'NIA', text: 'Four guards between you and the truck. Make it loud or make it quiet — your call.', dur: 6 }]);
  } else {
    // city: on-foot downtown exploration, traffic + pedestrians, sunset.
    g.player.teleport(0, -30, 0.4);
    g.cameraRig.yaw = 0.4;
    g.cameraRig.pitch = 0.22;
    g.hud.toast('Explore Solmar City — steal a car with E, follow the amber marker');
  }
  // Re-seed traffic + pedestrians around the staged position so the
  // streets are alive in the frame, then flag readiness for the tool.
  g._seedWorld();
  setTimeout(() => { window.__shotReady = true; }, 1600);
}
