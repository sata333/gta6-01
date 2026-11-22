'use strict';
/* Port Azura: Sunset Heat — vehicles.
   One car factory (sedans, the hot van, police interceptors with light bars),
   the traffic system that cruises the street grid intersection to
   intersection, the parked cars, and the arcade driving physics used by
   whichever car the player is driving. */

PA.Vehicles = (function () {
  const traffic = [];
  const parked = [];
  const all = [];
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff4b3e });
  const PALETTE = [0xd84f3d, 0x3f9db5, 0xf2b13c, 0x7a5fd0, 0x53b06a, 0xe87fa5, 0xe8e2d4, 0x4a6fd4, 0x2f3542, 0xff7d3c];

  let sceneRef = null;

  function makeWheel() {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), tyreMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    g.add(tyre);
    return g;
  }

  /* Build a car. kind: 'car' | 'van' | 'police'. Forward is +z. */
  function makeCarMesh(kind, colorHex) {
    const car = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
    bodyMat.userData.baseColor = new THREE.Color(colorHex);
    const wheels = [];
    let lightbar = null;

    if (kind === 'van') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.62, 4.9), bodyMat);
      body.position.y = 1.12; body.castShadow = true; car.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.62, 0.7), bodyMat);
      nose.position.set(0, 0.62, 2.6); nose.castShadow = true; car.add(nose);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 0.08), glassMat);
      shield.position.set(0, 1.24, 2.32); shield.rotation.x = -0.28; car.add(shield);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.58, 4.25), bodyMat);
      body.position.y = 0.58; body.castShadow = true; car.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.52, 2.05), kind === 'police' ? bodyMat : glassMat);
      cabin.position.set(0, 1.1, -0.25); cabin.castShadow = true; car.add(cabin);
      if (kind === 'police') {
        const glassBand = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.3, 2.09), glassMat);
        glassBand.position.set(0, 1.14, -0.25); car.add(glassBand);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.2, 4.29), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
        stripe.position.y = 0.62; car.add(stripe);
        lightbar = new THREE.Group();
        const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.4), tyreMat);
        lightbar.add(barBase);
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2a20 }));
        red.position.set(-0.33, 0.1, 0); lightbar.add(red);
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0x2255ff }));
        blue.position.set(0.33, 0.1, 0); lightbar.add(blue);
        lightbar.position.set(0, 1.44, -0.25);
        lightbar.userData = { red: red, blue: blue };
        car.add(lightbar);
      }
    }
    /* Headlights / taillights. */
    [-0.6, 0.6].forEach(function (x) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), lightMat);
      hl.position.set(x, 0.66, kind === 'van' ? 2.96 : 2.14); car.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), tailMat);
      tl.position.set(x, 0.72, kind === 'van' ? -2.46 : -2.14); car.add(tl);
    });
    /* Wheels: front pair steers (group yaw), every wheel spins. */
    const wz = kind === 'van' ? 1.62 : 1.38;
    [[-0.85, wz, true], [0.85, wz, true], [-0.85, -wz, false], [0.85, -wz, false]].forEach(function (w) {
      const g = makeWheel();
      g.position.set(w[0], 0.34, w[1]);
      car.add(g);
      wheels.push({ group: g, front: w[2] });
    });
    car.userData = { wheels: wheels, lightbar: lightbar, bodyMat: bodyMat };
    return car;
  }

  function registerCar(kind, style, colorHex, x, z, heading) {
    const mesh = makeCarMesh(style, colorHex);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    sceneRef.add(mesh);
    const car = {
      kind: kind, style: style, mesh: mesh,
      heading: heading, speed: 0, health: 100,
      steerVis: 0, radius: 1.75, occupied: false, stolen: false,
      isVan: false, stun: 0, ai: null, pushX: 0, pushZ: 0,
    };
    mesh.userData.carRef = car;
    all.push(car);
    return car;
  }

  /* ---------------- traffic ---------------- */
  const NODES = [];
  for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) NODES.push({ i: i, j: j, x: i * 52, z: j * 52 });
  function nodeAt(i, j) { return NODES[(i + 4) * 7 + (j + 3)]; }
  function pickNextNode(node, cameFrom) {
    const opts = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      const ni = node.i + d[0], nj = node.j + d[1];
      if (ni < -4 || ni > 4 || nj < -3 || nj > 3) return;
      if (cameFrom && ni === cameFrom.i && nj === cameFrom.j && opts.length) return;
      opts.push(nodeAt(ni, nj));
    });
    if (!opts.length) return cameFrom || nodeAt(0, 0);
    /* Prefer going straight, sometimes turn. */
    if (cameFrom && PA.rand() < 0.62) {
      const di = node.i - cameFrom.i, dj = node.j - cameFrom.j;
      const straight = opts.filter(function (n) { return n.i - node.i === di && n.j - node.j === dj; });
      if (straight.length) return straight[0];
    }
    return PA.pick(opts);
  }
  function laneWaypoint(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const rx = -(dz / len), rz = (dx / len);   // right of travel
    return { x: to.x + rx * 3.1, z: to.z + rz * 3.1 };
  }

  function spawnTraffic(count) {
    for (let n = 0; n < count; n++) {
      const node = PA.pick(NODES);
      const next = pickNextNode(node, null);
      const wp = laneWaypoint(node, next);
      const startX = node.x + (wp.x - node.x) * PA.rand() + (PA.rand() - 0.5) * 2;
      const startZ = node.z + (wp.z - node.z) * PA.rand();
      const heading = PA.headingTo(startX, startZ, wp.x, wp.z);
      const car = registerCar('traffic', 'car', PA.pick(PALETTE), startX, startZ, heading);
      car.ai = { node: node, next: next, wp: wp, cruise: PA.randRange(8.5, 12) };
      traffic.push(car);
    }
  }

  function spawnParked(count) {
    /* In the parking-lot grid. */
    const lotSpots = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) lotSpots.push([-78 - 15 + c * 10, 78 - 14 + r * 13, 0]);
    /* Along street curbs. */
    const curbSpots = [];
    PA.World.roadXS.forEach(function (x) {
      [-130, -26, 78].forEach(function (z) {
        curbSpots.push([x + 4.7, z + PA.randRange(-6, 6), 0]);
        curbSpots.push([x - 4.7, z + PA.randRange(-6, 6), Math.PI]);
      });
    });
    PA.World.roadZS.forEach(function (z) {
      [-156, 52, 156].forEach(function (x) {
        curbSpots.push([x + PA.randRange(-6, 6), z + 4.7, Math.PI / 2]);
      });
    });
    const spots = lotSpots.concat(curbSpots);
    let placed = 0;
    for (let i = 0; i < spots.length && placed < count; i++) {
      const s = spots[(i * 7) % spots.length];
      if (all.some(function (c) { return PA.dist(c.mesh.position.x, c.mesh.position.z, s[0], s[1]) < 6; })) continue;
      registerCar('parked', 'car', PA.pick(PALETTE), s[0], s[1], s[2]);
      placed++;
    }
    parked.push.apply(parked, all.filter(function (c) { return c.kind === 'parked'; }));
  }

  function spawnVan() {
    const van = registerCar('parked', 'van', 0xd84f3d, -88, 66, Math.PI / 2);
    van.isVan = true;
    return van;
  }

  function init(scene) {
    sceneRef = scene;
    spawnTraffic(14);
    spawnParked(28);
    spawnVan();
  }

  /* ---------------- damage ---------------- */
  function damageCar(car, amount) {
    if (car.health <= 0) return;
    car.health = PA.clamp(car.health - amount, 0, 100);
    const base = car.mesh.userData.bodyMat.userData.baseColor;
    if (base) {
      const d = 1 - car.health / 100;
      car.mesh.userData.bodyMat.color.copy(base).lerp(new THREE.Color(0x1d1a18), d * 0.6);
    }
  }

  function spinWheels(car, dt) {
    const w = car.mesh.userData.wheels;
    for (let i = 0; i < w.length; i++) {
      w[i].group.children[0].rotation.x += (car.speed * dt) / 0.34;
      if (w[i].front) w[i].group.rotation.y = PA.lerp(w[i].group.rotation.y, car.steerVis, 0.35);
    }
  }

  function obstacleAhead(car, lookDist) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let limit = Infinity;
    function test(x, z, r) {
      const dx = x - car.mesh.position.x, dz = z - car.mesh.position.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > lookDist + r) return;
      const side = Math.abs(dx * fz - dz * fx);
      if (side < 1.7 + r * 0.5) limit = Math.min(limit, ahead);
    }
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o === car || o.occupied) continue;
      test(o.mesh.position.x, o.mesh.position.z, o.radius);
    }
    const blockers = (PA.G && PA.G.blockers) || [];
    for (let i = 0; i < blockers.length; i++) test(blockers[i].x, blockers[i].z, blockers[i].r || 1);
    return limit;
  }

  /* ---------------- traffic update ---------------- */
  function updateTraffic(dt) {
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      if (car.kind !== 'traffic' || car.occupied) continue;
      const p = car.mesh.position;
      if (car.stun > 0) {
        car.stun -= dt;
        car.speed = Math.max(0, car.speed - 18 * dt);
      } else {
        const ai = car.ai;
        const desired = PA.headingTo(p.x, p.z, ai.wp.x, ai.wp.z);
        const diff = PA.wrapAngle(desired - car.heading);
        const turn = PA.clamp(diff, -1.5 * dt, 1.5 * dt);
        car.heading += turn;
        car.steerVis = PA.clamp(diff, -0.5, 0.5);
        let want = ai.cruise * (1 - Math.min(0.75, Math.abs(diff) * 0.85));
        const obs = obstacleAhead(car, 8.5);
        if (obs < 8.5) want = Math.min(want, Math.max(0, (obs - 3.2) * 1.6));
        if (car.speed < want) car.speed = Math.min(want, car.speed + 6.5 * dt);
        else car.speed = Math.max(want, car.speed - 16 * dt);
        if (PA.dist(p.x, p.z, ai.wp.x, ai.wp.z) < 6) {
          const cameFrom = ai.node;
          ai.node = ai.next;
          ai.next = pickNextNode(ai.node, cameFrom);
          ai.wp = laneWaypoint(ai.node, ai.next);
        }
      }
      p.x += Math.sin(car.heading) * car.speed * dt;
      p.z += Math.cos(car.heading) * car.speed * dt;
      PA.World.collideBuildings(p, car.radius);
      PA.World.clampPlay(p, car.radius);
      car.mesh.rotation.y = car.heading;
      spinWheels(car, dt);
    }
  }

  /* ---------------- the driven car ---------------- */
  /* input: {throttle:-1..1, steer:-1..1, handbrake:bool}. Returns impact speed. */
  function updateDriven(car, input, dt) {
    const p = car.mesh.position;
    if (car.health <= 0) { car.speed = 0; return 0; }
    if (input.throttle > 0) {
      car.speed += 14 * input.throttle * dt * (1 - (car.speed / 34) * 0.6);
    } else if (input.throttle < 0) {
      if (car.speed > 0.6) car.speed -= 26 * dt;
      else car.speed = Math.max(-9.5, car.speed + 10 * input.throttle * dt);
    }
    car.speed -= car.speed * (input.handbrake ? 0.85 : 0.22) * dt;
    if (Math.abs(car.speed) < 0.04 && !input.throttle) car.speed = 0;
    car.speed = PA.clamp(car.speed, -9.5, 31);

    const steerAngle = input.steer * 0.55 / (1 + Math.abs(car.speed) * 0.05);
    car.steerVis = steerAngle;
    if (Math.abs(car.speed) > 0.15) {
      car.heading += (car.speed / 2.7) * Math.tan(steerAngle) * dt * (input.handbrake ? 1.5 : 1.0);
    }
    p.x += Math.sin(car.heading) * car.speed * dt + car.pushX * dt;
    p.z += Math.cos(car.heading) * car.speed * dt + car.pushZ * dt;
    car.pushX *= Math.max(0, 1 - 3.2 * dt);
    car.pushZ *= Math.max(0, 1 - 3.2 * dt);

    let impact = 0;
    const before = Math.abs(car.speed);
    if (PA.World.collideBuildings(p, car.radius) && before > 4.5) {
      impact = before;
      damageCar(car, (before - 4) * 2.1);
      car.speed = -car.speed * 0.22;
    }
    PA.World.clampPlay(p, car.radius);
    car.mesh.rotation.y = car.heading;
    spinWheels(car, dt);
    return impact;
  }

  /* Parked cars can be shunted by collisions. */
  function updateParked(dt) {
    for (let i = 0; i < all.length; i++) {
      const car = all[i];
      if (car.occupied || car.kind === 'traffic') continue;
      if (Math.abs(car.pushX) < 0.02 && Math.abs(car.pushZ) < 0.02) continue;
      car.mesh.position.x += car.pushX * dt;
      car.mesh.position.z += car.pushZ * dt;
      car.pushX *= Math.max(0, 1 - 3.2 * dt);
      car.pushZ *= Math.max(0, 1 - 3.2 * dt);
      PA.World.collideBuildings(car.mesh.position, car.radius);
    }
  }

  function nearestCar(x, z, maxDist) {
    let best = null, bestD = maxDist;
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (c.occupied) continue;
      const d = PA.dist(x, z, c.mesh.position.x, c.mesh.position.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  return {
    init: init,
    makeCarMesh: makeCarMesh,
    registerCar: registerCar,
    updateTraffic: updateTraffic,
    updateDriven: updateDriven,
    updateParked: updateParked,
    damageCar: damageCar,
    spinWheels: spinWheels,
    nearestCar: nearestCar,
    traffic: traffic,
    parked: parked,
    all: all,
  };
})();
