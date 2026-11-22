// city.js — Port Azura itself: a compact sunset coastal city on a street
// grid. Nine avenues run north–south, seven streets east–west; between them
// sit block slabs with procedurally-textured buildings. The south edge is a
// beach, a wooden marina pier and open water. This module builds all of the
// static geometry (instanced wherever it repeats), and exports the layout
// data the traffic, pedestrians, police and missions navigate by:
// building colliders, sidewalk loops, parked-car spots and named places.

import {
  asphaltTexture,
  concreteTexture,
  facadeTextures,
  grassTexture,
  sandTexture,
  signTexture,
  waterTexture,
  woodTexture,
} from './textures.js';

/** Avenues (constant x) and streets (constant z) of the grid. */
export const ROAD_XS = [-176, -132, -88, -44, 0, 44, 88, 132, 176];
export const ROAD_ZS = [-132, -88, -44, 0, 44, 88, 132];
export const ROAD_W = 12;
export const BLOCK_PITCH = 44;

/** Playable bounds and the shoreline. */
export const WORLD = {
  minX: -200,
  maxX: 200,
  minZ: -156,
  maxZ: 198,
  sandZ: 150,
  waterZ: 188,
};

/** The pier deck rectangle (the one place you may walk out over the water). */
export const PIER = { minX: 8, maxX: 48, minZ: 150, maxZ: 208, topY: 0.55 };

/** Block lot rectangle between avenue i/i+1 and street j/j+1. */
export function lotRect(i, j) {
  return {
    minX: ROAD_XS[i] + 9,
    maxX: ROAD_XS[i + 1] - 9,
    minZ: ROAD_ZS[j] + 9,
    maxZ: ROAD_ZS[j + 1] - 9,
  };
}

const SPECIAL_BLOCKS = new Map([
  ['3,2', 'park'],
  ['5,4', 'parking'],
  ['7,5', 'garage'],
  ['0,0', 'hotel'],
  ['7,0', 'safehouse'],
  ['4,3', 'pd'],
  ['3,5', 'hospital'],
]);

const FACADE_BASES = ['#e0a184', '#c9856a', '#d9b98c', '#9fb6bd', '#e8cba3', '#b0765a'];

/**
 * Build the whole static city into `scene`. Returns the navigation data:
 * { colliders, lots, pedLoops, parkedSpots, places, update(dt, t) }.
 */
export function buildCity(scene, rng) {
  const colliders = [];
  const lots = [];
  const pedLoops = [];
  const parkedSpots = [];

  buildGround(scene, rng);
  const water = buildWater(scene, rng);
  buildDashes(scene);
  buildBlocks(scene, rng, { colliders, lots, pedLoops, parkedSpots });
  buildPalmsAndLights(scene, rng);
  buildPier(scene, rng, colliders);
  const places = buildPlaces(scene, colliders);

  return {
    colliders,
    lots,
    pedLoops,
    parkedSpots,
    places,
    update(dt, t) {
      water.material.map.offset.set(t * 0.008, t * 0.005);
    },
  };
}

/** The named story locations, as ground points a marker can sit on. */
function buildPlaces(scene, colliders) {
  const places = {
    garageDoor: new THREE.Vector3(136, 0, 110),
    garageForecourt: new THREE.Vector3(146, 0, 110),
    hotelDoor: new THREE.Vector3(-136, 0, -110),
    safehouseDoor: new THREE.Vector3(136, 0, -110),
    pdDoor: new THREE.Vector3(6, 0, 22),
    hospitalDoor: new THREE.Vector3(-48, 0, 110),
    pierBase: new THREE.Vector3(28, 0, 158),
    pierEnd: new THREE.Vector3(28, 0, 196),
    marinaOffice: new THREE.Vector3(64, 0, 146),
  };
  // The marina office: a small shore building east of the pier.
  const office = new THREE.Group();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf0e2c8 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 9), wallMat);
  walls.position.y = 2.5;
  walls.castShadow = true;
  office.add(walls);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(15.5, 0.5, 10.5),
    new THREE.MeshLambertMaterial({ color: 0xb5502f }),
  );
  roof.position.y = 5.2;
  office.add(roof);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 2.4),
    new THREE.MeshBasicMaterial({ map: signTexture('MARINA OFFICE', '#274b63', '#ffd9a0') }),
  );
  sign.position.set(0, 3.6, -4.56);
  sign.rotation.y = Math.PI;
  office.add(sign);
  office.position.set(64, 0, 146);
  scene.add(office);
  colliders.push({ minX: 57, maxX: 71, minZ: 141.5, maxZ: 150.5 });
  return places;
}

