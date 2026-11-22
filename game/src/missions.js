// missions.js — Marisol Vega's jobs: a four-mission story chain for Rook,
// the getaway driver, told through data-driven steps (go here, pick him
// up, beat the clock, shake the heat, hold the spot, run). This module owns
// the glowing marker beacon, the current step's completion checks, timers
// and failure, and pays the cash rewards through the world.

import { createPersonMesh } from './people.js';
import { markerGlyphTexture } from './textures.js';

/**
 * The story. Places are keys into city.places (filled in at start()).
 * Step types: goto | pickup | timed | checkpoints | stealvan | escape |
 * deliver | hold | finale. `setStars` fires when the step begins.
 */
export const MISSIONS = [
  {
    id: 'welcome',
    title: 'Welcome to Port Azura',
    reward: 300,
    intro: 'Marisol Vega runs the Marina Garage. Her brother Leo is stranded at the pier — fetch him to the Hotel Azul.',
    steps: [
      { type: 'goto', at: 'garageDoor', text: 'Meet Marisol at the Marina Garage', needCar: false },
      { type: 'pickup', at: 'pierEnd', text: 'Pick up Leo at the end of the pier — grab a car first', needCar: true, who: 'Leo' },
      { type: 'timed', at: 'hotelDoor', time: 150, text: 'Drive Leo to the Hotel Azul', needCar: true },
    ],
  },
  {
    id: 'circuit',
    title: 'Sunset Circuit',
    reward: 400,
    intro: 'The street racers run a checkpoint circuit at sunset. Beat it, and the Azura scene learns your name.',
    steps: [
      { type: 'goto', at: 'garageDoor', text: 'Check in with Marisol at the Marina Garage', needCar: false },
      {
        type: 'checkpoints',
        points: [
          { x: 44, z: 44 },
          { x: -44, z: 88 },
          { x: -132, z: 0 },
          { x: -44, z: -88 },
          { x: 88, z: -44 },
          { x: 132, z: 88 },
        ],
        time: 135,
        text: 'Run the Sunset Circuit checkpoints',
        needCar: true,
      },
    ],
  },
  {
    id: 'cargo',
    title: 'Hot Cargo',
    reward: 650,
    intro: 'A van at the docks is loaded with Corsair merchandise Marisol wants back. It will be hot the second you turn the key.',
    steps: [
      { type: 'stealvan', at: 'pierBase', text: 'Take the marked van at the docks', needCar: false },
      { type: 'escape', text: 'Lose the heat — break line of sight and keep moving', needCar: true },
      { type: 'deliver', at: 'garageForecourt', text: 'Deliver the van to the Marina Garage', needCar: true },
    ],
  },
  {
    id: 'score',
    title: 'The Marina Score',
    reward: 1500,
    intro: 'The marina office holds the Corsairs\u2019 race-night take. Grab the bags, and do not stop until the Casa Segura door.',
    steps: [
      { type: 'goto', at: 'marinaOffice', text: 'Go to the marina office by the pier', needCar: false },
      { type: 'hold', at: 'marinaOffice', time: 5, text: 'Grab the cash bags — stay in the circle', needCar: false },
      { type: 'finale', at: 'safehouseDoor', text: 'Get to Casa Segura — do not stop', needCar: false, setStars: 4 },
    ],
  },
];

