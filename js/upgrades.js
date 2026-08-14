/**
 * upgrades.js — the rogue-lite layer.
 *
 * The one rule that matters: **upgrades last exactly one run.** That is
 * enforced structurally rather than by remembering to clean up:
 *
 *   - Every effect is a pure `fold(stats, level)` that writes into a fresh
 *     copy of BASE_STATS. Nothing ever does `stats.x += ...` on a live value,
 *     so applying, stacking and expiring can't drift.
 *   - `recompute()` always rebuilds from scratch from the current stacks.
 *   - `reset()` *replaces* the stacks/timers objects rather than clearing
 *     them, so no stale key can survive a restart.
 *   - Nothing in this module is ever written to localStorage.
 */

import { CFG } from './config.js';

export const BASE_STATS = Object.freeze({
  scoreMult: 1,
  magnetRadius: 0,
  maxJumps: 1,
  jumpVelocity: CFG.JUMP_V,
  hoverHeight: 0,
  shieldMax: 0,
  shieldCharges: 0,
  coinValue: CFG.COIN_SCORE,
  speedRampScale: 1,
  duckBonus: 0,
  // ---- added with grinding and the trade-off cards ----
  grindMult: 1,
  grindSnap: CFG.GRIND_SNAP,
  comboWindow: CFG.COMBO_WINDOW,
  nearMissMult: 1,
  reviveMax: 0,
  reviveCharges: 0,
});

const RARITY_WEIGHT = { common: 5, rare: 3, epic: 1 };

export const UPGRADES = [
  {
    id: 'magnet',
    name: 'Magnet Deck',
    icon: '🧲',
    rarity: 'common',
    maxStacks: 3,
    desc: (lvl) => `Pulls coins in from ${(3.5 + (lvl + 1)).toFixed(1)} units away`,
    fold: (st, lvl) => { st.magnetRadius = 3.5 + lvl; },
  },
  {
    id: 'doubleJump',
    name: 'Double Jump',
    icon: '⏫',
    rarity: 'rare',
    maxStacks: 2,
    desc: (lvl) => (lvl === 0 ? 'Jump a second time in mid-air' : 'A third mid-air jump'),
    fold: (st, lvl) => { st.maxJumps = 1 + lvl; },
  },
  {
    id: 'scoreMult',
    name: 'Hot Streak',
    icon: '✖️',
    rarity: 'common',
    maxStacks: 3,
    desc: (lvl) => `Score ×${Math.pow(1.5, lvl + 1).toFixed(2)}`,
    fold: (st, lvl) => { st.scoreMult = Math.pow(1.5, lvl); },
  },
  {
    id: 'hoverDeck',
    name: 'Hover Deck',
    icon: '🛸',
    rarity: 'rare',
    maxStacks: 1,
    // An honest trade-off, not a free win: floating makes gantries harder.
    desc: () => 'Float above the road and fall slowly — but duck lower',
    fold: (st) => { st.hoverHeight = CFG.HOVER_HEIGHT; },
  },
  {
    id: 'shield',
    name: 'Guard Rail',
    icon: '🛡️',
    rarity: 'common',
    maxStacks: 3,
    desc: (lvl) => `Survive ${lvl + 1} crash${lvl ? 'es' : ''}`,
    fold: (st, lvl) => { st.shieldMax = lvl; },
  },
  {
    id: 'coinValue',
    name: 'Gold Grip',
    icon: '💰',
    rarity: 'common',
    maxStacks: 3,
    desc: (lvl) => `Coins worth ${CFG.COIN_SCORE + 6 * (lvl + 1)} points`,
    fold: (st, lvl) => { st.coinValue = CFG.COIN_SCORE + 6 * lvl; },
  },
  {
    id: 'slowBurn',
    name: 'Slow Burn',
    icon: '🐢',
    rarity: 'rare',
    maxStacks: 2,
    desc: () => 'The street speeds up more gently',
    fold: (st, lvl) => { st.speedRampScale = Math.pow(0.78, lvl); },
  },
  {
    id: 'moonBoots',
    name: 'Moon Boots',
    icon: '🌙',
    rarity: 'epic',
    maxStacks: 1,
    desc: () => 'Much higher ollies',
    fold: (st) => { st.jumpVelocity = CFG.JUMP_V * 1.22; },
  },
  {
    id: 'airBrake',
    name: 'Air Brake',
    icon: '🪂',
    rarity: 'common',
    maxStacks: 2,
    desc: () => 'Hold a duck-slide for longer',
    fold: (st, lvl) => { st.duckBonus = 0.3 * lvl; },
  },

  /* ---- cards that change how you play, rather than scaling a number ---- */

  {
    id: 'railRider',
    name: 'Rail Rider',
    icon: '🛤️',
    rarity: 'rare',
    maxStacks: 2,
    desc: (lvl) => `Grinds score ×${1 + lvl} and catch rails from further`,
    fold: (st, lvl) => {
      st.grindMult = 1 + lvl;
      st.grindSnap = CFG.GRIND_SNAP + 0.18 * lvl;
    },
  },
  {
    id: 'comboKeeper',
    name: 'Long Fuse',
    icon: '🧨',
    rarity: 'rare',
    maxStacks: 2,
    desc: (lvl) => `Combo survives ${(CFG.COMBO_WINDOW + 0.9 * (lvl + 1)).toFixed(1)}s between hits`,
    fold: (st, lvl) => { st.comboWindow = CFG.COMBO_WINDOW + 0.9 * lvl; },
  },
  {
    id: 'daredevil',
    name: 'Daredevil',
    icon: '😎',
    rarity: 'common',
    maxStacks: 3,
    desc: (lvl) => `Near misses are worth ×${1 + lvl} and build combo faster`,
    fold: (st, lvl) => { st.nearMissMult = 1 + lvl; },
  },
  {
    id: 'secondWind',
    name: 'Second Wind',
    icon: '🌀',
    rarity: 'epic',
    maxStacks: 1,
    // Distinct from Guard Rail: a shield eats a hit and keeps you rolling,
    // this one catches you after the crash animation has already started.
    desc: () => 'Get back up once after a wipeout',
    fold: (st) => { st.reviveMax = 1; },
  },

  /* ---- trade-offs: these give up something real ---- */

  {
    id: 'overdrive',
    name: 'Overdrive',
    icon: '🔥',
    rarity: 'rare',
    maxStacks: 2,
    desc: (lvl) => `Score ×${(1 + 0.45 * (lvl + 1)).toFixed(2)} — but the street speeds up hard`,
    fold: (st, lvl) => {
      st.scoreMult *= 1 + 0.45 * lvl;
      st.speedRampScale *= Math.pow(1.35, lvl);
    },
  },
  {
    // Deliberately LAST in this list. `recompute()` folds in array order, so
    // zeroing the shields here reliably overrides Guard Rail no matter which
    // order the two were picked in.
    id: 'glassCannon',
    name: 'Glass Cannon',
    icon: '💎',
    rarity: 'epic',
    maxStacks: 1,
    desc: () => 'Score ×2.5 — but every shield and revive is stripped away',
    fold: (st) => {
      st.scoreMult *= 2.5;
      st.shieldMax = 0;
      st.reviveMax = 0;
    },
  },
];

