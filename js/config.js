/**
 * config.js — every tunable number and colour in one place.
 *
 * Coordinate system: the track runs along -Z (into the screen). The player
 * stays at z = 0 and the world is positioned relative to `travelled`, the
 * total distance covered this run. An object placed at track distance
 * `worldZ` is drawn at scene z = -(worldZ - travelled), so it slides toward
 * the camera as `travelled` grows. Collision therefore happens in the same
 * space the meshes are drawn in — there is no second coordinate system.
 */

export const LANES = [-2.4, 0, 2.4];

/** One full turn. Tricks are all whole rotations, so this reads better. */
const TAU = Math.PI * 2;

export const IS_COARSE =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const CFG = Object.freeze({
  LANES,
  LANE_COUNT: LANES.length,
  LANE_DAMP: 14,            // exponential damping toward the target lane
  LANE_SETTLE: 0.16,        // seconds a lane change realistically takes

  // ---- speed ----
  BASE_SPEED: 14,           // world units / second at the start of a run
  MAX_SPEED: 38,            // cap reached by the time-based ramp alone
  SPEED_RAMP: 0.32,         // units/sec added per second of running
  // Past DIFFICULTY_DISTANCE the cap itself keeps creeping, so a run never
  // reaches a state where nothing can get harder. Slow enough (+1 u/s per
  // ENDLESS_SPEED_DIV metres) that it never reads as a wall.
  ENDLESS_SPEED_DIV: 900,
  ABSOLUTE_MAX_SPEED: 50,   // hard stop; see SUBSTEP_DT for why it matters

  // ---- jumping ----
  GRAVITY: 25,
  JUMP_V: 10.5,             // ~2.2 unit peak, ~0.84s airtime
  AIR_JUMP_MULT: 0.9,
  HOVER_GRAVITY_MULT: 0.6,
  HOVER_HEIGHT: 0.75,
  JUMP_BUFFER: 0.12,        // early press still fires on landing
  COYOTE_TIME: 0.1,         // late press still works just after leaving ground
  RAMP_LAUNCH_V: 13.5,
  FAST_FALL_V: -17,

  // ---- ducking ----
  // ---- animation ----
  LAND_SQUASH_TIME: 0.28,   // how long the landing dip takes to decay

  // Rider skeleton. Shared by voxel.js (which builds the bones) and player.js
  // (which solves them), so the two can never drift apart.
  //
  // THIGH + SHIN (0.68) is deliberately LONGER than the hip-to-ankle drop
  // (0.925 - 0.365 = 0.56). A leg just long enough to stand straight has no
  // length spare to reach fore and aft, and the solver spent it all clamping:
  // the feet came up short of the trucks and hovered above the deck. The extra
  // 0.12 is what lets him stand with his knees bent, like a skater, and still
  // put a foot on each end of the board.
  RIG: Object.freeze({
    HIP_Y: 0.925,
    THIGH: 0.36,
    SHIN: 0.32,
    ANKLE_Y: 0.365,         // deck top 0.245 + the shoe's 0.12
    // The skate twist, at the waist. Applied to the torso alone — putting it
    // on the whole body is what dragged the feet off the sides of the deck.
    TORSO_YAW: 1.13,        // ~65°
    // Where each sole lands along the board. Nose is -Z (direction of
    // travel), so the right foot is the front foot.
    FOOT_Z_FRONT: -0.52,
    FOOT_Z_BACK: 0.52,
    // Hip pivots stay near the pelvis; the legs splay out to the feet above.
    HIP_Z: 0.14,
  }),

  DUCK_MIN_TIME: 0.55,
  DUCK_TIME_BONUS: 0.3,     // per stack of Air Brake

  // ---- player hitbox (half extents) ----
  PLAYER_HALF_X: 0.42,
  PLAYER_HALF_Z: 0.42,
  STAND_HEIGHT: 1.7,
  DUCK_HEIGHT: 0.85,

  // ---- spawning ----
  SPAWN_AHEAD: 205,         // spawn objects up to this far down the track
  DESPAWN_Z: 16,            // recycle once an object is this far behind
  ROW_GAP_TIME_START: 0.95, // seconds between obstacle rows, early run
  ROW_GAP_TIME_MIN: 0.6,    // ...and at full difficulty
  JUMP_ROW_MIN_GAP: 1.05,   // never chain two jump-rows tighter than this
  SCENERY_GAP: 12,
  STRIPE_GAP: 6,
  GROUND_SLABS: 8,
  SLAB_LEN: 30,

  // ---- difficulty ----
  // `intensity()` in track.js ramps 0→1 over DIFFICULTY_DISTANCE and then
  // keeps creeping, unbounded, one extra "step" per ENDLESS_PERIOD. Density
  // and row pacing are driven by it, so the run never stops escalating.
  DIFFICULTY_DISTANCE: 1800,
  ENDLESS_PERIOD: 2600,
  TIER_SIZE: 300,           // unlocks obstacle *types* only
  DENSITY_MAX: 0.92,        // leaving 3 lanes fully blocked is the repair
                            // loop's job, not something to aim for
  ROW_GAP_TIME_FLOOR: 0.48, // below this a lane change (LANE_SETTLE) plus
                            // human reaction time stops being survivable

  // ---- phases ----
  PHASE_LENGTH: 750,        // metres per phase; PHASES cycles
  PHASE_FADE: 1.5,          // seconds to lerp sky + fog to the new palette

  // ---- scoring ----
  SCORE_PER_METRE: 1,
  COIN_SCORE: 10,
  GEM_SCORE: 50,
  RAMP_BONUS: 50,
  NEAR_MISS_SCORE: 25,

  // ---- combo ----
  // The combo multiplies *everything*, distance score included. That is the
  // point: sitting in a clear lane scores ×1, while a player who keeps
  // touching the track can reach ×4. Risk finally pays.
  COMBO_WINDOW: 2.5,        // seconds before the combo lapses
  COMBO_MULT_PER: 0.02,     // multiplier gained per combo point
  COMBO_MULT_MAX: 4,        // ...capped here (150 points to reach it)
  COMBO_COIN: 1,
  COMBO_GEM: 5,
  COMBO_RAMP: 3,
  COMBO_NEAR_MISS: 2,
  COMBO_MILESTONE: 25,      // burst + popup every N points

  // ---- rails & grinding ----
  // A grind lasts RAIL_LEN / speed seconds. At the old 7-unit length that was
  // 0.14s at full speed — over before the player registered it. 24 units puts
  // it at 0.5–0.9s across the whole speed range, which is long enough to read
  // as a trick rather than a bump.
  RAIL_LEN: 24,
  RAIL_HALF_LEN: 12,
  // A square handrail section. Deliberately narrower than the 0.72 deck: a
  // grind should look like balancing on an edge, not like riding a platform.
  RAIL_WIDTH: 0.26,
  RAIL_RIDE_Y: 1.75,        // top of the bar — where the board sits
  // Landing tolerance. The jump arc is above the rail while descending for
  // only ~0.19s, but the player may attach anywhere along the rail's length,
  // so the real window is the whole traversal. This just softens the edge.
  GRIND_SNAP: 0.35,
  // After stepping off deliberately the player is still directly above the
  // bar and descending, which is exactly the condition for mounting — without
  // a short lock-out, carving or dropping off would re-latch on the very next
  // substep and the rail would be impossible to leave.
  GRIND_REMOUNT_LOCK: 0.3,
  GRIND_SCORE_PER_SEC: 220,
  GRIND_MOUNT_SCORE: 40,
  GRIND_COMBO_INTERVAL: 0.25,   // combo +1 this often while riding

  // ---- air tricks ----
  // Paid only on a clean landing, so bailing mid-rotation is worth nothing.
  TRICK_SCORE: 120,
  TRICK_COMBO: 4,

  // ---- near miss ----
  // Measured outward from the contact width, so a "dodge" is a lane squeeze
  // that genuinely nearly hit, and a "clear" is a jump or duck that passed
  // within NEAR_MISS_Y of the obstacle.
  // Clearance beyond the contact envelope that still counts as a near miss.
  // A margin rather than an absolute distance, so a wide barrier and a narrow
  // rail both demand the same real closeness — see nearMissKind().
  NEAR_MISS_MARGIN: 0.53,
  NEAR_MISS_Y: 0.45,

  // ---- coins ----
  COIN_Y: 1.1,
  COIN_PICKUP_PAD: 0.4,
  MAGNET_PULL: 15,

  // ---- rogue-lite ----
  CHOICE_EVERY_M: 250,       // distance between upgrade choices
  CHOICE_COUNT: 3,           // upgrades offered per choice
  SHIELD_INVULN: 1.3,        // seconds of i-frames after a shield break
  // Longer than a shield's: a revive leaves the player standing inside the
  // thing that just killed them, so the i-frames must outlast it scrolling
  // clear — 1.6s is 80 units even at the absolute speed cap.
  REVIVE_INVULN: 1.6,

  // ---- rendering ----
  // Rendered at full device resolution. The chunky look now comes from the
  // geometry being made of boxes, not from throwing pixels away.
  MAX_DPR: 2,
  FOV: 60,
  // Flat enough to see a long way down the track — the player needs time to
  // read a row before reaching it.
  CAMERA_POS: [0, 3.5, 10.2],
  CAMERA_LOOK: [0, 1.7, -13],
  CAMERA_LANE_SWAY: 0.32,
  // Fog sits much further out than before: the old distances were tuned to
  // hide pop-in at a resolution where nothing was sharp enough to notice.
  FOG_NEAR: 65,
  FOG_FAR: IS_COARSE ? 150 : 195,
  DRAW_DISTANCE: 280,
  SHADOW_MAP: IS_COARSE ? 1024 : 2048,
  MAX_PARTICLES: IS_COARSE ? 240 : 460,

  // ---- simulation ----
  MAX_FRAME_DT: 0.05,        // clamp so a backgrounded tab can't tunnel
  // MAX_FRAME_DT alone is not enough. The window in which an obstacle and the
  // player overlap in z is 2 × (hz + PLAYER_HALF_Z) — only 1.28 units for the
  // thinnest obstacle, the gantry. At 50 u/s a single 0.05s frame advances
  // 2.5 units, so an obstacle could step clean over the player between two
  // collision tests. game.js therefore splits every frame into substeps of at
  // most this length, bounding travel per test to 1.0 units at the absolute
  // speed cap — inside the 1.28 window, so an overlap can never be skipped.
  // Chosen so a healthy 60fps frame (0.0167s) still takes exactly one step
  // and pays nothing: substepping only kicks in once frames get long, which
  // is precisely when it is needed.
  SUBSTEP_DT: 0.02,

  // ---- storage (score/mute only — never upgrades) ----
  // Deliberately still 'deckrunner:' after the rename to Deck Surfers —
  // changing the key would silently wipe every existing high score.
  KEY_BEST: 'deckrunner:best',
  KEY_MUTED: 'deckrunner:muted',
  KEY_BEST_DIST: 'deckrunner:bestdist',
});

