/**
 * player.js — the skater.
 *
 * Owns lane position, the jump arc, ducking, and all procedural animation.
 * It reads upgrade effects from a `stats` object it never mutates, so an
 * upgrade can change how the player behaves without the player module
 * knowing which upgrades exist.
 */

import { CFG, LANES, PAL } from './config.js';
import { buildPlayer } from './voxel.js';
import { createPoseMachine } from './pose.js';

/**
 * Poses. Each is a set of joint angles the rig eases toward; anything a pose
 * leaves out falls back to REST, so no state can leave a joint stuck where
 * the previous one put it.
 *
 * Angles are in radians and read as: hip/knee positive = folding forward,
 * shoulder z = arm swinging out from the body.
 */
const REST = {
  'hips.y': 0, 'hips.rx': 0,
  'torso.rx': 0.1, 'torso.rz': 0, 'head.rx': 0, 'head.ry': -0.52,
  'legL.hip': -0.12, 'legL.knee': 0.2, 'legL.foot': -0.08,
  'legR.hip': -0.06, 'legR.knee': 0.16, 'legR.foot': -0.06,
  // Held well clear of the body: tucked in, the arms merged into the hoodie
  // and he read as a single block with no limbs.
  'armL.sh': 0, 'armL.shz': -0.66, 'armL.elb': -0.32,
  'armR.sh': 0, 'armR.shz': 0.66, 'armR.elb': -0.32,
  'board.rx': 0, 'board.rz': 0,
};

const POSES = {
  // Rolling: knees soft, weight settled, arms loose for balance.
  ride: {
    ...REST,
    'hips.y': -0.02,
    'legL.hip': -0.2, 'legL.knee': 0.34,
    'legR.hip': -0.1, 'legR.knee': 0.26,
    'torso.rx': 0.14,
  },
  // Duck-slide: a real crouch — hips drop, knees fold hard, chest over the
  // board. This has to fit under CFG.DUCK_HEIGHT on its own, without the
  // scale squash the old code relied on.
  tuck: {
    ...REST,
    // -0.44 is near the floor of what the legs can reach while the soles stay
    // on the deck; the solver clamps below that, so going lower buys nothing.
    // The leg angles here are only used mid-air — on the ground solveLeg()
    // owns them.
    'hips.y': -0.44, 'hips.rx': 0.14,
    'legL.hip': -1.0, 'legL.knee': 1.5, 'legL.foot': 0.25,
    'legR.hip': -0.92, 'legR.knee': 1.44, 'legR.foot': 0.24,
    // He still lifts his eyes to see the road, but only just — craning the
    // head back is what put the cap up above the gantry line.
    'torso.rx': 1.2, 'head.rx': -0.42,
    'armL.shz': -1.0, 'armL.sh': -0.6, 'armL.elb': -1.0,
    'armR.shz': 1.0, 'armR.sh': -0.6, 'armR.elb': -1.0,
  },
  // The pop itself: legs snapping straight as the board leaves the ground.
  pop: {
    ...REST,
    'hips.y': 0.06,
    'legL.hip': 0.1, 'legL.knee': 0.06,
    'legR.hip': 0.14, 'legR.knee': 0.05,
    'torso.rx': -0.1,
    'armL.shz': -1.5, 'armL.sh': -0.6,
    'armR.shz': 1.5, 'armR.sh': -0.6,
  },
  // Airborne: knees pulled up under him, arms wide.
  float: {
    ...REST,
    'hips.y': -0.08,
    'legL.hip': -0.95, 'legL.knee': 1.15, 'legL.foot': 0.2,
    'legR.hip': -0.85, 'legR.knee': 1.05, 'legR.foot': 0.18,
    'torso.rx': 0.28,
    'armL.shz': -1.85, 'armL.sh': -0.35, 'armL.elb': -0.6,
    'armR.shz': 1.85, 'armR.sh': -0.35, 'armR.elb': -0.6,
  },
  // Grinding: low and locked, arms out wide on the balance point.
  grind: {
    ...REST,
    'hips.y': -0.2, 'hips.rx': 0.1,
    'legL.hip': -0.7, 'legL.knee': 0.95,
    'legR.hip': -0.6, 'legR.knee': 0.85,
    'torso.rx': 0.34,
    'armL.shz': -2.05, 'armL.elb': -0.15,
    'armR.shz': 2.05, 'armR.elb': -0.15,
  },
  // Wiped out — limbs let go.
  bail: {
    ...REST,
    'legL.hip': -1.4, 'legL.knee': 0.9,
    'legR.hip': -0.6, 'legR.knee': 1.4,
    'torso.rx': -0.5,
    'armL.shz': -2.4, 'armL.sh': -1.2,
    'armR.shz': 2.4, 'armR.sh': -1.2,
  },
};

