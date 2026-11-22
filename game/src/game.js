'use strict';
/* Port Azura: Sunset Heat — the game itself.
   Owns the renderer and the main loop, the player (on foot and driving),
   the camera, input, combat, collisions, the busted/wasted flow, screens,
   the localStorage save, and the deterministic ?shot= screenshot modes. */

const G = (PA.G = {
  state: 'title',           // title | playing | paused | busted | wasted | complete
  time: 0,
  cash: 350,
  health: 100,
  playerPos: { x: -130, z: 158 },
  playerHeading: Math.PI,
  driving: null,
  blockers: [],
  prevStars: 0,
  lastDamageAt: -99,
  punchAt: null,
  shotMode: PA.params.get('shot'),
  addCash: function (n) { G.cash += n; },
  onStoryComplete: null,
});
G.focusPoint = G.playerPos;

let renderer, scene, camera;
let player = null;          // {mesh, limbs, heading, speed, phase, vx, vz}
let camYaw = Math.PI, camPitch = 0.34, lastMouseAt = -99;
let keys = {};
let punchCooldown = 0;
let shake = 0;
let saveClock = 0;
let framesRendered = 0;

/* ---------------- the player character ---------------- */
function makePlayerMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d5f });
  const jacket = new THREE.MeshLambertMaterial({ color: 0x12a5b4 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2f3542 });
  function limb(mat, w, h, d, x, y, z) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  const limbs = {
    legL: limb(pants, 0.17, 0.78, 0.19, -0.13, 0.78, 0),
    legR: limb(pants, 0.17, 0.78, 0.19, 0.13, 0.78, 0),
    armL: limb(jacket, 0.13, 0.62, 0.15, -0.34, 1.34, 0),
    armR: limb(jacket, 0.13, 0.62, 0.15, 0.34, 1.34, 0),
  };
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.28), jacket);
  torso.position.y = 1.09; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.34, 0.3), skin);
  head.position.y = 1.58; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.36), new THREE.MeshLambertMaterial({ color: 0xff5e3c }));
  cap.position.y = 1.77; g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.22), cap.material);
  brim.position.set(0, 1.73, 0.26); g.add(brim);
  g.userData.limbs = limbs;
  return g;
}

function groundY(x, z) {
  if (x > -161 && x < -151 && z > 184 && z < 284) return 0.55;   // pier deck
  const ci = Math.round((x + 182) / 52), ri = Math.round((z + 130) / 52);
  if (ci >= 0 && ci < 8 && ri >= 0 && ri < 6) {
    const cx = -182 + ci * 52, cz = -130 + ri * 52;
    if (Math.abs(x - cx) < 22 && Math.abs(z - cz) < 22) return 0.32;
  }
  return 0.04;
}

