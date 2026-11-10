/**
 * textures.js — every texture in the game, drawn into a canvas at runtime.
 *
 * The repo still ships zero binary assets: these are painted with 2D canvas
 * calls when the game boots, not loaded from files. Three rules keep them
 * consistent with the voxel look:
 *
 *  1. `NearestFilter` everywhere. Smooth filtering would fight the chunky
 *     geometry; crisp texels are the same aesthetic as crisp faces.
 *  2. Colour maps are greyscale *detail*, near-white with darker marks, and
 *     get multiplied by the palette colour on the material. That way the
 *     fixed palette in config.js still decides every hue, and alternating
 *     road slabs keep working.
 *  3. Anything that needs to be *brighter* than its surface — lit windows —
 *     goes in an emissive map instead, since a colour map can only darken.
 *
 * Everything is generated once and cached; a seeded RNG keeps the variants
 * identical between runs.
 */

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

const TEX_SIZE = 128;

function makeCanvas(size = TEX_SIZE) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Wrap a finished canvas as a texture with the house filtering rules. */
function toTexture(canvas, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* Road                                                                */
/* ------------------------------------------------------------------ */

let asphaltBase = null;

/**
 * Asphalt: coarse aggregate speckle, a few cracks and the odd repair patch.
 * Greyscale, so the road keeps whichever palette colour its slab was given.
 */
function buildAsphalt() {
  const rng = makeRng(0xa5f4);
  const c = makeCanvas();
  const g = c.getContext('2d');

  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Aggregate. Chunky 2px grains rather than per-pixel noise, so it survives
  // being minified down the length of the street instead of turning to mush.
  //
  // Kept deliberately low-contrast. The camera sits close to the road and an
  // earlier, punchier version read as stains on the tarmac rather than as
  // texture — at this scale a hint is all it takes.
  for (let i = 0; i < 2200; i++) {
    const v = 205 + Math.floor(rng.next() * 45);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.floor(rng.next() * TEX_SIZE), Math.floor(rng.next() * TEX_SIZE), 2, 2);
  }

  // Repair patches — barely-there rectangles, just enough to break the tiling.
  for (let i = 0; i < 4; i++) {
    const w = 18 + rng.next() * 40;
    const h = 14 + rng.next() * 30;
    g.fillStyle = `rgba(170,170,178,${0.05 + rng.next() * 0.05})`;
    g.fillRect(rng.next() * TEX_SIZE, rng.next() * TEX_SIZE, w, h);
  }

  // Cracks: short jagged polylines.
  g.strokeStyle = 'rgba(150,150,158,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = rng.next() * TEX_SIZE;
    let y = rng.next() * TEX_SIZE;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rng.next() - 0.5) * 26;
      y += (rng.next() - 0.5) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  return c;
}

/* ------------------------------------------------------------------ */
/* Pavement                                                            */
/* ------------------------------------------------------------------ */

let sidewalkBase = null;

/** Paving slabs: a grid of tiles with grouted joints and a little wear. */
function buildSidewalk() {
  const rng = makeRng(0x5eed);
  const c = makeCanvas();
  const g = c.getContext('2d');

  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const tile = TEX_SIZE / 4;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      // Each slab a slightly different shade, so the grid doesn't read as
      // a printed pattern.
      const v = 226 + Math.floor(rng.next() * 26);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(tx * tile + 1, ty * tile + 1, tile - 2, tile - 2);
    }
  }

  // Joints.
  g.strokeStyle = 'rgba(120,120,130,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = i * tile;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, TEX_SIZE); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(TEX_SIZE, p); g.stroke();
  }

  // Speckle.
  for (let i = 0; i < 700; i++) {
    const v = 180 + Math.floor(rng.next() * 60);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.floor(rng.next() * TEX_SIZE), Math.floor(rng.next() * TEX_SIZE), 2, 2);
  }

  return c;
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

const buildingCache = new Map();

/**
 * A tower face: concrete banding in the colour map, and the lit windows in a
 * separate emissive map so they genuinely glow against the dusk instead of
 * just being pale rectangles.
 */
