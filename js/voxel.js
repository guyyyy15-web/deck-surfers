/**
 * voxel.js — every mesh in the game is built here.
 *
 * Two rules keep the look cohesive and the draw cost flat:
 *  1. One shared unit BoxGeometry, scaled per mesh. Geometry count stays ~4
 *     no matter how much is on screen.
 *  2. Materials are cached per colour and always flat-shaded Lambert, so
 *     lighting reads as crisp per-face banding — the voxel look. No textures
 *     anywhere, which is also why this game ships zero binary assets.
 */

import * as THREE from '../vendor/three.module.min.js';
import { PAL, CFG } from './config.js';
import {
  asphaltTexture, sidewalkTexture, buildingTexture, BUILDING_VARIANTS,
} from './textures.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
// 12 sides rather than 6: still visibly faceted, but it catches the light as
// it spins instead of flicking between three flat shades.
const COIN_GEO = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12);
const COIN_FACE_GEO = new THREE.CylinderGeometry(0.29, 0.29, 0.14, 12);
const GEM_GEO = new THREE.OctahedronGeometry(0.42, 0);

const matCache = new Map();

/** Cached flat-shaded Lambert material. */
export function mat(hex, opts) {
  const key = opts ? `${hex}|${JSON.stringify(opts)}` : String(hex);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...opts });
    matCache.set(key, m);
  }
  return m;
}

/**
 * Cached material carrying a texture. Kept separate from `mat()` because that
 * one is keyed by colour alone, and two surfaces can share a colour while
 * needing different maps or tiling.
 */
const texMatCache = new Map();

export function texMat(hex, maps, opts) {
  const key = `${hex}|${maps.map ? maps.map.uuid : '-'}|${maps.emissiveMap ? maps.emissiveMap.uuid : '-'}|${opts ? JSON.stringify(opts) : ''}`;
  let m = texMatCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: hex,
      flatShading: true,
      map: maps.map || null,
      emissiveMap: maps.emissiveMap || null,
      emissive: maps.emissiveMap ? new THREE.Color(maps.emissive ?? 0xffffff) : new THREE.Color(0x000000),
      ...opts,
    });
    texMatCache.set(key, m);
  }
  return m;
}

/** A box of the given size/colour, built from the shared unit geometry. */
export function makeMesh(w, h, d, hex, opts) {
  const m = new THREE.Mesh(UNIT_BOX, mat(hex, opts));
  m.scale.set(w, h, d);
  return m;
}

