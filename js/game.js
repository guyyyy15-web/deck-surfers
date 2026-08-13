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
import { CFG, PAL } from './config.js';
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
  };
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
  try {
    best = Number(localStorage.getItem(CFG.KEY_BEST)) || 0;
  } catch (e) { /* private mode */ }

  // Allow the verification harness (and curious players) to shorten the
  // distance between upgrade choices without rebuilding.
  const params = new URLSearchParams(location.search);
  const choiceEvery = Number(params.get('choiceEvery')) || CFG.CHOICE_EVERY_M;

  const ui = createUI({
    onPlay: () => { audio.unlock(); startRun(); },
    onRestart: () => { audio.unlock(); startRun(); },
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

    dyingTimer = 0;
    ui.resetHUD();
    ui.setUpgradeIcons([]);
    ui.updateHUD(run);
    ui.showHUD();
    state = STATE.PLAYING;
  }

  function die() {
    if (state !== STATE.PLAYING) return;
    state = STATE.DYING;
    dyingTimer = 0.9;
    player.playDeath();
    fx.burst(player.rig.root.position, PAL.barrier, 26, { speed: 6, ttl: 0.8 });
    fx.addShake(0.5);
    audio.play('crash');
  }

  function finishRun() {
    state = STATE.GAME_OVER;
    if (run.score > best) {
      best = run.score;
      try {
        localStorage.setItem(CFG.KEY_BEST, String(Math.floor(best)));
      } catch (e) { /* ignore */ }
      ui.setBest(best);
    }
    ui.showGameOver({
      score: run.score,
      distance: run.distance,
      coins: run.coins,
      best,
      upgrades: upgrades.activeList(),
    });
  }

  /* ---------------- upgrade choice ---------------- */

  function enterChoice() {
    if (state !== STATE.PLAYING) return;
    state = STATE.CHOICE_PAUSE;
    orbitT = 0;
    input.releaseAll();
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
  }

  function pause() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    input.releaseAll();
    ui.showScreen('paused');
  }

  function resume() {
    if (state !== STATE.PAUSED) return;
    state = STATE.PLAYING;
    ui.showHUD();
  }

  /* ---------------- collision handlers ---------------- */

  const collisionCtx = {
    onCoin(m) {
      run.coins++;
      run.score += upgrades.stats.coinValue * upgrades.stats.scoreMult;
      fx.burst(m.position, PAL.coin, 6, { speed: 2.6, ttl: 0.35 });
      audio.play('coin');
      track.removeCollectible(m);
    },
    onGem(m) {
      run.coins += 5;
      run.score += CFG.GEM_SCORE * upgrades.stats.scoreMult;
      fx.burst(m.position, PAL.gem, 14, { speed: 4, ttl: 0.6 });
      audio.play('gem');
      track.removeCollectible(m);
    },
    onCrate(m) {
      fx.burst(m.position, PAL.crate, 18, { speed: 4.5, ttl: 0.6 });
      track.removeCollectible(m);
      enterChoice();
    },
    onRamp(m) {
      player.launch(CFG.RAMP_LAUNCH_V);
      run.score += CFG.RAMP_BONUS * upgrades.stats.scoreMult;
      fx.burst(m.position, PAL.ramp, 14, { speed: 4, ttl: 0.5 });
      audio.play('ramp');
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
    audio.unlock();
    if (state === STATE.MENU || state === STATE.GAME_OVER) startRun();
    else if (state === STATE.PAUSED) resume();
  });

  /* ---------------- simulation ---------------- */

  const trailPos = new THREE.Vector3();

  function step(dt) {
    const stats = upgrades.stats;

    run.time += dt;
    run.speed = Math.min(
      CFG.MAX_SPEED,
      CFG.BASE_SPEED + run.time * CFG.SPEED_RAMP * stats.speedRampScale
    );

    const moved = run.speed * dt;
    run.distance += moved;
    run.score += moved * CFG.SCORE_PER_METRE * stats.scoreMult;

    player.update(dt, input.isHeld('duck'));
    track.update(dt, run.speed, run.distance);
    world.updateGround(run.distance);

    magnetPass(player, track.collectibles, stats.magnetRadius, run.distance, dt);
    checkCollisions(player, track, run.distance, collisionCtx);

    // Board trail — colour follows the active upgrades.
    if (player.grounded && !player.state.dead) {
      trailPos.set(player.x, 0.05, 0);
      fx.trail(trailPos, player.trailColour(upgrades.stacks), 26, dt);
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
        ui.updateHUD(run);
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
    // Hooks used by the verification harness.
    debugTriggerChoice: () => enterChoice(),
    debugKill: () => die(),
    debugStats: () => ({ ...upgrades.stats }),
    debugPools: () => track.poolSizes(),
    debugRender: () => world.stats(),
    selfTest: (n) => track.selfTest(n),
  };
}