/* ---------------- boot ---------------- */
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  PA.el('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(92, 34, 132);

  PA.World.build(scene);
  PA.Vehicles.init(scene);
  PA.People.init(scene);
  PA.Police.init(scene);
  PA.Missions.init(scene);
  PA.HUD.init();

  const mesh = makePlayerMesh();
  mesh.position.set(G.playerPos.x, groundY(G.playerPos.x, G.playerPos.z), G.playerPos.z);
  scene.add(mesh);
  player = { mesh: mesh, heading: Math.PI, speed: 0, phase: 0, vx: 0, vz: 0 };
  /* Parked cars in the lot sit on its raised slab. */
  PA.Vehicles.all.forEach(function (c) {
    if (Math.abs(c.mesh.position.x + 78) < 22 && Math.abs(c.mesh.position.z - 78) < 22) c.mesh.position.y = 0.31;
  });

  bindInput();
  bindScreens();
  if (loadSave()) PA.el('btn-continue').classList.remove('hidden');

  if (G.shotMode) setupShot(G.shotMode);
  window.addEventListener('resize', onResize);
  requestAnimationFrame(loop);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ---------------- input ---------------- */
function bindInput() {
  window.addEventListener('keydown', function (ev) {
    PA.Audio.init();
    keys[ev.code] = true;
    if (ev.code === 'Space') ev.preventDefault();
    if (G.state === 'playing') {
      if (ev.code === 'KeyE') onInteract();
      if (ev.code === 'KeyF') tryPunch();
      if (ev.code === 'KeyR' && PA.Missions.circuitOffer()) PA.Missions.startCircuit();
      if (ev.code === 'KeyP') pauseGame();
    } else if (G.state === 'paused' && ev.code === 'KeyP') resumeGame();
    if (ev.code === 'KeyM') PA.HUD.toast(PA.Audio.toggleMute() ? 'Sound off' : 'Sound on');
  });
  window.addEventListener('keyup', function (ev) { keys[ev.code] = false; });
  renderer.domElement.addEventListener('mousedown', function () {
    PA.Audio.init();
    if (G.state !== 'playing') return;
    if (document.pointerLockElement === renderer.domElement) tryPunch();
    else renderer.domElement.requestPointerLock();
  });
  document.addEventListener('mousemove', function (ev) {
    if (document.pointerLockElement !== renderer.domElement) return;
    camYaw -= ev.movementX * 0.0026;
    camPitch = PA.clamp(camPitch + ev.movementY * 0.0021, -0.04, 1.05);
    lastMouseAt = G.time;
  });
}

function bindScreens() {
  PA.el('btn-start').addEventListener('click', function () { PA.Audio.init(); PA.Audio.click(); newGame(); });
  PA.el('btn-continue').addEventListener('click', function () { PA.Audio.init(); PA.Audio.click(); continueGame(); });
  PA.el('btn-resume').addEventListener('click', function () { PA.Audio.click(); resumeGame(); });
  PA.el('btn-restart').addEventListener('click', function () { PA.Audio.click(); newGame(); });
  PA.el('btn-busted-ok').addEventListener('click', function () { PA.Audio.click(); closeEndScreen(); });
  PA.el('btn-wasted-ok').addEventListener('click', function () { PA.Audio.click(); closeEndScreen(); });
  PA.el('btn-complete-ok').addEventListener('click', function () { PA.Audio.click(); closeEndScreen(); });
}

/* ---------------- save / load ---------------- */
const SAVE_KEY = 'portAzuraSunsetHeatSaveV1';
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, health: Math.round(G.health),
      mi: PA.Missions.state.index, done: PA.Missions.state.storyDone,
      x: Math.round(G.playerPos.x), z: Math.round(G.playerPos.z),
    }));
  } catch (e) { /* storage unavailable — play on without saving */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    G.pendingSave = JSON.parse(raw);
    return !!(G.pendingSave && typeof G.pendingSave.cash === 'number');
  } catch (e) { return false; }
}

/* ---------------- game flow ---------------- */
function showOnly(id) {
  ['screen-start', 'screen-pause', 'screen-busted', 'screen-wasted', 'screen-complete'].forEach(function (s) {
    PA.el(s).classList.toggle('hidden', s !== id);
  });
  if (!id) ['screen-start', 'screen-pause', 'screen-busted', 'screen-wasted', 'screen-complete'].forEach(function (s) { PA.el(s).classList.add('hidden'); });
}

function placePlayerOnFoot(x, z, heading) {
  if (G.driving) { G.driving.occupied = false; G.driving = null; }
  player.mesh.visible = true;
  player.mesh.position.set(x, groundY(x, z), z);
  player.heading = heading;
  player.speed = 0;
  G.playerPos.x = x; G.playerPos.z = z;
  G.playerHeading = heading;
  camYaw = heading + Math.PI;
}

function startPlaying() {
  showOnly(null);
  PA.el('hud').classList.remove('hidden');
  G.state = 'playing';
}

function newGame() {
  G.cash = 350; G.health = 100;
  PA.Police.clearHeat();
  PA.Missions.setProgress(0, false);
  placePlayerOnFoot(PA.World.marks.garage.x, PA.World.marks.garage.z + 5, Math.PI);
  startPlaying();
  PA.Missions.startMission(0);
  save();
}

