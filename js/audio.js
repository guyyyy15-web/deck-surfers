/**
 * audio.js — all sound is synthesised at runtime with WebAudio.
 *
 * That keeps the game asset-free (nothing binary is committed to the repo)
 * and suits the retro aesthetic: square and saw blips are exactly the right
 * texture. The AudioContext is created lazily on the first real gesture,
 * because mobile browsers refuse to start audio any other way.
 */

import { CFG } from './config.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  try {
    muted = localStorage.getItem(CFG.KEY_MUTED) === '1';
  } catch (e) { /* private mode — default to unmuted */ }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.32;
    master.connect(ctx.destination);

    // One short noise buffer, reused by every percussive sound.
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  function tone({ type = 'square', from, to, dur, gain = 0.5, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.12, gain = 0.4, freq = 1200, q = 1, type = 'bandpass', delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SOUNDS = {
    coin: () => tone({ type: 'square', from: 880, to: 1320, dur: 0.07, gain: 0.28 }),
    gem: () => {
      tone({ type: 'square', from: 880, to: 880, dur: 0.06, gain: 0.24 });
      tone({ type: 'square', from: 1320, to: 1320, dur: 0.06, gain: 0.24, delay: 0.06 });
      tone({ type: 'square', from: 1760, to: 1760, dur: 0.12, gain: 0.24, delay: 0.12 });
    },
    jump: () => tone({ type: 'sawtooth', from: 220, to: 520, dur: 0.12, gain: 0.22 }),
    airJump: () => tone({ type: 'sawtooth', from: 380, to: 760, dur: 0.14, gain: 0.22 }),
    land: () => noise({ dur: 0.08, gain: 0.22, freq: 400, q: 0.8, type: 'lowpass' }),
    ramp: () => tone({ type: 'triangle', from: 300, to: 900, dur: 0.22, gain: 0.28 }),
    crash: () => {
      noise({ dur: 0.5, gain: 0.5, freq: 900, q: 0.5, type: 'lowpass' });
      tone({ type: 'sawtooth', from: 300, to: 55, dur: 0.55, gain: 0.35 });
    },
    shield: () => {
      noise({ dur: 0.25, gain: 0.4, freq: 2400, q: 4 });
      tone({ type: 'sine', from: 1200, to: 400, dur: 0.28, gain: 0.25 });
    },
    choice: () => tone({ type: 'square', from: 660, to: 990, dur: 0.1, gain: 0.24 }),
    upgrade: () => {
      tone({ type: 'square', from: 523, to: 523, dur: 0.09, gain: 0.26 });
      tone({ type: 'square', from: 659, to: 659, dur: 0.09, gain: 0.26, delay: 0.09 });
      tone({ type: 'square', from: 784, to: 784, dur: 0.09, gain: 0.26, delay: 0.18 });
      tone({ type: 'square', from: 1047, to: 1047, dur: 0.2, gain: 0.26, delay: 0.27 });
    },
  };

  function play(name) {
    if (!ctx || muted) return;
    const fn = SOUNDS[name];
    if (fn) fn();
  }

  function setMuted(next) {
    muted = next;
    if (master) master.gain.value = muted ? 0 : 0.32;
    try {
      localStorage.setItem(CFG.KEY_MUTED, muted ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  return {
    unlock,
    play,
    setMuted,
    toggleMuted: () => { setMuted(!muted); return muted; },
    isMuted: () => muted,
  };
}