/** As makeMesh, but with a texture map (and optionally an emissive one). */
function addTexBox(parent, w, h, d, hex, maps, x, y, z) {
  const m = new THREE.Mesh(UNIT_BOX, texMat(hex, maps));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function addBox(parent, w, h, d, hex, x, y, z, opts) {
  const m = makeMesh(w, h, d, hex, opts);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * Set shadow flags across a whole subtree. Applied centrally in each builder
 * so a newly added box can't silently miss out and float shadowless.
 */
export function setShadow(obj, cast, receive) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

export function geometryCount() {
  return 3;
}
export function materialCount() {
  return matCache.size;
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

/**
 * Voxel skater on a modular board. Every part is a named handle so the
 * player controller can animate it procedurally — there are no keyframes
 * and no skinned meshes.
 */
export function buildPlayer() {
  const root = new THREE.Group();

  // --- board (its own group so it can spin independently on air jumps) ---
  const board = new THREE.Group();
  const deck = addBox(board, 0.72, 0.09, 1.95, PAL.deck, 0, 0.2, 0);
  addBox(board, 0.5, 0.09, 0.2, PAL.truck, 0, 0.13, 0.62);
  addBox(board, 0.5, 0.09, 0.2, PAL.truck, 0, 0.13, -0.62);
  const wheels = [
    addBox(board, 0.17, 0.17, 0.17, PAL.wheel, 0.28, 0.085, 0.62),
    addBox(board, 0.17, 0.17, 0.17, PAL.wheel, -0.28, 0.085, 0.62),
    addBox(board, 0.17, 0.17, 0.17, PAL.wheel, 0.28, 0.085, -0.62),
    addBox(board, 0.17, 0.17, 0.17, PAL.wheel, -0.28, 0.085, -0.62),
  ];
  root.add(board);

  // --- rider ---
  const body = new THREE.Group();
  const torso = addBox(body, 0.54, 0.5, 0.32, PAL.shirt, 0, 0.96, 0);
  const head = addBox(body, 0.35, 0.35, 0.35, PAL.skin, 0, 1.4, 0);
  addBox(body, 0.41, 0.16, 0.41, PAL.helmet, 0, 1.62, 0);
  addBox(body, 0.41, 0.1, 0.16, PAL.helmet, 0, 1.55, 0.2);

  // Limbs hang from a pivot group at the shoulder/hip, so rotating the group
  // swings the limb from its joint instead of spinning it about its middle.
  function limb(w, h, d, hex, x, jointY, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, jointY, z);
    addBox(pivot, w, h, d, hex, 0, -h / 2, 0);
    body.add(pivot);
    return pivot;
  }
  const legL = limb(0.21, 0.46, 0.24, PAL.pants, 0.16, 0.71, -0.16);
  const legR = limb(0.21, 0.46, 0.24, PAL.pants, -0.16, 0.71, 0.2);
  const armL = limb(0.15, 0.44, 0.17, PAL.skin, 0.36, 1.18, 0);
  const armR = limb(0.15, 0.44, 0.17, PAL.skin, -0.36, 1.18, 0);

  root.add(body);

  // --- upgrade visuals, created once and toggled with .visible ---
  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.15, 1),
    new THREE.MeshBasicMaterial({
      color: PAL.shield, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false,
    })
  );
  shield.position.y = 0.95;
  shield.visible = false;
  root.add(shield);

  const hoverRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.07, 4, 8),
    new THREE.MeshBasicMaterial({ color: PAL.hover, transparent: true, opacity: 0.8, depthWrite: false })
  );
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.position.y = 0.05;
  hoverRing.visible = false;
  root.add(hoverRing);

  const magnetRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.05, 4, 10),
    new THREE.MeshBasicMaterial({ color: PAL.magnet, transparent: true, opacity: 0.5, depthWrite: false })
  );
  magnetRing.rotation.x = Math.PI / 2;
  magnetRing.position.y = 0.6;
  magnetRing.visible = false;
  root.add(magnetRing);

  // The skater casts a real shadow now, so there is no fake blob quad.
  // The upgrade rings/bubble are unlit overlays and deliberately cast nothing.
  setShadow(board, true, false);
  setShadow(body, true, false);

  return {
    root, board, deck, wheels, body,
    legL, legR, torso, armL, armR, head,
    shield, hoverRing, magnetRing,
  };
}

/* ------------------------------------------------------------------ */
/* Obstacles                                                           */
/* ------------------------------------------------------------------ */

/**
 * Obstacle groups carry their own AABB in userData:
 *   { type, hx, hz, yMin, yMax }
 * Collision reads only those numbers, so hitboxes never drift from visuals.
 */