/** Asphalt street plane, beach sand and the park/beach ground cover. */
function buildGround(scene, rng) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(440, 330),
    new THREE.MeshLambertMaterial({ map: asphaltTexture(rng) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -5);
  ground.receiveShadow = true;
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(440, 0.3, 46),
    new THREE.MeshLambertMaterial({ map: sandTexture(rng) }),
  );
  sand.position.set(0, 0.02, 168);
  sand.receiveShadow = true;
  scene.add(sand);
}

/** The sea: a big animated plane south of the sand. */
function buildWater(scene, rng) {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 320),
    new THREE.MeshLambertMaterial({
      map: waterTexture(rng),
      transparent: true,
      opacity: 0.94,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, 348);
  scene.add(water);
  return water;
}

/** Dashed centre lines along every avenue and street (one instanced mesh). */
function buildDashes(scene) {
  const geo = new THREE.BoxGeometry(0.35, 0.04, 3.2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8e4da });
  const spots = [];
  for (const x of ROAD_XS) {
    for (let z = WORLD.minZ + 4; z < 148; z += 9) spots.push([x, z, 0]);
  }
  for (const z of ROAD_ZS) {
    for (let x = WORLD.minX + 4; x < WORLD.maxX; x += 9) spots.push([x, z, 1]);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  spots.forEach(([x, z, rot], i) => {
    e.set(0, rot ? Math.PI / 2 : 0, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

/** Block slabs, buildings, the park, the parking lot and special blocks. */
function buildBlocks(scene, rng, out) {
  const slabGeo = new THREE.BoxGeometry(28, 0.24, 28);
  const slabMat = new THREE.MeshLambertMaterial({ map: concreteTexture(rng) });
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTexture(rng) });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, 48);
  const parkSlabs = new THREE.InstancedMesh(slabGeo, grassMat, 1);
  let slabIdx = 0;
  let parkIdx = 0;
  const m = new THREE.Matrix4();

  // Buildings are grouped by facade variant so each variant is one
  // InstancedMesh; transforms are collected first, then baked.
  const variants = FACADE_BASES.map((base) => {
    const { map, emissiveMap } = facadeTextures(rng, base);
    return {
      mat: new THREE.MeshLambertMaterial({
        map,
        emissiveMap,
        emissive: new THREE.Color(0xcc7733),
        emissiveIntensity: 0.55,
      }),
      items: [],
    };
  });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const addBuilding = (cx, cz, w, h, d, variant = -1) => {
    const v = variant >= 0 ? variant : rng.int(0, variants.length - 1);
    variants[v].items.push({ cx, cz, w, h, d });
    out.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  };

  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const lot = lotRect(i, j);
      const cx = (lot.minX + lot.maxX) / 2;
      const cz = (lot.minZ + lot.maxZ) / 2;
      out.lots.push(lot);
      const kind = SPECIAL_BLOCKS.get(`${i},${j}`) ?? 'normal';
      if (kind === 'park') {
        m.makeTranslation(cx, 0.12, cz);
        parkSlabs.setMatrixAt(parkIdx++, m);
        addParkTrees(scene, rng, lot);
      } else {
        m.makeTranslation(cx, 0.12, cz);
        slabs.setMatrixAt(slabIdx++, m);
      }
      // Sidewalk loop around this block for pedestrians.
      out.pedLoops.push([
        new THREE.Vector3(lot.minX - 1.6, 0, lot.minZ - 1.6),
        new THREE.Vector3(lot.maxX + 1.6, 0, lot.minZ - 1.6),
        new THREE.Vector3(lot.maxX + 1.6, 0, lot.maxZ + 1.6),
        new THREE.Vector3(lot.minX - 1.6, 0, lot.maxZ + 1.6),
      ]);

      if (kind === 'normal') {
        const downtown = Math.hypot(cx, cz) < 120;
        const hBase = downtown ? rng.range(20, 48) : rng.range(9, 26);
        addBuilding(cx + rng.range(-2, 2), cz + rng.range(-2, 2), rng.range(15, 23), hBase, rng.range(15, 23));
        if (rng.chance(0.45)) {
          addBuilding(
            cx + rng.range(-6, 6),
            cz + rng.range(-6, 6),
            rng.range(8, 12),
            rng.range(6, 14),
            rng.range(8, 12),
          );
        }
      } else if (kind === 'parking') {
        for (let s = 0; s < 6; s++) {
          out.parkedSpots.push({
            x: lot.minX + 5 + (s % 3) * 8,
            z: lot.minZ + 6 + Math.floor(s / 3) * 13,
            heading: Math.PI / 2,
          });
        }
      } else if (kind === 'garage') {
        addBuilding(cx + 3, cz, 20, 7.5, 24, 3);
        addSign(scene, 'MARINA GARAGE', cx + 3, 8.6, cz - 12.2, 0, '#7a2e22', '#ffd9a0');
      } else if (kind === 'hotel') {
        addBuilding(cx, cz, 21, 56, 21, 2);
        addSign(scene, 'HOTEL AZUL', cx, 47, cz + 10.7, Math.PI, '#1d4e5f', '#ffe9b0');
      } else if (kind === 'safehouse') {
        addBuilding(cx, cz, 16, 15, 16, 4);
        addSign(scene, 'CASA SEGURA', cx, 12.4, cz - 8.2, 0, '#3d5a3a', '#eaf5d0');
      } else if (kind === 'pd') {
        addBuilding(cx, cz, 22, 13, 22, 5);
        addSign(scene, 'PORT AZURA PD', cx, 11.2, cz - 11.2, 0, '#22364f', '#cfe4ff');
      } else if (kind === 'hospital') {
        addBuilding(cx, cz, 22, 18, 20, 1);
        addSign(scene, 'ST. AZURA HOSPITAL', cx, 15.6, cz - 10.2, 0, '#e8e4da', '#c03a30');
      }
    }
  }
  slabs.count = slabIdx;
  parkSlabs.count = parkIdx;
  slabs.receiveShadow = true;
  parkSlabs.receiveShadow = true;
  scene.add(slabs);
  scene.add(parkSlabs);

  for (const v of variants) {
    if (v.items.length === 0) continue;
    const mesh = new THREE.InstancedMesh(unitBox, v.mat, v.items.length);
    const mm = new THREE.Matrix4();
    v.items.forEach((b, idx) => {
      mm.makeScale(b.w, b.h, b.d);
      mm.setPosition(b.cx, b.h / 2 + 0.24, b.cz);
      mesh.setMatrixAt(idx, mm);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Curbside parked-car spots along a few avenues.
  for (let s = 0; s < 10; s++) {
    const x = ROAD_XS[rng.int(1, 7)] + 4.6;
    const z = rng.range(-140, 130);
    out.parkedSpots.push({ x, z, heading: 0 });
  }
}

/** A painted sign board on a building face. rotY 0 faces -z, PI faces +z. */
function addSign(scene, text, x, y, z, rotY, bg, fg) {
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 3.3),
    new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }),
  );
  sign.position.set(x, y, z);
  sign.rotation.y = rotY;
  scene.add(sign);
}