function continueGame() {
  const s = G.pendingSave;
  if (!s) { newGame(); return; }
  G.cash = s.cash; G.health = s.health || 100;
  PA.Police.clearHeat();
  PA.Missions.setProgress(s.mi || 0, !!s.done);
  placePlayerOnFoot(s.x || -130, s.z || 158, Math.PI);
  startPlaying();
  if (!s.done) PA.Missions.startMission(s.mi || 0);
  else PA.HUD.toast('Welcome back to Port Azura.');
}

function pauseGame() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  PA.el('pause-stats').textContent = 'Cash $' + G.cash + ' — ' +
    (PA.Missions.state.storyDone ? 'story complete, free roaming' : 'on mission ' + (PA.Missions.state.index + 1) + ' of 4') +
    ' — wanted level ' + PA.Police.stars() + '.';
  showOnly('screen-pause');
  save();
}
function resumeGame() { showOnly(null); G.state = 'playing'; }

function endScreen(kind, cost) {
  G.state = kind;
  if (G.driving) { const c = G.driving; c.occupied = false; c.speed = 0; G.driving = null; }
  PA.Police.clearHeat();
  if (kind === 'busted') {
    PA.el('busted-cost').textContent = '$' + cost;
    placePlayerOnFoot(PA.World.marks.pd.x, PA.World.marks.pd.z, Math.PI);
    showOnly('screen-busted');
  } else {
    PA.el('wasted-cost').textContent = '$' + cost;
    G.health = 100;
    placePlayerOnFoot(PA.World.marks.clinic.x, PA.World.marks.clinic.z, Math.PI);
    showOnly('screen-wasted');
  }
  PA.Audio.setEngine(false, 0);
  save();
}
function busted() {
  const cost = Math.min(G.cash, 60 + PA.Police.stars() * 40);
  G.cash -= cost;
  endScreen('busted', cost);
}
function wasted() {
  const cost = Math.min(G.cash, 80);
  G.cash -= cost;
  endScreen('wasted', cost);
}
function closeEndScreen() {
  showOnly(null);
  G.state = 'playing';
}

G.onStoryComplete = function () {
  PA.el('complete-stats').textContent = 'Final cash: $' + G.cash + '. Rook is a legend of the sunset strip.';
  G.state = 'complete';
  showOnly('screen-complete');
  save();
};

/* ---------------- entering / leaving cars ---------------- */
function enterCar(car) {
  if (car.health <= 0) { PA.HUD.toast('That car is wrecked — find another.'); return; }
  car.occupied = true;
  G.driving = car;
  player.mesh.visible = false;
  if (car.kind === 'traffic') car.kind = 'parked';   // its driver has… stepped out for good
  if (!car.stolen) {
    car.stolen = true;
    if (!car.isVan && PA.Police.addHeat(2, car.mesh.position.x, car.mesh.position.z, G.time)) {
      PA.HUD.toast('Witnessed! Someone called the PD.');
    }
  }
  PA.HUD.setPrompt(null);
}

function exitCar() {
  const car = G.driving;
  if (!car) return;
  car.occupied = false;
  car.speed = 0;
  G.driving = null;
  const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
  const p = { x: car.mesh.position.x + rx * 2.5, z: car.mesh.position.z + rz * 2.5 };
  PA.World.collideBuildings(p, 0.55);
  PA.World.clampPlay(p, 0.55);
  player.mesh.visible = true;
  player.mesh.position.set(p.x, groundY(p.x, p.z), p.z);
  player.heading = car.heading;
  G.playerPos.x = p.x; G.playerPos.z = p.z;
  PA.Audio.setEngine(false, 0);
}

function onInteract() {
  if (G.driving) { exitCar(); return; }
  const car = PA.Vehicles.nearestCar(G.playerPos.x, G.playerPos.z, 3.6);
  if (car) enterCar(car);
}

