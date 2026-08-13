/**
 * main.js — bootstrap.
 *
 * Keeps the entry point tiny: find the canvas, build the game, start the
 * loop. The game object is exposed on `window.__RUNNER` so the browser
 * console (and the Playwright verification suite) can inspect run state,
 * trigger an upgrade choice, or run the track fairness self-test.
 */

import { createGame } from './game.js';

function boot() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  // Probe on a throwaway canvas: acquiring a context on the real one would
  // hand three.js a context it didn't configure.
  const probeCanvas = document.createElement('canvas');
  const probe = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
  if (!probe) {
    document.body.innerHTML =
      '<div class="noscript">This browser can\'t start WebGL, so Deck Runner ' +
      'can\'t run. Try a current Chrome, Firefox, Edge or Safari with hardware ' +
      'acceleration enabled.</div>';
    return;
  }

  const game = createGame({ canvas });
  window.__RUNNER = game;
  game.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