/**
 * Run phases. Every CFG.PHASE_LENGTH metres the run moves to the next one and
 * cycles, changing both the palette and the mix of obstacles — so a long run
 * keeps changing texture instead of only changing numbers. No new meshes are
 * involved: the sky is already a gradient shader with two uniforms, and the
 * weights simply re-bias a pick the planner was already making.
 *
 * `weights` are relative, and are only consulted for types the current tier
 * has actually unlocked, so phases can never smuggle in an obstacle early.
 */
export const PHASES = Object.freeze([
  {
    name: 'DOWNTOWN',
    skyTop: 0x150b32, skyHorizon: 0xa84776,
    sun: 0xffd9a0, stars: 0.0, clouds: 0.55, sunHeight: 0.07, ambient: 1.6,
    weights: { barrier: 3, low: 3, high: 2, ramp: 2, rail: 1 },
  },
  {
    name: 'NIGHT RUN',
    skyTop: 0x060418, skyHorizon: 0x3b2a7a,
    // A pale moon, a sky full of stars and almost no cloud.
    sun: 0xdfe6ff, stars: 1.0, clouds: 0.18, sunHeight: 0.22, ambient: 0.85,
    weights: { barrier: 2, low: 2, high: 4, ramp: 1, rail: 2 },
  },
  {
    name: 'SUNRISE',
    skyTop: 0x2b1b4d, skyHorizon: 0xffa45c,
    // Big low sun, heavy cloud for it to catch.
    sun: 0xfff0c2, stars: 0.12, clouds: 0.8, sunHeight: 0.03, ambient: 1.75,
    weights: { barrier: 4, low: 2, high: 1, ramp: 3, rail: 2 },
  },
  {
    name: 'OVERPASS',
    skyTop: 0x0d2137, skyHorizon: 0x2fa8a0,
    sun: 0xc9fff2, stars: 0.35, clouds: 0.45, sunHeight: 0.12, ambient: 1.35,
    weights: { barrier: 2, low: 4, high: 3, ramp: 2, rail: 3 },
  },
]);

