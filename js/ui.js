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
  };

  const last = { score: -1, distance: -1, coins: -1, upgradeKey: '' };

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

  function updateHUD(run) {
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
    el.overBest.textContent = Math.floor(summary.best).toLocaleString('en-US');
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
    el.upgrades.innerHTML = '';
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
  };
}