export function buildObstacle(type) {
  const g = new THREE.Group();

  if (type === 'barrier') {
    addBox(g, 1.85, 2.4, 0.55, PAL.barrier, 0, 1.2, 0);
    addBox(g, 1.95, 0.22, 0.62, PAL.barrierTrim, 0, 2.2, 0);
    addBox(g, 1.95, 0.22, 0.62, PAL.barrierTrim, 0, 0.5, 0);
    g.userData = { type, hx: 0.95, hz: 0.32, yMin: 0, yMax: 2.4 };
  } else if (type === 'low') {
    addBox(g, 1.8, 0.95, 0.85, PAL.lowBlock, 0, 0.475, 0);
    addBox(g, 1.9, 0.16, 0.95, PAL.barrierTrim, 0, 0.95, 0);
    g.userData = { type, hx: 0.92, hz: 0.48, yMin: 0, yMax: 1.0 };
  } else if (type === 'high') {
    // Gantry: legs are outside the lane, the bar hangs at head height.
    addBox(g, 1.9, 1.45, 0.4, PAL.overhang, 0, 1.98, 0);
    addBox(g, 0.22, 2.7, 0.3, PAL.overhangPost, 1.05, 1.35, 0);
    addBox(g, 0.22, 2.7, 0.3, PAL.overhangPost, -1.05, 1.35, 0);
    g.userData = { type, hx: 0.95, hz: 0.22, yMin: 1.25, yMax: 2.7 };
  } else if (type === 'ramp') {
    // Stepped wedge — reads as a ramp in voxel style, launches an ollie.
    for (let i = 0; i < 5; i++) {
      addBox(g, 1.8, 0.2, 0.42, PAL.ramp, 0, 0.1 + i * 0.18, 0.8 - i * 0.42);
    }
    g.userData = { type, hx: 0.9, hz: 0.9, yMin: 0, yMax: 1.0, harmless: true };
  } else if (type === 'rail') {
    // Long enough to actually grind — see CFG.RAIL_LEN. The bar is lethal
    // from the side; landing on top of it is what collision.js treats
    // specially, and `rideY` is derived from the same numbers that draw the
    // bar so the ride surface can't drift from the mesh.
    const len = CFG.RAIL_LEN;
    const half = len / 2;
    addBox(g, 1.7, 0.3, len, PAL.rail, 0, 1.6, 0);
    for (let z = -half; z <= half + 0.01; z += 6) {
      addBox(g, 0.18, 1.6, 0.18, PAL.overhangPost, 0, 0.8, z);
    }
    g.userData = {
      type, hx: 0.85, hz: half, yMin: 0, yMax: 1.9,
      grindable: true,
      rideY: 1.6 + 0.3 / 2,
    };
  }

  return setShadow(g, true, true);
}

/**
 * A coin is a rim plus a slightly proud inner face, so it reads as struck
 * metal rather than a flat disc. Both parts are emissive enough to stay
 * legible once the fog and the darker phases take the ambient light down.
 */
export function buildCoin() {
  const g = new THREE.Group();

  const rim = new THREE.Mesh(COIN_GEO, mat(PAL.coin, {
    emissive: PAL.coinGlow, emissiveIntensity: 0.45,
  }));
  g.add(rim);

  const face = new THREE.Mesh(COIN_FACE_GEO, mat(PAL.coinFace, {
    emissive: PAL.coinGlow, emissiveIntensity: 0.7,
  }));
  g.add(face);

  g.rotation.x = Math.PI / 2;
  g.userData = { type: 'coin' };
  return setShadow(g, true, false);
}

export function buildGem() {
  const m = new THREE.Mesh(GEM_GEO, mat(PAL.gem, {
    emissive: PAL.gem, emissiveIntensity: 0.5,
  }));
  m.userData = { type: 'gem' };
  m.castShadow = true;
  return m;
}

export function buildCrate() {
  const g = new THREE.Group();
  addBox(g, 0.9, 0.9, 0.9, PAL.crate, 0, 0, 0);
  addBox(g, 1.0, 0.14, 0.14, PAL.barrierTrim, 0, 0, 0);
  addBox(g, 0.14, 1.0, 0.14, PAL.barrierTrim, 0, 0, 0);
  g.userData = { type: 'crate' };
  return setShadow(g, true, true);
}

/* ------------------------------------------------------------------ */
/* Scenery + ground                                                    */
/* ------------------------------------------------------------------ */

