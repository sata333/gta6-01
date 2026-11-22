// textures.js — every texture in Port Azura is painted on a canvas at load
// time: building facades with lit windows, asphalt, concrete, sand, grass,
// pier wood, shop signs and the mission-marker glyph. No image files, no
// network: the game is fully self-contained.

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')];
}

/** Paint a canvas with `draw(ctx, w, h)` and wrap it as a THREE texture. */
export function canvasTexture(width, height, draw, opts = {}) {
  const [canvas, ctx] = makeCanvas(width, height);
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (opts.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

/** Sprinkle noise flecks over a filled canvas to break up flat colour. */
function fleck(ctx, w, h, rng, count, colours, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[Math.floor(rng.next() * colours.length)];
    ctx.globalAlpha = 0.05 + rng.next() * 0.1;
    ctx.fillRect(rng.next() * w, rng.next() * h, size, size);
  }
  ctx.globalAlpha = 1;
}

/**
 * A building facade: coloured render, a grid of windows, some of them lit
 * warm for the sunset hour. Returns { map, emissiveMap } — the emissive map
 * is black except for the lit windows, so the lit windows alone glow.
 */
export function facadeTextures(rng, base) {
  const W = 128;
  const H = 256;
  const lit = [];
  const drawBase = (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, base);
    grad.addColorStop(1, shade(base, -18));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    fleck(ctx, W, H, rng, 260, ['#000000', '#ffffff'], 3);
  };
  const drawWindows = (ctx, litOnly) => {
    const cols = 8;
    const rows = 16;
    const cw = W / cols;
    const ch = H / rows;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const isLit = lit[x * rows + y];
        if (litOnly && !isLit) continue;
        if (!litOnly && isLit) continue;
        ctx.fillStyle = litOnly ? '#ffb45e' : '#232c38';
        ctx.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
        if (litOnly) {
          ctx.fillStyle = 'rgba(255, 220, 160, 0.55)';
          ctx.fillRect(x * cw + 3, y * ch + 4, cw - 6, 3);
        }
      }
    }
  };
  for (let i = 0; i < 8 * 16; i++) lit.push(rng.chance(0.42));
  const map = canvasTexture(W, H, (ctx) => {
    drawBase(ctx);
    drawWindows(ctx, false);
    drawWindows(ctx, true);
  });
  const emissiveMap = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    drawWindows(ctx, true);
  });
  return { map, emissiveMap };
}

/** Darken or lighten a #rrggbb colour by amt (-255..255). */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

/** Asphalt for the street plane. */
export function asphaltTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#41464e';
      ctx.fillRect(0, 0, w, h);
      fleck(ctx, w, h, rng, 2400, ['#2e3238', '#525860', '#6a6055'], 2);
    },
    { repeat: [30, 24] },
  );
}

/** Pale concrete for block slabs and sidewalks. */
export function concreteTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#9aa0a2';
      ctx.fillRect(0, 0, w, h);
      fleck(ctx, w, h, rng, 1500, ['#868c8e', '#aeb4b6', '#7c8284'], 2);
      ctx.strokeStyle = 'rgba(70, 74, 76, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    },
    { repeat: [3, 3] },
  );
}

/** Beach sand. */
export function sandTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#e3c184';
      ctx.fillRect(0, 0, w, h);
      fleck(ctx, w, h, rng, 2200, ['#cfa968', '#f2d9a4', '#b8934f'], 2);
    },
    { repeat: [18, 3] },
  );
}

/** Park grass. */
export function grassTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#59864a';
      ctx.fillRect(0, 0, w, h);
      fleck(ctx, w, h, rng, 2600, ['#49743c', '#6b9a58', '#3d6633'], 3);
    },
    { repeat: [4, 4] },
  );
}

/** Weathered planks for the marina pier. */
export function woodTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#8a6844';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) {
        ctx.fillStyle = 'rgba(60, 40, 20, 0.55)';
        ctx.fillRect(0, y, w, 3);
        fleck(ctx, w, 30, rng, 60, ['#75552f', '#9c774e'], 3);
        ctx.save();
        ctx.translate(0, y);
        ctx.restore();
      }
    },
    { repeat: [4, 6] },
  );
}

/** Sunset water: deep teal with sun-streak highlights. Animated by offset. */
export function waterTexture(rng) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#20607e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 130; i++) {
        const y = rng.next() * h;
        const len = 12 + rng.next() * 46;
        ctx.fillStyle = rng.chance(0.4) ? 'rgba(255, 178, 105, 0.5)' : 'rgba(140, 205, 225, 0.35)';
        ctx.fillRect(rng.next() * w, y, len, 2);
      }
    },
    { repeat: [10, 6] },
  );
}

/** A building sign: bold lettering on a painted board. */
export function signTexture(text, bg, fg) {
  return canvasTexture(512, 112, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = fg;
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

/** The floating glyph drawn on mission markers: a ring with an "!". */
export function markerGlyphTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(20, 16, 8, 0.72)';
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffc93c';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffc93c';
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 64, 68);
  });
}