/* ---------------- combat ---------------- */
function tryPunch() {
  if (G.driving || punchCooldown > 0) return;
  punchCooldown = 0.38;
  player.swingT = 0.22;
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  const ped = PA.People.nearestPed(G.playerPos.x, G.playerPos.z, 2.5);
  if (ped) {
    const dx = ped.mesh.position.x - G.playerPos.x, dz = ped.mesh.position.z - G.playerPos.z;
    if (dx * fx + dz * fz > 0.1) {
      PA.People.punchPed(ped);
      PA.Audio.punch();
      G.punchAt = { x: ped.mesh.position.x, z: ped.mesh.position.z, until: G.time + 0.6 };
      if (PA.Police.addHeat(1.5, G.playerPos.x, G.playerPos.z, G.time)) PA.HUD.toast('Witnessed! That was assault.');
      return;
    }
  }
  const car = PA.Vehicles.nearestCar(G.playerPos.x, G.playerPos.z, 2.7);
  if (car) {
    PA.Audio.punch();
    PA.Vehicles.damageCar(car, 2);
    car.pushX += fx * 1.2; car.pushZ += fz * 1.2;
  }
}

function hurt(n) {
  if (n <= 0 || G.state !== 'playing' || G.warmup) return;
  G.health -= n;
  G.lastDamageAt = G.time;
  if (G.health <= 0) { G.health = 0; wasted(); }
}

/* ---------------- per-frame updates ---------------- */
function updatePlayerFoot(dt) {
  const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
  const r = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
  const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const mx = f.x * iz + r.x * ix, mz = f.z * iz + r.z * ix;
  if (mx || mz) {
    player.heading = PA.angleLerp(player.heading, Math.atan2(mx, mz), Math.min(1, dt * 11));
    const top = (keys.ShiftLeft || keys.ShiftRight) ? 7.4 : 4.6;
    player.speed = PA.lerp(player.speed, top, Math.min(1, dt * 9));
    if (G.time - lastMouseAt > 2.5 && !G.shotMode) {
      camYaw = PA.angleLerp(camYaw, player.heading + Math.PI, Math.min(1, dt * 1.7));
    }
  } else {
    player.speed = PA.lerp(player.speed, 0, Math.min(1, dt * 10));
  }
  const p = player.mesh.position;
  p.x += Math.sin(player.heading) * player.speed * dt;
  p.z += Math.cos(player.heading) * player.speed * dt;
  PA.World.collideBuildings(p, 0.55);
  PA.World.clampPlay(p, 0.55);
  p.y = groundY(p.x, p.z);
  player.mesh.rotation.y = player.heading;
  player.phase += dt * player.speed * 2.5;
  const sw = Math.sin(player.phase) * PA.clamp(player.speed / 7, 0, 1) * 0.6;
  const L = player.mesh.userData.limbs;
  L.legL.rotation.x = sw; L.legR.rotation.x = -sw;
  if (player.swingT > 0) {
    player.swingT -= dt;
    L.armR.rotation.x = -2.3 * Math.max(0, player.swingT / 0.22);
    L.armL.rotation.x = -sw * 0.6;
  } else {
    L.armL.rotation.x = -sw * 0.6; L.armR.rotation.x = sw * 0.6;
  }
  G.playerPos.x = p.x; G.playerPos.z = p.z;
  G.playerHeading = player.heading;
}

