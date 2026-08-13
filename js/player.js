/**
 * player.js — the skater.
 *
 * Owns lane position, the jump arc, ducking, and all procedural animation.
 * It reads upgrade effects from a `stats` object it never mutates, so an
 * upgrade can change how the player behaves without the player module
 * knowing which upgrades exist.
 */

import { CFG, LANES, PAL } from './config.js';
import { buildPlayer, mat } from './voxel.js';

export function createPlayer(scene) {
  const rig = buildPlayer();
  scene.add(rig.root);
  scene.add(rig.shadow);

  const s = {
    laneIndex: 1,
    x: LANES[1],
    y: 0,
    vy: 0,
    groundY: 0,
    grounded: true,
    ducking: false,
    duckTimer: 0,
    jumpsUsed: 0,
    coyote: 0,
    buffer: 0,
    leanZ: 0,
    invuln: 0,
    dead: false,
    animT: 0,
    boardSpin: 0,
    boardSpinV: 0,
  };

  let stats = null;

  /* ---------------- actions ---------------- */

  function moveLane(dir) {
    if (s.dead) return false;
    const next = Math.min(LANES.length - 1, Math.max(0, s.laneIndex + dir));
    if (next === s.laneIndex) return false;
    s.laneIndex = next;
    return true;
  }

  function canJump() {
    if (s.grounded || s.coyote > 0) return true;
    return s.jumpsUsed < (stats ? stats.maxJumps : 1);
  }

  function requestJump() {
    if (s.dead) return false;
    if (!canJump()) {
      s.buffer = CFG.JUMP_BUFFER;   // remember it; fire on landing
      return false;
    }
    doJump();
    return true;
  }

  function doJump() {
    const air = !s.grounded && s.coyote <= 0;
    const v = (stats ? stats.jumpVelocity : CFG.JUMP_V) * (air ? CFG.AIR_JUMP_MULT : 1);
    s.vy = v;
    s.grounded = false;
    s.coyote = 0;
    s.buffer = 0;
    s.jumpsUsed++;
    if (s.ducking) endDuck();
    if (air) s.boardSpinV = Math.PI * 2 / 0.55;  // a full flip over the air time
    return air;
  }

  /** Ramps launch the player without consuming a jump. */
  function launch(v) {
    s.vy = v;
    s.grounded = false;
    s.jumpsUsed = 0;
    s.boardSpinV = Math.PI * 2 / 0.7;
  }

  function startDuck() {
    if (s.dead) return;
    if (!s.grounded) {
      // Mid-air duck is a fast-fall, not a hitbox change — otherwise you
      // could cheese every gantry by tapping down while jumping over it.
      s.vy = Math.min(s.vy, CFG.FAST_FALL_V);
      return;
    }
    s.ducking = true;
    s.duckTimer = CFG.DUCK_MIN_TIME + (stats ? stats.duckBonus : 0);
  }

  function endDuck() {
    // The minimum duck window still has to elapse; update() finishes it.
    if (s.duckTimer <= 0) s.ducking = false;
  }

  /* ---------------- per-frame ---------------- */

  function update(dt, heldDuck) {
    stats = stats || null;
    s.animT += dt;

    // --- lane: frame-rate independent exponential damping ---
    const targetX = LANES[s.laneIndex];
    s.x += (targetX - s.x) * (1 - Math.exp(-CFG.LANE_DAMP * dt));
    s.leanZ = Math.max(-1, Math.min(1, (targetX - s.x) / 2.4));

    // --- vertical ---
    const hovering = stats && stats.hoverHeight > 0;
    s.groundY = hovering ? CFG.HOVER_HEIGHT : 0;
    const g = CFG.GRAVITY * (hovering ? CFG.HOVER_GRAVITY_MULT : 1);

    if (!s.grounded) {
      s.vy -= g * dt;
      s.y += s.vy * dt;
      s.coyote = Math.max(0, s.coyote - dt);

      if (s.y <= s.groundY) {
        s.y = s.groundY;
        s.vy = 0;
        s.grounded = true;
        s.jumpsUsed = 0;
        s.boardSpinV = 0;
        s.boardSpin = 0;
        if (s.buffer > 0) doJump();   // buffered press lands as a jump
      }
    } else {
      // Hover height can change mid-run when the upgrade is picked.
      s.y += (s.groundY - s.y) * (1 - Math.exp(-8 * dt));
      s.coyote = CFG.COYOTE_TIME;
    }

    s.buffer = Math.max(0, s.buffer - dt);
    s.invuln = Math.max(0, s.invuln - dt);

    // --- duck window ---
    if (s.ducking) {
      s.duckTimer -= dt;
      if (s.duckTimer <= 0 && !heldDuck) s.ducking = false;
    }

    animate(dt);
  }

  /* ---------------- procedural animation ---------------- */

  function animate(dt) {
    const { root, board, body, legL, legR, armL, armR, torso, shadow } = rig;

    root.position.set(s.x, s.y, 0);
    root.rotation.z = -s.leanZ * 0.42;
    root.rotation.y = -s.leanZ * 0.28;

    if (s.dead) {
      root.rotation.x += dt * 6;
      root.rotation.z += dt * 3;
      shadow.visible = false;
      return;
    }

    // Blink while invulnerable so the shield break is readable.
    root.visible = s.invuln <= 0 || Math.floor(s.invuln * 12) % 2 === 0;

    const duckK = s.ducking ? 1 : 0;
    body.scale.y += (1 - duckK * 0.52 - body.scale.y) * Math.min(1, dt * 14);
    body.position.y += (-duckK * 0.06 - body.position.y) * Math.min(1, dt * 14);

    if (s.grounded) {
      // Rolling stance: subtle pumping, arms out for balance.
      const f = s.animT * 7;
      legL.rotation.x = Math.sin(f) * 0.16 - 0.1;
      legR.rotation.x = -Math.sin(f) * 0.16 - 0.1;
      armL.rotation.z = -0.5 - s.leanZ * 0.5 + Math.sin(f) * 0.08;
      armR.rotation.z = 0.5 - s.leanZ * 0.5 - Math.sin(f) * 0.08;
      armL.rotation.x = duckK * -0.9;
      armR.rotation.x = duckK * -0.9;
      torso.rotation.x = 0.08 + duckK * 0.5;
      board.rotation.x = 0;
    } else {
      // Ollie: knees tucked, arms up, board noses up then flips.
      legL.rotation.x = -0.75;
      legR.rotation.x = -0.6;
      armL.rotation.z = -1.5;
      armR.rotation.z = 1.5;
      armL.rotation.x = -0.4;
      armR.rotation.x = -0.4;
      torso.rotation.x = 0.22;

      s.boardSpin += s.boardSpinV * dt;
      board.rotation.x = s.boardSpinV > 0
        ? s.boardSpin
        : Math.max(-0.5, Math.min(0.5, s.vy * 0.045));
    }

    // Contact shadow shrinks and fades with altitude.
    const h = Math.max(0, s.y - 0);
    shadow.visible = true;
    shadow.position.set(s.x, 0.03, 0);
    const k = Math.max(0.35, 1 - h * 0.28);
    shadow.scale.set(1.3 * k, 2.1 * k, 1);
    shadow.material.opacity = 0.35 * k;

    rig.shield.rotation.y += dt * 1.6;
    rig.shield.scale.setScalar(1 + Math.sin(s.animT * 5) * 0.05);
    rig.magnetRing.rotation.z += dt * 2.2;
    rig.hoverRing.rotation.z -= dt * 3;
  }

  /* ---------------- upgrade-driven visuals ---------------- */

  /**
   * Called whenever the upgrade set changes. The board is the readout: its
   * colour, its rings and its trail all reflect what is currently active.
   */
  function applyStats(next, stacks) {
    stats = next;

    rig.shield.visible = next.shieldCharges > 0;
    rig.hoverRing.visible = next.hoverHeight > 0;
    rig.magnetRing.visible = next.magnetRadius > 0;
    if (next.magnetRadius > 0) {
      // Ring grows with the pull radius so the upgrade's strength is visible.
      rig.magnetRing.scale.setScalar(Math.max(1, next.magnetRadius / 4.5));
    }

    // Deck colour by the most striking active upgrade.
    let deckColour = PAL.deck;
    if (stacks.moonBoots) deckColour = PAL.crate;
    else if (stacks.scoreMult) deckColour = PAL.multi;
    else if (stacks.magnet) deckColour = PAL.magnet;
    else if (stacks.hoverDeck) deckColour = PAL.hover;
    rig.deck.material = mat(deckColour);

    // Wheels glow gold once coins are worth more.
    const wheelColour = stacks.coinValue ? PAL.coin : PAL.wheel;
    for (const w of rig.wheels) w.material = mat(wheelColour);
  }

  /** Colour of the trail particles, so FX matches the board. */
  function trailColour(stacks) {
    if (stacks.moonBoots) return PAL.crate;
    if (stacks.scoreMult) return PAL.multi;
    if (stacks.magnet) return PAL.magnet;
    if (stacks.hoverDeck) return PAL.hover;
    return PAL.deck;
  }

  function getAABB(out) {
    // Ducking only shrinks the hitbox on the ground (see startDuck).
    const height = s.ducking && s.grounded ? CFG.DUCK_HEIGHT : CFG.STAND_HEIGHT;
    out.minX = s.x - CFG.PLAYER_HALF_X;
    out.maxX = s.x + CFG.PLAYER_HALF_X;
    out.minY = s.y;
    out.maxY = s.y + height;
    out.minZ = -CFG.PLAYER_HALF_Z;
    out.maxZ = CFG.PLAYER_HALF_Z;
    return out;
  }

  function playDeath() {
    s.dead = true;
    s.ducking = false;
    rig.root.visible = true;
  }

  function reset() {
    s.laneIndex = 1;
    s.x = LANES[1];
    s.y = 0;
    s.vy = 0;
    s.groundY = 0;
    s.grounded = true;
    s.ducking = false;
    s.duckTimer = 0;
    s.jumpsUsed = 0;
    s.coyote = CFG.COYOTE_TIME;
    s.buffer = 0;
    s.leanZ = 0;
    s.invuln = 0;
    s.dead = false;
    s.animT = 0;
    s.boardSpin = 0;
    s.boardSpinV = 0;

    const { root, board, body } = rig;
    root.position.set(s.x, 0, 0);
    root.rotation.set(0, 0, 0);
    root.visible = true;
    board.rotation.set(0, 0, 0);
    body.scale.y = 1;
    body.position.y = 0;
    rig.shield.visible = false;
    rig.hoverRing.visible = false;
    rig.magnetRing.visible = false;
    rig.deck.material = mat(PAL.deck);
    for (const w of rig.wheels) w.material = mat(PAL.wheel);
  }

  return {
    rig,
    state: s,
    get x() { return s.x; },
    get y() { return s.y; },
    get leanZ() { return s.leanZ; },
    get grounded() { return s.grounded; },
    get ducking() { return s.ducking; },
    get laneIndex() { return s.laneIndex; },
    get invuln() { return s.invuln; },
    set invuln(v) { s.invuln = v; },
    moveLane, requestJump, launch, startDuck, endDuck,
    update, applyStats, trailColour, getAABB, playDeath, reset,
  };
}
