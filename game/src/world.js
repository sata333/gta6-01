'use strict';
/* Port Azura: Sunset Heat — the city.
   Builds the whole world into the scene: a 9x7 street grid, ~94 instanced
   buildings with procedural lit-window facades, sidewalks, a park, a parking
   lot, beach, marina pier and sea, plus the named landmarks (Marina Garage,
   Hotel Azul, Casa Segura, Port Azura PD, Azura Clinic). Exposes the road
   graph, building colliders and landmark points the other systems use. */

PA.World = (function () {
  const PITCH = 52;                 // distance between street centrelines
  const ROAD_HALF = 6;              // half the road width
  const ROAD_XS = [];               // vertical streets (run along z)
  const ROAD_ZS = [];               // horizontal streets (run along x)
  for (let i = -4; i <= 4; i++) ROAD_XS.push(i * PITCH);
  for (let j = -3; j <= 3; j++) ROAD_ZS.push(j * PITCH);
  const CITY = { minX: -238, maxX: 238, minZ: -186, maxZ: 200 };

  const colliders = [];             // {minX,maxX,minZ,maxZ} building AABBs
  const marks = {
    garage:    { x: -130, z: 153 },
    hotel:     { x: 130,  z: -3 },
    safehouse: { x: -130, z: -107 },
    pd:        { x: 26,   z: -3 },
    clinic:    { x: 26,   z: 49 },
    pier:      { x: -156, z: 262 },
    lot:       { x: -78,  z: 78 },
    park:      { x: 78,   z: 26 },
  };

  let sunLight = null, seaTex = null, clouds = [], sunSprite = null;

  function blockCenterX(ci) { return -182 + ci * PITCH; }
  function blockCenterZ(ri) { return -130 + ri * PITCH; }

  /* Merge simple geometries into one (for palm fronds), no external utils. */
  function mergeGeoms(geoms) {
    let total = 0;
    const parts = geoms.map(function (g) {
      const ng = g.index ? g.toNonIndexed() : g;
      total += ng.attributes.position.count;
      return ng;
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    let o = 0;
    parts.forEach(function (g) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }

  /* ---------------- procedural textures ---------------- */
  function facadeTexture(base, trim) {
    return PA.canvasTexture(128, 256, function (g, w, h) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, base); grad.addColorStop(1, trim);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, w, 10);
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 6; c++) {
          const x = 8 + c * 20, y = 18 + r * 19;
          if (PA.rand() < 0.44) { g.fillStyle = PA.pick(['#ffd98a', '#ffc46b', '#fff0b8']); }
          else { g.fillStyle = 'rgba(24,28,44,0.85)'; }
          g.fillRect(x, y, 12, 12);
        }
      }
    });
  }
  function signTexture(text, fg, bg) {
    return PA.canvasTexture(512, 96, function (g, w, h) {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = fg; g.font = '900 44px "Avenir Next", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = fg; g.shadowBlur = 16;
      g.fillText(text, w / 2, h / 2 + 2);
    });
  }
  function doorTexture(text) {
    return PA.canvasTexture(256, 160, function (g, w, h) {
      g.fillStyle = '#3a3f46'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#22262b'; g.lineWidth = 3;
      for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#ffd75e'; g.font = '900 30px Arial'; g.textAlign = 'center';
      g.fillText(text, w / 2, 30);
    });
  }

  /* ---------------- build ---------------- */
  function build(scene) {
    /* Sky: a screen-space sunset gradient, a low sun, drifting clouds. */
    const skyTex = PA.canvasTexture(16, 512, function (g, w, h) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#241543');
      grad.addColorStop(0.42, '#6d2a5e');
      grad.addColorStop(0.68, '#d84f3d');
      grad.addColorStop(0.86, '#ff9a4d');
      grad.addColorStop(1.0, '#ffc46b');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    });
    scene.background = skyTex;
    scene.fog = new THREE.Fog(0xdd7a4a, 130, 560);

    const sunTex = PA.canvasTexture(128, 128, function (g, w, h) {
      const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,240,200,1)');
      rg.addColorStop(0.25, 'rgba(255,196,107,0.9)');
      rg.addColorStop(1, 'rgba(255,150,60,0)');
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
    });
    sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunSprite.position.set(-330, 52, 430);
    sunSprite.scale.set(300, 300, 1);
    scene.add(sunSprite);

    const cloudTex = PA.canvasTexture(256, 128, function (g) {
      g.clearRect(0, 0, 256, 128);
      for (let i = 0; i < 16; i++) {
        const x = 30 + PA.rand() * 196, y = 44 + PA.rand() * 40, r = 18 + PA.rand() * 30;
        const rg = g.createRadialGradient(x, y, 2, x, y, r);
        rg.addColorStop(0, 'rgba(255,190,160,0.30)');
        rg.addColorStop(1, 'rgba(255,190,160,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false }));
      s.position.set(PA.randRange(-420, 420), PA.randRange(95, 150), PA.randRange(180, 460));
      s.scale.set(PA.randRange(180, 300), PA.randRange(50, 80), 1);
      scene.add(s); clouds.push(s);
    }

    /* Lights: warm low sun with shadows + violet sky bounce. */
    scene.add(new THREE.HemisphereLight(0x9a7bd8, 0x51331f, 0.85));
    sunLight = new THREE.DirectionalLight(0xffb36b, 1.65);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -95; sunLight.shadow.camera.right = 95;
    sunLight.shadow.camera.top = 95; sunLight.shadow.camera.bottom = -95;
    sunLight.shadow.camera.far = 420;
    sunLight.shadow.bias = -0.0006;
    scene.add(sunLight); scene.add(sunLight.target);
    const amb = new THREE.AmbientLight(0xff9a6b, 0.34);
    scene.add(amb);

    /* Base ground (outskirts, sand under the sea edge). */
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 640),
      new THREE.MeshLambertMaterial({ color: 0x77684f })
    );
    base.rotation.x = -Math.PI / 2; base.position.set(0, -0.05, 60);
    base.receiveShadow = true;
    scene.add(base);

    /* City slab. */
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(484, 380),
      new THREE.MeshLambertMaterial({ color: 0x5b5a50 })
    );
    slab.rotation.x = -Math.PI / 2; slab.position.set(0, 0.0, 0);
    slab.receiveShadow = true;
    scene.add(slab);

    buildRoads(scene);
    buildBlocks(scene);
    buildBeachAndPier(scene);
    buildVegetation(scene);
    buildStreetlights(scene);
  }

  function buildRoads(scene) {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x2e2c31 });
    ROAD_XS.forEach(function (x) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 380), roadMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, 0);
      m.receiveShadow = true; scene.add(m);
    });
    ROAD_ZS.forEach(function (z) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(484, ROAD_HALF * 2), roadMat);
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.04, z);
      m.receiveShadow = true; scene.add(m);
    });
    /* Centre dashes, instanced; skipped inside intersections. */
    const dashGeo = new THREE.BoxGeometry(0.28, 0.03, 2.4);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5d76e });
    const spots = [];
    ROAD_XS.forEach(function (x) {
      for (let z = -186; z <= 186; z += 6.5) {
        if (ROAD_ZS.some(function (rz) { return Math.abs(z - rz) < 9; })) continue;
        spots.push([x, z, 0]);
      }
    });
    ROAD_ZS.forEach(function (z) {
      for (let x = -238; x <= 238; x += 6.5) {
        if (ROAD_XS.some(function (rx) { return Math.abs(x - rx) < 9; })) continue;
        spots.push([x, z, 1]);
      }
    });
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, spots.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(function (s, i) {
      e.set(0, s[2] ? Math.PI / 2 : 0, 0); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(s[0], 0.07, s[1]), q, one);
      dashes.setMatrixAt(i, mtx);
    });
    scene.add(dashes);
  }

  function addCollider(cx, cz, w, d) {
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  function signPlane(text, fg, bg, w, h) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: signTexture(text, fg, bg), transparent: false })
    );
    return m;
  }

  /* One city block: slab plus buildings (instanced later) or a special use. */
  const buildingSpecs = [];   // {x,z,w,d,h,tex,tint}
  function queueBuilding(x, z, w, d, h) {
    buildingSpecs.push({
      x: x, z: z, w: w, d: d, h: h,
      tex: PA.randInt(0, 2),
      tint: new THREE.Color().setHSL(PA.randRange(0.02, 0.13), PA.randRange(0.25, 0.5), PA.randRange(0.62, 0.85)),
    });
    addCollider(x, z, w, d);
  }

  function buildBlocks(scene) {
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x8d8578 });
    const special = {
      '1,5': 'garage', '2,4': 'lot', '1,0': 'safehouse', '6,2': 'hotel',
      '4,2': 'pd', '4,3': 'clinic', '5,3': 'park',
    };
    for (let ri = 0; ri < 6; ri++) {
      for (let ci = 0; ci < 8; ci++) {
        const cx = blockCenterX(ci), cz = blockCenterZ(ri);
        const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(44, 0.3, 44), slabMat);
        slabMesh.position.set(cx, 0.15, cz);
        slabMesh.receiveShadow = true;
        scene.add(slabMesh);
        const kind = special[ci + ',' + ri];
        if (kind === 'park') buildPark(scene, cx, cz);
        else if (kind === 'lot') buildLot(scene, cx, cz);
        else if (kind === 'garage') buildGarage(scene, cx, cz);
        else if (kind === 'hotel') buildHotel(scene, cx, cz);
        else if (kind === 'pd') buildStation(scene, cx, cz, 'PORT AZURA PD', '#6db9ff', 0x2c3e57);
        else if (kind === 'clinic') buildStation(scene, cx, cz, 'AZURA CLINIC', '#ff7a6b', 0xd8d3c8);
        else if (kind === 'safehouse') buildSafehouse(scene, cx, cz);
        else buildOrdinaryBlock(cx, cz);
      }
    }
    flushBuildings(scene);
  }

  function buildOrdinaryBlock(cx, cz) {
    const pattern = PA.pick(['quad', 'triple', 'pair', 'pair', 'tower', 'triple']);
    if (pattern === 'quad') {
      [[-9.5, -9.5], [9.5, -9.5], [-9.5, 9.5], [9.5, 9.5]].forEach(function (o) {
        queueBuilding(cx + o[0], cz + o[1], 13, 13, PA.randRange(10, 26));
      });
    } else if (pattern === 'triple') {
      queueBuilding(cx - 9, cz - 8, 16, 17, PA.randRange(14, 30));
      queueBuilding(cx + 10, cz - 10, 12, 12, PA.randRange(9, 20));
      queueBuilding(cx + 6, cz + 10, 15, 13, PA.randRange(11, 24));
    } else if (pattern === 'pair') {
      queueBuilding(cx - 10, cz, 15, 30, PA.randRange(13, 30));
      queueBuilding(cx + 10, cz, 15, 30, PA.randRange(13, 30));
    } else {
      queueBuilding(cx, cz, 25, 25, PA.randRange(34, 56));
    }
  }

  function flushBuildings(scene) {
    const facades = [
      facadeTexture('#c96f4a', '#8a4630'),
      facadeTexture('#7fb0b5', '#4a6d78'),
      facadeTexture('#b59ac7', '#6e557f'),
    ];
    const byTex = [[], [], []];
    buildingSpecs.forEach(function (b) { byTex[b.tex].push(b); });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    byTex.forEach(function (list, ti) {
      if (!list.length) return;
      const mat = new THREE.MeshLambertMaterial({ map: facades[ti], emissive: 0xffca7a, emissiveMap: facades[ti], emissiveIntensity: 0.18 });
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const mtx = new THREE.Matrix4();
      list.forEach(function (b, i) {
        mtx.makeScale(b.w, b.h, b.d);
        mtx.setPosition(b.x, 0.3, b.z);
        im.setMatrixAt(i, mtx);
        im.setColorAt(i, b.tint);
      });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    });
    /* Dark roof caps hide the facade texture on top faces. */
    const capGeo = new THREE.BoxGeometry(1, 0.4, 1);
    const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: 0x39323e }), buildingSpecs.length);
    const mtx2 = new THREE.Matrix4();
    buildingSpecs.forEach(function (b, i) {
      mtx2.makeScale(b.w + 0.4, 1, b.d + 0.4);
      mtx2.setPosition(b.x, 0.3 + b.h + 0.2, b.z);
      caps.setMatrixAt(i, mtx2);
    });
    caps.castShadow = true;
    scene.add(caps);
  }

  function buildPark(scene, cx, cz) {
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(40, 0.36, 40), new THREE.MeshLambertMaterial({ color: 0x4d7c43 }));
    lawn.position.set(cx, 0.18, cz); lawn.receiveShadow = true; scene.add(lawn);
    const path1 = new THREE.Mesh(new THREE.PlaneGeometry(40, 4), new THREE.MeshLambertMaterial({ color: 0xc9b18a }));
    path1.rotation.x = -Math.PI / 2; path1.position.set(cx, 0.38, cz); scene.add(path1);
    const path2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 40), path1.material);
    path2.rotation.x = -Math.PI / 2; path2.position.set(cx, 0.38, cz); scene.add(path2);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.8, 20), new THREE.MeshLambertMaterial({ color: 0x9fb6bd }));
    basin.position.set(cx, 0.6, cz); basin.castShadow = true; scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.3, 20), new THREE.MeshLambertMaterial({ color: 0x3f9db5, emissive: 0x1a4a5a }));
    water.position.set(cx, 0.95, cz); scene.add(water);
  }

  function buildLot(scene, cx, cz) {
    const tex = PA.canvasTexture(256, 256, function (g, w, h) {
      g.fillStyle = '#33343a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e8e4da'; g.lineWidth = 3;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          g.strokeRect(14 + c * 48, 16 + r * 58, 38, 46);
        }
      }
    });
    const lot = new THREE.Mesh(new THREE.BoxGeometry(42, 0.36, 42), new THREE.MeshLambertMaterial({ map: tex }));
    lot.position.set(cx, 0.18, cz); lot.receiveShadow = true; scene.add(lot);
  }

  function buildGarage(scene, cx, cz) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 20), new THREE.MeshLambertMaterial({ color: 0xb56a41 }));
    body.position.set(cx, 4.8, cz - 6); body.castShadow = true; body.receiveShadow = true; scene.add(body);
    addCollider(cx, cz - 6, 30, 20);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(20, 7), new THREE.MeshLambertMaterial({ map: doorTexture('MARINA GARAGE') }));
    door.position.set(cx, 3.8, cz + 4.05); scene.add(door);
    const sign = signPlane('MARINA GARAGE', '#ffd75e', '#33231a', 24, 4.2);
    sign.position.set(cx, 10.6, cz + 4.1); scene.add(sign);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(34, 0.34, 14), new THREE.MeshLambertMaterial({ color: 0x6e6a60 }));
    fore.position.set(cx, 0.17, cz + 13); fore.receiveShadow = true; scene.add(fore);
  }

  function buildHotel(scene, cx, cz) {
    const tex = facadeTexture('#e8b07e', '#a06a42');
    const tower = new THREE.Mesh(new THREE.BoxGeometry(24, 46, 24), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffca7a, emissiveMap: tex, emissiveIntensity: 0.22 }));
    tower.position.set(cx, 23.3, cz - 4); tower.castShadow = true; tower.receiveShadow = true; scene.add(tower);
    addCollider(cx, cz - 4, 24, 24);
    const sign = signPlane('HOTEL AZUL', '#7ef0e0', '#14202e', 22, 4.6);
    sign.position.set(cx, 40, cz + 8.1); scene.add(sign);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x274b5c }));
    canopy.position.set(cx, 4.6, cz + 10); canopy.castShadow = true; scene.add(canopy);
  }

  function buildStation(scene, cx, cz, name, color, bodyColor) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 18), new THREE.MeshLambertMaterial({ color: bodyColor }));
    body.position.set(cx, 6.3, cz - 5); body.castShadow = true; body.receiveShadow = true; scene.add(body);
    addCollider(cx, cz - 5, 26, 18);
    const sign = signPlane(name, color, '#1c2733', 20, 3.6);
    sign.position.set(cx, 13.8, cz + 4.1); scene.add(sign);
    const steps = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x9a958a }));
    steps.position.set(cx, 0.25, cz + 7); scene.add(steps);
  }

  function buildSafehouse(scene, cx, cz) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 6.5, 13), new THREE.MeshLambertMaterial({ color: 0xe3cfa3 }));
    body.position.set(cx - 4, 3.55, cz - 6); body.castShadow = true; body.receiveShadow = true; scene.add(body);
    addCollider(cx - 4, cz - 6, 16, 13);
    const roofGeo = new THREE.CylinderGeometry(0.1, 8.6, 12.5, 4, 1);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xa03d2e }));
    roof.rotation.y = Math.PI / 4; roof.rotation.z = Math.PI / 2;
    roof.scale.set(1, 1, 0.62);
    roof.position.set(cx - 4, 8.6, cz - 6); roof.castShadow = true; scene.add(roof);
    const sign = signPlane('CASA SEGURA', '#a7f3c9', '#22331f', 11, 2.1);
    sign.position.set(cx - 4, 5.4, cz + 0.6); scene.add(sign);
    const drive = new THREE.Mesh(new THREE.BoxGeometry(10, 0.34, 20), new THREE.MeshLambertMaterial({ color: 0x77726a }));
    drive.position.set(cx + 9, 0.17, cz + 6); drive.receiveShadow = true; scene.add(drive);
  }

  function buildBeachAndPier(scene) {
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(560, 42), new THREE.MeshLambertMaterial({ color: 0xe8c188 }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, 203);
    sand.receiveShadow = true; scene.add(sand);

    seaTex = PA.canvasTexture(256, 256, function (g, w, h) {
      g.fillStyle = '#2a7d8c'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,214,160,0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 42; i++) {
        const y = PA.rand() * h;
        g.beginPath(); g.moveTo(PA.rand() * w, y); g.lineTo(PA.rand() * w, y + PA.randRange(-3, 3)); g.stroke();
      }
    });
    seaTex.wrapS = seaTex.wrapT = THREE.RepeatWrapping;
    seaTex.repeat.set(10, 6);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(760, 260), new THREE.MeshLambertMaterial({ map: seaTex, transparent: true, opacity: 0.94 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.06, 352);
    scene.add(sea);

    /* The marina pier: a deck running south from the beach at x = -156. */
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 104), deckMat);
    deck.position.set(-156, 0.28, 232); deck.castShadow = true; deck.receiveShadow = true; scene.add(deck);
    const end = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 16), deckMat);
    end.position.set(-156, 0.28, 272); end.receiveShadow = true; scene.add(end);
    const postGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.4, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5e4630 });
    const posts = new THREE.InstancedMesh(postGeo, postMat, 24);
    const mtx = new THREE.Matrix4();
    let pi = 0;
    for (let z = 188; z <= 280; z += 8.6) {
      [-160.2, -151.8].forEach(function (x) {
        if (pi >= 24) return;
        mtx.makeTranslation(x, -0.6, z);
        posts.setMatrixAt(pi++, mtx);
      });
    }
    posts.count = pi;
    scene.add(posts);
    /* Moored boats: simple hulls with a cabin, bobbing gently is overkill — static charm. */
    const hullCols = [0xd84f3d, 0x3f9db5, 0xf2e3c9, 0x7ef0c9];
    for (let i = 0; i < 6; i++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 6.4), new THREE.MeshLambertMaterial({ color: hullCols[i % 4] }));
      hull.position.y = 0.35; boat.add(hull);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 2.2), new THREE.MeshLambertMaterial({ color: 0xf5f2ea }));
      cab.position.set(0, 1.1, -0.4); boat.add(cab);
      boat.position.set(i % 2 ? -146 : -166, 0.1, 216 + i * 11);
      boat.rotation.y = PA.randRange(-0.14, 0.14);
      scene.add(boat);
    }
  }

  function buildVegetation(scene) {
    /* Palms: instanced trunks + instanced frond stars (merged planes). */
    const palmSpots = [];
    for (let x = -228; x <= 228; x += 19) palmSpots.push([x + PA.randRange(-3, 3), 188 + PA.randRange(-2, 3)]);
    for (let i = 0; i < 14; i++) palmSpots.push([blockCenterX(PA.randInt(0, 7)) + PA.randRange(-18, 18), blockCenterZ(PA.randInt(0, 5)) + PA.randRange(-18, 18)]);
    palmSpots.push([70, 14], [86, 38], [70, 38], [86, 14]);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5.6, 6);
    trunkGeo.translate(0, 2.8, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x8a6a4a }), palmSpots.length);
    const frondTex = PA.canvasTexture(128, 128, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#3f7d3a'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(8, 120);
      g.quadraticCurveTo(50, 60, 122, 42); g.stroke();
      g.lineWidth = 2.4; g.strokeStyle = '#4c9440';
      for (let i = 0; i < 9; i++) {
        const t = i / 9, x = 20 + t * 92, y = 108 - t * 58;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y + 15); g.stroke();
      }
    });
    const frondParts = [];
    for (let k = 0; k < 6; k++) {
      const p = new THREE.PlaneGeometry(4.6, 4.6);
      p.translate(1.9, 0, 0);
      p.rotateX(-0.5 - (k % 3) * 0.16);
      p.rotateY((k / 6) * Math.PI * 2);
      p.translate(0, 5.7, 0);
      frondParts.push(p);
    }
    const frondGeo = mergeGeoms(frondParts);
    const fronds = new THREE.InstancedMesh(frondGeo, new THREE.MeshLambertMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide }), palmSpots.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    palmSpots.forEach(function (s, i) {
      e.set(PA.randRange(-0.07, 0.07), PA.rand() * Math.PI * 2, PA.randRange(-0.07, 0.07));
      q.setFromEuler(e);
      const s1 = PA.randRange(0.85, 1.25);
      sc.set(s1, s1, s1); v.set(s[0], 0.1, s[1]);
      mtx.compose(v, q, sc);
      trunks.setMatrixAt(i, mtx); fronds.setMatrixAt(i, mtx);
    });
    trunks.castShadow = true; fronds.castShadow = true;
    scene.add(trunks); scene.add(fronds);

    /* Round park/street trees: instanced trunks + canopy blobs. */
    const treeSpots = [];
    for (let i = 0; i < 12; i++) treeSpots.push([78 + PA.randRange(-17, 17), 26 + PA.randRange(-17, 17)]);
    for (let i = 0; i < 16; i++) treeSpots.push([blockCenterX(PA.randInt(0, 7)) + PA.randRange(-19, 19), blockCenterZ(PA.randInt(0, 5)) + PA.randRange(-19, 19)]);
    const tGeo = new THREE.CylinderGeometry(0.2, 0.32, 2.6, 6); tGeo.translate(0, 1.3, 0);
    const tTrunks = new THREE.InstancedMesh(tGeo, new THREE.MeshLambertMaterial({ color: 0x6e4f30 }), treeSpots.length);
    const cGeo = new THREE.IcosahedronGeometry(2.3, 0); cGeo.translate(0, 4.1, 0);
    const canopies = new THREE.InstancedMesh(cGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), treeSpots.length);
    const greens = [new THREE.Color(0x4d7c43), new THREE.Color(0x5d8a3c), new THREE.Color(0x6b9a44), new THREE.Color(0x3f6d3a)];
    treeSpots.forEach(function (s, i) {
      e.set(0, PA.rand() * 3, 0); q.setFromEuler(e);
      const s1 = PA.randRange(0.8, 1.35);
      sc.set(s1, s1 * PA.randRange(0.9, 1.2), s1); v.set(s[0], 0.2, s[1]);
      mtx.compose(v, q, sc);
      tTrunks.setMatrixAt(i, mtx); canopies.setMatrixAt(i, mtx);
      canopies.setColorAt(i, PA.pick(greens));
    });
    tTrunks.castShadow = true; canopies.castShadow = true;
    scene.add(tTrunks); scene.add(canopies);
  }

  function buildStreetlights(scene) {
    const spots = [];
    ROAD_XS.forEach(function (x) {
      for (let z = -172; z <= 172; z += 26) spots.push([x + 7.2, z]);
    });
    ROAD_ZS.forEach(function (z) {
      for (let x = -224; x <= 224; x += 26) spots.push([x, z + 7.2]);
    });
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.6, 5); poleGeo.translate(0, 2.8, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3c4148 }), spots.length);
    const lampGeo = new THREE.SphereGeometry(0.27, 8, 6); lampGeo.translate(0, 5.65, 0);
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffd98a }), spots.length);
    const mtx = new THREE.Matrix4();
    spots.forEach(function (s, i) {
      mtx.makeTranslation(s[0], 0, s[1]);
      poles.setMatrixAt(i, mtx); lamps.setMatrixAt(i, mtx);
    });
    scene.add(poles); scene.add(lamps);
  }

  /* ---------------- runtime helpers ---------------- */
  function update(dt, elapsed) {
    if (seaTex) seaTex.offset.y = (elapsed * 0.008) % 1;
    for (let i = 0; i < clouds.length; i++) {
      clouds[i].position.x += dt * 1.1;
      if (clouds[i].position.x > 480) clouds[i].position.x = -480;
    }
    if (sunLight && PA.G && PA.G.focusPoint) {
      const f = PA.G.focusPoint;
      sunLight.position.set(f.x - 70, 95, f.z + 45);
      sunLight.target.position.set(f.x, 0, f.z);
    }
  }

  /* Keep a circle of radius r inside the playable world and out of the sea. */
  function clampPlay(p, r) {
    p.x = PA.clamp(p.x, CITY.minX + r, CITY.maxX - r);
    p.z = PA.clamp(p.z, CITY.minZ + r, 288);
    const onPier = p.x > -161.5 && p.x < -150.5;
    if (p.z > CITY.maxZ && !onPier) p.z = CITY.maxZ;
    if (onPier && p.z > 200 && (p.x < -161.5 + r || p.x > -150.5 - r)) { /* pier edge handled by z clamp */ }
    return p;
  }

  /* Push a circle out of every building AABB it overlaps. Returns impact speed loss hint. */
  function collideBuildings(p, r) {
    let hit = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const nx = PA.clamp(p.x, c.minX, c.maxX), nz = PA.clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          p.x = nx + (dx / d) * r; p.z = nz + (dz / d) * r;
        } else {
          /* Centre inside the box: push out along the smallest penetration. */
          const left = p.x - c.minX, right = c.maxX - p.x, top = p.z - c.minZ, bot = c.maxZ - p.z;
          const m = Math.min(left, right, top, bot);
          if (m === left) p.x = c.minX - r; else if (m === right) p.x = c.maxX + r;
          else if (m === top) p.z = c.minZ - r; else p.z = c.maxZ + r;
        }
      }
    }
    return hit;
  }

  function isRoad(x, z) {
    for (let i = 0; i < ROAD_XS.length; i++) if (Math.abs(x - ROAD_XS[i]) < ROAD_HALF + 2.5) return true;
    for (let j = 0; j < ROAD_ZS.length; j++) if (Math.abs(z - ROAD_ZS[j]) < ROAD_HALF + 2.5) return true;
    return false;
  }

  return {
    build: build,
    update: update,
    clampPlay: clampPlay,
    collideBuildings: collideBuildings,
    isRoad: isRoad,
    colliders: colliders,
    marks: marks,
    pitch: PITCH,
    roadXS: ROAD_XS,
    roadZS: ROAD_ZS,
    bounds: CITY,
  };
})();
