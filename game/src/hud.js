'use strict';
/* Port Azura: Sunset Heat — HUD.
   Cash, wanted stars, health and vehicle bars, speedometer, the objective
   tracker, banners and toasts, the bust meter, and the live canvas minimap
   (streets, shoreline, traffic, flashing police, the mission marker and
   the player arrow). */

PA.HUD = (function () {
  let els = null;
  let bannerUntil = 0, toastUntil = 0, clock = 0;
  let lastCash = -1, lastStars = -1, mapTick = 0;

  function init() {
    els = {
      hud: PA.el('hud'), cash: PA.el('cash'), stars: PA.el('stars'),
      missionTag: PA.el('mission-tag'),
      objective: PA.el('objective'), objTitle: PA.el('objective-title'), objSub: PA.el('objective-sub'),
      banner: PA.el('banner'), bannerTitle: PA.el('banner-title'), bannerSub: PA.el('banner-sub'),
      healthFill: PA.el('health-fill'),
      carHealth: PA.el('car-health'), carHealthFill: PA.el('car-health-fill'),
      speed: PA.el('speed'), speedNum: PA.el('speed-num'),
      prompt: PA.el('prompt'), bust: PA.el('bust'), bustFill: PA.el('bust-fill'),
      toast: PA.el('toast'),
      minimap: PA.el('minimap'),
    };
  }

  function banner(title, sub) {
    if (!els) return;
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.classList.remove('hidden');
    bannerUntil = clock + 2.8;
  }
  function toast(msg) {
    if (!els) return;
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    toastUntil = clock + 4.2;
  }
  function setPrompt(html) {
    if (!els) return;
    if (html) { els.prompt.innerHTML = html; els.prompt.classList.remove('hidden'); }
    else els.prompt.classList.add('hidden');
  }

  function drawMinimap() {
    const ctx = els.minimap.getContext('2d');
    const W = 190, s = 0.352, ox = 4, oz = 6;
    function mx(x) { return ox + (x + 252) * s; }
    function mz(z) { return oz + (z + 192) * s; }
    ctx.save();
    ctx.beginPath(); ctx.arc(95, 95, 93, 0, 7); ctx.clip();
    ctx.fillStyle = '#232a33'; ctx.fillRect(0, 0, W, W);
    /* Sea + beach along the south edge. */
    ctx.fillStyle = '#2a7d8c'; ctx.fillRect(0, mz(208), W, W - mz(208));
    ctx.fillStyle = '#e8c188'; ctx.fillRect(0, mz(184), W, mz(208) - mz(184));
    /* Blocks, then the street grid. */
    ctx.fillStyle = '#31363e';
    for (let ci = 0; ci < 8; ci++) for (let ri = 0; ri < 6; ri++) {
      ctx.fillRect(mx(-182 + ci * 52 - 22), mz(-130 + ri * 52 - 22), 44 * s, 44 * s);
    }
    ctx.strokeStyle = '#596270'; ctx.lineWidth = 3;
    PA.World.roadXS.forEach(function (x) { ctx.beginPath(); ctx.moveTo(mx(x), mz(-188)); ctx.lineTo(mx(x), mz(190)); ctx.stroke(); });
    PA.World.roadZS.forEach(function (z) { ctx.beginPath(); ctx.moveTo(mx(-240), mz(z)); ctx.lineTo(mx(240), mz(z)); ctx.stroke(); });
    /* Pier. */
    ctx.strokeStyle = '#a8845c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(mx(-156), mz(186)); ctx.lineTo(mx(-156), mz(282)); ctx.stroke();
    /* Traffic dots. */
    ctx.fillStyle = '#c8ccd4';
    PA.Vehicles.all.forEach(function (c) {
      if (c.occupied) return;
      ctx.fillRect(mx(c.mesh.position.x) - 1.3, mz(c.mesh.position.z) - 1.3, 2.6, 2.6);
    });
    /* Police: flashing red/blue. */
    const phase = Math.floor(clock * 5) % 2;
    PA.Police.cars.forEach(function (c) {
      if (!c.active) return;
      ctx.fillStyle = phase ? '#4d7dff' : '#ff4b3e';
      ctx.beginPath(); ctx.arc(mx(c.mesh.position.x), mz(c.mesh.position.z), 3.1, 0, 7); ctx.fill();
    });
    /* Mission marker: a pulsing gold ring. */
    const info = PA.Missions.objectiveInfo();
    if (info && info.point) {
      const px = mx(info.point.x), pz = mz(info.point.z);
      const pulse = 4.6 + Math.sin(clock * 4.4) * 1.5;
      ctx.strokeStyle = '#ffc93c'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(px, pz, pulse, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath(); ctx.arc(px, pz, 2.1, 0, 7); ctx.fill();
    }
    /* Player arrow. */
    const P = PA.G.playerPos, h = PA.G.playerHeading;
    ctx.translate(mx(P.x), mz(P.z));
    ctx.rotate(Math.PI - h);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#14202b'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -6.4); ctx.lineTo(4.4, 5); ctx.lineTo(0, 2.6); ctx.lineTo(-4.4, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function update(dt) {
    if (!els) return;
    clock += dt;
    const G = PA.G;
    if (bannerUntil && clock > bannerUntil) { els.banner.classList.add('hidden'); bannerUntil = 0; }
    if (toastUntil && clock > toastUntil) { els.toast.classList.add('hidden'); toastUntil = 0; }

    if (G.cash !== lastCash) { els.cash.textContent = '$' + G.cash; lastCash = G.cash; }
    const st = PA.Police.stars();
    if (st !== lastStars) {
      let html = '';
      for (let i = 0; i < 5; i++) html += '<span class="' + (i < st ? 'on' : 'off') + '">★</span>';
      els.stars.innerHTML = html;
      lastStars = st;
    }
    els.missionTag.textContent = PA.Missions.state.storyDone ? 'FREE ROAM' :
      (PA.Missions.state.active ? 'MISSION ' + (PA.Missions.state.index + 1) + ' — ' + PA.Missions.STORY[PA.Missions.state.index].name : 'FREE ROAM');

    const info = PA.Missions.objectiveInfo();
    if (info && G.state === 'playing') {
      els.objective.classList.remove('hidden');
      els.objTitle.textContent = info.title;
      els.objSub.textContent = info.sub || '';
    } else els.objective.classList.add('hidden');

    els.healthFill.style.width = PA.clamp(G.health, 0, 100) + '%';
    if (G.driving) {
      els.carHealth.classList.remove('hidden');
      els.carHealthFill.style.width = PA.clamp(G.driving.health, 0, 100) + '%';
      els.speed.classList.remove('hidden');
      els.speedNum.textContent = Math.round(Math.abs(G.driving.speed) * 2.237);
    } else {
      els.carHealth.classList.add('hidden');
      els.speed.classList.add('hidden');
    }
    const bust = PA.Police.getBust();
    if (bust > 0.02 && G.state === 'playing') {
      els.bust.classList.remove('hidden');
      els.bustFill.style.width = (bust * 100) + '%';
    } else els.bust.classList.add('hidden');

    mapTick += dt;
    if (mapTick > 0.05) { mapTick = 0; drawMinimap(); }
  }

  return { init: init, update: update, banner: banner, toast: toast, setPrompt: setPrompt };
})();