function collideDrivenCar(car) {
  const p = car.mesh.position;
  const sp = Math.abs(car.speed);
  for (let i = 0; i < PA.Vehicles.all.length; i++) {
    const o = PA.Vehicles.all[i];
    if (o === car || o.occupied) continue;
    const d = PA.dist(p.x, p.z, o.mesh.position.x, o.mesh.position.z);
    const min = car.radius + o.radius - 0.35;
    if (d < min && d > 0.001) {
      const nx = (o.mesh.position.x - p.x) / d, nz = (o.mesh.position.z - p.z) / d;
      o.pushX += nx * sp * 0.6 + nx * 2;
      o.pushZ += nz * sp * 0.6 + nz * 2;
      p.x -= nx * (min - d) * 0.6;
      p.z -= nz * (min - d) * 0.6;
      if (sp > 5.5 && !G.warmup && G.time - (o.lastHitAt || -9) > 1.2) {
        o.lastHitAt = G.time;
        PA.Vehicles.damageCar(o, sp * 0.75);
        if (o.kind === 'traffic') o.stun = 2.2;
        PA.Audio.crash(sp > 10);
        shake = Math.min(0.45, sp * 0.018);
        if (PA.Police.addHeat(1.2, p.x, p.z, G.time)) PA.HUD.toast('Witnessed! Hit and run.');
      }
      if (sp > 3) car.speed *= 0.55;
    }
  }
  for (let i = 0; i < PA.Police.cars.length; i++) {
    const pc = PA.Police.cars[i];
    if (!pc.active) continue;
    const d = PA.dist(p.x, p.z, pc.mesh.position.x, pc.mesh.position.z);
    const min = car.radius + pc.radius - 0.3;
    if (d < min && d > 0.001) {
      const nx = (pc.mesh.position.x - p.x) / d, nz = (pc.mesh.position.z - p.z) / d;
      pc.mesh.position.x += nx * (min - d);
      pc.mesh.position.z += nz * (min - d);
      if (sp > 4) { car.speed *= 0.7; if (!G.warmup) PA.Audio.crash(false); }
    }
  }
  for (let i = 0; i < PA.People.peds.length; i++) {
    const ped = PA.People.peds[i];
    if (ped.state === 'down') continue;
    if (PA.dist(p.x, p.z, ped.mesh.position.x, ped.mesh.position.z) < 1.7 && sp > 3.5) {
      if (!G.warmup) {
        PA.People.punchPed(ped);
        PA.Audio.crash(false);
        PA.Police.addHeat(3, p.x, p.z, G.time);
        shake = Math.max(shake, 0.16);
      }
      car.speed *= 0.55;
    }
  }
}

function updateDriving(dt) {
  const car = G.driving;
  const input = {
    throttle: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    steer: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
    handbrake: !!keys.Space,
  };
  if (G.shotAutopilot) { input.throttle = 0.6; input.steer = 0; }
  const impact = PA.Vehicles.updateDriven(car, input, dt);
  if (impact > 6 && !G.warmup) {
    shake = Math.min(0.5, impact * 0.02);
    PA.Audio.crash(impact > 11);
    if (impact > 10) hurt((impact - 10) * 0.8);
    if (impact > 9) PA.Police.addHeat(0.5, car.mesh.position.x, car.mesh.position.z, G.time);
  }
  collideDrivenCar(car);
  car.mesh.position.y = groundY(car.mesh.position.x, car.mesh.position.z) - 0.04;
  G.playerPos.x = car.mesh.position.x;
  G.playerPos.z = car.mesh.position.z;
  G.playerHeading = car.heading;
  PA.Audio.setEngine(true, Math.abs(car.speed) / 31);
}

function updatePrompt() {
  if (G.driving) {
    PA.HUD.setPrompt(PA.Missions.circuitOffer() ? '<b>R</b> Run the Sunset Circuit — $200' : null);
    return;
  }
  const car = PA.Vehicles.nearestCar(G.playerPos.x, G.playerPos.z, 3.6);
  if (!car) { PA.HUD.setPrompt(null); return; }
  if (car.health <= 0) PA.HUD.setPrompt('That car is wrecked');
  else if (car.isVan && !PA.Missions.state.storyDone && PA.Missions.state.index === 2 && PA.Missions.state.step === 0) PA.HUD.setPrompt('<b>E</b> Steal the van');
  else PA.HUD.setPrompt('<b>E</b> ' + (car.stolen ? 'Enter your car' : 'Steal this car'));
}

