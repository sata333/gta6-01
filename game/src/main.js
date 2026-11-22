// main.js — Port Azura: Sunset Heat. Bootstraps the renderer and the
// sunset sky, builds the city, assembles the world (player, traffic,
// pedestrians, police, missions, HUD, sound), and runs the game: states
// (menu, playing, paused, wasted, busted, story-complete), camera work,
// collisions and crime, the save system, and the deterministic screenshot
// modes (?shot=start|play|chase|end&seed=1) used for the entry's images.

import { Rng } from './rng.js';
import { buildCity, collideCircle, groundHeightAt, ROAD_XS, ROAD_ZS } from './city.js';
import { Car, TrafficDriver, CAR_COLORS } from './vehicles.js';
import { Ped } from './people.js';
import { Player } from './player.js';
import { WantedSystem } from './police.js';
import { MissionChain } from './missions.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';
import { loadSave, writeSave, clearSave } from './save.js';

// Surface errors on the page (handy in headless screenshot runs).
window.__gameErrors = [];
window.addEventListener('error', (e) => {
  window.__gameErrors.push(String(e.message));
  const box = document.getElementById('debug-errors');
  if (box) box.textContent = window.__gameErrors.join('\n');
});

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') ?? 7) || 7;
const rng = new Rng(SEED);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe8906a, 150, 950);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(-60, 40, 190);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- sky & sun
function buildSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1800, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vP;' +
        'void main(){ float h = normalize(vP).y;' +
        ' vec3 top = vec3(0.15, 0.22, 0.42);' +
        ' vec3 mid = vec3(0.86, 0.38, 0.27);' +
        ' vec3 low = vec3(1.0, 0.71, 0.40);' +
        ' vec3 c = h > 0.16 ? mix(mid, top, smoothstep(0.16, 0.62, h)) : mix(low, mid, smoothstep(-0.05, 0.16, h));' +
        ' gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  scene.add(sky);

  // A soft sun glow sprite hanging over the sea.
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 236, 190, 1)');
  grad.addColorStop(0.35, 'rgba(255, 190, 110, 0.55)');
  grad.addColorStop(1, 'rgba(255, 160, 80, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sun.position.set(-620, 150, 1150);
  sun.scale.set(760, 760, 1);
  scene.add(sun);
}
buildSky();

const hemi = new THREE.HemisphereLight(0xffd9b0, 0x7a4a3a, 1.15);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffb36b, 2.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 700;
sunLight.shadow.bias = -0.0008;
scene.add(sunLight);
scene.add(sunLight.target);
const SUN_DIR = new THREE.Vector3(-0.42, 0.52, 0.74).normalize();

// ---------------------------------------------------------------- the world
const cityData = buildCity(scene, rng);
const sound = new SoundBank();

const world = {
  scene,
  rng,
  sound,
  time: 0,
  cars: [],
  peds: [],
  cash: 0,
  cameraYaw: Math.PI * 1.5,
  city: {
    data: cityData,
    colliders: cityData.colliders,
    lots: cityData.lots,
    pedLoops: cityData.pedLoops,
    places: cityData.places,
    parkedSpots: cityData.parkedSpots,
    collide(pos, r) {
      return collideCircle(pos, r, cityData.colliders);
    },
    heightAt(x, z) {
      return groundHeightAt(x, z, cityData.lots);
    },
  },
};

world.addCash = (n) => {
  world.cash += n;
  hud.setCash(world.cash);
};

/** Crime reporting: heat scaled by whether anyone saw it happen. */
world.onCrime = (type, pos) => {
  const HEAT = { theft: 70, assault: 35, pedHit: 135, policeHit: 130, crash: 18 };
  let witnessed = false;
  for (const ped of world.peds) {
    if (ped.state !== 'fallen' && Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z) < 32) witnessed = true;
  }
  for (const cop of world.wanted.police) {
    if (Math.hypot(cop.pos.x - pos.x, cop.pos.z - pos.z) < 60) witnessed = true;
  }
  world.wanted.addHeat((HEAT[type] ?? 20) * (witnessed ? 1 : 0.3));
  if (type === 'assault' || type === 'pedHit') {
    for (const ped of world.peds) {
      if (Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z) < 13) ped.scare(pos.x, pos.z);
    }
  }
};

