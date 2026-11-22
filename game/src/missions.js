'use strict';
/* Port Azura: Sunset Heat — missions.
   Marisol Vega's four-job story chain, driven by a small step engine:
   goto / timed delivery / checkpoint circuit / steal-and-lose-the-heat /
   hold-and-escape. A gold beacon marks the live objective; after the story,
   the Sunset Circuit stays open as a repeatable $200 rematch. */

PA.Missions = (function () {
  const M = PA.World.marks;
  const CIRCUIT = [
    { x: -208, z: -52 }, { x: -104, z: -156 }, { x: 52, z: -104 },
    { x: 208, z: -52 }, { x: 104, z: 156 }, { x: -104, z: 104 },
  ];

  const STORY = [
    {
      name: 'PIER PRESSURE', reward: 300,
      intro: 'Marisol: "A package is waiting at the end of the pier. Bring it to Hotel Azul — fast."',
      steps: [
        { type: 'goto', point: M.pier, r: 6, label: 'Pick up the package at the end of the pier', done: 'Package collected.' },
        { type: 'goto', point: M.hotel, r: 8, timer: 100, label: 'Deliver the package to Hotel Azul', failStep: 0, failMsg: 'Too slow — the drop has gone cold. Pick it up again.' },
      ],
    },
    {
      name: 'SUNSET CIRCUIT', reward: 400,
      intro: 'Marisol: "The street racers respect one thing: the Circuit. Six gates. Run it."',
      steps: [
        { type: 'circuit', label: 'Run the Sunset Circuit — hit every gate', timer: 165 },
      ],
    },
    {
      name: 'HOT VAN', reward: 600,
      intro: 'Marisol: "Red van, parking lot, plates already missed. Take it. Then disappear."',
      steps: [
        { type: 'stealvan', label: 'Steal the red van from the parking lot' },
        { type: 'loseheat', label: 'Lose the heat — then the van is yours to deliver' },
        { type: 'deliver', point: M.garage, r: 9, label: 'Deliver the van to Marina Garage' },
      ],
    },
    {
      name: 'LAST STAND AT THE MARINA', reward: 900,
      intro: 'Marisol: "They are coming for the marina office. Hold it. Then run to Casa Segura."',
      steps: [
        { type: 'goto', point: M.garage, r: 9, label: 'Get to the marina office' },
        { type: 'hold', point: M.garage, r: 12, holdTime: 45, label: 'Hold the marina office' },
        { type: 'goto', point: M.safehouse, r: 8, label: 'Escape to Casa Segura', done: '' },
      ],
    },
  ];

  const state = {
    index: 0,           // current story mission
    step: 0,
    active: false,
    storyDone: false,
    timer: -1,          // countdown for the live step, -1 = none
    holdLeft: 0,
    cpIndex: 0,         // circuit checkpoint progress
    cpTime: 0,          // circuit elapsed (rematch timing)
    mode: 'story',      // 'story' | 'circuit' (free-roam rematch)
  };

  let beacon = null, beaconRing = null, beaconCone = null, beaconMat = null, beaconRingMat = null;
  let beaconPos = null, beaconClock = 0;

  function init(scene) {
    beaconMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false });
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 36, 18, 1, true), beaconMat);
    beacon.position.y = 18;
    beaconRingMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    beaconRing = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.1, 28), beaconRingMat);
    beaconRing.rotation.x = -Math.PI / 2; beaconRing.position.y = 0.25;
    beaconCone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), new THREE.MeshBasicMaterial({ color: 0xffe259 }));
    beaconCone.rotation.x = Math.PI;
    const g = new THREE.Group();
    g.add(beacon); g.add(beaconRing); g.add(beaconCone);
    g.visible = false;
    scene.add(g);
    beacon = g;
    beaconPos = null;
  }

  function setBeacon(x, z, color) {
    beaconPos = { x: x, z: z };
    beacon.position.set(x, 0, z);
    beaconMat.color.setHex(color);
    beaconRingMat.color.setHex(color);
    beacon.visible = true;
  }
  function hideBeacon() { beaconPos = null; if (beacon) beacon.visible = false; }

  function currentStep() {
    if (state.mode === 'circuit') return { type: 'circuit', label: 'Sunset Circuit rematch — hit every gate' };
    if (!state.active || state.storyDone) return null;
    return STORY[state.index].steps[state.step];
  }

  function startMission(i) {
    state.mode = 'story';
    state.index = i; state.step = 0; state.active = true;
    setupStep();
    PA.HUD.banner('MISSION ' + (i + 1) + ' — ' + STORY[i].name, 'Reward $' + STORY[i].reward);
    PA.HUD.toast(STORY[i].intro);
  }

  function setupStep() {
    const s = currentStep();
    state.timer = s && s.timer ? s.timer : -1;
    if (s && s.type === 'hold') state.holdLeft = s.holdTime;
    if (s && s.type === 'circuit') state.cpIndex = 0;
  }

  function completeMission() {
    const m = STORY[state.index];
    PA.G.addCash(m.reward);
    PA.Audio.cash();
    state.step = 0;
    if (state.index >= STORY.length - 1) {
      state.active = false;
      state.storyDone = true;
      hideBeacon();
      PA.Police.clearHeat();
      if (PA.G.onStoryComplete) PA.G.onStoryComplete();
    } else {
      PA.HUD.banner('MISSION COMPLETE', m.name + ' — $' + m.reward + ' earned');
      startMission(state.index + 1);
    }
  }

  function advanceStep() {
    const s = currentStep();
    if (s && s.done) PA.HUD.toast(s.done);
    state.step++;
    if (state.step >= STORY[state.index].steps.length) completeMission();
    else setupStep();
  }

  function failStep(msg) {
    PA.HUD.toast(msg);
    PA.Audio.alarm();
    state.step = currentStep().failStep || 0;
    setupStep();
  }

  function startCircuit() {
    state.mode = 'circuit';
    state.cpIndex = 0;
    state.cpTime = 0;
    state.timer = -1;
    PA.HUD.banner('SUNSET CIRCUIT', 'Six gates — $200 for a full run');
  }

  function circuitDone() {
    const t = state.cpTime;
    PA.G.addCash(200);
    PA.Audio.cash();
    PA.HUD.banner('CIRCUIT COMPLETE', 'Time ' + t.toFixed(1) + 's — $200 earned');
    state.mode = 'story';
    hideBeacon();
  }

  function circuitOffer() {
    return state.storyDone && state.mode === 'story' && !state.active &&
      PA.G.driving && PA.dist(PA.G.playerPos.x, PA.G.playerPos.z, CIRCUIT[0].x, CIRCUIT[0].z) < 9;
  }

  function objectiveInfo() {
    const s = currentStep();
    if (!s) {
      if (state.storyDone) return { title: 'Free roam — Port Azura is yours', sub: 'Run the Sunset Circuit from the west gate for $200', point: CIRCUIT[0] };
      return null;
    }
    const P = PA.G.playerPos;
    let point = s.point || null, sub = '';
    if (s.type === 'circuit') {
      point = CIRCUIT[state.cpIndex];
      sub = 'Gate ' + (state.cpIndex + 1) + ' of ' + CIRCUIT.length + ' — ' + Math.round(PA.dist(P.x, P.z, point.x, point.z)) + 'm';
      if (!PA.G.driving) sub += ' — you need a car';
    } else if (s.type === 'stealvan') {
      const van = PA.Vehicles.all.filter(function (c) { return c.isVan; })[0];
      point = van ? { x: van.mesh.position.x, z: van.mesh.position.z } : M.lot;
      sub = Math.round(PA.dist(P.x, P.z, point.x, point.z)) + 'm — the red van';
    } else if (s.type === 'loseheat') {
      sub = PA.Police.stars() > 0 ? 'Heat: ' + PA.Police.stars() + ' stars — break line of sight and lay low' : 'Heat is gone';
      point = M.garage;
    } else if (s.type === 'hold') {
      sub = 'Hold the office — ' + Math.ceil(state.holdLeft) + 's';
      if (point && PA.dist(P.x, P.z, point.x, point.z) > s.r) sub = 'GET BACK to the marina office!';
    } else if (point) {
      sub = Math.round(PA.dist(P.x, P.z, point.x, point.z)) + 'm';
    }
    if (state.timer > 0 && s.type !== 'circuit') sub += ' — ' + Math.ceil(state.timer) + 's left';
    if (s.type === 'circuit' && state.timer > 0) sub += ' — ' + Math.ceil(state.timer) + 's left';
    return { title: s.label, sub: sub, point: point, step: s };
  }

  function update(dt) {
    beaconClock += dt;
    if (beaconPos && beacon.visible) {
      beaconCone.position.y = 6.4 + Math.sin(beaconClock * 3.2) * 0.7;
      const pulse = 1 + Math.sin(beaconClock * 3.2) * 0.1;
      beaconRing.scale.set(pulse, pulse, 1);
    }
    const s = currentStep();
    if (!s) {
      if (state.storyDone && state.mode === 'story') setBeacon(CIRCUIT[0].x, CIRCUIT[0].z, 0x7ef0e0);
      return;
    }
    const P = PA.G.playerPos;
    const info = objectiveInfo();
    if (info && info.point) setBeacon(info.point.x, info.point.z, s.type === 'circuit' ? 0x7ef0e0 : 0xffc93c);

    /* Countdown steps. */
    if (state.timer > 0) {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (s.type === 'circuit') {
          PA.HUD.toast('Out of time — the Circuit resets.');
          PA.Audio.alarm();
          if (state.mode === 'circuit') { state.mode = 'story'; hideBeacon(); }
          else { state.cpIndex = 0; state.timer = s.timer || 165; setupStep(); }
        } else {
          failStep(s.failMsg || 'Too slow.');
        }
        return;
      }
    }

    if (s.type === 'goto' || s.type === 'deliver') {
      const inVanOk = s.type !== 'deliver' || (PA.G.driving && PA.G.driving.isVan);
      if (inVanOk && PA.dist(P.x, P.z, s.point.x, s.point.z) < s.r) {
        if (s.type === 'goto' && s.done === 'Package collected.') PA.Audio.pickup();
        advanceStep();
      }
    } else if (s.type === 'stealvan') {
      if (PA.G.driving && PA.G.driving.isVan) {
        PA.Police.setHeat(6);
        PA.HUD.banner('THE VAN IS HOT', '3 stars — lose the heat, then deliver it');
        PA.Audio.alarm();
        advanceStep();
      }
    } else if (s.type === 'loseheat') {
      if (PA.Police.stars() === 0) advanceStep();
    } else if (s.type === 'hold') {
      if (PA.Police.getHeat() < 7.9 && state.holdLeft > s.holdTime - 2) PA.Police.setHeat(8);
      if (PA.dist(P.x, P.z, s.point.x, s.point.z) < s.r) {
        state.holdLeft -= dt;
        if (state.holdLeft <= 0) advanceStep();
      }
    } else if (s.type === 'circuit') {
      state.cpTime += dt;
      const cp = CIRCUIT[state.cpIndex];
      if (PA.G.driving && PA.dist(P.x, P.z, cp.x, cp.z) < 8.5) {
        PA.Audio.checkpoint();
        state.cpIndex++;
        if (state.mode === 'story' && STORY[state.index].steps[state.step].timer) state.timer += 12;
        if (state.cpIndex >= CIRCUIT.length) {
          if (state.mode === 'circuit') circuitDone();
          else advanceStep();
        } else {
          PA.HUD.toast('Gate ' + state.cpIndex + ' of ' + CIRCUIT.length);
        }
      }
    }
  }

  return {
    init: init,
    update: update,
    startMission: startMission,
    startCircuit: startCircuit,
    circuitOffer: circuitOffer,
    objectiveInfo: objectiveInfo,
    setProgress: function (index, done) {
      state.index = index; state.storyDone = !!done;
      state.active = !done && index < STORY.length;
      state.step = 0;
      if (state.active) setupStep();
    },
    state: state,
    STORY: STORY,
    CIRCUIT: CIRCUIT,
  };
})();
