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

  // Transposition applied to `tone` for the duration of one play() call.
  // Music schedules its own notes and never goes through play(), so it is
  // unaffected.
  let pitch = 1;

  function tone({ type = 'square', from, to, dur, gain = 0.5, delay = 0 }) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from * pitch, t0);
    if (to && to !== from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to * pitch), t0 + dur);
    }
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
    // Short and dry: a near miss fires often, so it has to sit under the
    // music rather than punch through it.
    nearMiss: () => {
      noise({ dur: 0.09, gain: 0.16, freq: 3200, q: 6 });
      tone({ type: 'triangle', from: 1200, to: 1800, dur: 0.07, gain: 0.14 });
    },
    comboUp: () => {
      tone({ type: 'square', from: 784, to: 784, dur: 0.06, gain: 0.2 });
      tone({ type: 'square', from: 1175, to: 1175, dur: 0.1, gain: 0.2, delay: 0.06 });
    },
    comboDrop: () => tone({ type: 'triangle', from: 520, to: 240, dur: 0.16, gain: 0.14 }),
    // The clack of trucks landing on the bar.
    grindOn: () => {
      noise({ dur: 0.07, gain: 0.3, freq: 1800, q: 2 });
      tone({ type: 'square', from: 300, to: 200, dur: 0.06, gain: 0.16 });
    },
    phase: () => {
      tone({ type: 'sine', from: 330, to: 660, dur: 0.35, gain: 0.2 });
      tone({ type: 'sine', from: 495, to: 990, dur: 0.35, gain: 0.14, delay: 0.05 });
    },
    revive: () => {
      tone({ type: 'sine', from: 220, to: 880, dur: 0.5, gain: 0.3 });
      tone({ type: 'square', from: 440, to: 1320, dur: 0.4, gain: 0.16, delay: 0.08 });
      noise({ dur: 0.4, gain: 0.22, freq: 3000, q: 2 });
    },
    choice: () => tone({ type: 'square', from: 660, to: 990, dur: 0.1, gain: 0.24 }),
    upgrade: () => {
      tone({ type: 'square', from: 523, to: 523, dur: 0.09, gain: 0.26 });
      tone({ type: 'square', from: 659, to: 659, dur: 0.09, gain: 0.26, delay: 0.09 });
      tone({ type: 'square', from: 784, to: 784, dur: 0.09, gain: 0.26, delay: 0.18 });
      tone({ type: 'square', from: 1047, to: 1047, dur: 0.2, gain: 0.26, delay: 0.27 });
    },
  };

  /**
   * `opts.semitones` transposes the whole sound. Used to walk the coin blip
   * up as a combo builds, which makes a long chain audible without the
   * player having to watch the HUD. Existing callers pass nothing.
   */
  /* ------------------------------------------------------------------ */
  /* Sustained grind                                                     */
  /* ------------------------------------------------------------------ */

  // Every other sound here is a one-shot. A grind has to last as long as the
  // player is on the rail, so it is a looping noise source held open between
  // startGrind and stopGrind, gain-ramped at both ends so it can't click.
  let grindNodes = null;

  function startGrind() {
    if (!ctx || muted || grindNodes) return;
    const t0 = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2100;
    band.Q.value = 3.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.04);

    src.connect(band).connect(g).connect(master);
    src.start(t0);
    grindNodes = { src, gain: g };
  }

  function stopGrind() {
    if (!grindNodes) return;
    const { src, gain } = grindNodes;
    grindNodes = null;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // Ramp down rather than cutting, then stop once silent.
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    try {
      src.stop(t0 + 0.08);
    } catch (e) { /* already stopped */ }
  }

  function play(name, opts) {
    if (!ctx || muted) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const semis = opts && opts.semitones ? opts.semitones : 0;
    pitch = Math.pow(2, semis / 12);
    fn();
    pitch = 1;
  }

  function setMuted(next) {
    muted = next;
    if (master) master.gain.value = muted ? 0 : 0.32;
    try {
      localStorage.setItem(CFG.KEY_MUTED, muted ? '1' : '0');
    } catch (e) { /* ignore */ }
  }


  /* ------------------------------------------------------------------ */
  /* Music                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * A synthesised boom-bap loop for the menu — kick, snare, hats, a sub
   * bassline and a minor-key stab. No audio files: it is all oscillators
   * plus the same noise buffer the SFX use.
   *
   * Timing comes from a lookahead scheduler rather than setTimeout alone.
   * Queueing each note against `ctx.currentTime` a little ahead of when it
   * sounds is what keeps a loop from drifting audibly.
   */
  const BPM = 90;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 4;             // sixteenth notes
  const STEPS = 64;                  // four bars
  const LOOKAHEAD = 0.12;            // seconds queued ahead of the clock

  // A minor: bass root per bar, and a stab chord voicing.
  const BASS = [55.00, 55.00, 73.42, 65.41];       // A1  A1  D2  C2
  const STAB = [[220.0, 261.6, 329.6], [246.9, 293.7, 349.2]];  // Am, Bdim-ish

  let musicGain = null;
  let timer = null;
  let step = 0;
  let nextTime = 0;

  function kick(t) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g).connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  function snare(t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    src.connect(bp).connect(g).connect(musicGain);
    src.start(t);
    src.stop(t + 0.19);
  }

  function hat(t, open) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const dur = open ? 0.16 : 0.045;
    g.gain.setValueAtTime(open ? 0.16 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g).connect(musicGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function bass(t, freq, dur) {
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function stab(t, chord) {
    // Two detuned saws per note through a lowpass — cheap and suitably lo-fi.
    for (const f of chord) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = detune;
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2200, t);
        lp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        osc.connect(lp).connect(g).connect(musicGain);
        osc.start(t);
        osc.stop(t + 0.36);
      }
    }
  }

  /** One sixteenth-note step of the pattern. */
  function scheduleStep(i, t) {
    const inBar = i % 16;
    const bar = Math.floor(i / 16);

    // Boom-bap skeleton: kick on 1 and the "and" of 3, snare on 2 and 4.
    if (inBar === 0 || inBar === 10) kick(t);
    if (inBar === 6 && bar % 2 === 1) kick(t);
    if (inBar === 4 || inBar === 12) snare(t);
    if (inBar % 2 === 0) hat(t, inBar === 14);

    if (inBar === 0) bass(t, BASS[bar], BEAT * 1.4);
    if (inBar === 8) bass(t, BASS[bar] * 1.5, BEAT * 0.5);

    // Stab only on bars 2 and 4 so the loop doesn't fatigue.
    if (inBar === 2 && (bar === 1 || bar === 3)) stab(t, STAB[bar === 1 ? 0 : 1]);
  }

  function tick() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step % STEPS, nextTime);
      step++;
      nextTime += STEP;
    }
  }

  /** Start (or fade back in) the menu loop. */
  function startMusic() {
    if (!ctx || timer) return;
    if (!musicGain) {
      musicGain = ctx.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(master);
    }
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.8);
    tick();
    timer = setInterval(tick, 25);
  }

  /** Fade out and stop — called when a run begins, so SFX stay readable. */
  function stopMusic(fade = 0.6) {
    if (!ctx || !timer) return;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t);
    musicGain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    clearInterval(timer);
    timer = null;
  }

  /** Duck the music without stopping it — used while a run is in progress
   *  so the coin and jump blips stay readable over the beat. */
  function setMusicLevel(level, fade = 0.5) {
    if (!ctx || !musicGain) return;
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t);
    musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, level), t + fade);
  }

  function musicPlaying() {
    return timer !== null;
  }

  return {
    unlock,
    play,
    setMuted,
    startGrind,
    stopGrind,
    startMusic,
    stopMusic,
    setMusicLevel,
    musicPlaying,
    toggleMuted: () => { setMuted(!muted); return muted; },
    isMuted: () => muted,
  };
}