world.onPedDown = (ped, power) => {
  if (power >= 5 && sound) sound.noiseHit(0.16, 300, 0.3);
};

world.onCarWallHit = () => {};

world.onCarWrecked = (car) => {
  if (world.missions && world.missions.markedVan === car) {
    world.missions.markedVan = null;
    if (world.missions.active && world.missions.active.mission.id === 'cargo') {
      world.missions.fail(world, 'The van is wrecked. Marisol needed that cargo intact.');
    }
  }
  if (player.state === 'driving' && player.car === car) {
    player.damage(12, world);
    if (!player.dead) ejectFromCar();
  }
};

/** A stolen traffic car's driver becomes a fleeing pedestrian. */
world.spawnEjectedDriver = (car) => {
  const ped = new Ped(scene, rng, rng.pick(cityData.pedLoops));
  ped.mesh.position.set(car.pos.x + 2.3, world.city.heightAt(car.pos.x + 2.3, car.pos.z), car.pos.z + 0.8);
  ped.state = 'flee';
  ped.stateTime = 0;
  ped.fleeFrom = { x: car.pos.x, z: car.pos.z };
  world.peds.push(ped);
};

/** The marked cargo van for Marisol's third job, parked at the docks. */
world.spawnMissionVan = () => {
  const van = new Car(scene, { kind: 'van', color: 0x707880, x: 34, z: 168, heading: Math.PI, driver: 'parked' });
  van.input.brake = true;
  world.cars.push(van);
  return van;
};

world.saveGame = () => {
  if (SHOT) return;
  writeSave({
    cash: world.cash,
    missionIndex: missions.index,
    storyDone: missions.storyDone,
    px: player.pos.x,
    pz: player.pos.z,
    heading: player.heading,
    health: player.health,
  });
};

// ---------------------------------------------------------------- cast
const player = new Player(scene, 128, 100);
player.heading = Math.PI / 2;
world.player = player;

const wanted = new WantedSystem();
world.wanted = wanted;

const hud = new Hud();
world.hud = hud;

const missions = new MissionChain(scene, world);
world.missions = missions;

function spawnTrafficCar(x, z, heading) {
  const kind = rng.chance(0.14) ? 'taxi' : rng.chance(0.1) ? 'van' : 'car';
  const car = new Car(scene, { kind, color: rng.pick(CAR_COLORS), x, z, heading, driver: 'traffic' });
  car.brain = new TrafficDriver(car, rng);
  world.cars.push(car);
  return car;
}

function spawnInitialTraffic() {
  for (let i = 0; i < 14; i++) {
    const ix = rng.pick(ROAD_XS);
    const iz = rng.pick(ROAD_ZS);
    const heading = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    spawnTrafficCar(ix + rng.range(-3, 3), iz + rng.range(-3, 3), heading);
  }
  for (const spot of cityData.parkedSpots) {
    if (rng.chance(0.22)) continue;
    const car = new Car(scene, {
      kind: rng.chance(0.12) ? 'van' : 'car',
      color: rng.pick(CAR_COLORS),
      x: spot.x,
      z: spot.z,
      heading: spot.heading,
      driver: 'parked',
    });
    car.input.brake = true;
    world.cars.push(car);
  }
  for (let i = 0; i < 22; i++) {
    world.peds.push(new Ped(scene, rng, rng.pick(cityData.pedLoops)));
  }
}
spawnInitialTraffic();

// ---------------------------------------------------------------- state
let state = 'menu'; // menu | playing | paused | wasted | busted | ended
let shotAutopilot = false;
let saveTimer = 0;
let playerHitCooldown = 0;

const screens = {
  start: document.getElementById('screen-start'),
  pause: document.getElementById('screen-pause'),
  wasted: document.getElementById('screen-wasted'),
  end: document.getElementById('screen-end'),
  hud: document.getElementById('hud'),
};
const savedGame = SHOT ? null : loadSave();
const continueBtn = document.getElementById('btn-continue');
if (!savedGame) continueBtn.disabled = true;

function showScreen(name) {
  for (const key of ['start', 'pause', 'wasted', 'end']) {
    screens[key].classList.toggle('hidden', key !== name);
  }
  if (name === null) {
    for (const key of ['start', 'pause', 'wasted', 'end']) screens[key].classList.add('hidden');
  }
}