export function createPlayer(scene) {
  const rig = buildPlayer();
  scene.add(rig.root);

  // Channel map: pose names → the actual object properties they drive. The
  // dotted names above are only labels; this is where the hierarchy lives.
  const pose = createPoseMachine({
    'hips.y': { obj: rig.hips.position, key: 'y' },
    'hips.rx': { obj: rig.hips.rotation, key: 'x' },
    'torso.rx': { obj: rig.torso.rotation, key: 'x' },
    'torso.rz': { obj: rig.torso.rotation, key: 'z' },
    'head.rx': { obj: rig.head.rotation, key: 'x' },
    'head.ry': { obj: rig.head.rotation, key: 'y' },

    'legL.hip': { obj: rig.legL.upper.rotation, key: 'x' },
    'legL.knee': { obj: rig.legL.lower.rotation, key: 'x' },
    'legL.foot': { obj: rig.legL.end.rotation, key: 'x' },
    'legR.hip': { obj: rig.legR.upper.rotation, key: 'x' },
    'legR.knee': { obj: rig.legR.lower.rotation, key: 'x' },
    'legR.foot': { obj: rig.legR.end.rotation, key: 'x' },

    'armL.sh': { obj: rig.armL.upper.rotation, key: 'x' },
    'armL.shz': { obj: rig.armL.upper.rotation, key: 'z' },
    'armL.elb': { obj: rig.armL.lower.rotation, key: 'x' },
    'armR.sh': { obj: rig.armR.upper.rotation, key: 'x' },
    'armR.shz': { obj: rig.armR.upper.rotation, key: 'z' },
    'armR.elb': { obj: rig.armR.lower.rotation, key: 'x' },

    'board.rx': { obj: rig.board.rotation, key: 'x' },
    'board.rz': { obj: rig.board.rotation, key: 'z' },
  }, REST);


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
    grinding: null,      // the rail mesh currently being ridden, or null
    grindTime: 0,
    grindCooldown: 0,    // blocks an instant re-latch after stepping off
    landT: 0,            // decaying landing-squash impulse
  };

  let stats = null;
  // Remembered so a skin swap can re-assert the upgrade-driven deck colour
  // over whatever the skin just painted.
  let lastStacks = {};

  /* ---------------- actions ---------------- */

  function moveLane(dir) {
    if (s.dead) return false;
    const next = Math.min(LANES.length - 1, Math.max(0, s.laneIndex + dir));
    if (next === s.laneIndex) return false;
    // Carving off a rail steps you off it.
    if (s.grinding) endGrind();
    s.laneIndex = next;
    return true;
  }

  /* ---------------- grinding ---------------- */

  /** Latch onto a rail. collision.js decides *when*; this is the how. */
  function startGrind(mesh) {
    if (s.dead || s.grinding === mesh) return false;
    const ud = mesh.userData;
    s.grinding = mesh;
    s.grindTime = 0;
    s.y = ud.rideY;
    s.vy = 0;
    s.grounded = true;
    s.jumpsUsed = 0;
    s.boardSpin = 0;
    s.boardSpinV = 0;
    // A duck-slide makes no sense balanced on a rail, and leaving it set
    // would drop the hitbox through the bar.
    s.ducking = false;
    s.duckTimer = 0;
    if (typeof ud.lane === 'number') s.laneIndex = ud.lane;
    return true;
  }

  /**
   * Leave the rail airborne, whatever the reason — jumped off, carved off,
   * or simply ran out of rail. Every exit lands here so gravity resumes from
   * exactly one place.
   */
  function endGrind() {
    if (!s.grinding) return;
    s.grinding = null;
    s.grounded = false;
    s.vy = 0;
    s.grindCooldown = CFG.GRIND_REMOUNT_LOCK;
    // Running off the end shouldn't rob you of a jump you were about to make.
    s.coyote = CFG.COYOTE_TIME;
  }

  function isGrinding(mesh) {
    return mesh === undefined ? !!s.grinding : s.grinding === mesh;
  }

  /** Whether a rail may be latched onto right now. Read by collision.js. */
  function canGrind() {
    return !s.dead && !s.grinding && s.grindCooldown <= 0;
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
    // Grinding counts as grounded, so this reads false and the pop off a rail
    // gets the full jump velocity.
    const air = !s.grounded && s.coyote <= 0;
    if (s.grinding) endGrind();
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
    // Down while grinding reads as "drop off", not "crouch on the bar".
    if (s.grinding) {
      endGrind();
      return;
    }
    if (!s.grounded) {
      // Mid-air duck is a fast-fall, not a hitbox change — otherwise you
      // could cheese every gantry by tapping down while jumping over it.
      s.vy = Math.min(s.vy, CFG.FAST_FALL_V);
      return;
    }
    s.ducking = true;
    s.duckTimer = CFG.DUCK_MIN_TIME + (stats ? stats.duckBonus : 0);
    // Slam straight down to the road. Hovering otherwise holds the rider at
    // HOVER_HEIGHT, and 0.75 + DUCK_HEIGHT sits *above* the gantry underside
    // at 1.25 — so without this, Hover Deck would make every gantry lethal
    // rather than merely harder. Snapping (rather than easing) keeps the
    // hitbox honest: it can never disagree with what is drawn.
    s.y = 0;
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

    // --- grinding ---
    if (s.grinding) {
      const rail = s.grinding;
      // The rail scrolls past at run speed. Once its far end is behind us
      // there is nothing left to ride. The visible check is a safety net for
      // a mesh recycled back into the pool underneath us.
      if (!rail.visible || rail.position.z > rail.userData.hz) endGrind();
      else s.grindTime += dt;
    }

    // --- vertical ---
    // Ducking suspends the hover, so a duck-slide always fits under a gantry.
    // Float returns on its own once the duck window closes — that delay is
    // the real cost of the upgrade. Grinding outranks both: the rail *is*
    // the ground while you are on it.
    const hovering = !s.grinding && stats && stats.hoverHeight > 0 && !s.ducking;
    s.groundY = s.grinding
      ? s.grinding.userData.rideY
      : (hovering ? CFG.HOVER_HEIGHT : 0);
    const g = CFG.GRAVITY * (hovering ? CFG.HOVER_GRAVITY_MULT : 1);

    if (!s.grounded) {
      s.vy -= g * dt;
      s.y += s.vy * dt;
      s.coyote = Math.max(0, s.coyote - dt);

      if (s.y <= s.groundY) {
        // Captured before it is zeroed — the squash depth comes from how hard
        // he was falling, so a big drop reads heavier than a hop.
        const impact = Math.abs(s.vy);
        s.y = s.groundY;
        s.vy = 0;
        s.grounded = true;
        s.jumpsUsed = 0;
        s.boardSpinV = 0;
        s.boardSpin = 0;
        s.landT = CFG.LAND_SQUASH_TIME * Math.min(1, impact / 11);
        if (s.buffer > 0) doJump();   // buffered press lands as a jump
      }
    } else {
      // Hover height can change mid-run when the upgrade is picked.
      s.y += (s.groundY - s.y) * (1 - Math.exp(-8 * dt));
      s.coyote = CFG.COYOTE_TIME;
    }

    s.buffer = Math.max(0, s.buffer - dt);
    s.invuln = Math.max(0, s.invuln - dt);
    s.grindCooldown = Math.max(0, s.grindCooldown - dt);
    s.landT = Math.max(0, s.landT - dt);

    // --- duck window ---
    if (s.ducking) {
      s.duckTimer -= dt;
      if (s.duckTimer <= 0 && !heldDuck) s.ducking = false;
    }

    animate(dt);
  }

  /* ---------------- procedural animation ---------------- */

  /**
   * Two-bone IK for one leg, in the sagittal plane.
   *
   * Hand-authoring hip and knee angles for every pose does not work: drop the
   * hips for a crouch and the folded shin swings straight through the road.
   * Solving instead means the soles stay planted on the deck at *any* hip
   * height, so a pose only has to say how low to sit and the knees follow.
   *
   * `drop` is the pose's hips offset. Returns the angles that put the ankle
   * back on the board.
   */
  const { HIP_Y, THIGH, SHIN, ANKLE_Y } = CFG.RIG;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function solveLeg(drop, bias) {
    // Distance from hip to ankle, clamped inside what the bones can span.
    const d = clamp(HIP_Y + drop - ANKLE_Y, 0.1, THIGH + SHIN - 0.002);
    const knee = Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
    const hip = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    // Straight leg solves to 0/0; folding swings the thigh forward and the
    // shin back, which is the direction a knee actually bends.
    return { hip: -hip + bias, knee: Math.PI - knee };
  }

  // Reused so the per-frame IK override allocates nothing.
  const solved = {};

  /** Which pose the current state wants, and how fast to ease into it. */
  function targetPose() {
    if (s.dead) return { pose: POSES.bail, rate: 7 };
    if (s.grinding) return { pose: POSES.grind, rate: 14 };
    if (s.ducking && s.grounded) return { pose: POSES.tuck, rate: 14 };
    if (!s.grounded) {
      // Rising off the pop, then settling into the float once gravity wins.
      return s.vy > 2.5 ? { pose: POSES.pop, rate: 22 } : { pose: POSES.float, rate: 10 };
    }
    return { pose: POSES.ride, rate: 11 };
  }

  function animate(dt) {
    const { root, board } = rig;

    root.position.set(s.x, s.y, 0);
    // Most of the lean now lives in the board and the body, not the root, so
    // a carve tips the deck onto its edge instead of tilting the whole rig
    // like a signpost.
    root.rotation.z = -s.leanZ * 0.16;
    root.rotation.y = -s.leanZ * 0.22;

    if (s.dead) {
      root.rotation.x += dt * 6;
      root.rotation.z += dt * 3;
      pose.blend(POSES.bail, dt, 7);
      pose.commit();
      return;
    }

    // Blink while invulnerable so the shield break is readable.
    root.visible = s.invuln <= 0 || Math.floor(s.invuln * 12) % 2 === 0;

    const t = targetPose();

    // With the feet on something, the legs are solved rather than posed. The
    // solve overrides the target *before* blending, not the rig afterwards,
    // so easing in and out of a state stays continuous — the legs are still
    // just channels in the same blend as everything else.
    let target = t.pose;
    if (s.grounded) {
      const drop = t.pose['hips.y'] || 0;
      const l = solveLeg(drop, 0.07);
      const r = solveLeg(drop, -0.05);
      for (const k in t.pose) solved[k] = t.pose[k];
      solved['legL.hip'] = l.hip;
      solved['legL.knee'] = l.knee;
      solved['legR.hip'] = r.hip;
      solved['legR.knee'] = r.knee;
      // Ankles keep the shoes flat on the deck as the knees fold.
      solved['legL.foot'] = -(l.hip + l.knee);
      solved['legR.foot'] = -(r.hip + r.knee);
      target = solved;
    }

    pose.blend(target, dt, t.rate);

    /* ---- additive layers, on top of the blend ---- */

    const rolling = s.grounded && !s.ducking && !s.grinding;

    // Ride bob: the loop that keeps him alive underneath everything else.
    if (rolling) {
      const f = s.animT * 6.5;
      pose.add('hips.y', Math.sin(f) * 0.022);
      pose.add('torso.rx', Math.sin(f + 0.7) * 0.05);
      pose.add('legL.knee', Math.sin(f) * 0.1);
      pose.add('legR.knee', -Math.sin(f) * 0.08);
      pose.add('armL.shz', Math.sin(f + 1.2) * 0.07);
      pose.add('armR.shz', -Math.sin(f + 1.2) * 0.07);
    }

    // Grind wobble: slower and wider than the ride bob — he is balancing.
    if (s.grinding) {
      const w = Math.sin(s.animT * 7.5);
      pose.add('torso.rz', w * 0.1);
      pose.add('armL.shz', w * 0.16);
      pose.add('armR.shz', w * 0.16);
      pose.add('hips.y', Math.abs(w) * 0.015);
    }

    // Carve: arms counter-swing, shoulders roll and the head turns into the
    // turn. Driven by the same leanZ the lane damping already produces.
    const lean = s.leanZ;
    pose.add('torso.rz', -lean * 0.24);
    pose.add('armL.shz', -lean * 0.45);
    pose.add('armR.shz', -lean * 0.45);
    pose.add('head.ry', lean * 0.4);
    pose.add('hips.rx', Math.abs(lean) * 0.12);

    // Landing squash: a decaying dip through the knees, so touching down has
    // weight instead of snapping straight to the ride pose.
    if (s.landT > 0) {
      const k = s.landT / CFG.LAND_SQUASH_TIME;
      pose.add('hips.y', -0.16 * k);
      pose.add('legL.knee', 0.5 * k);
      pose.add('legR.knee', 0.45 * k);
      pose.add('torso.rx', 0.2 * k);
    }

    /* ---- the board ---- */

    if (!s.grounded && !s.grinding) {
      s.boardSpin += s.boardSpinV * dt;
      pose.add('board.rx', s.boardSpinV > 0
        ? s.boardSpin
        : Math.max(-0.5, Math.min(0.5, s.vy * 0.045)));
    }
    // Tips onto its edge through a turn. The single clearest "he is riding
    // this thing" cue, and it did not exist before.
    pose.add('board.rz', -lean * 0.5);

    pose.commit();

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
    lastStacks = stacks;
    stats = next;

    rig.shield.visible = next.shieldCharges > 0;
    rig.hoverRing.visible = next.hoverHeight > 0;
    rig.magnetRing.visible = next.magnetRadius > 0;
    if (next.magnetRadius > 0) {
      // Ring grows with the pull radius so the upgrade's strength is visible.
      rig.magnetRing.scale.setScalar(Math.max(1, next.magnetRadius / 4.5));
    }

    // Goes through the same slot API as skins, so there is exactly one path
    // that recolours the rider rather than two that can disagree.
    rig.setSlot('deck', deckColour(stacks));

    // Wheels glow gold once coins are worth more.
    rig.setSlot('wheels', stacks.coinValue ? PAL.coin : PAL.wheel);
  }

  /**
   * The board is the readout for the build: whichever active upgrade is most
   * striking claims the deck colour, and the trail follows it. One list, used
   * by both, so they can never disagree.
   */
  function deckColour(stacks) {
    if (stacks.glassCannon) return PAL.gem;
    if (stacks.overdrive) return PAL.barrier;
    if (stacks.railRider) return PAL.rail;
    if (stacks.moonBoots) return PAL.crate;
    if (stacks.scoreMult) return PAL.multi;
    if (stacks.magnet) return PAL.magnet;
    if (stacks.hoverDeck) return PAL.hover;
    return PAL.deck;
  }

  /** Colour of the trail particles, so FX matches the board. */
  function trailColour(stacks) {
    return deckColour(stacks);
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
    s.grinding = null;
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
    // Must not survive a restart: the mesh it points at is handed back to the
    // track's pool by track.reset(), which runs just before this.
    s.grinding = null;
    s.grindTime = 0;
    s.grindCooldown = 0;
    s.landT = 0;

    const { root, board } = rig;
    root.position.set(s.x, 0, 0);
    root.rotation.set(0, 0, 0);
    root.visible = true;
    board.rotation.set(0, 0, 0);
    rig.shield.visible = false;
    rig.hoverRing.visible = false;
    rig.magnetRing.visible = false;
    // Straight to the ride pose — a run must never open mid-blend out of
    // whatever the last one ended in (usually the bail).
    pose.snap(POSES.ride);
    pose.commit();
    rig.setSlot('deck', PAL.deck);
    rig.setSlot('wheels', PAL.wheel);
  }

  /** Swap the rider's colours. `overrides` is slot → hex; {} restores stock. */
  function setSkin(overrides) {
    rig.applySkin(overrides);
    // The deck is upgrade-driven, so re-assert it over whatever the skin set.
    if (stats) applyStats(stats, lastStacks);
  }

  return {
    rig,
    state: s,
    get x() { return s.x; },
    get y() { return s.y; },
    get leanZ() { return s.leanZ; },
    get vy() { return s.vy; },
    get grounded() { return s.grounded; },
    get ducking() { return s.ducking; },
    get laneIndex() { return s.laneIndex; },
    get invuln() { return s.invuln; },
    set invuln(v) { s.invuln = v; },
    get grindTime() { return s.grindTime; },
    /** How far above the bar a landing still counts — widened by Rail Rider. */
    get grindSnap() { return stats ? stats.grindSnap : CFG.GRIND_SNAP; },
    moveLane, requestJump, launch, startDuck, endDuck,
    startGrind, endGrind, isGrinding, canGrind,
    update, applyStats, trailColour, getAABB, playDeath, reset, setSkin,
  };
}
