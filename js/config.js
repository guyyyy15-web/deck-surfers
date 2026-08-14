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

  // ---- near miss ----
  // Measured outward from the contact width, so a "dodge" is a lane squeeze
  // that genuinely nearly hit, and a "clear" is a jump or duck that passed
  // within NEAR_MISS_Y of the obstacle.
  NEAR_MISS_X: 1.9,
  NEAR_MISS_Y: 0.45,

  // ---- coins ----
  COIN_Y: 1.1,
  COIN_PICKUP_PAD: 0.4,
  MAGNET_PULL: 15,

  // ---- rogue-lite ----
  CHOICE_EVERY_M: 250,       // distance between upgrade choices
  CHOICE_COUNT: 3,           // upgrades offered per choice
  SHIELD_INVULN: 1.3,        // seconds of i-frames after a shield break

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
    weights: { barrier: 3, low: 3, high: 2, ramp: 2, rail: 1 },
  },
  {
    name: 'NIGHT RUN',
    skyTop: 0x060418, skyHorizon: 0x3b2a7a,
    weights: { barrier: 2, low: 2, high: 4, ramp: 1, rail: 2 },
  },
  {
    name: 'SUNRISE',
    skyTop: 0x2b1b4d, skyHorizon: 0xffa45c,
    weights: { barrier: 4, low: 2, high: 1, ramp: 3, rail: 2 },
  },
  {
    name: 'OVERPASS',
    skyTop: 0x0d2137, skyHorizon: 0x2fa8a0,
    weights: { barrier: 2, low: 4, high: 3, ramp: 2, rail: 3 },
  },
]);

/** The phase a given distance falls in. Cycles forever. */
export function phaseFor(distance) {
  return PHASES[Math.floor(distance / CFG.PHASE_LENGTH) % PHASES.length];
}

/** Fixed retro palette — every mesh in the game draws from this list. */
export const PAL = Object.freeze({
  // Dusk gradient: deep violet overhead falling to a hot magenta horizon.
  // Fog is matched to the horizon band so the street dissolves into the sky
  // instead of stopping at a hard line.
  skyTop: 0x150b32,
  skyHorizon: 0xa84776,
  sky: 0xa84776,
  ground: 0x6f68a6,
  groundAlt: 0x635c96,
  // Muted, so lane markings never get mistaken for gold pickups.
  stripe: 0xcdc6ee,
  curb: 0xa79ed8,

  skin: 0xffcf9e,
  shirt: 0xff5d5d,
  pants: 0x2b2d42,
  helmet: 0x4fd6ff,

  deck: 0x2ee6a8,
  truck: 0xadb5bd,
  wheel: 0x22223b,

  coin: 0xffd23f,
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
