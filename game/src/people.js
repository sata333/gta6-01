'use strict';
/* Port Azura: Sunset Heat — pedestrians.
   Box people who stroll the sidewalk loop around their block, pause at
   corners, flee danger (a fast car, a thrown punch, a police chase) and
   get knocked down — briefly — when punched. */

PA.People = (function () {
  const peds = [];
  const SKIN = [0xf2c79b, 0xc98d5f, 0x8a5a34, 0x6e4525, 0xffdbb8];
  const SHIRT = [0xff6b4a, 0x3f9db5, 0xffd75e, 0x7ef0c9, 0xe87fa5, 0xf2e3c9, 0x7a5fd0, 0x53b06a];
  const PANTS = [0x2f3542, 0x4a5a75, 0x6e4f30, 0x8a8f98, 0x37474f];

  function makePersonMesh() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: PA.pick(SKIN) });
    const shirt = new THREE.MeshLambertMaterial({ color: PA.pick(SHIRT) });
    const pants = new THREE.MeshLambertMaterial({ color: PA.pick(PANTS) });
    function limb(mat, w, h, d, x, y, z) {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, -h / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    }
    const legL = limb(pants, 0.17, 0.78, 0.19, -0.13, 0.78, 0);
    const legR = limb(pants, 0.17, 0.78, 0.19, 0.13, 0.78, 0);
    const armL = limb(shirt, 0.13, 0.62, 0.15, -0.34, 1.34, 0);
    const armR = limb(shirt, 0.13, 0.62, 0.15, 0.34, 1.34, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.28), shirt);
    torso.position.y = 1.09; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.34, 0.3), skin);
    head.position.y = 1.58; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.33), new THREE.MeshLambertMaterial({ color: PA.pick([0x2b1c10, 0x4a2f18, 0x777777, 0xb5894a, 0x181818]) }));
    hair.position.y = 1.78; g.add(hair);
    g.userData = { legL: legL, legR: legR, armL: armL, armR: armR };
    return g;
  }

  function cornersFor(cx, cz) {
    const h = 23.6;
    return [
      { x: cx - h, z: cz - h }, { x: cx + h, z: cz - h },
      { x: cx + h, z: cz + h }, { x: cx - h, z: cz + h },
    ];
  }

  function init(scene) {
    for (let i = 0; i < 22; i++) {
      const ci = PA.randInt(0, 7), ri = PA.randInt(0, 5);
      const cx = -182 + ci * 52, cz = -130 + ri * 52;
      const corners = cornersFor(cx, cz);
      const startCorner = PA.randInt(0, 3);
      const mesh = makePersonMesh();
      const start = corners[startCorner];
      mesh.position.set(start.x + PA.randRange(-6, 6), 0.3, start.z + PA.randRange(-2, 2));
      scene.add(mesh);
      peds.push({
        mesh: mesh, corners: corners, corner: (startCorner + 1) % 4,
        heading: PA.rand() * Math.PI * 2, speed: 0, walkSpeed: PA.randRange(1.1, 1.7),
        state: 'walk', timer: PA.randRange(0, 2), phase: PA.rand() * 6,
        homeCx: cx, homeCz: cz, radius: 0.55,
      });
    }
  }

  function animate(ped, dt) {
    const u = ped.mesh.userData;
    const moving = ped.speed > 0.15;
    ped.phase += dt * (moving ? ped.speed * 3.4 : 0);
    const swing = moving ? Math.sin(ped.phase) * 0.55 : 0;
    u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.7; u.armR.rotation.x = swing * 0.7;
    ped.mesh.rotation.y = ped.heading;
  }

  /* dangers: array of {x, z, r}. */
  function update(dt, dangers) {
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      const p = ped.mesh.position;
      if (ped.state === 'down') {
        ped.timer -= dt;
        ped.mesh.rotation.x = PA.lerp(ped.mesh.rotation.x, -Math.PI / 2, 0.3);
        ped.mesh.position.y = PA.lerp(ped.mesh.position.y, 0.35, 0.3);
        if (ped.timer <= 0) { ped.state = 'flee'; ped.timer = 1.4; ped.fleeFrom = { x: p.x + 1, z: p.z }; }
        animate(ped, dt);
        continue;
      }
      ped.mesh.rotation.x = PA.lerp(ped.mesh.rotation.x, 0, 0.3);
      ped.mesh.position.y = PA.lerp(ped.mesh.position.y, 0.3, 0.3);

      /* Danger check: flee the nearest threat. */
      let threat = null, threatD = Infinity;
      for (let d = 0; d < dangers.length; d++) {
        const dd = PA.dist(p.x, p.z, dangers[d].x, dangers[d].z);
        if (dd < dangers[d].r && dd < threatD) { threat = dangers[d]; threatD = dd; }
      }
      if (threat && ped.state !== 'flee') { ped.state = 'flee'; ped.timer = PA.randRange(1.1, 1.9); ped.fleeFrom = threat; }
      if (ped.state === 'flee') {
        ped.timer -= dt;
        const away = PA.headingTo(ped.fleeFrom.x, ped.fleeFrom.z, p.x, p.z);
        ped.heading = PA.angleLerp(ped.heading, away, 0.18);
        ped.speed = 5.3;
        if (ped.timer <= 0) ped.state = 'return';
      } else if (ped.state === 'return') {
        const target = ped.corners[ped.corner];
        ped.heading = PA.angleLerp(ped.heading, PA.headingTo(p.x, p.z, target.x, target.z), 0.12);
        ped.speed = ped.walkSpeed * 1.4;
        if (PA.dist(p.x, p.z, target.x, target.z) < 2.5) ped.state = 'walk';
      } else if (ped.state === 'pause') {
        ped.timer -= dt;
        ped.speed = 0;
        if (ped.timer <= 0) ped.state = 'walk';
      } else {
        const target = ped.corners[ped.corner];
        ped.heading = PA.angleLerp(ped.heading, PA.headingTo(p.x, p.z, target.x, target.z), 0.14);
        ped.speed = ped.walkSpeed;
        if (PA.dist(p.x, p.z, target.x, target.z) < 1.6) {
          ped.corner = (ped.corner + 1) % 4;
          if (PA.rand() < 0.3) { ped.state = 'pause'; ped.timer = PA.randRange(0.8, 2.6); }
        }
      }
      p.x += Math.sin(ped.heading) * ped.speed * dt;
      p.z += Math.cos(ped.heading) * ped.speed * dt;
      PA.World.collideBuildings(p, ped.radius);
      PA.World.clampPlay(p, ped.radius);
      animate(ped, dt);
    }
  }

  function nearestPed(x, z, maxDist) {
    let best = null, bestD = maxDist;
    for (let i = 0; i < peds.length; i++) {
      if (peds[i].state === 'down') continue;
      const d = PA.dist(x, z, peds[i].mesh.position.x, peds[i].mesh.position.z);
      if (d < bestD) { bestD = d; best = peds[i]; }
    }
    return best;
  }

  function punchPed(ped) {
    ped.state = 'down';
    ped.timer = 2.8;
    ped.speed = 0;
  }

  /* Any standing ped within r of a point (a witness to a crime). */
  function witnessNear(x, z, r) {
    for (let i = 0; i < peds.length; i++) {
      if (peds[i].state === 'down') continue;
      if (PA.dist(x, z, peds[i].mesh.position.x, peds[i].mesh.position.z) < r) return true;
    }
    return false;
  }

  return { init: init, update: update, nearestPed: nearestPed, punchPed: punchPed, witnessNear: witnessNear, peds: peds };
})();
