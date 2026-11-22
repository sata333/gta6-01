// hud.js — everything drawn over the 3D view: cash, wanted stars, health,
// the objective line, contextual prompts, centre banners, the damage flash,
// the bust meter, and the live minimap (a 2D canvas: streets, the shore,
// traffic, police, the mission marker and Rook's arrow).

import { ROAD_XS, ROAD_ZS, WORLD } from './city.js';

export class Hud {
  constructor() {
    this.el = {
      cash: document.getElementById('hud-cash'),
      stars: document.getElementById('hud-stars'),
      healthFill: document.getElementById('hud-health-fill'),
      carHealth: document.getElementById('hud-carhealth'),
      carHealthFill: document.getElementById('hud-carhealth-fill'),
      objective: document.getElementById('hud-objective'),
      objectiveSub: document.getElementById('hud-objective-sub'),
      speed: document.getElementById('hud-speed'),
      prompt: document.getElementById('hud-prompt'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('banner-title'),
      bannerSub: document.getElementById('banner-sub'),
      flash: document.getElementById('damage-flash'),
      bust: document.getElementById('bust-wrap'),
      bustFill: document.getElementById('bust-fill'),
      wantedLabel: document.getElementById('hud-wanted-label'),
    };
    this.minimap = document.getElementById('minimap');
    this.mapCtx = this.minimap.getContext('2d');
    this.bannerTimer = 0;
    this.flashTimer = 0;
    this.lastStars = -1;
    this.lastCash = -1;
    this.promptText = null;
  }

  setCash(cash) {
    if (cash === this.lastCash) return;
    this.lastCash = cash;
    this.el.cash.textContent = `$${cash.toLocaleString('en-US')}`;
  }

  setStars(stars) {
    if (stars === this.lastStars) return;
    this.lastStars = stars;
    this.el.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    this.el.stars.classList.toggle('hot', stars > 0);
    this.el.wantedLabel.style.visibility = stars > 0 ? 'visible' : 'hidden';
  }

  setHealth(frac) {
    this.el.healthFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.el.healthFill.classList.toggle('low', frac < 0.3);
  }

  /** The car-health bar only shows while driving. */
  setCarHealth(frac) {
    if (frac === null) {
      this.el.carHealth.style.display = 'none';
      return;
    }
    this.el.carHealth.style.display = 'block';
    this.el.carHealthFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  setObjective(text, sub = '') {
    if (this.el.objective.textContent !== text) this.el.objective.textContent = text;
    if (this.el.objectiveSub.textContent !== sub) this.el.objectiveSub.textContent = sub;
  }

  setSpeed(kmh) {
    if (kmh === null) {
      this.el.speed.style.display = 'none';
      return;
    }
    this.el.speed.style.display = 'block';
    this.el.speed.textContent = `${Math.round(kmh)} km/h`;
  }

  setPrompt(text) {
    if (text === this.promptText) return;
    this.promptText = text;
    if (text) {
      this.el.prompt.textContent = text;
      this.el.prompt.style.display = 'block';
    } else {
      this.el.prompt.style.display = 'none';
    }
  }

  banner(title, sub = '', seconds = 4) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.style.display = 'block';
    this.bannerTimer = seconds;
  }

  flashDamage() {
    this.flashTimer = 0.35;
    this.el.flash.style.opacity = '0.55';
  }

  setBust(frac) {
    if (frac > 0.02) {
      this.el.bust.style.display = 'block';
      this.el.bustFill.style.width = `${Math.min(1, frac) * 100}%`;
    } else {
      this.el.bust.style.display = 'none';
    }
  }

  /** Per-frame cosmetic timers. */
  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.style.display = 'none';
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.el.flash.style.opacity = '0';
    }
  }

  /**
   * Draw the minimap. North (-z) is up. The view is a fixed full-city
   * frame so the marker, the chase and the shore all read at a glance.
   */
  drawMinimap(world) {
    const ctx = this.mapCtx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    const sx = (x) => ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * W;
    const sz = (z) => ((z - WORLD.minZ) / (260 - WORLD.minZ)) * H;

    // Land, sand and sea.
    ctx.fillStyle = '#2e3238';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e3c184';
    ctx.fillRect(0, sz(WORLD.sandZ), W, sz(WORLD.waterZ) - sz(WORLD.sandZ));
    ctx.fillStyle = '#20607e';
    ctx.fillRect(0, sz(WORLD.waterZ), W, H - sz(WORLD.waterZ));

    // Streets.
    ctx.strokeStyle = '#6a7076';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const x of ROAD_XS) {
      ctx.moveTo(sx(x), sz(WORLD.minZ));
      ctx.lineTo(sx(x), sz(148));
    }
    for (const z of ROAD_ZS) {
      ctx.moveTo(sx(WORLD.minX), sz(z));
      ctx.lineTo(sx(WORLD.maxX), sz(z));
    }
    ctx.stroke();

    // Traffic as pale dots.
    ctx.fillStyle = '#cfd8dc';
    for (const car of world.cars) {
      if (car.driver === 'police') continue;
      ctx.fillRect(sx(car.pos.x) - 1.5, sz(car.pos.z) - 1.5, 3, 3);
    }
    // Police flash red/blue.
    const phase = Math.floor(performance.now() / 280) % 2 === 0;
    ctx.fillStyle = phase ? '#ff3524' : '#3a6bff';
    for (const cop of world.wanted.police) {
      if (cop.driver !== 'police') continue;
      ctx.beginPath();
      ctx.arc(sx(cop.pos.x), sz(cop.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // The mission marker pulses gold.
    const marker = world.missions.markerPoint(world);
    if (marker) {
      const pulse = 3.4 + Math.sin(performance.now() * 0.006) * 1.1;
      ctx.strokeStyle = '#ffc93c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(marker.x), sz(marker.z), pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc93c';
      ctx.fillRect(sx(marker.x) - 1, sz(marker.z) - 1, 2, 2);
    }

    // Rook's arrow.
    const p = world.player.focusPos();
    const heading = world.player.state === 'driving' && world.player.car
      ? world.player.car.heading
      : world.player.heading;
    ctx.save();
    ctx.translate(sx(p.x), sz(p.z));
    // Canvas y runs with +z, so a world heading maps to rotation PI - heading
    // for an arrow drawn pointing up.
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
