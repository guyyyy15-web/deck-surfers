/**
 * collision.js — AABB tests against the track.
 *
 * Hitboxes come straight from each obstacle's `userData` (written when the
 * mesh was built), so a hitbox can never silently drift away from what the
 * player sees. Ducking and jumping need no special cases: the boxes are
 * placed so that a duck simply misses a gantry and a jump simply clears a
 * low block.
 */

import { CFG } from './config.js';

const box = {
  minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0,
};

/** Pull nearby pickups toward the player when the Magnet Deck is active. */
export function magnetPass(player, collectibles, radius, distance, dt) {
  if (radius <= 0) return;
  const px = player.x;
  const py = player.y + 0.8;
  const r2 = radius * radius;
  const k = Math.min(1, CFG.MAGNET_PULL * dt * 0.25);

  for (const m of collectibles) {
    if (m.userData.kind === 'crate') continue;   // crates stay put
    const dz = -(m.userData.worldZ - distance);
    if (dz > 4 || dz < -radius) continue;        // already passed, or too far ahead
    const dx = px - m.position.x;
    const dy = py - m.position.y;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;

    m.position.x += dx * k;
    m.position.y += dy * k;
    m.userData.worldZ += (distance - m.userData.worldZ) * k;
  }
}

function overlaps(a, minX, maxX, minY, maxY, minZ, maxZ) {
  return (
    a.maxX > minX && a.minX < maxX &&
    a.maxY > minY && a.minY < maxY &&
    a.maxZ > minZ && a.minZ < maxZ
  );
}

/**
 * Test the player against obstacles and pickups.
 * `ctx` supplies the callbacks: onCoin, onGem, onCrate, onRamp, onHit.
 */
export function checkCollisions(player, track, distance, ctx) {
  player.getAABB(box);

  // --- obstacles ---
  for (let i = track.obstacles.length - 1; i >= 0; i--) {
    const m = track.obstacles[i];
    const z = m.position.z;
    const ud = m.userData;
    if (z < -ud.hz - 2 || z > ud.hz + 2) continue;   // cheap z reject

    const hit = overlaps(
      box,
      m.position.x - ud.hx, m.position.x + ud.hx,
      ud.yMin, ud.yMax,
      z - ud.hz, z + ud.hz
    );
    if (!hit) continue;

    if (ud.type === 'ramp') {
      if (!ud.used) {
        ud.used = true;
        ctx.onRamp(m);
      }
      continue;
    }
    ctx.onHit(m);
    return;   // one lethal contact is enough
  }

  // --- pickups (slightly padded so they feel generous) ---
  const pad = CFG.COIN_PICKUP_PAD;
  for (let i = track.collectibles.length - 1; i >= 0; i--) {
    const m = track.collectibles[i];
    const z = m.position.z;
    if (z < -2 || z > 2) continue;

    const r = m.userData.kind === 'crate' ? 0.55 : 0.45;
    const hit = overlaps(
      box,
      m.position.x - r - pad, m.position.x + r + pad,
      m.position.y - r - pad, m.position.y + r + pad,
      z - r - pad, z + r + pad
    );
    if (!hit) continue;

    if (m.userData.kind === 'coin') ctx.onCoin(m);
    else if (m.userData.kind === 'gem') ctx.onGem(m);
    else if (m.userData.kind === 'crate') ctx.onCrate(m);
  }
}