/** Fallback so the choice screen always has three cards to show. */
// Shown once the pool is exhausted, which now takes far longer than it used
// to. Scaled by distance so a late-run filler card is never an insult — at
// 6km it banks about 1500 rather than a flat 250.
const COIN_CACHE = {
  id: 'coinCache',
  name: 'Coin Cache',
  icon: '🎁',
  rarity: 'common',
  maxStacks: Infinity,
  desc: () => 'Instantly bank a pile of points, scaled to how far you have come',
  fold: () => {},
  instant: (run) => { run.score += 250 + run.distance * 0.2; },
};

const BY_ID = new Map([...UPGRADES, COIN_CACHE].map((u) => [u.id, u]));

export function createUpgradeManager(rng) {
  let stacks = {};
  let shieldUsed = 0;
  let reviveUsed = 0;
  let stats = { ...BASE_STATS };
  const changeHandlers = new Set();

  function recompute() {
    // Always from a clean base — this is what makes drift impossible.
    const next = { ...BASE_STATS };
    for (const up of UPGRADES) {
      const level = stacks[up.id];
      if (level) up.fold(next, level);
    }
    // Shields and revives are consumable, so derive the remaining charges
    // rather than storing them (a later recompute would otherwise refill
    // them). Note this runs after every fold, so Glass Cannon stripping
    // shieldMax to 0 correctly leaves zero charges too.
    next.shieldCharges = Math.max(0, next.shieldMax - shieldUsed);
    next.reviveCharges = Math.max(0, next.reviveMax - reviveUsed);
    stats = next;
    for (const cb of changeHandlers) cb(stats, stacks);
    return stats;
  }

  /** Pick `n` distinct upgrades the player can still take, weighted by rarity. */
  function roll(n = CFG.CHOICE_COUNT) {
    const eligible = UPGRADES.filter((u) => (stacks[u.id] || 0) < u.maxStacks);
    const chosen = [];
    const pool = [...eligible];

    while (chosen.length < n && pool.length > 0) {
      const pick = rng.weighted(pool, (u) => RARITY_WEIGHT[u.rarity] || 1);
      chosen.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    while (chosen.length < n) chosen.push(COIN_CACHE);

    return chosen.map((u) => ({
      id: u.id,
      name: u.name,
      icon: u.icon,
      rarity: u.rarity,
      level: stacks[u.id] || 0,
      maxStacks: u.maxStacks,
      desc: u.desc(stacks[u.id] || 0),
    }));
  }

  function apply(id, run) {
    const up = BY_ID.get(id);
    if (!up) return null;
    stacks[id] = (stacks[id] || 0) + 1;
    if (up.instant && run) up.instant(run);
    recompute();
    return up;
  }

  /** Returns true if a shield absorbed the hit. */
  function consumeShield() {
    if (stats.shieldCharges <= 0) return false;
    shieldUsed++;
    recompute();
    return true;
  }

  /** Returns true if a revive caught the wipeout. */
  function consumeRevive() {
    if (stats.reviveCharges <= 0) return false;
    reviveUsed++;
    recompute();
    return true;
  }

  /** Ordered list for the HUD and the game-over summary. */
  function activeList() {
    return UPGRADES.filter((u) => stacks[u.id] > 0).map((u) => ({
      id: u.id,
      name: u.name,
      icon: u.icon,
      rarity: u.rarity,
      level: stacks[u.id],
    }));
  }

  function reset(nextRng) {
    if (nextRng) rng = nextRng;
    // Replace, don't clear — nothing from the previous run can survive.
    stacks = {};
    shieldUsed = 0;
    reviveUsed = 0;
    stats = { ...BASE_STATS };
    for (const cb of changeHandlers) cb(stats, stacks);
    return stats;
  }

  return {
    get stats() { return stats; },
    get stacks() { return stacks; },
    roll, apply, consumeShield, consumeRevive, activeList, reset, recompute,
    onChange(cb) { changeHandlers.add(cb); return () => changeHandlers.delete(cb); },
  };
}
