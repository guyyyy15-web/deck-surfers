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
 * Did the player get close enough to this obstacle to deserve credit?
 * Returns 'dodge', 'clear', or null.
 *
 * Two distinct skill moments, both measured from the contact envelope so the
 * reward tracks how close the player actually came:
 *
 *   dodge — passed in a neighbouring lane, within NEAR_MISS_X of contact.
 *   clear — was laterally inside the obstacle and got over or under it,
 *           within NEAR_MISS_Y. This is the jumped block and the ducked
 *           gantry.
 */
function nearMissKind(a, px, ox, ud) {
  const contactX = ud.hx + CFG.PLAYER_HALF_X;   // ~1.37 for most obstacles
  const dx = Math.abs(px - ox);

  if (dx > contactX) {
    // Deliberately tighter than the 2.4 lane spacing: sitting safely in the
    // next lane is not a near miss. This only fires when the player was
    // still cutting across as they went past.
    return dx <= CFG.NEAR_MISS_X ? 'dodge' : null;
  }

  // Laterally overlapping, so it was survived vertically — a tight ollie
  // over a block, or a duck under a gantry.
  const gapY = a.minY >= ud.yMax
    ? a.minY - ud.yMax          // cleared it from above
    : ud.yMin - a.maxY;         // ducked under it
  return gapY >= 0 && gapY <= CFG.NEAR_MISS_Y ? 'clear' : null;
}

/**
 * Test the player against obstacles and pickups.
 * `ctx` supplies the callbacks: onCoin, onGem, onCrate, onRamp, onHit and
 * onNearMiss.
 */
export function checkCollisions(player, track, distance, ctx) {
  player.getAABB(box);
  const px = player.x;

  // --- obstacles ---
  for (let i = track.obstacles.length - 1; i >= 0; i--) {
    const m = track.obstacles[i];
    const z = m.position.z;
    const ud = m.userData;

    // Once it is fully behind the player it can no longer be hit, but it may
    // have been a near miss on the way past. Latched, so it scores at most
    // once. The threshold has to clear the obstacle's own depth, not just the
    // player's: a rail is 7 units long, so its *centre* passing the player
    // still leaves the player inside it.
    if (z > ud.hz + CFG.PLAYER_HALF_Z) {
      if (!ud.passed) {
        ud.passed = true;
        if (!ud.harmless) {
          const kind = nearMissKind(box, px, m.position.x, ud);
          if (kind) ctx.onNearMiss(m, kind);
        }
      }
      continue;
    }
    if (z < -ud.hz - 2) continue;   // cheap z reject: still too far ahead

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

    // A rail is a wall from the side and a ride from above. Nothing else
    // changes: if neither of these applies it falls through to the lethal
    // path below, which is what keeps grinding a risk rather than a tunnel.
    if (ud.grindable) {
      if (player.isGrinding(m)) continue;
      if (player.canGrind() && player.vy <= 0 && box.minY >= ud.rideY - CFG.GRIND_SNAP) {
        ctx.onGrind(m);
        continue;
      }
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