function stepWorld(dt) {
  G.time += dt;
  punchCooldown = Math.max(0, punchCooldown - dt);
  const prevX = G.playerPos.x, prevZ = G.playerPos.z;
  if (G.driving) updateDriving(dt); else updatePlayerFoot(dt);
  const vx = (G.playerPos.x - prevX) / Math.max(dt, 0.001);
  const vz = (G.playerPos.z - prevZ) / Math.max(dt, 0.001);

  G.blockers.length = 0;
  G.blockers.push({ x: G.playerPos.x, z: G.playerPos.z, r: 1.1 });
  PA.Police.cars.forEach(function (c) {
    if (c.active) G.blockers.push({ x: c.mesh.position.x, z: c.mesh.position.z, r: 1.75 });
  });
  PA.Vehicles.updateTraffic(dt);
  PA.Vehicles.updateParked(dt);

  const dangers = [];
  if (G.driving && Math.abs(G.driving.speed) > 8) dangers.push({ x: G.playerPos.x, z: G.playerPos.z, r: 11 });
  if (G.punchAt && G.time < G.punchAt.until) dangers.push({ x: G.punchAt.x, z: G.punchAt.z, r: 7 });
  PA.Police.cars.forEach(function (c) {
    if (c.active) dangers.push({ x: c.mesh.position.x, z: c.mesh.position.z, r: 8 });
  });
  PA.People.update(dt, dangers);

  PA.Police.update(dt, {
    x: G.playerPos.x, z: G.playerPos.z, vx: vx, vz: vz,
    speed: G.driving ? G.driving.speed : player.speed, inCar: !!G.driving,
  }, G.time);

  const st = PA.Police.stars();
  if (st !== G.prevStars) {
    if (st > G.prevStars && st > 0) PA.HUD.toast(st >= 5 ? 'WANTED — 5 STARS. The whole PD is coming.' : 'Wanted level: ' + st + (st === 1 ? ' star' : ' stars'));
    if (st === 0 && G.prevStars > 0) PA.HUD.toast('You lost the heat.');
    G.prevStars = st;
  }

  PA.Missions.update(dt);
  if (G.time - G.lastDamageAt > 5 && G.health > 0) G.health = Math.min(100, G.health + 5 * dt);
  updatePrompt();
  PA.HUD.update(dt);
  PA.World.update(dt, G.time);
  updateCamera(dt);

  if (PA.Police.getBust() >= 1 && G.state === 'playing' && !G.warmup) busted();
  saveClock += dt;
  if (saveClock > 12) { saveClock = 0; save(); }
}

/* ---------------- camera ---------------- */
function updateCamera(dt) {
  if (G.shotMode === 'start' || G.shotMode === 'end') {
    camera.position.set(92, 34, 132);
    camera.lookAt(-30, 4, 20);
    return;
  }
  if (G.state === 'title' || G.state === 'complete') {
    const a = G.time * 0.045;
    camera.position.set(Math.sin(a) * 175, 42, 40 + Math.cos(a) * 135);
    camera.lookAt(0, 2, 30);
    return;
  }
  let target, dist, look;
  if (G.driving) {
    const car = G.driving;
    camYaw = PA.angleLerp(camYaw, car.heading + (G.shotFrontCam ? 0 : Math.PI), Math.min(1, dt * 4.5));
    camPitch = PA.lerp(camPitch, 0.30, Math.min(1, dt * 3));
    dist = G.shotFrontCam ? 12.5 : 10.5;
    target = car.mesh.position;
    look = G.shotFrontCam
      ? { x: target.x, y: 1.3, z: target.z }
      : { x: target.x + Math.sin(car.heading) * 3.5, y: 1.6, z: target.z + Math.cos(car.heading) * 3.5 };
  } else {
    dist = 7.6;
    target = player.mesh.position;
    look = { x: target.x, y: target.y + 1.55, z: target.z };
  }
  const cx = target.x + Math.sin(camYaw) * Math.cos(camPitch) * dist;
  const cz = target.z + Math.cos(camYaw) * Math.cos(camPitch) * dist;
  let cy = target.y + Math.sin(camPitch) * dist + 0.6;
  if (cy < 1.15) cy = 1.15;
  if (G.shotMode) {
    camera.position.set(cx, cy, cz);
  } else {
    const k = 1 - Math.exp(-dt * 11);
    camera.position.x += (cx - camera.position.x) * k;
    camera.position.y += (cy - camera.position.y) * k;
    camera.position.z += (cz - camera.position.z) * k;
  }
  if (shake > 0.003) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.7;
    shake *= Math.max(0, 1 - dt * 5);
  }
  camera.lookAt(look.x, look.y, look.z);
  const targetFov = G.driving ? 62 + Math.min(13, Math.abs(G.driving.speed) * 0.4) : 62;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = PA.lerp(camera.fov, targetFov, Math.min(1, dt * 4));
    camera.updateProjectionMatrix();
  }
}