/** Low-poly park trees: a trunk and a blob canopy. */
function addParkTrees(scene, rng, lot) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(2.4, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6e4f30 });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x4d7d3c });
  const n = 7;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = rng.range(lot.minX + 3, lot.maxX - 3);
    const z = rng.range(lot.minZ + 3, lot.maxZ - 3);
    const s = rng.range(0.8, 1.5);
    m.makeScale(s, s, s);
    m.setPosition(x, 1.3 * s, z);
    trunks.setMatrixAt(i, m);
    m.makeScale(s, s * 0.75, s);
    m.setPosition(x, (2.6 + 1.4) * s, z);
    canopies.setMatrixAt(i, m);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  canopies.castShadow = true;
  scene.add(trunks);
  scene.add(canopies);
}

/** Palms along the beach and street lights along the avenues. */
function buildPalmsAndLights(scene, rng) {
  const spots = [];
  for (let x = -190; x <= 190; x += 13) spots.push([x + rng.range(-2, 2), 158 + rng.range(-1.5, 1.5)]);
  for (let s = 0; s < 22; s++) {
    spots.push([ROAD_XS[rng.int(0, 8)] + rng.sign() * 8.2, rng.range(-140, 130)]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5.2, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(2.5, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44 });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x55853f });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  spots.forEach(([x, z], i) => {
    e.set(rng.range(-0.09, 0.09), 0, rng.range(-0.09, 0.09));
    q.setFromEuler(e);
    const s = rng.range(0.85, 1.25);
    m.compose(new THREE.Vector3(x, 2.6 * s, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, 5.6 * s, z), q, new THREE.Vector3(s * 1.15, s * 0.5, s * 1.15));
    canopies.setMatrixAt(i, m);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  canopies.castShadow = true;
  scene.add(trunks);
  scene.add(canopies);

  // Street lights: pole + warm glowing head, instanced.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 5.6, 5);
  const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffc37a });
  const lightSpots = [];
  for (const x of ROAD_XS) {
    for (const z of ROAD_ZS) {
      lightSpots.push([x + 7.4, z + 7.4]);
      lightSpots.push([x - 7.4, z - 7.4]);
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lightSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
  lightSpots.forEach(([x, z], i) => {
    m.makeTranslation(x, 2.8, z);
    poles.setMatrixAt(i, m);
    m.makeTranslation(x, 5.7, z);
    heads.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(heads);
}

/** The wooden marina pier reaching into the water, with crates and posts. */
function buildPier(scene, rng, colliders) {
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(PIER.maxX - PIER.minX, 0.5, PIER.maxZ - PIER.minZ),
    new THREE.MeshLambertMaterial({ map: woodTexture(rng) }),
  );
  deck.position.set((PIER.minX + PIER.maxX) / 2, 0.3, (PIER.minZ + PIER.maxZ) / 2);
  deck.receiveShadow = true;
  scene.add(deck);

  const postGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.4, 6);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5f4630 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, 12);
  const m = new THREE.Matrix4();
  let idx = 0;
  for (const x of [PIER.minX + 1, PIER.maxX - 1]) {
    for (let z = PIER.minZ + 4; z < PIER.maxZ; z += 11) {
      m.makeTranslation(x, -0.5, z);
      posts.setMatrixAt(idx++, m);
    }
  }
  posts.count = idx;
  posts.instanceMatrix.needsUpdate = true;
  scene.add(posts);

  const crateMat = new THREE.MeshLambertMaterial({ color: 0xa8793f });
  for (let i = 0; i < 5; i++) {
    const s = rng.range(1.1, 1.9);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    const x = rng.range(PIER.minX + 3, PIER.maxX - 3);
    const z = rng.range(PIER.minZ + 6, PIER.maxZ - 4);
    crate.position.set(x, PIER.topY + s / 2, z);
    crate.rotation.y = rng.range(0, Math.PI);
    crate.castShadow = true;
    scene.add(crate);
    colliders.push({ minX: x - s / 2, maxX: x + s / 2, minZ: z - s / 2, maxZ: z + s / 2 });
  }
}

