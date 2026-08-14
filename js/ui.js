/**
 * ui.js — the DOM overlay: screens, HUD, upgrade cards, summary.
 *
 * All UI is DOM rather than in-canvas. The 3D layer is deliberately rendered
 * at a low resolution, so drawing text into it would make the text chunky
 * too; keeping it in the DOM means crisp type at native DPI, responsive
 * layout for free, and real focusable buttons.
 *
 * HUD values are only written when their rendered form actually changes —
 * per-frame innerHTML churn is the usual reason DOM-overlay games stutter.
 */

import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';

export function createUI(handlers) {
  const screens = {};
  for (const el of document.querySelectorAll('[data-screen]')) {
    screens[el.dataset.screen] = el;
  }

  const el = {
    score: document.getElementById('hud-score'),
    distance: document.getElementById('hud-distance'),
    coins: document.getElementById('hud-coins'),
    upgrades: document.getElementById('hud-upgrades'),
    menuBest: document.getElementById('menu-best'),
    overScore: document.getElementById('over-score'),
    overDistance: document.getElementById('over-distance'),
    overCoins: document.getElementById('over-coins'),
    overBest: document.getElementById('over-best'),
    overUpgrades: document.getElementById('over-upgrades'),
    cards: document.getElementById('choice-cards'),
    mute: document.getElementById('btn-mute'),
    combo: document.getElementById('hud-combo'),
    comboMult: document.getElementById('hud-combo-mult'),
    comboFill: document.getElementById('hud-combo-fill'),
    overCombo: document.getElementById('over-combo'),
    newBest: document.getElementById('over-newbest'),
    banner: document.getElementById('phase-banner'),
    popups: document.getElementById('popups'),
  };

  const last = {
    score: -1, distance: -1, coins: -1, upgradeKey: '',
    comboMult: '', comboTier: -1, comboOn: null, comboFill: -1,
  };

  /* ---------------- screens ---------------- */

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
    // The HUD must not swallow taps meant for the canvas.
    if (screens.hud) screens.hud.style.pointerEvents = 'none';
  }

  /** Menu and HUD are both visible during play? No — HUD only. */
  function showHUD() {
    showScreen('hud');
  }

  /* ---------------- HUD ---------------- */

  function updateHUD(run, mult) {
    const score = Math.floor(run.score);
    const dist = Math.floor(run.distance);
    if (score !== last.score) {
      el.score.textContent = score.toLocaleString('en-US');
      last.score = score;
    }
    if (dist !== last.distance) {
      el.distance.textContent = dist + 'm';
      last.distance = dist;
    }
    if (run.coins !== last.coins) {
      el.coins.textContent = run.coins;
      last.coins = run.coins;
    }
    updateCombo(run, mult);
  }

  /**
   * The combo meter. Same anti-churn rule as the rest of the HUD — nothing is
   * written unless its *rendered* form changed — and the draining bar is a
   * custom property rather than a width, so it never triggers layout.
   */
  function updateCombo(run, mult) {
    const on = run.combo > 0;
    if (on !== last.comboOn) {
      el.combo.hidden = !on;
      last.comboOn = on;
    }
    if (!on) return;

    const text = `×${mult.toFixed(1)}`;
    if (text !== last.comboMult) {
      el.comboMult.textContent = text;
      last.comboMult = text;
    }

    // Tier drives colour, so the player reads their multiplier peripherally
    // without parsing the number.
    const tier = mult >= 3.5 ? 3 : mult >= 2.5 ? 2 : mult >= 1.5 ? 1 : 0;
    if (tier !== last.comboTier) {
      el.combo.dataset.tier = String(tier);
      last.comboTier = tier;
    }

    // Quantised to 5% steps — a per-frame style write of an unrounded float
    // is exactly the DOM churn this file exists to avoid.
    const window_ = run.comboWindowMax || CFG.COMBO_WINDOW;
    const fill = Math.round((run.comboTimer / window_) * 20) / 20;
    if (fill !== last.comboFill) {
      el.comboFill.style.setProperty('--combo-fill', String(Math.max(0, fill)));
      last.comboFill = fill;
    }
  }

  /* ---------------- phase banner ---------------- */

  let bannerTimer = null;

  function showPhaseBanner(name) {
    el.banner.textContent = name;
    el.banner.classList.remove('show');
    // Force a reflow so re-adding the class restarts the animation even when
    // two phases land close together.
    void el.banner.offsetWidth;
    el.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('show'), 1800);
  }

  /* ---------------- floating popups ---------------- */

  // A fixed pool of nodes, recycled. Creating and destroying elements per
  // pickup is the usual reason a DOM overlay starts stuttering.
  const POPUP_COUNT = 12;
  const popupPool = [];
  for (let i = 0; i < POPUP_COUNT; i++) {
    const node = document.createElement('div');
    node.className = 'popup';
    node.style.display = 'none';
    el.popups.appendChild(node);
    popupPool.push({ node, ttl: 0, x: 0, y: 0 });
  }
  let popupNext = 0;

  // One scratch vector, reused — projecting must not allocate per popup, and
  // it must not mutate the caller's mesh position.
  const scratch = new THREE.Vector3();

  /**
   * Show `text` at a world position. The position is projected once, on
   * spawn, and the popup then drifts in screen space — cheaper than
   * re-projecting every frame, and it reads better, since the label stays
   * where the event happened rather than sliding away with the camera.
   */
  function popup(text, worldPos, tone) {
    const p = popupPool[popupNext];
    popupNext = (popupNext + 1) % POPUP_COUNT;
    p.node.textContent = text;
    p.node.dataset.tone = tone || '';
    p.pending = worldPos ? { x: worldPos.x, y: worldPos.y, z: worldPos.z } : null;
    p.ttl = 0.9;
    p.node.style.display = 'block';
    p.node.style.opacity = '1';
  }

  /** Advance the popups. `camera` projects any that spawned this frame. */
  function updatePopups(dt, camera) {
    for (const p of popupPool) {
      if (p.ttl <= 0) continue;

      if (p.pending && camera) {
        scratch.set(p.pending.x, p.pending.y, p.pending.z).project(camera);
        p.x = (scratch.x * 0.5 + 0.5) * window.innerWidth;
        p.y = (-scratch.y * 0.5 + 0.5) * window.innerHeight;
        p.pending = null;
      }

      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.node.style.display = 'none';
        continue;
      }
      const t = 1 - p.ttl / 0.9;
      p.node.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y - t * 46}px)`;
      p.node.style.opacity = String(Math.max(0, 1 - t * t));
    }
  }


  /** One markup for both places: CSS hides the name in the HUD and reveals
   *  it in the game-over list, so there is only one thing to keep in sync. */
  function chipHTML(u) {
    const stack = u.level > 1 ? `<span class="chip-stack">×${u.level}</span>` : '';
    return `<span class="chip" data-rarity="${u.rarity}" data-upgrade="${u.id}" title="${u.name}">
      <span class="chip-icon">${u.icon}</span><span class="chip-name">${u.name}</span>${stack}</span>`;
  }

  function setUpgradeIcons(list) {
    // Only rebuild when the set actually changed.
    const key = list.map((u) => u.id + u.level).join('|');
    if (key === last.upgradeKey) return;
    last.upgradeKey = key;
    el.upgrades.innerHTML = list.map(chipHTML).join('');
  }

  /* ---------------- upgrade choice ---------------- */

  function showChoice(options) {
    el.cards.innerHTML = options
      .map((o, i) => {
        const level = o.level > 0
          ? `OWNED ×${o.level}${o.maxStacks !== Infinity ? ` / ${o.maxStacks}` : ''}`
          : 'NEW';
        return `<button type="button" class="card" data-rarity="${o.rarity}"
                  data-upgrade-id="${o.id}" data-index="${i}">
          <span class="card-key">${i + 1}</span>
          <span class="card-icon">${o.icon}</span>
          <span class="card-body">
            <span class="card-name">${o.name}</span>
            <span class="card-desc">${o.desc}</span>
          </span>
          <span class="card-level">${level}</span>
        </button>`;
      })
      .join('');

    for (const btn of el.cards.querySelectorAll('.card')) {
      btn.addEventListener('click', () => handlers.onPickUpgrade(btn.dataset.upgradeId));
    }
    showScreen('choice');
    const first = el.cards.querySelector('.card');
    if (first) first.focus();
  }

  /** Keyboard 1/2/3 during a choice. */
  function pickByIndex(index) {
    const btn = el.cards.querySelector(`.card[data-index="${index}"]`);
    if (btn) handlers.onPickUpgrade(btn.dataset.upgradeId);
  }

  function hasChoice() {
    return !screens.choice.classList.contains('hidden');
  }

  /* ---------------- game over ---------------- */

  function showGameOver(summary) {
    el.overScore.textContent = Math.floor(summary.score).toLocaleString('en-US');
    el.overDistance.textContent = Math.floor(summary.distance) + 'm';
    el.overCoins.textContent = summary.coins;
    el.overCombo.textContent = summary.comboBest || 0;
    el.overBest.textContent = Math.floor(summary.best).toLocaleString('en-US');
    el.newBest.hidden = !summary.newBest;
    el.overUpgrades.innerHTML = summary.upgrades.map(chipHTML).join('');
    showScreen('gameover');
    const btn = document.getElementById('btn-restart');
    if (btn) btn.focus();
  }

  function setBest(value) {
    el.menuBest.textContent = Math.floor(value).toLocaleString('en-US');
  }

  function setMuted(muted) {
    el.mute.dataset.muted = muted ? 'true' : 'false';
    el.mute.textContent = muted ? '♪̸' : '♫';
  }

  /** Clear cached HUD values so the next run repaints from zero. */
  function resetHUD() {
    last.score = -1;
    last.distance = -1;
    last.coins = -1;
    last.upgradeKey = '';
    last.comboMult = '';
    last.comboTier = -1;
    last.comboOn = null;
    last.comboFill = -1;
    el.upgrades.innerHTML = '';
    el.combo.hidden = true;
    el.banner.classList.remove('show');
    // Clear any popups still in flight, so a new run never opens with the
    // last one's labels drifting up the screen.
    for (const p of popupPool) {
      p.ttl = 0;
      p.pending = null;
      p.node.style.display = 'none';
    }
  }

  /* ---------------- wiring ---------------- */

  // The full controls table stays collapsed by default — the menu should be
  // a wordmark and a PLAY button, not a manual.
  const howtoBtn = document.getElementById('btn-howto');
  const howtoPanel = document.getElementById('howto');
  if (howtoBtn && howtoPanel) {
    howtoBtn.addEventListener('click', () => {
      const open = !howtoPanel.hidden;
      howtoPanel.hidden = open;
      howtoBtn.setAttribute('aria-expanded', String(!open));
    });
  }

  document.getElementById('btn-play').addEventListener('click', handlers.onPlay);
  document.getElementById('btn-restart').addEventListener('click', handlers.onRestart);
  document.getElementById('btn-resume').addEventListener('click', handlers.onResume);
  el.mute.addEventListener('click', handlers.onToggleMute);

  return {
    showScreen, showHUD, updateHUD, setUpgradeIcons,
    showChoice, pickByIndex, hasChoice,
    showGameOver, setBest, setMuted, resetHUD,
    popup, updatePopups, showPhaseBanner,
  };
}
