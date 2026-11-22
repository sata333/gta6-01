// police.js — the law in Port Azura: a heat-based wanted level shown as
// stars, a pool of police interceptors that spawn on the street grid near
// (but not on top of) the player, pursuit driving that tries to ram and
// block, flashing light bars, and the bust meter that fills when a cop is
// close and the player is slow or on foot. Heat decays while no officer
// can see the player.

import { ROAD_XS, ROAD_ZS } from './city.js';
import { Car, angleDelta, forwardOf } from './vehicles.js';

/** Heat needed for each star: index = stars. */
const STAR_THRESHOLDS = [0, 55, 130, 230, 350, 490];
export const MAX_HEAT = 620;

/** The pursuit brain: chase the player's position, predicted ahead. */
export class PoliceDriver {
  constructor(car) {
    this.car = car;
    this.reverseTime = 0;
  }

  update(dt, world) {
    const car = this.car;
    const target = world.player.focusPos();
    const speed = world.player.focusSpeed();
    const dist = Math.hypot(target.x - car.pos.x, target.z - car.pos.z);
    // Aim where the player is heading, not where they are.
    const lead = Math.min(1.1, dist / 30);
    const pf = world.player.state === 'driving' && world.player.car
      ? forwardOf(world.player.car.heading)
      : { x: Math.sin(world.player.heading), z: Math.cos(world.player.heading) };
    const aimX = target.x + pf.x * speed * lead;
    const aimZ = target.z + pf.z * speed * lead;
    const err = car.steerErrorTo(aimX, aimZ);

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      car.input.throttle = -1;
      car.input.steer = err > 0 ? -1 : 1;
      car.input.brake = false;
      return;
    }
    // Stuck nose-first against something while the player is behind: reverse out.
    if (Math.abs(car.speed) < 0.8 && Math.abs(err) > 1.6 && dist < 26) {
      this.reverseTime = 0.7;
      return;
    }
    car.input.brake = false;
    car.driveToward(aimX, aimZ, car.maxSpeed, dt);
    // Close and slow player: ease off so the bust can happen instead of a ram.
    if (dist < 7 && speed < 2) {
      car.input.throttle = car.speed > 1 ? -0.6 : 0;
      car.input.brake = car.speed <= 1;
    }
  }
}

export class WantedSystem {
  constructor() {
    this.heat = 0;
    this.stars = 0;
    this.police = []; // Car instances with driver 'police'
    this.bustMeter = 0;
    this.timeSinceCrime = 99;
    this.flashPhase = 0;
  }

  addHeat(amount) {
    this.heat = Math.min(MAX_HEAT, this.heat + amount);
    this.timeSinceCrime = 0;
    this.updateStars();
  }

  updateStars() {
    let stars = 0;
    for (let i = 0; i < STAR_THRESHOLDS.length; i++) {
      if (this.heat >= STAR_THRESHOLDS[i]) stars = i;
    }
    this.stars = stars;
  }

  /** Set the level directly (mission scripts do this). */
  setStars(stars) {
    this.heat = STAR_THRESHOLDS[Math.max(0, Math.min(5, stars))];
    this.timeSinceCrime = 0;
    this.updateStars();
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.bustMeter = 0;
  }

  desiredPolice() {
    return this.stars === 0 ? 0 : Math.min(5, this.stars + 1);
  }

  /** A spawn point on the grid, 60–85 units from the player, off-screen-ish. */
  spawnPoint(world) {
    const p = world.player.focusPos();
    let bx = ROAD_XS[0];
    let bz = ROAD_ZS[0];
    for (const x of ROAD_XS) if (Math.abs(x - p.x) < Math.abs(bx - p.x)) bx = x;
    for (const z of ROAD_ZS) if (Math.abs(z - p.z) < Math.abs(bz - p.z)) bz = z;
    const options = [];
    for (const x of ROAD_XS) {
      for (const z of ROAD_ZS) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > 55 && d < 95) options.push({ x, z });
      }
    }
    const spot = options.length ? options[Math.floor(Math.random() * options.length)] : { x: bx, z: bz };
    return spot;
  }

  spawnPolice(world) {
    const spot = this.spawnPoint(world);
    const car = new Car(world.scene, {
      kind: 'police',
      color: 0xf2f3f5,
      x: spot.x + 3,
      z: spot.z,
      heading: Math.atan2(world.player.focusPos().x - spot.x, world.player.focusPos().z - spot.z),
      driver: 'police',
    });
    car.brain = new PoliceDriver(car);
    world.cars.push(car);
    this.police.push(car);
    return car;
  }

  despawn(car, world) {
    world.scene.remove(car.mesh);
    world.cars = world.cars.filter((c) => c !== car);
    this.police = this.police.filter((c) => c !== car);
  }

  update(dt, world) {
    this.timeSinceCrime += dt;
    const playerPos = world.player.focusPos();

    // Officers who can see the player: within 46 units. Out of sight and
    // quiet for a while, the heat bleeds away.
    let nearestCop = Infinity;
    for (const cop of this.police) {
      if (cop.driver !== 'police') continue;
      const d = Math.hypot(cop.pos.x - playerPos.x, cop.pos.z - playerPos.z);
      if (d < nearestCop) nearestCop = d;
    }
    const seen = nearestCop < 46;
    if (!seen && this.timeSinceCrime > 5 && this.heat > 0) {
      this.heat = Math.max(0, this.heat - (this.stars >= 3 ? 3.2 : 5.5) * dt);
      this.updateStars();
    }

    // Keep the force at strength; retire distant units when it cools off.
    const want = this.desiredPolice();
    const active = this.police.filter((c) => c.driver === 'police' && !c.wrecked);
    if (active.length < want) {
      this.spawnPolice(world);
    }
    for (const cop of [...this.police]) {
      const d = Math.hypot(cop.pos.x - playerPos.x, cop.pos.z - playerPos.z);
      if ((this.stars === 0 && d > 60) || d > 190 || cop.driver === 'abandoned') {
        this.despawn(cop, world);
      }
    }

    // Drive the pursuit and flash the light bars.
    this.flashPhase += dt * 6;
    const redOn = Math.sin(this.flashPhase) > 0;
    for (const cop of this.police) {
      if (cop.driver === 'police' && cop.brain) cop.brain.update(dt, world);
      const bar = cop.mesh.userData.lightbar;
      if (bar) {
        bar.red.visible = redOn;
        bar.blue.visible = !redOn;
      }
    }
    if (world.sound) world.sound.setSiren(this.stars > 0 && nearestCop < 55);

    // The bust: a cop close by while the player is slow or on foot.
    const playerSpeed = world.player.focusSpeed();
    const vulnerable = world.player.state === 'foot' || playerSpeed < 2.2;
    if (this.stars > 0 && vulnerable && nearestCop < 6.5) {
      this.bustMeter += dt * (world.player.state === 'foot' ? 1 : 0.65);
      if (this.bustMeter >= 2.4) {
        this.bustMeter = 0;
        if (world.onPlayerBusted) world.onPlayerBusted();
      }
    } else {
      this.bustMeter = Math.max(0, this.bustMeter - dt * 1.4);
    }
  }
}
