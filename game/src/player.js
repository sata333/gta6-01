// player.js — Rook, the player character: third-person on-foot movement
// relative to the camera, sprinting, entering and stealing cars (the
// driver is thrown out and runs), a short-range punch, health and the
// knock-down that leads to Wasted.

import { animateWalk, createPersonMesh, standPose } from './people.js';
import { angleDelta } from './vehicles.js';

export class Player {
  constructor(scene, x, z) {
    this.mesh = createPersonMesh({
      shirt: 0x1f7a8c, // Rook's teal jacket
      pants: 0x2c3440,
      skin: 0xd9a066,
      hair: 0x181818,
    });
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.heading = Math.PI; // facing the city (south, toward the sea view)
    this.health = 100;
    this.maxHealth = 100;
    this.state = 'foot'; // foot | driving
    this.car = null;
    this.walkPhase = 0;
    this.punchCooldown = 0;
    this.regenDelay = 0;
    this.dead = false;
  }

  get pos() {
    return this.mesh.position;
  }

  /** The position the camera, police and missions care about. */
  focusPos() {
    return this.state === 'driving' && this.car ? this.car.pos : this.pos;
  }

  focusSpeed() {
    return this.state === 'driving' && this.car ? Math.abs(this.car.speed) : 0;
  }

  damage(amount, world) {
    if (this.dead) return;
    this.health -= amount;
    this.regenDelay = 5;
    if (world.hud) world.hud.flashDamage();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      if (world.onPlayerWasted) world.onPlayerWasted();
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** The nearest car the player could get into, or null. */
  nearbyCar(world, maxDist = 3.4) {
    let best = null;
    let bestDist = maxDist;
    for (const car of world.cars) {
      if (car.wrecked) continue;
      const d = Math.hypot(car.pos.x - this.pos.x, car.pos.z - this.pos.z);
      if (d < bestDist) {
        best = car;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Enter a car. A traffic car is a theft: its driver is ejected (and
   * becomes a fleeing pedestrian), and the crime is reported to the world.
   */
  enterCar(car, world) {
    if (car.driver === 'traffic' && car.brain) {
      world.spawnEjectedDriver(car);
      car.brain = null;
      world.onCrime('theft', car.pos);
    }
    if (car.driver === 'police') world.onCrime('theft', car.pos);
    car.driver = 'player';
    car.input.throttle = 0;
    car.input.steer = 0;
    this.car = car;
    this.state = 'driving';
    this.mesh.visible = false;
    if (world.sound) world.sound.setEngine(true, 0);
    if (world.onPlayerEnterCar) world.onPlayerEnterCar(car);
  }

  /** Step out of the car, beside its left door. */
  exitCar(world) {
    const car = this.car;
    if (!car) return;
    const side = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
    this.pos.set(car.pos.x + side.x * 2.1, 0, car.pos.z + side.z * 2.1);
    world.city.collide(this.pos, 0.45);
    this.pos.y = world.city.heightAt(this.pos.x, this.pos.z);
    this.heading = car.heading;
    car.driver = car.kind === 'police' ? 'abandoned' : 'parked';
    car.input.throttle = 0;
    car.input.steer = 0;
    car.input.brake = true;
    this.car = null;
    this.state = 'foot';
    this.mesh.visible = true;
    if (world.sound) world.sound.setEngine(false);
    if (world.onPlayerExitCar) world.onPlayerExitCar(car);
  }

  /** Throw a punch: hits the nearest pedestrian or car in front. */
  punch(world) {
    if (this.punchCooldown > 0 || this.state !== 'foot') return;
    this.punchCooldown = 0.38;
    const parts = this.mesh.userData.parts;
    if (parts) parts.armR.rotation.x = -1.9;
    if (world.sound) world.sound.punch();
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let bestPed = null;
    let bestScore = 0.9;
    for (const ped of world.peds) {
      if (ped.state === 'fallen') continue;
      const dx = ped.pos.x - this.pos.x;
      const dz = ped.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.4) continue;
      const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
      if (dot > bestScore) {
        bestScore = dot;
        bestPed = ped;
      }
    }
    if (bestPed) {
      bestPed.hit(1, world);
      world.onCrime('assault', this.pos);
      return;
    }
    for (const car of world.cars) {
      const d = Math.hypot(car.pos.x - this.pos.x, car.pos.z - this.pos.z);
      if (d < 2.9) {
        car.damage(4, world);
        if (world.sound) world.sound.noiseHit(0.08, 700, 0.2);
        if (car.driver === 'police' || car.kind === 'police') world.onCrime('assault', this.pos);
        return;
      }
    }
  }

  update(dt, input, world) {
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else if (this.health > 0 && this.health < this.maxHealth && world.wanted.stars === 0) {
      this.heal(2.2 * dt);
    }
    if (this.state === 'driving') {
      // Keep the (hidden) body at the car so respawns and exits line up.
      this.pos.copy(this.car.pos);
      return;
    }
    const camYaw = world.cameraYaw;
    const ix = input.moveX;
    const iz = input.moveZ;
    const moving = ix !== 0 || iz !== 0;
    if (moving) {
      // Input is camera-relative: forward on screen is camera forward.
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      const wx = ix * cos - iz * sin;
      const wz = -ix * sin - iz * cos;
      const desired = Math.atan2(wx, wz);
      const delta = angleDelta(this.heading, desired);
      this.heading += Math.max(-11 * dt, Math.min(11 * dt, delta));
      const speed = input.sprint ? 9.6 : 5.8;
      this.pos.x += Math.sin(this.heading) * speed * dt;
      this.pos.z += Math.cos(this.heading) * speed * dt;
      world.city.collide(this.pos, 0.45);
      this.walkPhase += dt * speed * 1.9;
      animateWalk(this.mesh, this.walkPhase, input.sprint ? 1.2 : 1);
    } else {
      standPose(this.mesh);
      if (this.punchCooldown > 0.22) {
        const parts = this.mesh.userData.parts;
        if (parts) parts.armR.rotation.x = -1.9;
      }
    }
    this.pos.y = world.city.heightAt(this.pos.x, this.pos.z);
    this.mesh.rotation.y = this.heading;
  }
}
