// vehicles.js — Port Azura's cars: a low-poly car factory (sedans, taxis,
// a cargo van and police interceptors, all built from boxes with emissive
// lights), an arcade Car with throttle/steer input, and the TrafficDriver
// brain that cruises the street grid from intersection to intersection,
// keeping to its lane and slowing for the car ahead.

import { ROAD_XS, ROAD_ZS, collideCircle } from './city.js';

export const CAR_COLORS = [
  0xd94f3d, 0x3d7bd9, 0xe8b93c, 0x53b06a, 0xe8e4da, 0x8a8f98, 0x30343c,
  0xb04f9e, 0x3fb0a8, 0xe07b39, 0x7a4fd0, 0xc0c6cc,
];

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The forward vector for a heading (heading 0 faces +z). */
export function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Build a car's mesh. Kinds: 'car', 'taxi', 'van', 'police'. The car faces
 * +z. userData carries the spinning wheels, the steering front axle and,
 * for police, the light-bar halves the WantedSystem flashes.
 */
export function createCarMesh(color, kind = 'car') {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.35,
  });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1c2836 });
  const trim = new THREE.MeshLambertMaterial({ color: 0x22252a });

  const isVan = kind === 'van';
  const bodyH = isVan ? 1.15 : 0.62;
  const bodyY = isVan ? 0.95 : 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, bodyH, 4.3), paint);
  body.position.y = bodyY;
  body.castShadow = true;
  car.add(body);

  if (isVan) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.62, 0.9), glass);
    cab.position.set(0, 0.78, 1.85);
    car.add(cab);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.55, 2.1), glass);
    cabin.position.set(0, 1.16, -0.25);
    cabin.castShadow = true;
    car.add(cabin);
  }

  if (kind === 'police') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.3, 4.34), trim);
    stripe.position.y = 0.66;
    car.add(stripe);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.5), trim);
    barBase.position.set(0, 1.5, -0.25);
    car.add(barBase);
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a20 });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x2255ff });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.44), redMat);
    red.position.set(-0.31, 1.62, -0.25);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.44), blueMat);
    blue.position.set(0.31, 1.62, -0.25);
    car.add(red);
    car.add(blue);
    car.userData.lightbar = { red, blue };
  }
  if (kind === 'taxi') {
    const signBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.22, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
    );
    signBox.position.set(0, 1.56, -0.25);
    car.add(signBox);
  }

  // Headlights and taillights (emissive boxes; sunset makes them read).
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3524 });
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.06), headMat);
    head.position.set(sx, 0.72, 2.16);
    car.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), tailMat);
    tail.position.set(sx, 0.76, -2.16);
    car.add(tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const wheels = [];
  const steerPivots = [];
  for (const [sx, sz] of [[-0.88, 1.38], [0.88, 1.38], [-0.88, -1.38], [0.88, -1.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.36, sz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    car.add(pivot);
    wheels.push(wheel);
    if (sz > 0) steerPivots.push(pivot);
  }
  car.userData.wheels = wheels;
  car.userData.steerPivots = steerPivots;
  return car;
}

/**
 * An arcade car. Brains (player input, TrafficDriver, the police driver)
 * write `input = { throttle, steer, brake }` each frame; update() applies
 * the physics: acceleration, speed-sensitive steering, building collision.
 */
export class Car {
  constructor(scene, opts) {
    this.kind = opts.kind ?? 'car';
    this.mesh = createCarMesh(opts.color, this.kind);
    this.mesh.position.set(opts.x, 0, opts.z);
    this.heading = opts.heading ?? 0;
    this.speed = 0;
    this.health = 100;
    this.driver = opts.driver ?? 'traffic'; // traffic | police | player | parked | none
    this.input = { throttle: 0, steer: 0, brake: false };
    this.radius = 1.7;
    this.maxSpeed = this.kind === 'police' ? 35 : this.kind === 'van' ? 26 : 30;
    this.accel = this.kind === 'police' ? 26 : 21;
    this.wrecked = false;
    this.honkCooldown = 0;
    scene.add(this.mesh);
    this.syncMesh(0);
  }

  get pos() {
    return this.mesh.position;
  }

  /** Steer toward a world point; returns the heading error. */
  steerErrorTo(x, z) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const desired = Math.atan2(dx, dz);
    return angleDelta(this.heading, desired);
  }

  /** Fill input to drive toward a point at up to `speed`. */
  driveToward(x, z, speed, dt) {
    const err = this.steerErrorTo(x, z);
    this.input.steer = Math.max(-1, Math.min(1, err * 1.9));
    const dist = Math.hypot(x - this.pos.x, z - this.pos.z);
    const target = Math.abs(err) > 1.9 ? -4 : speed;
    if (this.speed < target) this.input.throttle = 1;
    else if (this.speed > target + 2) this.input.throttle = -0.4;
    else this.input.throttle = 0.15;
    if (dist < 3 && speed === 0) {
      this.input.throttle = 0;
      this.input.brake = true;
    }
  }

  update(dt, world) {
    const input = this.input;
    if (this.wrecked) {
      this.speed = 0;
    } else if (input.brake) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 42 * dt);
    } else if (input.throttle > 0) {
      this.speed += this.accel * input.throttle * dt * (this.speed < 0 ? 2.2 : 1);
    } else if (input.throttle < 0) {
      this.speed += this.accel * input.throttle * dt * (this.speed > 0.5 ? 2.4 : 1);
    }
    // Drag and rolling resistance.
    this.speed -= this.speed * 0.55 * dt;
    if (!input.brake && Math.abs(input.throttle) < 0.05 && Math.abs(this.speed) < 0.4) this.speed = 0;
    this.speed = Math.max(-11, Math.min(this.maxSpeed, this.speed));

    // Steering bites with speed; reversing flips it, as in a real car.
    const steerAuthority = Math.min(1, Math.abs(this.speed) / 7);
    this.heading += input.steer * 1.75 * steerAuthority * dt * (this.speed < 0 ? -1 : 1);

    const beforeX = this.pos.x;
    const beforeZ = this.pos.z;
    const f = forwardOf(this.heading);
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    collideCircle(this.pos, this.radius, world.city.colliders);
    // A collision that stops the car dead costs health and speed.
    const moved = Math.hypot(this.pos.x - beforeX, this.pos.z - beforeZ);
    const expected = Math.abs(this.speed * dt);
    if (expected > 0.02 && moved < expected * 0.35 && Math.abs(this.speed) > 7) {
      const impact = Math.abs(this.speed);
      this.damage(impact * 0.55, world, true);
      this.speed *= -0.18;
      if (world.onCarWallHit) world.onCarWallHit(this, impact);
    }
    this.syncMesh(dt);
  }

  damage(amount, world, loud = false) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.wrecked = true;
      if (world.onCarWrecked) world.onCarWrecked(this);
    } else if (loud && world.sound) {
      world.sound.crash(Math.min(1, amount / 22));
    }
  }

  syncMesh(dt) {
    this.mesh.rotation.y = this.heading;
    const spin = dt > 0 ? (this.speed * dt) / 0.36 : 0;
    for (const wheel of this.mesh.userData.wheels) wheel.rotation.x += spin;
    for (const pivot of this.mesh.userData.steerPivots) {
      pivot.rotation.y = this.input.steer * 0.42;
    }
  }
}