export class MissionChain {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.index = 0; // next mission to run
    this.active = null; // { mission, stepIndex, timeLeft, holdTime, checkpointIndex }
    this.storyDone = false;
    this.failed = false;
    this.failCooldown = 0;
    this.passenger = null; // { ped, riding }
    this.markedVan = null;
    this.rematchCooldown = 0;
    this.buildMarker(scene);
  }

  /** The beacon: a translucent gold pillar, a ground ring and a "!" glyph. */
  buildMarker(scene) {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 22, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc93c,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beam.position.y = 11;
    group.add(beam);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.9, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    group.add(ring);
    const glyph = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: markerGlyphTexture(), transparent: true, depthWrite: false }),
    );
    glyph.scale.set(2.6, 2.6, 1);
    glyph.position.y = 4.6;
    group.add(glyph);
    group.visible = false;
    scene.add(group);
    this.marker = group;
    this.markerGlyph = glyph;
  }

  currentMission() {
    return this.active ? this.active.mission : null;
  }

  /** Begin mission `index` (0-based) from its first step. */
  start(index, world) {
    const mission = MISSIONS[index];
    if (!mission) return;
    this.active = {
      mission,
      stepIndex: 0,
      timeLeft: null,
      holdTime: 0,
      checkpointIndex: 0,
      isRematch: false,
    };
    this.failed = false;
    this.enterStep(world);
    world.hud.banner(mission.title, mission.intro, 5.5);
    world.hud.setObjective(this.objectiveText(world), this.subText(world));
  }

  /** Start the repeatable circuit rematch (after the story is done). */
  startRematch(world) {
    const base = MISSIONS[1];
    const mission = { ...base, title: 'Sunset Circuit — Rematch', reward: 200, intro: 'One more run at the circuit. $200 on the table.' };
    this.active = {
      mission,
      stepIndex: 1, // straight to the checkpoints
      timeLeft: base.steps[1].time,
      holdTime: 0,
      checkpointIndex: 0,
      isRematch: true,
    };
    this.failed = false;
    world.hud.banner(mission.title, mission.intro, 4.5);
    world.hud.setObjective(this.objectiveText(world), this.subText(world));
  }

  /** Resolve a step's target point from the city places. */
  stepPoint(step, world) {
    if (step.points) {
      const p = step.points[this.active.checkpointIndex];
      return { x: p.x, z: p.z };
    }
    if (step.type === 'stealvan' && this.markedVan) {
      return { x: this.markedVan.pos.x, z: this.markedVan.pos.z };
    }
    const place = world.city.places[step.at];
    return place ? { x: place.x, z: place.z } : { x: 0, z: 0 };
  }

  /** Set up per-step state: timers, star levels, the marked van. */
  enterStep(world) {
    const a = this.active;
    const step = a.mission.steps[a.stepIndex];
    a.timeLeft = step.time ?? null;
    a.holdTime = 0;
    if (step.setStars) world.wanted.setStars(step.setStars);
    if (a.mission.id === 'cargo' && a.stepIndex === 0 && !this.markedVan) {
      this.markedVan = world.spawnMissionVan();
    }
    if (step.type === 'pickup') this.spawnPassenger(world);
  }

  spawnPassenger(world) {
    const at = world.city.places.pierEnd;
    const mesh = createPersonMesh({ shirt: 0xf2c230, pants: 0x33455c, skin: 0xa06a3c, hair: 0x2a2018 });
    mesh.position.set(at.x + 2, world.city.heightAt(at.x + 2, at.z), at.z - 2);
    this.scene.add(mesh);
    this.passenger = { mesh, riding: false, delivered: false };
  }

  objectiveText(world) {
    if (!this.active) {
      if (this.storyDone) return 'Free roam — the circuit rematch waits at the Marina Garage';
      return 'Head to the Marina Garage for work';
    }
    const step = this.active.mission.steps[this.active.stepIndex];
    return step.text;
  }

  subText(world) {
    if (!this.active) return '';
    const a = this.active;
    const step = a.mission.steps[a.stepIndex];
    const parts = [`${a.mission.title} — $${a.mission.reward}`];
    if (step.type === 'checkpoints') {
      parts.push(`Checkpoint ${a.checkpointIndex + 1} of ${step.points.length}`);
    }
    if (a.timeLeft !== null) parts.push(`${Math.ceil(a.timeLeft)}s left`);
    if (step.type === 'hold') parts.push(`Hold… ${Math.floor(a.holdTime)} / ${step.time}s`);
    if (step.type === 'escape') parts.push('Heat fades faster out of sight');
    const point = this.stepPoint(step, world);
    const p = world.player.focusPos();
    const dist = Math.hypot(point.x - p.x, point.z - p.z);
    if (step.type !== 'escape') parts.push(`${Math.round(dist)}m`);
    return parts.join(' · ');
  }

  /** The point the HUD/minimap marker should show, or null. */
  markerPoint(world) {
    if (!this.active) {
      return this.storyDone ? null : { x: world.city.places.garageDoor.x, z: world.city.places.garageDoor.z };
    }
    const step = this.active.mission.steps[this.active.stepIndex];
    if (step.type === 'escape') return null;
    return this.stepPoint(step, world);
  }

  fail(world, why) {
    world.hud.banner('Mission failed', why, 4);
    if (world.sound) world.sound.blip(180, 0.3, 'sawtooth', 0.14);
    this.active = null;
    this.failed = true;
    this.failCooldown = 4;
    if (this.passenger && !this.passenger.delivered) {
      this.scene.remove(this.passenger.mesh);
      this.passenger = null;
    }
    world.hud.setObjective(this.objectiveText(world), '');
  }

  completeMission(world) {
    const mission = this.active.mission;
    const wasRematch = this.active.isRematch;
    world.addCash(mission.reward);
    if (world.sound) world.sound.cash();
    this.active = null;
    if (this.passenger) {
      this.passenger.delivered = true;
      this.passenger = null;
    }
    if (wasRematch) {
      world.hud.banner('Circuit beaten', `+$${mission.reward}. Marisol always has another run for you.`, 4.5);
    } else {
      this.index += 1;
      if (this.index >= MISSIONS.length) {
        this.storyDone = true;
        world.hud.banner('STORY COMPLETE', `The Marina Score is yours. Port Azura is Rook's town now — free roam, and the circuit rematch pays $200 at the garage.`, 7);
        if (world.onStoryComplete) world.onStoryComplete();
      } else {
        world.hud.banner('Mission complete', `+$${mission.reward}. ${MISSIONS[this.index].title} is waiting at the Marina Garage.`, 5);
      }
    }
    world.saveGame();
    world.hud.setObjective(this.objectiveText(world), '');
  }

  advanceStep(world) {
    const a = this.active;
    if (world.sound) world.sound.checkpoint();
    a.stepIndex += 1;
    if (a.stepIndex >= a.mission.steps.length) {
      this.completeMission(world);
      return;
    }
    this.enterStep(world);
    world.hud.setObjective(this.objectiveText(world), this.subText(world));
  }

  playerInCircle(world, point, r) {
    const p = world.player.focusPos();
    return Math.hypot(point.x - p.x, point.z - p.z) < r;
  }

  update(dt, world) {
    this.failCooldown = Math.max(0, this.failCooldown - dt);
    this.rematchCooldown = Math.max(0, this.rematchCooldown - dt);

    // Idle at the garage starts the next job (or the rematch).
    if (!this.active && this.failCooldown === 0) {
      const garage = world.city.places.garageDoor;
      if (this.playerInCircle(world, garage, 5.5)) {
        if (!this.storyDone && this.index < MISSIONS.length) this.start(this.index, world);
        else if (this.storyDone && this.rematchCooldown === 0) {
          this.startRematch(world);
          this.rematchCooldown = 20;
        }
      }
    }

    // The passenger waits, rides hidden, and steps out at the hotel.
    if (this.passenger) {
      const pas = this.passenger;
      if (!pas.riding && !pas.delivered) {
        pas.mesh.rotation.y += Math.sin(performance.now() * 0.002) * 0.01;
      }
    }

    if (!this.active) {
      this.updateMarker(world, dt);
      return;
    }
    const a = this.active;
    const step = a.mission.steps[a.stepIndex];

    // Timers.
    if (a.timeLeft !== null && step.type !== 'hold') {
      a.timeLeft -= dt;
      if (a.timeLeft <= 0) {
        this.fail(world, 'Out of time.');
        this.updateMarker(world, dt);
        return;
      }
    }

    const point = this.stepPoint(step, world);
    switch (step.type) {
      case 'goto':
        if (this.playerInCircle(world, point, 5.5)) this.advanceStep(world);
        break;
      case 'pickup': {
        if (this.playerInCircle(world, point, 6.5)) {
          if (world.player.state !== 'driving') {
            world.hud.setPrompt('Leo needs a car — press E near any car to take it');
            break;
          }
          if (this.passenger) {
            this.passenger.riding = true;
            this.passenger.mesh.visible = false;
          }
          this.advanceStep(world);
        }
        break;
      }
      case 'timed':
        if (this.playerInCircle(world, point, 6.5)) {
          if (this.passenger) {
            // Leo steps out at the hotel and walks off.
            const hotel = world.city.places.hotelDoor;
            this.passenger.mesh.visible = true;
            this.passenger.mesh.position.set(hotel.x + 2, 0, hotel.z + 2);
            this.passenger.riding = false;
          }
          this.advanceStep(world);
        }
        break;
      case 'checkpoints': {
        if (this.playerInCircle(world, point, 7.5)) {
          if (world.player.state !== 'driving') {
            world.hud.setPrompt('The circuit is run in a car');
            break;
          }
          a.checkpointIndex += 1;
          if (world.sound) world.sound.checkpoint();
          if (a.checkpointIndex >= step.points.length) this.advanceStep(world);
          else world.hud.setObjective(this.objectiveText(world), this.subText(world));
        }
        break;
      }
      case 'stealvan': {
        if (world.player.state === 'driving' && world.player.car === this.markedVan) {
          world.wanted.setStars(3);
          this.advanceStep(world);
        } else if (this.playerInCircle(world, point, 6)) {
          world.hud.setPrompt('Press E to take the van');
        }
        break;
      }
      case 'escape':
        if (world.wanted.stars === 0) this.advanceStep(world);
        break;
      case 'deliver':
        if (world.player.state === 'driving' && world.player.car === this.markedVan && this.playerInCircle(world, point, 8)) {
          // Park the van with Marisol: it stays hers now.
          this.markedVan = null;
          this.advanceStep(world);
        }
        break;
      case 'hold': {
        if (this.playerInCircle(world, point, 5.5)) {
          a.holdTime += dt;
          if (a.holdTime >= step.time) {
            world.wanted.setStars(4);
            this.advanceStep(world);
          }
        } else {
          a.holdTime = Math.max(0, a.holdTime - dt * 1.5);
        }
        break;
      }
      case 'finale':
        if (this.playerInCircle(world, point, 7)) this.advanceStep(world);
        break;
      default:
        break;
    }

    // Refresh the objective line (distance and timers tick).
    world.hud.setObjective(this.objectiveText(world), this.subText(world));
    this.updateMarker(world, dt);
  }

  /** Position and pulse the beacon at the current marker point. */
  updateMarker(world, dt) {
    const point = this.markerPoint(world);
    if (!point) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    const y = world.city.heightAt(point.x, point.z);
    this.marker.position.set(point.x, y, point.z);
    const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.08;
    this.markerGlyph.scale.set(2.6 * pulse, 2.6 * pulse, 1);
    this.markerGlyph.position.y = 4.6 + Math.sin(performance.now() * 0.003) * 0.35;
  }
}
