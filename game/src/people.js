// people.js — the people of Port Azura: a blocky low-poly person factory
// (shared by the player character and every pedestrian, with swinging
// limbs for the walk cycle) and the Ped brain: stroll a block's sidewalk
// loop, chat in place now and then, flee from danger, and fall when hit.

const SHIRTS = [0xe2543e, 0x3e7de2, 0xf2c230, 0x53b06a, 0xe8e4da, 0xb04f9e, 0x3fb0a8, 0xe07b39, 0x5a6b7a, 0xd94f6a];
const PANTS = [0x2c3440, 0x4a3b2c, 0x5a5148, 0x33455c, 0x707880, 0x20242a];
const SKINS = [0xf2c79b, 0xd9a066, 0xa06a3c, 0x6e4525, 0xffdbac];

/**
 * Build a person. Limbs hang from shoulder/hip pivots so animateWalk() can
 * swing them. Faces +z. About 1.8 units tall.
 */
export function createPersonMesh({ shirt, pants, skin, hair = 0x2a2018 }) {
  const person = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.3), shirtMat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  person.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), skinMat);
  head.position.y = 1.66;
  head.castShadow = true;
  person.add(head);
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.12, 0.37), hairMat);
  hairCap.position.y = 1.86;
  person.add(hairCap);

  const makeLimb = (w, len, mat) => {
    const pivot = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    box.position.y = -len / 2;
    box.castShadow = true;
    pivot.add(box);
    return pivot;
  };
  const legL = makeLimb(0.2, 0.78, pantsMat);
  legL.position.set(-0.15, 0.78, 0);
  const legR = makeLimb(0.2, 0.78, pantsMat);
  legR.position.set(0.15, 0.78, 0);
  const armL = makeLimb(0.15, 0.66, shirtMat);
  armL.position.set(-0.36, 1.42, 0);
  const armR = makeLimb(0.15, 0.66, shirtMat);
  armR.position.set(0.36, 1.42, 0);
  person.add(legL, legR, armL, armR);
  person.userData.parts = { legL, legR, armL, armR, torso, head };
  return person;
}

/** Swing the limbs for a walk cycle; phase advances with distance walked. */
export function animateWalk(mesh, phase, amount = 1) {
  const p = mesh.userData.parts;
  if (!p) return;
  const swing = Math.sin(phase) * 0.62 * amount;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  p.armL.rotation.x = -swing * 0.8;
  p.armR.rotation.x = swing * 0.8;
}

/** Reset a person's limbs to a standing pose. */
export function standPose(mesh) {
  const p = mesh.userData.parts;
  if (!p) return;
  p.legL.rotation.x = 0;
  p.legR.rotation.x = 0;
  p.armL.rotation.x = 0;
  p.armR.rotation.x = 0;
}

/**
 * A pedestrian: walks its block's sidewalk loop, sometimes pauses, flees
 * from a threat point for a few seconds, and falls when hit — getting up
 * again (and walking off) a while later, unless the hit was fatal-speed.
 */
export class Ped {
  constructor(scene, rng, loop) {
    this.mesh = createPersonMesh({
      shirt: rng.pick(SHIRTS),
      pants: rng.pick(PANTS),
      skin: rng.pick(SKINS),
      hair: rng.pick([0x2a2018, 0x4a3018, 0x888078, 0x181818, 0xb08a4a]),
    });
    this.loop = loop;
    this.seg = rng.int(0, loop.length - 1);
    const start = loop[this.seg];
    this.mesh.position.set(start.x + rng.range(-1, 1), 0, start.z + rng.range(-1, 1));
    this.heading = rng.range(0, Math.PI * 2);
    this.speed = rng.range(1.1, 1.9);
    this.phase = rng.range(0, 6);
    this.state = 'walk'; // walk | pause | flee | fallen
    this.stateTime = 0;
    this.health = 2;
    this.rng = rng;
    this.fleeFrom = null;
    scene.add(this.mesh);
  }

  get pos() {
    return this.mesh.position;
  }

  /** Take a hit: punches wound, cars at speed are fatal to the stroll. */
  hit(power, world) {
    if (this.state === 'fallen') return;
    this.health -= power;
    if (this.health <= 0 || power >= 5) {
      this.state = 'fallen';
      this.stateTime = 0;
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.y = 0.25;
      if (world && world.onPedDown) world.onPedDown(this, power);
    } else {
      this.state = 'flee';
      this.stateTime = 0;
      this.fleeFrom = { x: this.pos.x, z: this.pos.z };
    }
  }

  /** Start running from a point (a crime, a fast car, a shout). */
  scare(fromX, fromZ) {
    if (this.state === 'fallen') return;
    this.state = 'flee';
    this.stateTime = 0;
    this.fleeFrom = { x: fromX, z: fromZ };
  }

  update(dt, world) {
    this.stateTime += dt;
    if (this.state === 'fallen') {
      if (this.stateTime > 7) {
        // Get up, dust off, and rejoin the sidewalk somewhere else.
        this.state = 'walk';
        this.health = 2;
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
        const loop = this.rng.pick(world.city.pedLoops);
        this.loop = loop;
        this.seg = 0;
        this.mesh.position.set(loop[0].x, 0, loop[0].z);
      }
      return;
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = this.speed;
    if (this.state === 'flee') {
      const from = this.fleeFrom ?? this.pos;
      moveX = this.pos.x - from.x;
      moveZ = this.pos.z - from.z;
      const len = Math.hypot(moveX, moveZ) || 1;
      moveX /= len;
      moveZ /= len;
      speed = 5.2;
      if (this.stateTime > 3.2) this.state = 'walk';
    } else if (this.state === 'pause') {
      if (this.stateTime > 2.4) this.state = 'walk';
      standPose(this.mesh);
      return;
    } else {
      const target = this.loop[(this.seg + 1) % this.loop.length];
      moveX = target.x - this.pos.x;
      moveZ = target.z - this.pos.z;
      const dist = Math.hypot(moveX, moveZ);
      if (dist < 0.7) {
        this.seg = (this.seg + 1) % this.loop.length;
        if (this.rng.chance(0.12)) {
          this.state = 'pause';
          this.stateTime = 0;
        }
        return;
      }
      moveX /= dist;
      moveZ /= dist;
    }

    const desired = Math.atan2(moveX, moveZ);
    let delta = desired - this.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.heading += Math.max(-3.4 * dt, Math.min(3.4 * dt, delta));
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    if (this.state !== 'flee') {
      // Sidewalk walkers stay out of the buildings.
      const before = { x: this.pos.x, z: this.pos.z };
      world.city.collide(this.pos, 0.42);
      if (Math.hypot(this.pos.x - before.x, this.pos.z - before.z) > 0.01) this.seg = (this.seg + 1) % this.loop.length;
    }
    this.pos.y = world.city.heightAt(this.pos.x, this.pos.z);
    this.mesh.rotation.y = this.heading;
    this.phase += dt * speed * 3.4;
    animateWalk(this.mesh, this.phase, this.state === 'flee' ? 1.25 : 1);
  }
}