/**
 * The traffic brain: cruises the grid intersection to intersection in the
 * right-hand lane, choosing a new direction at each crossing, and slows
 * for whatever is ahead — another car or a pedestrian in the road.
 */
export class TrafficDriver {
  constructor(car, rng) {
    this.car = car;
    this.rng = rng;
    this.cruise = rng.range(9.5, 14.5);
    this.target = null;
    this.pickNext(true);
  }

  /** The intersection the car is currently nearest to. */
  nearestIntersection() {
    const p = this.car.pos;
    let bx = ROAD_XS[0];
    let bz = ROAD_ZS[0];
    for (const x of ROAD_XS) if (Math.abs(x - p.x) < Math.abs(bx - p.x)) bx = x;
    for (const z of ROAD_ZS) if (Math.abs(z - p.z) < Math.abs(bz - p.z)) bz = z;
    return { x: bx, z: bz };
  }

  /** Choose the next intersection to aim for, with the lane offset applied. */
  pickNext(first = false) {
    const car = this.car;
    const at = this.nearestIntersection();
    const f = forwardOf(car.heading);
    const alongX = Math.abs(f.x) > Math.abs(f.z);
    // Candidate next intersections: straight on (weighted), or a turn.
    const options = [];
    if (alongX) {
      const step = f.x > 0 ? 44 : -44;
      if (ROAD_XS.includes(at.x + step)) options.push([at.x + step, at.z], [at.x + step, at.z]);
      if (ROAD_ZS.includes(at.z + 44)) options.push([at.x, at.z + 44]);
      if (ROAD_ZS.includes(at.z - 44)) options.push([at.x, at.z - 44]);
      if (options.length === 0) options.push([at.x - step, at.z]);
    } else {
      const step = f.z > 0 ? 44 : -44;
      if (ROAD_ZS.includes(at.z + step)) options.push([at.x, at.z + step], [at.x, at.z + step]);
      if (ROAD_XS.includes(at.x + 44)) options.push([at.x + 44, at.z]);
      if (ROAD_XS.includes(at.x - 44)) options.push([at.x - 44, at.z]);
      if (options.length === 0) options.push([at.x, at.z - step]);
    }
    const [nx, nz] = first ? options[0] : this.rng.pick(options);
    // Aim at the far intersection, offset into the right-hand lane.
    const dirX = Math.sign(nx - at.x);
    const dirZ = Math.sign(nz - at.z);
    const heading = Math.atan2(dirX, dirZ);
    const rx = -Math.cos(heading);
    const rz = Math.sin(heading);
    this.target = { x: nx + rx * 3.1, z: nz + rz * 3.1, ix: nx, iz: nz };
    this.atIntersection = at;
  }

  update(dt, world) {
    const car = this.car;
    if (!this.target) this.pickNext(true);
    const dx = this.target.x - car.pos.x;
    const dz = this.target.z - car.pos.z;
    if (Math.hypot(dx, dz) < 5) this.pickNext();

    let speed = this.cruise;
    // Slow for anything ahead in our lane.
    const f = forwardOf(car.heading);
    for (const other of world.cars) {
      if (other === car || other.wrecked) continue;
      const ox = other.pos.x - car.pos.x;
      const oz = other.pos.z - car.pos.z;
      const ahead = ox * f.x + oz * f.z;
      const side = Math.abs(ox * f.z - oz * f.x);
      if (ahead > 0 && ahead < 9 && side < 2.4) {
        speed = Math.min(speed, Math.max(0, (ahead - 5.5) * 1.6));
      }
    }
    if (world.player && world.player.state === 'foot') {
      const px = world.player.pos.x - car.pos.x;
      const pz = world.player.pos.z - car.pos.z;
      const ahead = px * f.x + pz * f.z;
      const side = Math.abs(px * f.z - pz * f.x);
      if (ahead > 0 && ahead < 8 && side < 2.2) speed = 0;
    }
    car.driveToward(this.target.x, this.target.z, speed, dt);
    if (speed === 0) {
      car.input.throttle = car.speed > 0.5 ? -0.5 : 0;
      car.input.brake = car.speed <= 0.5;
    }
  }
}
