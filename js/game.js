/**
 * game.js — state machine, run state, scoring and the main loop.
 *
 * The reset guarantee the whole rogue-lite design rests on lives in
 * `startRun()`: it is the single entry point for both "Play" and "Restart
 * Run", and it rebuilds the run state and resets every subsystem. There is
 * no code path that starts a run without going through it, so upgrades
 * cannot leak from one run into the next.
 */

import * as THREE from '../vendor/three.module.min.js';
import { CFG, PAL, phaseFor } from './config.js';
import { makeRng } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createTrackGenerator } from './track.js';
import { createUpgradeManager } from './upgrades.js';
import { createFX } from './fx.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { magnetPass, checkCollisions } from './collision.js';

export const STATE = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  CHOICE_PAUSE: 'CHOICE_PAUSE',
  DYING: 'DYING',
  GAME_OVER: 'GAME_OVER',
  PAUSED: 'PAUSED',
};

function createRunState() {
  return {
    score: 0,
    distance: 0,
    coins: 0,
    speed: CFG.BASE_SPEED,
    time: 0,
    nextChoiceAt: CFG.CHOICE_EVERY_M,
    choicesTaken: 0,
    // ---- combo ----
    combo: 0,
    comboTimer: 0,
    comboWindowMax: CFG.COMBO_WINDOW,
    comboBest: 0,
    nextMilestone: CFG.COMBO_MILESTONE,
    phaseIndex: 0,
  };
}

/**
 * The combo multiplier. This scales *every* score award, distance included,
 * which is the whole point: holding a clear lane scores ×1, while a player
 * who keeps touching the track earns up to COMBO_MULT_MAX.
 */
function comboMult(combo) {
  return 1 + Math.min(CFG.COMBO_MULT_MAX - 1, combo * CFG.COMBO_MULT_PER);
}

