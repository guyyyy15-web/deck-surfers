/**
 * track.js — procedural street generator.
 *
 * Rows of obstacles are planned in a pure function (`planRow`) and only then
 * turned into meshes. That split is what makes the fairness guarantee
 * testable: `selfTest()` runs thousands of rows through the identical
 * planner with a fixed seed and asserts that none of them is unwinnable.
 *
 * Every mesh comes from a pool and is positioned from its `worldZ` each
 * frame, so nothing is allocated once the pools are warm.
 */

import { CFG, LANES, phaseFor } from './config.js';
import { createPool } from './pool.js';
import { buildObstacle, buildCoin, buildGem, buildCrate, buildScenery } from './voxel.js';

/** Obstacle types the player can pass without leaving the lane. */
const PASSABLE = new Set(['low', 'high', 'ramp']);
/** Types that force a lane change. */
const DODGE_ONLY = new Set(['barrier', 'rail']);

const TYPES_BY_TIER = [
  ['barrier', 'low'],
  ['barrier', 'low', 'high'],
  ['barrier', 'low', 'high', 'ramp'],
  ['barrier', 'low', 'high', 'ramp', 'rail'],
];

function typesForTier(tier) {
  return TYPES_BY_TIER[Math.min(tier, TYPES_BY_TIER.length - 1)];
}

/** Lanes the player can occupy and survive in this row. */
function passableLanes(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null || PASSABLE.has(slots[i])) out.push(i);
  }
  return out;
}

/**
 * Is this row survivable given where the player could have been?
 * Returns null when fine, or a string reason when not.
 */
export function validateRow(slots, prevPassable, maxShift, allowJump) {
  const passable = passableLanes(slots);
  if (passable.length === 0) return 'no-passable-lane';

  // At least one survivable lane must be within reach of a lane the player
  // could actually have been standing in.
  if (prevPassable && prevPassable.length) {
    const reachable = passable.some((q) =>
      prevPassable.some((p) => Math.abs(p - q) <= maxShift)
    );
    if (!reachable) return 'unreachable';
  }

  // Don't demand a jump too soon after the last one — the player would still
  // be in the air from the previous row.
  if (!allowJump) {
    const withoutJump = passable.filter((i) => slots[i] !== 'low');
    if (withoutJump.length === 0) return 'jump-too-soon';
  }

  return null;
}