function beginPlay(fresh) {
  sound.ensure();
  if (fresh) {
    clearSave();
    world.cash = 0;
    missions.index = 0;
    missions.storyDone = false;
    player.health = player.maxHealth;
    player.dead = false;
    player.pos.set(128, 0, 100);
    player.heading = Math.PI / 2;
    wanted.clear();
  } else if (savedGame) {
    world.cash = savedGame.cash ?? 0;
    missions.index = savedGame.missionIndex ?? 0;
    missions.storyDone = !!savedGame.storyDone;
    player.pos.set(savedGame.px ?? 128, 0, savedGame.pz ?? 100);
    player.heading = savedGame.heading ?? Math.PI / 2;
    player.health = savedGame.health ?? 100;
    player.dead = false;
  }
  hud.setCash(world.cash);
  hud.setObjective(missions.objectiveText(world), '');
  showScreen(null);
  screens.hud.classList.remove('hidden');
  state = 'playing';
}

function ejectFromCar() {
  if (player.state === 'driving' && player.car) {
    const car = player.car;
    player.exitCar(world);
    car.driver = 'parked';
  }
}

function endRun(kind) {
  // kind: 'wasted' | 'busted'
  if (player.state === 'driving') ejectFromCar();
  if (missions.active) missions.fail(world, kind === 'wasted' ? 'You woke up at St. Azura Hospital.' : 'The PD took the job apart.');
  const penalty = kind === 'wasted' ? Math.floor(world.cash * 0.1) : Math.min(world.cash, 150);
  world.cash = Math.max(0, world.cash - penalty);
  hud.setCash(world.cash);
  wanted.clear();
  for (const cop of [...wanted.police]) wanted.despawn(cop, world);
  document.getElementById('wasted-title').textContent = kind === 'wasted' ? 'WASTED' : 'BUSTED';
  document.getElementById('wasted-sub').textContent =
    kind === 'wasted'
      ? `St. Azura Hospital patched Rook up and billed $${penalty}. The city keeps spinning.`
      : `Port Azura PD held Rook overnight and fined $${penalty}. Marisol is not impressed.`;
  showScreen('wasted');
  state = kind;
  document.exitPointerLock?.();
}

world.onPlayerWasted = () => endRun('wasted');
world.onPlayerBusted = () => endRun('busted');
world.onStoryComplete = () => {
  setTimeout(() => {
    if (state === 'playing') {
      showScreen('end');
      state = 'ended';
      document.exitPointerLock?.();
    }
  }, 2600);
};

function respawn() {
  const at = state === 'busted' ? cityData.places.pdDoor : cityData.places.hospitalDoor;
  player.pos.set(at.x, 0, at.z);
  player.health = player.maxHealth;
  player.dead = false;
  showScreen(null);
  state = 'playing';
  world.saveGame();
}

function restartStory() {
  clearSave();
  if (player.state === 'driving') ejectFromCar();
  world.cash = 0;
  missions.index = 0;
  missions.storyDone = false;
  missions.active = null;
  wanted.clear();
  player.health = player.maxHealth;
  player.dead = false;
  player.pos.set(128, 0, 100);
  player.heading = Math.PI / 2;
  hud.setCash(0);
  hud.setObjective(missions.objectiveText(world), '');
  showScreen(null);
  screens.hud.classList.remove('hidden');
  state = 'playing';
  world.saveGame();
}

document.getElementById('btn-start').addEventListener('click', () => beginPlay(true));
continueBtn.addEventListener('click', () => beginPlay(false));
document.getElementById('btn-resume').addEventListener('click', () => setPause(false));
document.getElementById('btn-restart').addEventListener('click', () => restartStory());
document.getElementById('btn-respawn').addEventListener('click', () => respawn());
document.getElementById('btn-freeroam').addEventListener('click', () => {
  showScreen(null);
  state = 'playing';
});

function setPause(on) {
  if (on && state === 'playing') {
    state = 'paused';
    showScreen('pause');
    document.exitPointerLock?.();
    sound.setEngine(false);
    sound.setSiren(false);
  } else if (!on && state === 'paused') {
    showScreen(null);
    state = 'playing';
  }
}