/**
 * Push a circle (centre x/z, radius r) out of every building collider and
 * the world bounds. Mutates and returns `pos` (a THREE.Vector3).
 */
export function collideCircle(pos, radius, colliders) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: leave by the nearest face.
      const left = pos.x - c.minX;
      const right = c.maxX - pos.x;
      const top = pos.z - c.minZ;
      const bottom = c.maxZ - pos.z;
      const min = Math.min(left, right, top, bottom);
      if (min === left) pos.x = c.minX - radius;
      else if (min === right) pos.x = c.maxX + radius;
      else if (min === top) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  pos.x = Math.max(WORLD.minX, Math.min(pos.x, WORLD.maxX));
  const onPier = pos.x >= PIER.minX && pos.x <= PIER.maxX;
  const zMax = onPier ? PIER.maxZ - 1 : WORLD.waterZ;
  pos.z = Math.max(WORLD.minZ, Math.min(pos.z, zMax));
  return pos;
}

/** Standing height at a point: on a block slab, on the pier, or street level. */
export function groundHeightAt(x, z, lots) {
  if (x >= PIER.minX && x <= PIER.maxX && z >= PIER.minZ && z <= PIER.maxZ) return PIER.topY;
  for (const lot of lots) {
    if (x >= lot.minX - 1 && x <= lot.maxX + 1 && z >= lot.minZ - 1 && z <= lot.maxZ + 1) return 0.24;
  }
  return 0;
}