/**
 * Air tricks.
 *
 * The deck's long axis is Z and its cross axis is X, so real tricks map
 * straight onto the three rotations with no fudging:
 *
 *   z — roll about the length      → kickflip / heelflip
 *   y — spin flat about vertical   → shove-its
 *   x — end over end               → impossible
 *
 * `weight` biases the pick so the simple ones come up most; `dur` is how long
 * the rotation takes, and is what decides whether it can be completed before
 * touching down. A trick only pays out if it finishes before the wheels do.
 */
export const TRICKS = Object.freeze([
  { name: 'KICKFLIP', x: 0, y: 0, z: TAU, dur: 0.42, weight: 5 },
  { name: 'HEELFLIP', x: 0, y: 0, z: -TAU, dur: 0.42, weight: 4 },
  { name: 'POP SHOVE-IT', x: 0, y: -Math.PI, z: 0, dur: 0.36, weight: 4 },
  // `grab` marks the slow ones — only these have the hang time for a hand to
  // reach the deck and let go again before the wheels come down.
  { name: '360 SHOVE-IT', x: 0, y: -TAU, z: 0, dur: 0.5, weight: 2, grab: true },
  { name: 'TRE FLIP', x: 0, y: -TAU, z: TAU, dur: 0.55, weight: 1, grab: true },
  { name: 'IMPOSSIBLE', x: TAU, y: 0, z: 0, dur: 0.5, weight: 1, grab: true },
]);

