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
  MAX_SPEED: 38,
  SPEED_RAMP: 0.32,         // units/sec added per second of running

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
  DIFFICULTY_DISTANCE: 1800, // metres to reach maximum difficulty
  TIER_SIZE: 300,

  // ---- scoring ----
  SCORE_PER_METRE: 1,
  COIN_SCORE: 10,
  GEM_SCORE: 50,
  RAMP_BONUS: 50,

  // ---- coins ----
  COIN_Y: 1.1,
  COIN_PICKUP_PAD: 0.4,
  MAGNET_PULL: 15,

  // ---- rogue-lite ----
  CHOICE_EVERY_M: 250,       // distance between upgrade choices
  CHOICE_COUNT: 3,           // upgrades offered per choice
  SHIELD_INVULN: 1.3,        // seconds of i-frames after a shield break

  // ---- rendering ----
  RENDER_HEIGHT: IS_COARSE ? 208 : 288, // internal buffer height -> chunky pixels
  MIN_RENDER_HEIGHT: 160,
  FOV: 60,
  // Flat enough to see a long way down the track — the player needs time to
  // read a row before reaching it.
  CAMERA_POS: [0, 3.5, 10.2],
  CAMERA_LOOK: [0, 1.7, -13],
  CAMERA_LANE_SWAY: 0.32,
  FOG_NEAR: 42,
  FOG_FAR: IS_COARSE ? 105 : 130,
  DRAW_DISTANCE: 210,
  MAX_PARTICLES: IS_COARSE ? 240 : 460,

  // ---- simulation ----
  MAX_FRAME_DT: 0.05,        // clamp so a backgrounded tab can't tunnel

  // ---- storage (score/mute only — never upgrades) ----
  KEY_BEST: 'deckrunner:best',
  KEY_MUTED: 'deckrunner:muted',
});

/** Fixed retro palette — every mesh in the game draws from this list. */
export const PAL = Object.freeze({
  // The sky stays deep so the fogged horizon reads as depth, but everything
  // the player has to react to sits well above it in value — a dark road on
  // a dark sky is unreadable at this render resolution.
  sky: 0x241a3d,
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
  building: [0x33285e, 0x3d3070, 0x5b4b9c, 0x46387f, 0x2c2252],
  window: 0xffe8a3,

  shield: 0x48cae4,
  magnet: 0xff70a6,
  hover: 0xb5e48c,
  multi: 0xffd166,
});
