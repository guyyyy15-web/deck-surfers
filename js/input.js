/**
 * input.js — turns keyboard and touch into semantic actions.
 *
 * Nothing downstream ever sees a KeyboardEvent or a PointerEvent: the player
 * controller and the UI both subscribe to the same action names, which is why
 * desktop and mobile need no separate code paths anywhere else.
 *
 * Actions: left | right | jump | duck | duckEnd | confirm | pause | choice
 */

const SWIPE_THRESHOLD = 28;   // px before a drag counts as a swipe
const TAP_MAX_DIST = 14;      // px of movement still considered a tap
const TAP_MAX_TIME = 260;     // ms

export function createInput(target) {
  const listeners = new Map();
  const held = new Set();

  function on(action, cb) {
    if (!listeners.has(action)) listeners.set(action, new Set());
    listeners.get(action).add(cb);
    return () => off(action, cb);
  }
  function off(action, cb) {
    const set = listeners.get(action);
    if (set) set.delete(cb);
  }
  function emit(action, payload) {
    const set = listeners.get(action);
    if (set) for (const cb of set) cb(payload);
  }

  /* ---------------- keyboard ---------------- */

  const KEY_ACTIONS = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', Spacebar: 'jump',
    ArrowDown: 'duck', s: 'duck', S: 'duck',
    Enter: 'confirm',
    Escape: 'pause', p: 'pause', P: 'pause',
  };

  function onKeyDown(e) {
    if (e.key >= '1' && e.key <= '3') {
      emit('choice', Number(e.key) - 1);
      return;
    }
    const action = KEY_ACTIONS[e.key];
    if (!action) return;

    // Arrows and space would otherwise scroll the page.
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    if (e.repeat) return;

    held.add(action);
    emit(action);
  }

  function onKeyUp(e) {
    const action = KEY_ACTIONS[e.key];
    if (!action) return;
    held.delete(action);
    if (action === 'duck') emit('duckEnd');
  }

  /* ---------------- touch / pointer ---------------- */

  let start = null;
  let swiped = false;

  function onPointerDown(e) {
    if (e.pointerType === 'mouse') return; // mouse plays with the keyboard
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    swiped = false;
  }

  function onPointerMove(e) {
    if (!start || swiped) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    // Fire as soon as the threshold is crossed rather than waiting for
    // pointerup — a runner has to feel immediate.
    swiped = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      emit(dx > 0 ? 'right' : 'left');
    } else if (dy < 0) {
      emit('jump');
    } else {
      emit('duck');
      // A swipe has no "hold", so schedule the release ourselves.
      setTimeout(() => emit('duckEnd'), 520);
    }
  }

  function onPointerUp(e) {
    if (!start) return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    const dt = performance.now() - start.t;
    if (!swiped && dist < TAP_MAX_DIST && dt < TAP_MAX_TIME) {
      emit('confirm');
      emit('jump');
    }
    start = null;
    swiped = false;
  }

  function onPointerCancel() {
    start = null;
    swiped = false;
  }

  /* ---------------- wiring ---------------- */

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointerdown', onPointerDown, { passive: true });
  target.addEventListener('pointermove', onPointerMove, { passive: true });
  target.addEventListener('pointerup', onPointerUp, { passive: true });
  target.addEventListener('pointercancel', onPointerCancel, { passive: true });
  // Belt and braces against iOS rubber-banding during a swipe.
  target.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  /** Drop every held key — used on pause and on window blur so a held duck
   *  can't survive a state change. */
  function releaseAll() {
    const wasDucking = held.has('duck');
    held.clear();
    start = null;
    swiped = false;
    if (wasDucking) emit('duckEnd');
  }

  window.addEventListener('blur', releaseAll);

  return {
    on,
    off,
    isHeld: (action) => held.has(action),
    releaseAll,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      listeners.clear();
      held.clear();
    },
  };
}
