/**
 * rng.js — seeded PRNG so a run can be reproduced exactly.
 *
 * The track generator's self-test relies on this: given a fixed seed it walks
 * the identical code path the real game uses, which is what makes the
 * "no unwinnable patterns" guarantee testable rather than aspirational.
 */

/** mulberry32 — small, fast, good enough for gameplay. */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;

  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** integer in [0, n) */
    int: (n) => Math.floor(next() * n),
    /** float in [a, b) */
    range: (a2, b) => a2 + next() * (b - a2),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,

    /** Weighted pick. `weightOf(item)` must return a non-negative number. */
    weighted(items, weightOf) {
      let total = 0;
      for (const it of items) total += Math.max(0, weightOf(it));
      if (total <= 0) return items[0];
      let r = next() * total;
      for (const it of items) {
        r -= Math.max(0, weightOf(it));
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    },

    /** In-place Fisher-Yates. */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}