/** When during a grabbing trick the hand is actually on the board. */
export const GRAB_WINDOW = Object.freeze({ from: 0.2, to: 0.75 });

/** Weighted pick from TRICKS. Uses Math.random — nothing here is replayed. */
export function pickTrick() {
  let total = 0;
  for (const t of TRICKS) total += t.weight;
  let r = Math.random() * total;
  for (const t of TRICKS) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return TRICKS[0];
}

/** The phase a given distance falls in. Cycles forever. */
export function phaseFor(distance) {
  return PHASES[Math.floor(distance / CFG.PHASE_LENGTH) % PHASES.length];
}

/**
 * Rider skins. Each one is nothing but a set of slot overrides — the rig in
 * voxel.js registers every mesh it builds under a slot name, and
 * `rig.applySkin()` recolours whole slots at once.
 *
 * Adding a skin therefore means adding data here and nothing else: no rig
 * changes, no new meshes, no new materials beyond what `mat()` already
 * caches. Slots left out keep their PAL default.
 *
 * Try them with `__RUNNER.setSkin('midnight')` in the console.
 */
export const SKINS = Object.freeze({
  classic: {},
  midnight: {
    skin: 0xd8a273, hair: 0x120c1e,
    shirt: 0x2f2a6b, shirtAlt: 0x211c52,
    pants: 0x161327, shoes: 0x4fd6ff, shoeSole: 0x2b2d42,
    cap: 0xff3d8e, pack: 0x120c1e, packStrap: 0x2f2a6b,
  },
  highlighter: {
    skin: 0x8d5524, hair: 0x1a1410,
    shirt: 0xd8ff3d, shirtAlt: 0xa8cc22,
    pants: 0x1f1f28, shoes: 0xff3d8e, shoeSole: 0xf2e9e4,
    cap: 0x1f1f28, pack: 0xff3d8e, packStrap: 0x1f1f28,
  },
});

/** Fixed retro palette — every mesh in the game draws from this list. */
export const PAL = Object.freeze({
  // Dusk gradient: deep violet overhead falling to a hot magenta horizon.
  // Fog is matched to the horizon band so the street dissolves into the sky
  // instead of stopping at a hard line.
  skyTop: 0x150b32,
  skyHorizon: 0xa84776,
  sky: 0xa84776,
  sun: 0xffd9a0,            // the disc itself; per-phase in PHASES
  ground: 0x6f68a6,
  groundAlt: 0x635c96,
  // Pavements and the ground beyond them. The verge is deliberately darker
  // than the road so the street reads as raised out of its surroundings.
  pavement: 0x8d86bf,
  verge: 0x453d78,
  // Muted, so lane markings never get mistaken for gold pickups.
  stripe: 0xcdc6ee,
  curb: 0xa79ed8,

  // ---- the rider ----
  // Each of these maps to a slot on the rig, so a skin is just a set of
  // overrides for some of them — see SKINS below.
  skin: 0xffcf9e,
  hair: 0x3b2a1f,
  shirt: 0xff5d5d,          // hoodie body
  shirtAlt: 0xd83c58,       // hood and sleeve cuffs, a shade down
  // Light enough to read against dark asphalt — the old near-black legs
  // disappeared into the road at night.
  pants: 0x454a78,
  shoes: 0xf2e9e4,
  shoeSole: 0x9d95c7,
  cap: 0x4fd6ff,
  pack: 0x3a3f8f,
  packStrap: 0x2b2d42,

  deck: 0x2ee6a8,
  grip: 0x1a1a24,           // grip tape, so the deck top isn't bare colour
  truck: 0xadb5bd,
  wheel: 0x22223b,

  coin: 0xffd23f,
  coinFace: 0xffe98a,       // proud inner face, lighter than the rim
  coinGlow: 0xffb020,       // emissive, so coins stay legible in NIGHT RUN
  gem: 0x4fd6ff,
  crate: 0xff9f1c,

  barrier: 0xff3d6e,
  barrierTrim: 0xf2e9e4,
  lowBlock: 0xffa62b,
  overhang: 0x8f86b8,
  overhangPost: 0x5b4b9c,
  ramp: 0x7bff5d,
  rail: 0x9d4edd,

  // Dark enough to recede behind the action, light enough to read as a city.
  building: [0x3f3277, 0x4c3c8c, 0x5f4ea3, 0x483a83, 0x372c68],
  window: 0xffe8a3,

  shield: 0x48cae4,
  magnet: 0xff70a6,
  hover: 0xb5e48c,
  multi: 0xffd166,
});