export function createTrackGenerator(scene, rng) {
  /* ---------------- pools ---------------- */

  const hide = (m) => { m.visible = false; };
  const show = (m) => { m.visible = true; };

  const obstaclePools = {};
  for (const type of ['barrier', 'low', 'high', 'ramp', 'rail']) {
    obstaclePools[type] = createPool(() => {
      const m = buildObstacle(type);
      scene.add(m);
      return m;
    }, { onAcquire: show, onRelease: hide });
  }

  const coinPool = createPool(() => {
    const m = buildCoin();
    scene.add(m);
    return m;
  }, { onAcquire: show, onRelease: hide });

  const gemPool = createPool(() => {
    const m = buildGem();
    scene.add(m);
    return m;
  }, { onAcquire: show, onRelease: hide });

  const cratePool = createPool(() => {
    const m = buildCrate();
    scene.add(m);
    return m;
  }, { onAcquire: show, onRelease: hide });

  const sceneryPools = {};
  for (const kind of ['tower', 'lamp', 'billboard']) {
    sceneryPools[kind] = createPool(() => {
      const m = buildScenery(kind, rng);
      scene.add(m);
      return m;
    }, { onAcquire: show, onRelease: hide });
  }

  const obstacles = [];     // active obstacle meshes
  const collectibles = [];  // active coins / gems / crates
  const scenery = [];

  /* ---------------- planner state ---------------- */

  let nextRowZ = 60;        // give the player a clear run-up
  let nextSceneryZ = 20;
  let prevPassable = [0, 1, 2];
  let prevRequiredJump = false;
  let prevRowZ = 0;
  let lastCrateZ = 0;
  let repairs = 0;

  function tierFor(distance) {
    return Math.min(5, Math.floor(distance / CFG.TIER_SIZE));
  }

  /**
   * How hard the street should be right now. Ramps 0→1 over
   * DIFFICULTY_DISTANCE and then keeps climbing, unbounded, so there is no
   * distance at which the game stops getting harder. Everything that paces a
   * row — density and gap — reads from this rather than from the capped tier.
   */
  function intensity(distance) {
    const ramp = Math.min(1, distance / CFG.DIFFICULTY_DISTANCE);
    const endless = Math.max(0, (distance - CFG.DIFFICULTY_DISTANCE) / CFG.ENDLESS_PERIOD);
    return ramp + endless;
  }

  function rowGapTime(inten) {
    const t = Math.min(1, inten);
    const base = CFG.ROW_GAP_TIME_START + (CFG.ROW_GAP_TIME_MIN - CFG.ROW_GAP_TIME_START) * t;
    // Past the ramp the gap keeps tightening, but only down to a floor a
    // human can still act inside.
    const endless = Math.max(0, inten - 1) * 0.06;
    return Math.max(CFG.ROW_GAP_TIME_FLOOR, base - endless);
  }

  /**
   * Plan one row. Pure: no meshes, no scene access — just lane slots.
   * Returns { slots, passable, requiredJump, repaired }.
   */
  function planRow(worldZ, tier, speed, state, inten = 1, phase = null) {
    const gapTime = speed > 0 ? (worldZ - state.prevRowZ) / speed : 1;
    const maxShift = Math.max(0, Math.min(2, Math.floor(gapTime / CFG.LANE_SETTLE)));
    const allowJump = !state.prevRequiredJump || gapTime >= CFG.JUMP_ROW_MIN_GAP;

    const types = typesForTier(tier);
    const density = Math.min(CFG.DENSITY_MAX, 0.4 + inten * 0.45);
    // The phase re-biases which of the *already unlocked* types get picked,
    // so a phase can never smuggle in an obstacle the tier hasn't reached.
    const pickType = phase
      ? () => rng.weighted(types, (t) => phase.weights[t] || 1)
      : () => rng.pick(types);

    // Start from a lane the player can actually get to, and keep it clear.
    const candidates = [0, 1, 2].filter((l) =>
      state.prevPassable.some((p) => Math.abs(p - l) <= maxShift)
    );
    const safeLane = candidates.length
      ? rng.pick(candidates)
      : rng.int(LANES.length);

    const slots = [null, null, null];
    for (let lane = 0; lane < LANES.length; lane++) {
      if (lane === safeLane) continue;
      if (!rng.chance(density)) continue;
      let type = pickType();
      if (type === 'low' && !allowJump) type = 'barrier';
      // Rails are long; only ever one per row and never next to the safe lane
      // at low tiers, where the player has less room to read them.
      if (type === 'rail' && (slots.includes('rail') || tier < 3)) type = 'barrier';
      slots[lane] = type;
    }

    // Occasionally reward the safe lane with something jumpable instead of
    // leaving it empty, so rows don't all read the same.
    if (allowJump && tier >= 2 && rng.chance(0.18)) {
      slots[safeLane] = rng.chance(0.5) ? 'ramp' : 'low';
    }

    // --- validate, and repair rather than ship something unwinnable ---
    let repaired = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const reason = validateRow(slots, state.prevPassable, maxShift, allowJump);
      if (!reason) break;
      repaired++;
      if (reason === 'jump-too-soon') {
        const lane = passableLanes(slots).find((i) => slots[i] === 'low');
        slots[lane === undefined ? safeLane : lane] = null;
      } else if (reason === 'unreachable') {
        // Open the lane closest to somewhere the player could have been.
        let best = safeLane;
        let bestDist = Infinity;
        for (let l = 0; l < LANES.length; l++) {
          for (const p of state.prevPassable) {
            const d = Math.abs(p - l);
            if (d < bestDist) { bestDist = d; best = l; }
          }
        }
        slots[best] = null;
      } else {
        slots[rng.int(LANES.length)] = null;
      }
    }

    const passable = passableLanes(slots);
    const requiredJump = passable.length > 0 && passable.every((i) => slots[i] === 'low');

    return { slots, passable, requiredJump, repaired, safeLane };
  }

  /* ---------------- instantiation ---------------- */

  function placeObstacle(type, lane, worldZ) {
    const mesh = obstaclePools[type].acquire();
    mesh.position.x = LANES[lane];
    mesh.userData.worldZ = worldZ;
    mesh.userData.lane = lane;
    mesh.userData.dead = false;
    // Cleared once the obstacle is behind the player, so a near miss can only
    // ever be scored once per obstacle per pass.
    mesh.userData.passed = false;
    // Ramps latch `used` when they launch the player. Without clearing it on
    // acquire, every ramp in the pool would fire exactly once per run and
    // then be inert scenery for the rest of it.
    mesh.userData.used = false;
    obstacles.push(mesh);
    return mesh;
  }

  function placeCoin(lane, worldZ, y) {
    const mesh = coinPool.acquire();
    mesh.position.x = LANES[lane];
    mesh.position.y = y;
    mesh.userData.worldZ = worldZ;
    mesh.userData.kind = 'coin';
    mesh.userData.pool = coinPool;
    mesh.userData.homeX = LANES[lane];
    collectibles.push(mesh);
    return mesh;
  }

  function placeGem(lane, worldZ) {
    const mesh = gemPool.acquire();
    mesh.position.x = LANES[lane];
    mesh.position.y = CFG.COIN_Y + 0.2;
    mesh.userData.worldZ = worldZ;
    mesh.userData.kind = 'gem';
    mesh.userData.pool = gemPool;
    mesh.userData.homeX = LANES[lane];
    collectibles.push(mesh);
    return mesh;
  }

  function placeCrate(lane, worldZ) {
    const mesh = cratePool.acquire();
    mesh.position.x = LANES[lane];
    mesh.position.y = 1.0;
    mesh.userData.worldZ = worldZ;
    mesh.userData.kind = 'crate';
    mesh.userData.pool = cratePool;
    mesh.userData.homeX = LANES[lane];
    collectibles.push(mesh);
    return mesh;
  }

  /** Coins on a parabola that matches the real jump arc, so an arc of coins
   *  always teaches the jump the row in front of it needs. */
  function coinArc(lane, worldZ, count, peak) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const y = CFG.COIN_Y + Math.sin(Math.PI * t) * peak;
      placeCoin(lane, worldZ + i * 2.2, y);
    }
  }

  function coinLine(lane, worldZ, count) {
    for (let i = 0; i < count; i++) placeCoin(lane, worldZ + i * 2.2, CFG.COIN_Y);
  }

  function spawnRow(worldZ, distance, speed) {
    const tier = tierFor(distance);
    // Plan against the row's own position, not the player's, so the phase and
    // intensity a row is built with match where it will actually be met.
    const plan = planRow(worldZ, tier, speed, {
      prevPassable, prevRequiredJump, prevRowZ,
    }, intensity(worldZ), phaseFor(worldZ));
    repairs += plan.repaired;

    let usedRail = false;
    for (let lane = 0; lane < LANES.length; lane++) {
      const type = plan.slots[lane];
      if (!type) continue;
      placeObstacle(type, lane, worldZ);
      if (type === 'rail') usedRail = true;
    }

    // --- rewards along the safe path ---
    const rewardLane = plan.passable.length ? rng.pick(plan.passable) : plan.safeLane;
    const slotType = plan.slots[rewardLane];
    if (slotType === 'low' || slotType === 'ramp') {
      coinArc(rewardLane, worldZ - 3, 5, 1.5);
    } else if (rng.chance(0.65)) {
      coinLine(rewardLane, worldZ + 3, 3 + rng.int(3));
    }
    if (tier >= 2 && rng.chance(0.08)) {
      // Gems sit in the lane that took the most nerve to reach.
      const risky = [0, 1, 2].filter((l) => plan.slots[l] === null && l !== rewardLane);
      if (risky.length) placeGem(rng.pick(risky), worldZ + 6);
    }

    // --- power-up crate: an extra route to an upgrade choice ---
    if (tier >= 1 && worldZ - lastCrateZ > 320 && rng.chance(0.4)) {
      lastCrateZ = worldZ;
      placeCrate(rewardLane, worldZ + 10);
    }

    prevPassable = plan.passable.length ? plan.passable : [0, 1, 2];
    prevRequiredJump = plan.requiredJump;
    prevRowZ = worldZ;

    // Rails are long, so leave room past the far end — otherwise the next row
    // would spawn inside the rail and the player would meet an obstacle
    // mid-grind, in a lane they are locked into.
    return usedRail ? CFG.RAIL_HALF_LEN : 0;
  }

  function spawnScenery(worldZ) {
    for (const side of [-1, 1]) {
      if (!rng.chance(0.8)) continue;
      const kind = rng.weighted(['tower', 'lamp', 'billboard'], (k) =>
        k === 'tower' ? 5 : k === 'lamp' ? 3 : 1
      );
      const mesh = sceneryPools[kind].acquire();
      const offset = kind === 'tower' ? rng.range(7.5, 13) : 5.6;
      mesh.position.x = side * offset;
      mesh.rotation.y = kind === 'lamp' && side > 0 ? Math.PI : 0;
      mesh.userData.worldZ = worldZ + rng.range(-3, 3);
      mesh.userData.pool = sceneryPools[kind];
      scenery.push(mesh);
    }
  }

  /* ---------------- per-frame ---------------- */

  function update(dt, speed, distance) {
    // Spawn ahead of the player.
    let guard = 0;
    while (nextRowZ < distance + CFG.SPAWN_AHEAD && guard++ < 40) {
      const extra = spawnRow(nextRowZ, distance, speed);
      nextRowZ += Math.max(6, speed * rowGapTime(intensity(nextRowZ))) + extra;
    }
    guard = 0;
    while (nextSceneryZ < distance + CFG.SPAWN_AHEAD && guard++ < 40) {
      spawnScenery(nextSceneryZ);
      nextSceneryZ += CFG.SCENERY_GAP;
    }

    // Position and recycle.
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const m = obstacles[i];
      const z = -(m.userData.worldZ - distance);
      m.position.z = z;
      // Measured from the near end, not the centre: a 24-unit rail whose
      // centre has passed DESPAWN_Z still has half its length in front of the
      // camera, and recycling it there would pop it out on screen.
      if (z - m.userData.hz > CFG.DESPAWN_Z) {
        obstaclePools[m.userData.type].release(m);
        obstacles.splice(i, 1);
      }
    }

    const spin = dt * 2.4;
    for (let i = collectibles.length - 1; i >= 0; i--) {
      const m = collectibles[i];
      const z = -(m.userData.worldZ - distance);
      m.position.z = z;
      if (m.userData.kind === 'coin') m.rotation.y += spin;
      else m.rotation.y += spin * 0.7;
      if (z > CFG.DESPAWN_Z) {
        m.userData.pool.release(m);
        collectibles.splice(i, 1);
      }
    }

    for (let i = scenery.length - 1; i >= 0; i--) {
      const m = scenery[i];
      const z = -(m.userData.worldZ - distance);
      m.position.z = z;
      if (z > CFG.DESPAWN_Z + 20) {
        m.userData.pool.release(m);
        scenery.splice(i, 1);
      }
    }
  }

  /** Remove a collected pickup immediately. */
  function removeCollectible(mesh) {
    const i = collectibles.indexOf(mesh);
    if (i !== -1) {
      collectibles.splice(i, 1);
      mesh.userData.pool.release(mesh);
    }
  }

  /** Destroy an obstacle (shield break). */
  function removeObstacle(mesh) {
    const i = obstacles.indexOf(mesh);
    if (i !== -1) {
      obstacles.splice(i, 1);
      obstaclePools[mesh.userData.type].release(mesh);
    }
  }

  function reset(nextRng) {
    if (nextRng) rng = nextRng;
    for (const m of obstacles) obstaclePools[m.userData.type].release(m);
    for (const m of collectibles) m.userData.pool.release(m);
    for (const m of scenery) m.userData.pool.release(m);
    obstacles.length = 0;
    collectibles.length = 0;
    scenery.length = 0;

    nextRowZ = 60;
    nextSceneryZ = 20;
    prevPassable = [0, 1, 2];
    prevRequiredJump = false;
    prevRowZ = 0;
    lastCrateZ = 0;
    repairs = 0;
  }

  /**
   * Run `count` rows through the real planner and report any that would be
   * unwinnable *after* repair. `failures` must be 0.
   */
  function selfTest(count = 5000) {
    const state = { prevPassable: [0, 1, 2], prevRequiredJump: false, prevRowZ: 0 };
    let failures = 0;
    let repaired = 0;
    let z = 60;
    let distance = 0;

    for (let i = 0; i < count; i++) {
      const tier = tierFor(distance);
      const inten = intensity(distance);
      // Sweep the real speed curve, including the endless creep past
      // DIFFICULTY_DISTANCE — the tightest rows the game can produce are the
      // ones this test most needs to reach.
      const cap = Math.min(
        CFG.ABSOLUTE_MAX_SPEED,
        CFG.MAX_SPEED + Math.max(0, distance - CFG.DIFFICULTY_DISTANCE) / CFG.ENDLESS_SPEED_DIV
      );
      const speed = Math.min(cap, CFG.BASE_SPEED + distance * 0.012);
      const gapTime = (z - state.prevRowZ) / speed;
      const maxShift = Math.max(0, Math.min(2, Math.floor(gapTime / CFG.LANE_SETTLE)));
      const allowJump = !state.prevRequiredJump || gapTime >= CFG.JUMP_ROW_MIN_GAP;

      const plan = planRow(z, tier, speed, state, inten, phaseFor(distance));
      repaired += plan.repaired;

      // Re-validate the finished row independently of the planner.
      if (validateRow(plan.slots, state.prevPassable, maxShift, allowJump)) failures++;

      state.prevPassable = plan.passable.length ? plan.passable : [0, 1, 2];
      state.prevRequiredJump = plan.requiredJump;
      state.prevRowZ = z;
      const step = Math.max(6, speed * rowGapTime(inten));
      z += step;
      distance += step;
    }

    return { rows: count, failures, repairs: repaired, distance: Math.round(distance) };
  }

  function warm() {
    for (const type of ['barrier', 'low', 'high', 'ramp']) obstaclePools[type].warm(10);
    obstaclePools.rail.warm(3);
    coinPool.warm(120);
    gemPool.warm(4);
    cratePool.warm(3);
    sceneryPools.tower.warm(30);
    sceneryPools.lamp.warm(20);
    sceneryPools.billboard.warm(10);
  }

  return {
    update, reset, selfTest, warm,
    removeCollectible, removeObstacle,
    obstacles, collectibles,
    get repairs() { return repairs; },
    poolSizes: () => ({
      barrier: obstaclePools.barrier.created,
      low: obstaclePools.low.created,
      high: obstaclePools.high.created,
      ramp: obstaclePools.ramp.created,
      rail: obstaclePools.rail.created,
      coin: coinPool.created,
      gem: gemPool.created,
      crate: cratePool.created,
      tower: sceneryPools.tower.created,
    }),
  };
}