export function buildScenery(kind, rng) {
  const g = new THREE.Group();

  if (kind === 'tower') {
    const h = rng.range(7, 18);
    const w = rng.range(2.4, 4.2);
    const colour = rng.pick(PAL.building);
    const variant = rng.int(BUILDING_VARIANTS);
    const tex = buildingTexture(variant);

    // One textured box instead of the old stack of window-band boxes. That is
    // both far more detail *and* fewer draw calls — a tall tower used to cost
    // up to 17 meshes and now costs one, plus its roof furniture. Lit windows
    // live in the emissive map because a colour map can only darken.
    addTexBox(g, w, h, w, colour, {
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: PAL.window,
    }, 0, h / 2, 0);

    // Roof furniture, for silhouette variety against the sky.
    const roof = rng.int(3);
    if (roof === 0) {
      addBox(g, w * 0.34, 0.9, w * 0.34, PAL.overhangPost, w * 0.22, h + 0.45, -w * 0.18);
    } else if (roof === 1) {
      addBox(g, 0.12, rng.range(1.4, 2.8), 0.12, PAL.overhangPost, 0, h + 1.2, 0);
      addBox(g, 0.7, 0.12, 0.12, PAL.overhangPost, 0, h + 1.9, 0);
    } else {
      addBox(g, w * 0.8, 0.28, w * 0.8, PAL.curb, 0, h + 0.14, 0);
    }
  } else if (kind === 'lamp') {
    addBox(g, 0.2, 4.2, 0.2, PAL.curb, 0, 2.1, 0);
    addBox(g, 1.1, 0.18, 0.2, PAL.curb, 0.45, 4.1, 0);
    addBox(g, 0.5, 0.2, 0.4, PAL.window, 0.85, 3.95, 0);
  } else if (kind === 'billboard') {
    addBox(g, 0.18, 2.6, 0.18, PAL.overhangPost, 0, 1.3, 0);
    addBox(g, 3.0, 1.7, 0.16, rng.pick(PAL.building), 0, 3.3, 0);
    addBox(g, 2.6, 0.3, 0.22, PAL.window, 0, 3.6, 0);
    addBox(g, 1.8, 0.3, 0.22, PAL.window, -0.3, 3.1, 0);
  }

  return setShadow(g, true, false);
}

/** One recycled slab of road: surface, curbs and lane stripes. */
export function buildGroundSlab(shadeAlt) {
  const g = new THREE.Group();
  const len = CFG.SLAB_LEN;

  // Road surface. The texture is greyscale detail multiplied by the palette
  // colour, so the alternating slab shades still work.
  addTexBox(
    g, 9, 0.5, len, shadeAlt ? PAL.groundAlt : PAL.ground,
    // Tiled finely: a coarse tile puts metre-wide blotches right under the
    // camera, where the road is most magnified.
    { map: asphaltTexture(3, Math.round(len / 2.5)) },
    0, -0.25, 0
  );

  addBox(g, 0.5, 0.55, len, PAL.curb, 4.5, 0.02, 0);
  addBox(g, 0.5, 0.55, len, PAL.curb, -4.5, 0.02, 0);

  // Pavements and the ground beyond them. These matter more than they look:
  // without them the road was a 9-unit ribbon with nothing either side, which
  // is most of why the world read as empty. Four boxes per slab buy a street
  // that has edges.
  for (const side of [-1, 1]) {
    addTexBox(
      g, 4.4, 0.44, len, PAL.pavement,
      { map: sidewalkTexture(1, Math.round(len / 6)) },
      side * 6.95, -0.08, 0
    );
    addBox(g, 14, 0.4, len, PAL.verge, side * 16, -0.4, 0);
  }

  const stripes = Math.floor(len / CFG.STRIPE_GAP);
  for (let i = 0; i < stripes; i++) {
    const z = -len / 2 + i * CFG.STRIPE_GAP + CFG.STRIPE_GAP / 2;
    addBox(g, 0.14, 0.02, 2.2, PAL.stripe, 1.2, 0.005, z);
    addBox(g, 0.14, 0.02, 2.2, PAL.stripe, -1.2, 0.005, z);
  }

  return setShadow(g, false, true);
}
