'use strict';
/* Port Azura: Sunset Heat — the Port Azura PD.
   A heat model (crimes add heat, witnesses scale it, it decays out of
   sight) drives a 0–5 star wanted level; up to five interceptor cars
   spawn on the grid, pursue with target leading, flash their light bars
   and box the player in until the bust meter fills. */

PA.Police = (function () {
  const cars = [];
  let heat = 0;
  let lastCrimeAt = -99;
  let bust = 0;
  let flashClock = 0;

  function stars() {
    if (heat <= 0.05) return 0;
    return Math.min(5, Math.ceil(heat / 2));
  }

  function init(scene) {
    for (let i = 0; i < 5; i++) {
      const mesh = PA.Vehicles.makeCarMesh('police', 0xf2f2f2);
      mesh.visible = false;
      scene.add(mesh);
      cars.push({
        mesh: mesh, heading: 0, speed: 0, steerVis: 0, health: 100,
        radius: 1.75, active: false, stuckFor: 0, pushX: 0, pushZ: 0,
      });
    }
  }

  /* Report a crime at (x, z). Witnesses — a pedestrian within earshot or an
     officer nearby — scale the heat up; an unseen crime barely registers. */
  function addHeat(points, x, z, now) {
    const witnessed = PA.People.witnessNear(x, z, 26) || anyNear(x, z, 42);
    heat = PA.clamp(heat + points * (witnessed ? 1.5 : 0.55), 0, 10);
    lastCrimeAt = now;
    return witnessed;
  }

  function setHeat(v) { heat = PA.clamp(v, 0, 10); lastCrimeAt = PA.G ? PA.G.time : 0; }
  function clearHeat() { heat = 0; bust = 0; }

  function anyNear(x, z, r) {
    for (let i = 0; i < cars.length; i++) {
      if (!cars[i].active) continue;
      if (PA.dist(x, z, cars[i].mesh.position.x, cars[i].mesh.position.z) < r) return true;
    }
    return false;
  }

  function spawnOne(player) {
    const free = cars.filter(function (c) { return !c.active; });
    if (!free.length) return;
    /* Pick an intersection 70–130 away: close enough to matter, never in view. */
    let best = null, bestScore = -1;
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
      const x = i * 52, z = j * 52;
      const d = PA.dist(x, z, player.x, player.z);
      if (d < 65 || d > 150) continue;
      const score = 100 - Math.abs(d - 95) + PA.rand() * 12;
      if (score > bestScore) { bestScore = score; best = { x: x, z: z }; }
    }
    if (!best) best = { x: player.x > 0 ? -208 : 208, z: player.z > 0 ? -156 : 156 };
    const car = free[0];
    car.mesh.position.set(best.x, 0, best.z);
    car.heading = PA.headingTo(best.x, best.z, player.x, player.z);
    car.mesh.rotation.y = car.heading;
    car.speed = 12;
    car.active = true;
    car.stuckFor = 0;
    car.mesh.visible = true;
  }

  function despawn(car) {
    car.active = false;
    car.mesh.visible = false;
    car.speed = 0;
  }

  /* player: {x, z, vx, vz, speed, inCar}. now: game clock seconds. */
  function update(dt, player, now) {
    flashClock += dt;
    /* Heat decays once the player has been out of sight for a while. */
    if (heat > 0 && now - lastCrimeAt > 4 && !anyNear(player.x, player.z, 42)) {
      heat = Math.max(0, heat - dt * 0.24);
    }
    const want = stars();
    let activeCount = 0;
    for (let i = 0; i < cars.length; i++) if (cars[i].active) activeCount++;
    if (activeCount < want) spawnOne(player);
    if (activeCount > want) {
      /* Release the farthest unit when the heat drops. */
      let far = null, farD = -1;
      cars.forEach(function (c) {
        if (!c.active) return;
        const d = PA.dist(player.x, player.z, c.mesh.position.x, c.mesh.position.z);
        if (d > farD) { farD = d; far = c; }
      });
      if (far && (farD > 55 || want === 0)) despawn(far);
    }

    let nearest = Infinity;
    let boxing = false;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car.active) continue;
      const p = car.mesh.position;
      const d = PA.dist(p.x, p.z, player.x, player.z);
      nearest = Math.min(nearest, d);

      /* Pursuit with target leading. */
      const lead = PA.clamp(d * 0.045, 0, 1.4);
      const tx = player.x + player.vx * lead, tz = player.z + player.vz * lead;
      let desired = PA.headingTo(p.x, p.z, tx, tz);
      /* Building probe: if the nose is about to meet a wall, veer off. */
      const probe = { x: p.x + Math.sin(car.heading) * 7, z: p.z + Math.cos(car.heading) * 7 };
      for (let c = 0; c < PA.World.colliders.length; c++) {
        const col = PA.World.colliders[c];
        if (probe.x > col.minX - 1.5 && probe.x < col.maxX + 1.5 && probe.z > col.minZ - 1.5 && probe.z < col.maxZ + 1.5) {
          const cxm = (col.minX + col.maxX) / 2, czm = (col.minZ + col.maxZ) / 2;
          desired = PA.headingTo(cxm, czm, p.x, p.z);
          break;
        }
      }
      const diff = PA.wrapAngle(desired - car.heading);
      car.heading += PA.clamp(diff, -1.9 * dt, 1.9 * dt);
      car.steerVis = PA.clamp(diff, -0.5, 0.5);
      let wantSpeed = 27.5 * (1 - Math.min(0.55, Math.abs(diff) * 0.6));
      if (d < 5) wantSpeed = Math.min(wantSpeed, 6);
      if (car.speed < wantSpeed) car.speed = Math.min(wantSpeed, car.speed + 13 * dt);
      else car.speed = Math.max(wantSpeed, car.speed - 20 * dt);
      p.x += Math.sin(car.heading) * car.speed * dt;
      p.z += Math.cos(car.heading) * car.speed * dt;
      /* Separation from other units. */
      for (let j = 0; j < cars.length; j++) {
        if (j === i || !cars[j].active) continue;
        const o = cars[j].mesh.position;
        const dd = PA.dist(p.x, p.z, o.x, o.z);
        if (dd > 0.01 && dd < 4.4) {
          p.x += ((p.x - o.x) / dd) * (4.4 - dd) * 0.5;
          p.z += ((p.z - o.z) / dd) * (4.4 - dd) * 0.5;
        }
      }
      if (PA.World.collideBuildings(p, car.radius)) car.speed *= 0.55;
      PA.World.clampPlay(p, car.radius);
      car.mesh.rotation.y = car.heading;
      PA.Vehicles.spinWheels(car, dt);

      /* Stuck recovery: if a unit cannot move, re-stage it at a junction. */
      if (Math.abs(car.speed) < 1.2 && d > 14) {
        car.stuckFor += dt;
        if (car.stuckFor > 2.6) { despawn(car); spawnOne(player); }
      } else car.stuckFor = 0;

      /* Light bar flash, all units in sync. */
      const bar = car.mesh.userData.lightbar;
      if (bar) {
        const phase = Math.floor(flashClock * 5) % 2;
        bar.userData.red.visible = phase === 0;
        bar.userData.blue.visible = phase === 1;
      }
      /* Boxing the player in? */
      const reach = player.inCar ? 9.5 : 8;
      if (d < reach && (!player.inCar || Math.abs(player.speed) < 2.6)) boxing = true;
    }

    if (boxing) bust = Math.min(1, bust + dt / (player.inCar ? 3.0 : 2.4));
    else bust = Math.max(0, bust - dt * 0.7);

    PA.Audio.setSiren(nearest < 65 && want > 0);
    return { bust: bust, nearest: nearest, stars: want };
  }

  return {
    init: init,
    update: update,
    addHeat: addHeat,
    setHeat: setHeat,
    clearHeat: clearHeat,
    stars: stars,
    anyNear: anyNear,
    cars: cars,
    getHeat: function () { return heat; },
    getBust: function () { return bust; },
  };
})();