// ---------------------------------------------------------------- input
const keys = new Set();
let freeLookTimer = 0;
window.addEventListener('keydown', (e) => {
  sound.ensure();
  if (e.repeat) return;
  keys.add(e.code);
  if (state === 'playing') {
    if (e.code === 'KeyE') tryEnterExit();
    if (e.code === 'KeyF') player.punch(world);
    if (e.code === 'KeyP') setPause(true);
    if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  } else if (state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) {
    setPause(false);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('pointerdown', () => sound.ensure(), { once: true });

renderer.domElement.addEventListener('click', () => {
  if (state === 'playing' && !SHOT) renderer.domElement.requestPointerLock();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement && state === 'playing') {
    world.cameraYaw -= e.movementX * 0.0031;
    cameraPitch = Math.max(0.05, Math.min(1.05, cameraPitch + e.movementY * 0.0026));
    freeLookTimer = 2.5;
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state === 'playing' && document.pointerLockElement === renderer.domElement && e.button === 0) {
    player.punch(world);
  }
});

function tryEnterExit() {
  if (player.state === 'foot') {
    const car = player.nearbyCar(world);
    if (car) {
      const wasParked = car.driver === 'parked';
      player.enterCar(car, world);
      if (wasParked) world.onCrime('theft', car.pos);
    }
  } else if (player.state === 'driving' && Math.abs(player.car.speed) < 3) {
    player.exitCar(world);
  }
}

const inputState = { moveX: 0, moveZ: 0, sprint: false };
function readInputs(dt) {
  inputState.moveX = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  inputState.moveZ = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  inputState.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (player.state === 'driving' && player.car) {
    const car = player.car;
    if (shotAutopilot && car.brain) {
      car.brain.update(dt, world);
    } else {
      const fwd = keys.has('KeyW') || keys.has('ArrowUp');
      const back = keys.has('KeyS') || keys.has('ArrowDown');
      car.input.throttle = fwd ? 1 : back ? -1 : 0;
      car.input.steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? -1 : 0);
      car.input.brake = keys.has('Space');
      if (back && car.speed > 1.5) car.input.brake = true;
    }
    sound.setEngine(true, car.speed / car.maxSpeed);
  }
}

// ---------------------------------------------------------------- collisions
function carCarCollisions() {
  const cars = world.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 11.5 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const overlap = 3.4 - d;
      const nx = dx / d;
      const nz = dz / d;
      a.pos.x -= nx * overlap * 0.5;
      a.pos.z -= nz * overlap * 0.5;
      b.pos.x += nx * overlap * 0.5;
      b.pos.z += nz * overlap * 0.5;
      const va = { x: Math.sin(a.heading) * a.speed, z: Math.cos(a.heading) * a.speed };
      const vb = { x: Math.sin(b.heading) * b.speed, z: Math.cos(b.heading) * b.speed };
      const rel = Math.hypot(va.x - vb.x, va.z - vb.z);
      if (rel > 5) {
        a.damage(rel * 0.45, world);
        b.damage(rel * 0.45, world);
        const playerInvolved = player.state === 'driving' && (player.car === a || player.car === b);
        if (playerInvolved) {
          sound.crash(Math.min(1, rel / 20));
          const other = player.car === a ? b : a;
          if (other.kind === 'police') world.onCrime('policeHit', other.pos);
          else if (rel > 10) world.onCrime('crash', other.pos);
        }
        a.speed *= 0.55;
        b.speed *= 0.55;
      }
    }
  }
}

function carPeopleCollisions(dt) {
  playerHitCooldown = Math.max(0, playerHitCooldown - dt);
  for (const car of world.cars) {
    const speed = Math.abs(car.speed);
    if (speed < 2.5) continue;
    for (const ped of world.peds) {
      if (ped.state === 'fallen') continue;
      const d = Math.hypot(ped.pos.x - car.pos.x, ped.pos.z - car.pos.z);
      if (d < 1.6) {
        ped.hit(Math.min(99, speed * 1.2), world);
        if (player.state === 'driving' && player.car === car) world.onCrime('pedHit', ped.pos);
        car.speed *= 0.82;
      }
    }
    if (player.state === 'foot' && !player.dead && playerHitCooldown === 0 && car.driver !== 'player') {
      const d = Math.hypot(player.pos.x - car.pos.x, player.pos.z - car.pos.z);
      if (d < 1.9 && speed > 4) {
        playerHitCooldown = 1.1;
        player.damage(speed * 1.5, world);
        const push = { x: (player.pos.x - car.pos.x) / (d || 1), z: (player.pos.z - car.pos.z) / (d || 1) };
        player.pos.x += push.x * 3;
        player.pos.z += push.z * 3;
        sound.crash(0.5);
      }
    }
  }
}