/* ---------------- deterministic screenshot modes ---------------- */
function enterShotCar(car) {
  car.occupied = true;
  car.stolen = true;
  car.kind = 'parked';
  G.driving = car;
  player.mesh.visible = false;
  G.playerPos.x = car.mesh.position.x;
  G.playerPos.z = car.mesh.position.z;
  camYaw = car.heading + (G.shotFrontCam ? 0 : Math.PI);
}

function stageChase(car) {
  const info = { x: G.playerPos.x, z: G.playerPos.z, vx: 0, vz: 12, speed: 13, inCar: true };
  for (let i = 0; i < 4; i++) PA.Police.update(0.25, info, G.time);
  const behind = [[0, -11], [-3.6, -16.5], [3.6, -22]];
  let n = 0;
  PA.Police.cars.forEach(function (pc) {
    if (!pc.active) return;
    const off = behind[n % behind.length];
    pc.mesh.position.set(car.mesh.position.x + off[0], 0, car.mesh.position.z + off[1]);
    pc.heading = car.heading;
    pc.mesh.rotation.y = pc.heading;
    pc.speed = 13;
    n++;
  });
}

function setupShot(mode) {
  if (mode === 'start') { G.state = 'title'; return; }
  if (mode === 'end') {
    G.cash = 2150;
    PA.Missions.setProgress(3, true);
    PA.el('complete-stats').textContent = 'Final cash: $2,150. Rook is a legend of the sunset strip.';
    G.state = 'complete';
    showOnly('screen-complete');
    return;
  }
  /* play / chase: jump straight into a composed driving scene. */
  showOnly(null);
  PA.el('hud').classList.remove('hidden');
  G.state = 'playing';
  G.shotAutopilot = true;
  let car;
  if (mode === 'play') {
    car = PA.Vehicles.registerCar('parked', 'car', 0x3f9db5, -100.9, -34, 0);
    car.speed = 12;
    enterShotCar(car);
    PA.Missions.startMission(0);
  } else {
    car = PA.Vehicles.registerCar('parked', 'car', 0xff7d3c, 3.1, -52, 0);
    car.speed = 14;
    G.shotFrontCam = true;   // camera ahead of the car, looking back at the pursuit
    enterShotCar(car);
    PA.Missions.startMission(0);
    PA.Police.setHeat(5.5);
    stageChase(car);
  }
  /* Warm the simulation up so traffic is spread and the scene is composed. */
  G.warmup = true;
  for (let i = 0; i < 150; i++) stepWorld(1 / 30);
  G.warmup = false;
  car.health = 100;
  PA.Vehicles.damageCar(car, 0);
  G.health = 100;
  if (mode === 'play') PA.Police.clearHeat();
  else { PA.Police.setHeat(5.5); stageChase(car); }
}

/* ---------------- main loop ---------------- */
let lastNow = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016);
  lastNow = now;
  if (G.state === 'playing') stepWorld(dt);
  else if (G.state === 'title' || G.state === 'complete') {
    G.time += dt;
    PA.World.update(dt, G.time);
    updateCamera(dt);
  }
  renderer.render(scene, camera);
  framesRendered++;
  if (G.shotMode && !window.__shotReady && framesRendered >= 42) window.__shotReady = true;
}

init();