function buildBuilding(variant) {
  const rng = makeRng(0xb01d + variant * 7919);
  const cols = 4 + (variant % 3);
  const rows = 8;

  const wall = makeCanvas();
  const wg = wall.getContext('2d');
  const lit = makeCanvas();
  const lg = lit.getContext('2d');

  wg.fillStyle = '#ededed';
  wg.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  lg.fillStyle = '#000000';
  lg.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Concrete grain and floor bands on the colour map.
  for (let i = 0; i < 900; i++) {
    const v = 190 + Math.floor(rng.next() * 55);
    wg.fillStyle = `rgba(${v},${v},${v},0.6)`;
    wg.fillRect(Math.floor(rng.next() * TEX_SIZE), Math.floor(rng.next() * TEX_SIZE), 2, 2);
  }

  const cw = TEX_SIZE / cols;
  const rh = TEX_SIZE / rows;
  const winW = cw * 0.52;
  const winH = rh * 0.42;

  for (let r = 0; r < rows; r++) {
    // A floor slab line between storeys.
    wg.fillStyle = 'rgba(140,140,150,0.45)';
    wg.fillRect(0, r * rh, TEX_SIZE, 2);

    for (let col = 0; col < cols; col++) {
      const x = col * cw + (cw - winW) / 2;
      const y = r * rh + (rh - winH) / 2 + 2;

      // Recessed frame in the colour map, whether or not the light is on.
      wg.fillStyle = 'rgba(105,105,120,0.85)';
      wg.fillRect(x, y, winW, winH);

      // About half the windows are lit, and lit ones vary in brightness.
      if (rng.chance(0.55)) {
        const b = 150 + Math.floor(rng.next() * 105);
        lg.fillStyle = `rgb(${b},${Math.floor(b * 0.93)},${Math.floor(b * 0.62)})`;
        lg.fillRect(x, y, winW, winH);
      }
    }
  }

  return {
    map: toTexture(wall),
    emissiveMap: toTexture(lit),
  };
}

/* ------------------------------------------------------------------ */
/* Cloud band                                                          */
/* ------------------------------------------------------------------ */

let cloudTex = null;

/**
 * The cloud layer, baked once instead of evaluated per pixel.
 *
 * One texture fetch replaces two octaves of value noise in the sky shader.
 * The measured saving turned out to be small — the sky's real cost is simply
 * being a full-screen shader — but painting clouds into a canvas gives much
 * better control over how they look than tuning noise thresholds does.
 *
 * The sky samples this as a dome projection, so it tiles on both axes and has
 * to be seamless on both: every blob is redrawn across whichever edges it
 * overlaps, giving nine placements in the corner case.
 */
function buildCloud() {
  const rng = makeRng(0xc10d);
  const S = 128;
  const c = makeCanvas(S);
  const g = c.getContext('2d');

  g.fillStyle = '#000000';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';

  const blob = (x, y, r, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };

  for (let i = 0; i < 70; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 9 + rng.next() * 26;
    const a = 0.16 + rng.next() * 0.28;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        // Only the wrapped copies that actually reach into the canvas.
        if (dx && Math.abs(x + dx - S / 2) > S / 2 + r) continue;
        if (dy && Math.abs(y + dy - S / 2) > S / 2 + r) continue;
        blob(x + dx, y + dy, r, a);
      }
    }
  }

  return c;
}

export function cloudTexture() {
  if (!cloudTex) {
    // Read as data, not colour — the shader samples .r as a mask, so an sRGB
    // transfer would skew it.
    // Repeats on both axes: the sky samples it as a dome projection rather
    // than a strip, so it tiles in Y as well.
    cloudTex = toTexture(buildCloud(), { srgb: false });
    cloudTex.generateMipmaps = false;
    cloudTex.minFilter = THREE.LinearFilter;
    cloudTex.magFilter = THREE.LinearFilter;
  }
  return cloudTex;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

const repeatCache = new Map();

/**
 * A texture instance with its own repeat. Clones share the underlying canvas
 * — only the sampling transform differs — so the extra instances are nearly
 * free, and they are cached by repeat anyway.
 */
function repeated(kind, canvas, rx, ry) {
  const key = `${kind}:${rx}x${ry}`;
  let t = repeatCache.get(key);
  if (!t) {
    t = toTexture(canvas);
    t.repeat.set(rx, ry);
    repeatCache.set(key, t);
  }
  return t;
}

export function asphaltTexture(rx = 1, ry = 1) {
  if (!asphaltBase) asphaltBase = buildAsphalt();
  return repeated('asphalt', asphaltBase, rx, ry);
}

export function sidewalkTexture(rx = 1, ry = 1) {
  if (!sidewalkBase) sidewalkBase = buildSidewalk();
  return repeated('sidewalk', sidewalkBase, rx, ry);
}

/** One of BUILDING_VARIANTS window layouts, as { map, emissiveMap }. */
export const BUILDING_VARIANTS = 4;

export function buildingTexture(variant) {
  const v = ((variant % BUILDING_VARIANTS) + BUILDING_VARIANTS) % BUILDING_VARIANTS;
  let t = buildingCache.get(v);
  if (!t) {
    t = buildBuilding(v);
    buildingCache.set(v, t);
  }
  return t;
}

export function textureCount() {
  return repeatCache.size + buildingCache.size * 2;
}