export function createGame({ canvas }) {
  let rng = makeRng();

  const world = createWorld(canvas);
  const fx = createFX(world.scene);
  const player = createPlayer(world.scene);
  const track = createTrackGenerator(world.scene, rng);
  const upgrades = createUpgradeManager(rng);
  const audio = createAudio();
  const input = createInput(canvas);

  let state = STATE.MENU;
  let run = createRunState();
  let dyingTimer = 0;
  let orbitT = 0;
  let best = 0;
  let bestDist = 0;
  try {
    best = Number(localStorage.getItem(CFG.KEY_BEST)) || 0;
    bestDist = Number(localStorage.getItem(CFG.KEY_BEST_DIST)) || 0;
  } catch (e) { /* private mode */ }

  // Allow the verification harness (and curious players) to shorten the
  // distance between upgrade choices without rebuilding.
  const params = new URLSearchParams(location.search);
  const choiceEvery = Number(params.get('choiceEvery')) || CFG.CHOICE_EVERY_M;

  const MUSIC_MENU = 0.5;
  const MUSIC_RUN = 0.26;

  /** Audio can only start from a real gesture, so every entry point that
   *  follows one unlocks and kicks the loop off. startMusic() is idempotent. */
  function wakeAudio() {
    audio.unlock();
    audio.startMusic();
  }

  const ui = createUI({
    onPlay: () => { wakeAudio(); startRun(); },
    onRestart: () => { wakeAudio(); startRun(); },
    onResume: () => resume(),
    onPickUpgrade: (id) => pickUpgrade(id),
    onToggleMute: () => ui.setMuted(audio.toggleMuted()),
  });

  ui.setBest(best);
  ui.setMuted(audio.isMuted());

  // Board visuals follow the upgrade set automatically.
  upgrades.onChange((stats, stacks) => {
    player.applyStats(stats, stacks);
    if (state === STATE.PLAYING) ui.setUpgradeIcons(upgrades.activeList());
  });
  upgrades.recompute();

  track.warm();

  /* ---------------- run lifecycle ---------------- */

  function startRun() {
    rng = makeRng();
    upgrades.reset(rng);      // replaces stacks/stats wholesale
    track.reset(rng);
    player.reset();
    fx.reset();
    world.resetGround();
    run = createRunState();
    run.nextChoiceAt = choiceEvery;

    // The grind loop is the one sound that outlives its trigger, so every
    // path out of PLAYING has to close it — including restarting mid-grind.
    audio.stopGrind();
    grindScore = 0;
    grindComboAcc = 0;

    dyingTimer = 0;
    ui.resetHUD();
    ui.setUpgradeIcons([]);
    ui.updateHUD(run);
    ui.showHUD();
    audio.setMusicLevel(MUSIC_RUN);

    // Back to phase 0's palette instantly — a run should never open mid-fade
    // in the colours of wherever the last one ended.
    world.setPhase(phaseFor(0), true);
    world.setBestMarker(bestDist);

    state = STATE.PLAYING;
  }

  function die() {
    if (state !== STATE.PLAYING) return;

    // Second Wind catches the wipeout itself, after a shield would already
    // have failed — so the two upgrades stack rather than overlapping.
    if (upgrades.consumeRevive()) {
      player.invuln = CFG.REVIVE_INVULN;
      fx.burst(player.rig.root.position, PAL.hover, 30, { speed: 6, ttl: 0.9 });
      fx.addShake(0.35);
      audio.play('revive');
      audio.stopGrind();
      dropCombo(true);
      ui.popup('SECOND WIND', player.rig.root.position, 'combo');
      ui.setUpgradeIcons(upgrades.activeList());
      return;
    }

    state = STATE.DYING;
    dyingTimer = 0.9;
    audio.stopGrind();
    dropCombo(true);
    player.playDeath();
    fx.burst(player.rig.root.position, PAL.barrier, 26, { speed: 6, ttl: 0.8 });
    fx.addShake(0.5);
    audio.play('crash');
  }

  function finishRun() {
    state = STATE.GAME_OVER;
    audio.setMusicLevel(MUSIC_MENU);

    const beatScore = run.score > best;
    if (beatScore) {
      best = run.score;
      try {
        localStorage.setItem(CFG.KEY_BEST, String(Math.floor(best)));
      } catch (e) { /* ignore */ }
      ui.setBest(best);
    }
    // Tracked separately from the score: the ghost marker needs a distance,
    // and the best score isn't always set on the longest run.
    if (run.distance > bestDist) {
      bestDist = run.distance;
      try {
        localStorage.setItem(CFG.KEY_BEST_DIST, String(Math.floor(bestDist)));
      } catch (e) { /* ignore */ }
    }

    ui.showGameOver({
      score: run.score,
      distance: run.distance,
      coins: run.coins,
      best,
      newBest: beatScore,
      comboBest: run.comboBest,
      upgrades: upgrades.activeList(),
    });
  }

  /* ---------------- upgrade choice ---------------- */

  function enterChoice() {
    if (state !== STATE.PLAYING) return;
    state = STATE.CHOICE_PAUSE;
    orbitT = 0;
    input.releaseAll();
    audio.stopGrind();
    audio.play('choice');
    ui.showChoice(upgrades.roll(CFG.CHOICE_COUNT));
  }

  function pickUpgrade(id) {
    if (state !== STATE.CHOICE_PAUSE) return;
    upgrades.apply(id, run);
    run.choicesTaken++;
    audio.play('upgrade');
    fx.burst(player.rig.root.position, PAL.multi, 22, { speed: 4.5, ttl: 0.7 });
    ui.setUpgradeIcons(upgrades.activeList());
    ui.showHUD();
    state = STATE.PLAYING;
    if (player.isGrinding()) audio.startGrind();
  }

  function pause() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    input.releaseAll();
    audio.stopGrind();
    ui.showScreen('paused');
  }

  function resume() {
    if (state !== STATE.PAUSED) return;
    state = STATE.PLAYING;
    ui.showHUD();
    if (player.isGrinding()) audio.startGrind();
  }

  /* ---------------- combo ---------------- */

  /** Award score through both multipliers. The single place score is added. */
  function award(points) {
    run.score += points * comboMult(run.combo) * upgrades.stats.scoreMult;
  }

  /** Feed the combo and refresh its window. */
  function bumpCombo(points) {
    run.combo += points;
    // Long Fuse widens the window, so the meter has to remember what "full"
    // means for this run rather than assuming the base value.
    run.comboWindowMax = upgrades.stats.comboWindow;
    run.comboTimer = run.comboWindowMax;
    if (run.combo > run.comboBest) run.comboBest = run.combo;

    while (run.combo >= run.nextMilestone) {
      run.nextMilestone += CFG.COMBO_MILESTONE;
      fx.burst(player.rig.root.position, PAL.multi, 16, { speed: 4.2, ttl: 0.6 });
      fx.addShake(0.12);
      audio.play('comboUp', { semitones: Math.min(12, run.combo / CFG.COMBO_MILESTONE * 2) });
      ui.popup(`×${comboMult(run.combo).toFixed(1)}`, player.rig.root.position, 'combo');
    }
  }

  // Accumulated across a single grind, so the dismount popup can report what
  // the whole trick was worth.
  let grindScore = 0;
  let grindComboAcc = 0;

  /**
   * Ride the rail: score accrues per second and the combo ticks, so a long
   * grind is worth roughly a coin every quarter second on top of the points.
   */
  function updateGrind(dt) {
    if (!player.isGrinding()) return;

    const points = CFG.GRIND_SCORE_PER_SEC * dt * upgrades.stats.grindMult;
    award(points);
    grindScore += points;

    grindComboAcc += dt;
    while (grindComboAcc >= CFG.GRIND_COMBO_INTERVAL) {
      grindComboAcc -= CFG.GRIND_COMBO_INTERVAL;
      bumpCombo(1);
    }

    // Sparks off the trucks. Reuses the board-trail emitter, just tinted and
    // lifted to the height of the bar.
    trailPos.set(player.x, player.y + 0.05, 0);
    fx.trail(trailPos, PAL.multi, 40, dt);
  }

  /** Close out a grind however it ended, and report what it was worth. */
  function finishGrind() {
    audio.stopGrind();
    if (grindScore >= 1) {
      ui.popup(`GRIND +${Math.round(grindScore)}`, player.rig.root.position, 'grind');
    }
    grindScore = 0;
    grindComboAcc = 0;
  }

  /** The combo lapsed. Nothing is taken away — it was banked as it was earnt. */
  function dropCombo(silent) {
    if (run.combo <= 0) return;
    run.combo = 0;
    run.comboTimer = 0;
    run.nextMilestone = CFG.COMBO_MILESTONE;
    if (!silent) audio.play('comboDrop');
  }

  /* ---------------- collision handlers ---------------- */

  const collisionCtx = {
    onCoin(m) {
      run.coins++;
      award(upgrades.stats.coinValue);
      bumpCombo(CFG.COMBO_COIN);
      fx.burst(m.position, PAL.coin, 6, { speed: 2.6, ttl: 0.35 });
      // Pitch climbs with the combo tier — the cheapest satisfaction in the
      // game, and it makes a long chain audible without looking at the HUD.
      audio.play('coin', { semitones: Math.min(14, Math.floor(run.combo / 5)) });
      track.removeCollectible(m);
    },
    onGem(m) {
      run.coins += 5;
      award(CFG.GEM_SCORE);
      bumpCombo(CFG.COMBO_GEM);
      fx.burst(m.position, PAL.gem, 14, { speed: 4, ttl: 0.6 });
      audio.play('gem');
      ui.popup(`+${CFG.GEM_SCORE}`, m.position, 'gem');
      track.removeCollectible(m);
    },
    onCrate(m) {
      fx.burst(m.position, PAL.crate, 18, { speed: 4.5, ttl: 0.6 });
      track.removeCollectible(m);
      enterChoice();
    },
    onRamp(m) {
      player.launch(CFG.RAMP_LAUNCH_V);
      award(CFG.RAMP_BONUS);
      bumpCombo(CFG.COMBO_RAMP);
      fx.burst(m.position, PAL.ramp, 14, { speed: 4, ttl: 0.5 });
      audio.play('ramp');
      ui.popup(`AIR +${CFG.RAMP_BONUS}`, m.position, 'ramp');
    },
    /** Landed on top of a rail. collision.js has already vetted the approach. */
    onGrind(m) {
      if (!player.startGrind(m)) return;
      grindScore = 0;
      grindComboAcc = 0;
      award(CFG.GRIND_MOUNT_SCORE);
      grindScore += CFG.GRIND_MOUNT_SCORE;
      fx.burst(player.rig.root.position, PAL.rail, 14, { speed: 4, ttl: 0.4 });
      audio.play('grindOn');
      audio.startGrind();
    },
    /** A dodge or a clearance that came genuinely close. See collision.js. */
    onNearMiss(m, kind) {
      const mult = upgrades.stats.nearMissMult;
      award(CFG.NEAR_MISS_SCORE * mult);
      bumpCombo(CFG.COMBO_NEAR_MISS * mult);
      audio.play('nearMiss');
      ui.popup(kind === 'clear' ? 'CLEAR!' : 'CLOSE!', m.position, 'near');
    },
    onHit(m) {
      if (player.invuln > 0) return;
      if (upgrades.consumeShield()) {
        player.invuln = CFG.SHIELD_INVULN;
        fx.burst(m.position, PAL.shield, 24, { speed: 5.5, ttl: 0.7 });
        fx.addShake(0.28);
        audio.play('shield');
        track.removeObstacle(m);
        ui.setUpgradeIcons(upgrades.activeList());
        // Surviving isn't a combo event, so the chain lapses unless the
        // player re-engages: a real cost, without being punitive.
        dropCombo(true);
        return;
      }
      die();
    },
  };

  /* ---------------- input wiring ---------------- */

  input.on('left', () => {
    if (state === STATE.PLAYING) player.moveLane(-1);
  });
  input.on('right', () => {
    if (state === STATE.PLAYING) player.moveLane(1);
  });
  input.on('jump', () => {
    if (state !== STATE.PLAYING) return;
    const wasGrounded = player.grounded;
    if (player.requestJump()) audio.play(wasGrounded ? 'jump' : 'airJump');
  });
  input.on('duck', () => {
    if (state === STATE.PLAYING) player.startDuck();
  });
  input.on('duckEnd', () => {
    if (state === STATE.PLAYING) player.endDuck();
  });
  input.on('pause', () => {
    if (state === STATE.PLAYING) pause();
    else if (state === STATE.PAUSED) resume();
  });
  input.on('choice', (i) => {
    if (state === STATE.CHOICE_PAUSE) ui.pickByIndex(i);
  });
  input.on('confirm', () => {
    wakeAudio();
    if (state === STATE.MENU || state === STATE.GAME_OVER) startRun();
    else if (state === STATE.PAUSED) resume();
  });

  /* ---------------- simulation ---------------- */

  const trailPos = new THREE.Vector3();

  /**
   * One fixed-length slice of simulation. Everything that moves the world or
   * tests collision lives here rather than in `step`, so it always runs at a
   * bounded dt — see CFG.SUBSTEP_DT for why that is load-bearing.
   */
  function stepOnce(dt) {
    const stats = upgrades.stats;

    run.time += dt;
    // The speed cap itself creeps past DIFFICULTY_DISTANCE, so there is no
    // point at which the street stops getting faster.
    const cap = Math.min(
      CFG.ABSOLUTE_MAX_SPEED,
      CFG.MAX_SPEED
        + Math.max(0, run.distance - CFG.DIFFICULTY_DISTANCE) / CFG.ENDLESS_SPEED_DIV
    );
    run.speed = Math.min(
      cap,
      CFG.BASE_SPEED + run.time * CFG.SPEED_RAMP * stats.speedRampScale
    );

    const moved = run.speed * dt;
    run.distance += moved;
    award(moved * CFG.SCORE_PER_METRE);

    // Combo decay. Expiring costs nothing already banked — it just ends the
    // chain, so the pressure is to keep engaging rather than to avoid loss.
    if (run.combo > 0) {
      run.comboTimer -= dt;
      if (run.comboTimer <= 0) dropCombo(false);
    }

    // A grind can end inside player.update (ran out of rail) or from input
    // (jumped, carved, or dropped off), so the transition is detected here
    // rather than in any one of those places.
    const wasGrinding = player.isGrinding();

    player.update(dt, input.isHeld('duck'));
    track.update(dt, run.speed, run.distance);
    world.updateGround(run.distance);

    magnetPass(player, track.collectibles, stats.magnetRadius, run.distance, dt);
    checkCollisions(player, track, run.distance, collisionCtx);

    updateGrind(dt);
    if (wasGrinding && !player.isGrinding()) finishGrind();

    // Board trail — colour follows the active upgrades. Grinding has its own
    // sparks, so this would only double up.
    if (player.grounded && !player.state.dead && !player.isGrinding()) {
      trailPos.set(player.x, 0.05, 0);
      fx.trail(trailPos, player.trailColour(upgrades.stacks), 26, dt);
    }
  }

  function step(dt) {
    // Split the frame so no single collision test can be outrun. A dropped
    // frame therefore costs frame rate, never correctness.
    const n = Math.max(1, Math.ceil(dt / CFG.SUBSTEP_DT));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      stepOnce(h);
      // A substep can kill the player or open a crate; stop simulating the
      // moment we are no longer in a running state.
      if (state !== STATE.PLAYING) return;
    }

    // --- things that only need deciding once per frame ---

    const phaseIndex = Math.floor(run.distance / CFG.PHASE_LENGTH);
    if (phaseIndex !== run.phaseIndex) {
      run.phaseIndex = phaseIndex;
      const phase = phaseFor(run.distance);
      world.setPhase(phase, false);
      ui.showPhaseBanner(phase.name);
      audio.play('phase');
    }

    if (run.distance >= run.nextChoiceAt) {
      run.nextChoiceAt += choiceEvery;
      enterChoice();
    }
  }

  /* ---------------- main loop ---------------- */

  let lastTime = performance.now();
  let frameAcc = 0;
  let frameCount = 0;
  let slowFor = 0;
  let running = false;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    let dt = (now - lastTime) / 1000;
    lastTime = now;
    // Clamp so a backgrounded tab can't tunnel the player through anything.
    dt = Math.min(dt, CFG.MAX_FRAME_DT);
    if (dt <= 0) return;

    switch (state) {
      case STATE.PLAYING:
        step(dt);
        fx.update(dt);
        world.updateCamera(player, dt, fx.updateShake(dt));
        ui.updateHUD(run, comboMult(run.combo));
        break;

      case STATE.DYING:
        dyingTimer -= dt;
        player.update(dt, false);
        fx.update(dt);
        world.updateCamera(player, dt, fx.updateShake(dt));
        if (dyingTimer <= 0) finishRun();
        break;

      case STATE.CHOICE_PAUSE:
        // The world is frozen simply by not stepping it: nothing accumulates,
        // so resuming is seamless with no catch-up jump.
        orbitT += dt;
        fx.update(dt * 0.15);
        world.orbitCamera(orbitT);
        break;

      case STATE.MENU:
      case STATE.GAME_OVER:
      case STATE.PAUSED:
      default:
        orbitT += dt;
        world.orbitCamera(orbitT);
        fx.update(dt * 0.4);
        break;
    }

    // Phase colour fade and screen-space popups advance in every state, so
    // neither freezes awkwardly on the choice screen or the death sequence.
    world.updatePhase(dt);
    ui.updatePopups(dt, world.camera);

    world.render();
    trackPerformance(dt);
  }

  /** One-way quality degradation if we can't hold a decent frame rate. */
  function trackPerformance(dt) {
    frameAcc += dt;
    frameCount++;
    if (frameAcc < 1) return;
    const fps = frameCount / frameAcc;
    frameAcc = 0;
    frameCount = 0;
    if (fps < 45) {
      slowFor++;
      if (slowFor >= 2) {
        world.setQualityStep(world.qualityStep + 1);
        slowFor = 0;
      }
    } else {
      slowFor = 0;
    }
  }

  function start() {
    running = true;
    lastTime = performance.now();
    ui.showScreen('menu');
    state = STATE.MENU;

    // Browsers refuse to start audio without a gesture, so the menu loop
    // begins on the first interaction of any kind rather than only on PLAY.
    const kick = () => wakeAudio();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });

    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
  }

  /* ---------------- misc ---------------- */

  window.addEventListener('visibilitychange', () => {
    if (document.hidden && state === STATE.PLAYING) pause();
    lastTime = performance.now();
  });

  const onResize = () => world.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  return {
    start, stop, startRun, pause, resume,
    world, player, track, upgrades, fx, audio, ui, input,
    get state() { return state; },
    get run() { return run; },
    get best() { return best; },
    get bestDist() { return bestDist; },
    // Hooks used by the verification harness.
    debugTriggerChoice: () => enterChoice(),
    debugKill: () => die(),
    debugStats: () => ({ ...upgrades.stats }),
    debugPools: () => track.poolSizes(),
    debugRender: () => world.stats(),
    selfTest: (n) => track.selfTest(n),
  };
}
