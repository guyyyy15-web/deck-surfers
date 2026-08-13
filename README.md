# Deck Surfers

A 3D voxel endless runner: three lanes, one skateboard, and rogue-lite
upgrades that last exactly one run.

**Play: https://guyyyy15-web.github.io/deck-surfers/**

No build step, no package manager, no binary assets. Every model is
procedural boxes, every sound — including the music — is synthesised at
runtime, and the only dependency, three.js, is vendored into the repo.

## Running it locally

ES modules don't load over `file://`, so serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | `←` `→` or `A` `D` | swipe left / right |
| Ollie / jump | `↑`, `W`, `Space` | swipe up, or tap |
| Duck & slide | `↓`, `S` | swipe down |
| Pick an upgrade | `1` `2` `3` | tap a card |
| Pause | `Esc`, `P` | — |

## How a run works

The street speeds up continuously. Every 250m — and whenever you grab an
orange power-up crate — the run freezes and offers three random upgrades
from a pool of nine. They stack for the rest of the run and change how the
board looks and behaves: deck colour, wheels, a shield bubble, a hover ring,
a magnet ring, and the colour of the trail.

**Upgrades never persist.** Every effect lives in a stats object rebuilt from
scratch when a run starts, so wiping out returns you to a completely stock
board. Only your best score is saved.

| Upgrade | Effect |
| --- | --- |
| Magnet Deck | Pulls coins in from further away |
| Double Jump | A second (then third) mid-air jump |
| Hot Streak | Score multiplier, ×1.5 per stack |
| Hover Deck | Float above the road and fall slowly — but duck lower |
| Guard Rail | Survive a crash, once per stack |
| Gold Grip | Coins are worth more |
| Slow Burn | The street speeds up more gently |
| Moon Boots | Much higher ollies |
| Air Brake | Hold a duck-slide for longer |

## Code layout

Each module owns one thing:

| File | Responsibility |
| --- | --- |
| `js/config.js` | Every tunable constant and the colour palette |
| `js/rng.js` | Seeded PRNG (makes the track self-test reproducible) |
| `js/voxel.js` | All mesh construction, from one shared box geometry |
| `js/world.js` | Renderer, scene, camera, lights, sky, scrolling road |
| `js/input.js` | Keyboard + touch → semantic actions |
| `js/player.js` | **Player controller** — lanes, jump arc, duck, animation |
| `js/track.js` | **Track generator** — rows, pooling, fairness validator |
| `js/upgrades.js` | **Upgrade manager** — registry, rolling, stats folding |
| `js/ui.js` | **UI renderer** — screens, HUD, cards, summary |
| `js/collision.js` | AABB tests and the coin magnet |
| `js/fx.js` | Pooled particles, trails, screen shake |
| `js/audio.js` | Synthesised SFX and the music loop |
| `js/game.js` | State machine, run state, scoring, main loop |
| `js/main.js` | Bootstrap |

## Notes on the implementation

**Rendering.** Full device resolution (capped at 2× DPR) with antialiasing
and real `PCFSoftShadowMap` shadows. The sun's shadow frustum is deliberately
tight and follows the player, because a wide one spends its resolution on
empty asphalt. The chunky look comes from the geometry being boxes, not from
throwing pixels away. If a device can't hold 45fps, resolution and shadow
quality step down — one way only, so they can't oscillate.

**The sky** is a vertical gradient on the inside of a sphere, with `scene.fog`
matched to the horizon band so the street dissolves into it. Being a raw
`ShaderMaterial` it needs `#include <colorspace_fragment>`; without that the
colours land linear on an sRGB framebuffer and read far darker and redder
than the palette says.

**Music** is a 90 BPM boom-bap loop built from oscillators and one noise
buffer — kick, snare, hats, sub bass and a minor-key stab. Timing uses a
lookahead scheduler queueing notes against `ctx.currentTime`; scheduling from
`setTimeout` alone drifts audibly. It ducks under gameplay, comes back up on
the menu, and the mute button covers it.

**Upgrades can't leak between runs**, by construction rather than by cleanup:
each effect is a pure `fold(stats, level)` applied to a fresh copy of
`BASE_STATS` — nothing ever does `+=` on a live value — and `reset()` replaces
the stacks object rather than clearing it.

**Fair tracks.** Obstacle rows are planned by a pure function and validated
before anything is built: every row must leave a survivable lane, that lane
must be reachable from where the player could actually have been, and a jump
is never demanded while the player would still be airborne from the last one.
Because the planner is pure and the RNG is seeded, you can check it yourself
in the browser console:

```js
__RUNNER.selfTest(5000)   // => { rows: 5000, failures: 0, repairs: 0 }
```

`window.__RUNNER` also exposes `run`, `player`, `upgrades`, `state`, and
`debugTriggerChoice()` / `debugKill()` for poking at a run. Append
`?choiceEvery=40` to the URL to hit the upgrade screen every 40m instead of
250m.

## Deployment

GitHub Pages serves `main` from the repository root. `.nojekyll` is required —
without it Jekyll builds a placeholder page from this README instead of
serving the game.

## Credits

three.js r170, MIT licensed, vendored in `vendor/` — see
`vendor/THREE-LICENSE.txt`. Don't edit that file by hand; replace it
wholesale to upgrade.
