'use strict';
/* Port Azura: Sunset Heat — shared utilities.
   A seeded RNG (so a given ?seed= always builds the same city), small math
   helpers, and a canvas-texture factory used for every procedural texture. */

window.PA = window.PA || {};

/* ---------------- seeded RNG (mulberry32) ---------------- */
PA.seed = 1;
PA.rngState = 1;
PA.setSeed = function (n) {
  PA.seed = (n >>> 0) || 1;
  PA.rngState = PA.seed;
};
PA.rand = function () {
  PA.rngState |= 0;
  PA.rngState = (PA.rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(PA.rngState ^ (PA.rngState >>> 15), 1 | PA.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
PA.randRange = function (a, b) { return a + PA.rand() * (b - a); };
PA.randInt = function (a, b) { return Math.floor(PA.randRange(a, b + 1)); };
PA.pick = function (arr) { return arr[Math.floor(PA.rand() * arr.length) % arr.length]; };

/* ---------------- math helpers ---------------- */
PA.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
PA.lerp = function (a, b, t) { return a + (b - a) * t; };
PA.dist2 = function (ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
PA.dist = function (ax, az, bx, bz) { return Math.sqrt(PA.dist2(ax, az, bx, bz)); };

/* Shortest-path angle interpolation, angles in radians. */
PA.angleLerp = function (a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
/* Heading convention: heading h means forward = (sin h, cos h) in xz. */
PA.headingTo = function (ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); };
PA.wrapAngle = function (a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/* ---------------- DOM + canvas helpers ---------------- */
PA.el = function (id) { return document.getElementById(id); };
PA.show = function (elm, on) { if (elm) elm.classList.toggle('hidden', !on); };

/* Build a THREE.CanvasTexture from a 2D draw callback. */
PA.canvasTexture = function (w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/* Query string (shot modes + seed) parsed once. */
PA.params = new URLSearchParams(window.location.search);
PA.setSeed(parseInt(PA.params.get('seed') || '1', 10) || 1);