// ---------------------------------------------------------------- camera
let cameraPitch = 0.34;
const camPos = new THREE.Vector3(-60, 40, 190);
const camTarget = new THREE.Vector3();

function updateCamera(dt) {
  if (state === 'menu') {
    const t = world.time * 0.045;
    const cx = Math.sin(t) * 165;
    const cz = 60 + Math.cos(t) * 120;
    camPos.lerp(new THREE.Vector3(cx, 52, cz), 1 - Math.exp(-dt * 2));
    camera.position.copy(camPos);
    camera.lookAt(0, 6, 30);
    return;
  }
  const focus = player.focusPos();
  const driving = player.state === 'driving';
  // Let the camera settle behind the direction of travel.
  freeLookTimer = Math.max(0, freeLookTimer - dt);
  if (freeLookTimer === 0) {
    const targetHeading = driving && player.car ? player.car.heading : player.heading;
    const targetYaw = targetHeading + Math.PI;
    let delta = ((targetYaw - world.cameraYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const rate = driving ? (Math.abs(player.car.speed) > 2 ? 2.4 : 0.7) : 1.5;
    world.cameraYaw += delta * Math.min(1, rate * dt);
  }
  const dist = driving ? 10.8 : 7.6;
  const yaw = world.cameraYaw;
  camTarget.set(focus.x, focus.y + 1.8, focus.z);
  const desired = new THREE.Vector3(
    focus.x + Math.sin(yaw) * Math.cos(cameraPitch) * dist,
    focus.y + 1.6 + Math.sin(cameraPitch) * dist,
    focus.z + Math.cos(yaw) * Math.cos(cameraPitch) * dist,
  );
  const k = 1 - Math.exp(-dt * (driving ? 6.5 : 9));
  camPos.lerp(desired, k);
  const minY = groundHeightAt(camPos.x, camPos.z, cityData.lots) + 0.7;
  if (camPos.y < minY) camPos.y = minY;
  camera.position.copy(camPos);
  const lead = driving && player.car
    ? { x: Math.sin(player.car.heading) * 4.5, z: Math.cos(player.car.heading) * 4.5 }
    : { x: 0, z: 0 };
  camera.lookAt(camTarget.x + lead.x, camTarget.y, camTarget.z + lead.z);
}

// ---------------------------------------------------------------- per-frame
function ambientTick(dt) {
  for (const car of world.cars) {
    if (car.driver === 'traffic' && car.brain) car.brain.update(dt, world);
  }
  for (const car of world.cars) {
    car.update(dt, world);
    car.pos.y = world.city.heightAt(car.pos.x, car.pos.z);
  }
  for (const ped of world.peds) ped.update(dt, world);
  cityData.update(dt, world.time);
}

function playingTick(dt) {
  readInputs(dt);
  player.update(dt, inputState, world);
  for (const car of world.cars) {
    if (car.driver === 'traffic' && car.brain) car.brain.update(dt, world);
  }
  wanted.update(dt, world);
  for (const car of world.cars) {
    car.update(dt, world);
    car.pos.y = world.city.heightAt(car.pos.x, car.pos.z);
  }
  for (const ped of world.peds) ped.update(dt, world);
  carCarCollisions();
  carPeopleCollisions(dt);
  cityData.update(dt, world.time);

  // Contextual prompt first; the mission update below may override it
  // with step-specific wording ("Leo needs a car", "Press E to take the van").
  if (player.state === 'foot') {
    const car = player.nearbyCar(world, 3.4);
    if (car && !missions.active) hud.setPrompt(car.driver === 'traffic' ? 'E — Steal the car' : 'E — Enter car');
    else if (!missions.active) hud.setPrompt(null);
    else if (player.nearbyCar(world, 3.4)) hud.setPrompt('E — Enter car');
  } else if (Math.abs(player.car.speed) < 3) {
    hud.setPrompt('E — Exit car');
  } else {
    hud.setPrompt(null);
  }
  missions.update(dt, world);

  // HUD state.
  hud.setStars(wanted.stars);
  hud.setHealth(player.health / player.maxHealth);
  hud.setCarHealth(player.state === 'driving' ? player.car.health / 100 : null);
  hud.setSpeed(player.state === 'driving' ? Math.abs(player.car.speed) * 3.6 : null);
  hud.setBust(wanted.bustMeter / 2.4);
  hud.drawMinimap(world);
  hud.update(dt);
  sound.update(dt);

  // The sun (and its shadows) follow Rook around the city.
  const focus = player.focusPos();
  sunLight.position.set(focus.x + SUN_DIR.x * 300, SUN_DIR.y * 300, focus.z + SUN_DIR.z * 300);
  sunLight.target.position.set(focus.x, 0, focus.z);

  saveTimer += dt;
  if (saveTimer > 6) {
    saveTimer = 0;
    world.saveGame();
  }
}

// ---------------------------------------------------------------- shot modes
function placePlayerInCar(x, z, heading, { autopilot = false, speed = 0 } = {}) {
  const car = new Car(scene, { kind: 'car', color: 0xd94f3d, x, z, heading, driver: 'parked' });
  world.cars.push(car);
  player.pos.set(x, 0, z);
  player.enterCar(car, world);
  car.speed = speed;
  if (autopilot) {
    car.brain = new TrafficDriver(car, rng);
    shotAutopilot = true;
  }
  world.cameraYaw = heading + Math.PI;
  camPos.set(x - Math.sin(heading) * 11, 4.5, z - Math.cos(heading) * 11);
  return car;
}

function setupShotMode() {
  if (SHOT === 'start') {
    state = 'menu';
    showScreen('start');
    return;
  }
  screens.hud.classList.remove('hidden');
  showScreen(null);
  state = 'playing';
  if (SHOT === 'play') {
    world.cash = 350;
    hud.setCash(world.cash);
    placePlayerInCar(128.9, 66, 0, { autopilot: true, speed: 9 });
    spawnTrafficCar(135.1, 104, Math.PI); // an oncoming car for street life
    missions.start(0, world);
  } else if (SHOT === 'chase') {
    world.cash = 640;
    hud.setCash(world.cash);
    placePlayerInCar(128.9, 52, 0, { autopilot: true, speed: 17 });
    missions.start(0, world);
    wanted.setStars(3);
    // Bring the law into frame: close behind and beside the player, where
    // the chase camera (about 11 units back, slightly raised) can see them.
    cameraPitch = 0.52;
    const spots = [
      [124.2, 44, 16],
      [133.8, 42, 16],
      [128.9, 31, 18],
    ];
    for (const [x, z, s] of spots) {
      const cop = wanted.spawnPolice(world);
      cop.pos.set(x, 0, z);
      cop.heading = 0;
      cop.speed = s;
    }
    hud.setStars(3);
  } else if (SHOT === 'end') {
    world.cash = 2850;
    missions.index = 4;
    missions.storyDone = true;
    hud.setCash(world.cash);
    const car = new Car(scene, { kind: 'car', color: 0xd94f3d, x: 130, z: -100, heading: Math.PI / 2, driver: 'parked' });
    car.input.brake = true;
    world.cars.push(car);
    player.pos.set(135, 0, -105);
    player.heading = Math.PI * 0.75;
    hud.setObjective('Free roam — Port Azura is yours', 'Story complete · $2,850 earned');
    showScreen('end');
    state = 'ended';
    camPos.set(154, 7, -82);
    camera.position.copy(camPos);
    camera.lookAt(133, 1.5, -103);
  }
}

// Warm the world up so traffic and crowds are mid-routine in screenshots.
if (SHOT) {
  for (let i = 0; i < 110; i++) ambientTick(1 / 30);
  setupShotMode();
} else {
  showScreen('start');
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  world.time += dt;
  if (state === 'playing') {
    playingTick(dt);
    updateCamera(dt);
  } else if (state === 'menu') {
    ambientTick(dt);
    updateCamera(dt);
  } else if (state === 'ended') {
    ambientTick(dt);
    hud.drawMinimap(world);
  } else if (state === 'wasted' || state === 'busted') {
    ambientTick(dt);
  }
  renderer.render(scene, camera);
}
animate();

window.__game = world;
