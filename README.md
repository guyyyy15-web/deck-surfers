# Deck Runner

A 3D voxel endless runner: three lanes, one skateboard, and rogue-lite
upgrades that last exactly one run.

Live: https://guyyyy15-web.github.io/uechi-ryu-app/game/

This folder is **completely independent of the Uechi-Ryu site** in the repo
root. It is not a view in `index.html`, `build.py` never reads it, and
rebuilding the site has no effect on it. Editing the game means editing the
files here directly — there is no build step.

## Running it locally

ES modules do not load over `file://`, so open it through a web server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/game/
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
orange power-up crate — the run freezes and offers three random upgrades.
They stack for the rest of the run and change how the board looks and
behaves.

**Upgrades never persist.** Every effect lives in a stats object that is
rebuilt from scratch when a run starts, so wiping out returns you to a
completely stock board. Only your best score is saved.

## Code layout

Each module owns one thing:

| File | Responsibility |
| --- | --- |
| `js/config.js` | Every tunable constant and the colour palette |
| `js/rng.js` | Seeded PRNG (makes the track self-test reproducible) |
| `js/voxel.js` | All mesh construction, from one shared box geometry |
| `js/world.js` | Renderer, scene, camera, lights, scrolling road |
| `js/input.js` | Keyboard + touch → semantic actions |
| `js/player.js` | **Player controller** — lanes, jump arc, duck, animation |
| `js/track.js` | **Track generator** — rows, pooling, fairness validator |
| `js/upgrades.js` | **Upgrade manager** — registry, rolling, stats folding |
| `js/ui.js` | **UI renderer** — screens, HUD, cards, summary |
| `js/collision.js` | AABB tests and the coin magnet |
| `js/fx.js` | Pooled particles, trails, screen shake |
| `js/audio.js` | WebAudio-synthesised SFX (no audio files) |
| `js/game.js` | State machine, run state, scoring, main loop |
| `js/main.js` | Bootstrap |

No binary assets: every model is procedural boxes, every sound is
synthesised, and the only dependency is the vendored three.js in `vendor/`.

## Notes on the implementation

**The pixel look** is a small backbuffer (≈288px tall) upscaled by CSS with
`image-rendering: pixelated`. It is a performance win, not a cost, which is
what makes the game comfortable on phones.

**Fair tracks.** Obstacle rows are planned by a pure function and validated
before anything is built: every row must leave a survivable lane, that lane
must be reachable from where the player could actually have been, and a jump
is never demanded while the player would still be airborne from the last one.
Run the check yourself in the browser console:

```js
__RUNNER.selfTest(5000)   // => { rows: 5000, failures: 0, repairs: 0 }
```

`window.__RUNNER` also exposes `run`, `player`, `upgrades`, `state`, and
`debugTriggerChoice()` / `debugKill()` for poking at a run.

Append `?choiceEvery=40` to the URL to hit the upgrade screen every 40m
instead of 250m.
