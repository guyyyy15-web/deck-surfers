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
| Grind a rail | land on top of one | land on top of one |
| Pick an upgrade | `1` `2` `3` | tap a card |
| Pause | `Esc`, `P` | — |

## How a run works

The street speeds up continuously and never stops getting harder. Every 250m
— and whenever you grab an orange power-up crate — the run freezes and offers
three random upgrades from a pool of nine. They stack for the rest of the run
and change how the board looks and behaves: deck colour, wheels, a shield
bubble, a hover ring, a magnet ring, and the colour of the trail.

### The combo

Coins, gems, ramps and near misses all feed a combo that lapses 2.5 seconds
after the last one. The combo drives a multiplier up to ×4 that scales
**everything**, including the score you earn per metre — so sitting in a clear
lane is the *worst* way to play, and stringing pickups and tight dodges
together is the best.

| Event | Combo |
| --- | --- |
| Coin | +1 |
| Grinding | +1 every 0.25s |
| Near miss | +2 |
| Ramp | +3 |
| Gem | +5 |

A near miss is deliberately strict. Passing an obstacle in the next lane is
not enough: either you were still cutting across as you went by, or you were
in its lane and got over or under it by less than half a unit. Wiping out or
spending a shield ends the chain; letting it lapse costs nothing already
banked.

### Grinding

Ollie onto a rail and you ride it. Grinding pays 220 points a second — before
the combo multiplier — and ticks the combo every quarter second, so a full
rail is worth roughly four coins on top of the points. Step off by jumping,
carving into another lane, pressing down, or simply running out of rail.

**The rail is still a wall.** It is only survivable from directly above: you
have to be falling, with your feet at bar height. Come at it any other way and
it kills you exactly as it always did. That risk is the whole reason a grind
is worth points.

Rails are 24 units long — at the old 7 a grind lasted 0.14s at full speed,
which is a bump, not a trick. At 24 it runs 0.5–0.9s across the speed range.
Rails also reserve road behind them so no obstacle can appear mid-grind, in a
lane you are locked into.

Rails stay dodge-only in the track planner, so **every rail row still
guarantees a clear lane elsewhere** and grinding is purely an optional bonus
route. That is what lets the fairness proof below stay exactly as it was.

### Phases

Every 750m the run enters a new phase and cycles through four of them, each
with its own sky palette and its own bias in the mix of obstacles — NIGHT RUN
is full of gantries, OVERPASS is full of low blocks. The sky and fog lerp
between them over a second and a half. No new meshes are involved: the sky is
already a two-uniform gradient shader, and the phase only re-weights a pick
the track planner was already making, so tier gating and the fairness proof
are untouched.

### Difficulty

Density and row pacing follow a continuous `intensity()` that ramps to 1 over
`DIFFICULTY_DISTANCE` and then keeps climbing, unbounded. The speed cap itself
creeps too, +1 u/s every 900m past that point, up to a hard ceiling of 50.
Nothing pins until roughly 12km — previously every dial was maxed out by
75 seconds.

### The ghost gate

A translucent gold gate stands at the furthest you have ever got. It scrolls
in like everything else, so your target is a place you can see coming rather
than a number in the corner.

**Power never persists.** Every effect lives in a stats object rebuilt from
scratch when a run starts, so wiping out returns you to a completely stock
board. Only your best score and best distance are saved.

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
| `js/config.js` | Every tunable constant, the colour palette and the phases |
| `js/rng.js` | Seeded PRNG (makes the track self-test reproducible) |
| `js/voxel.js` | All mesh construction, from one shared box geometry |
| `js/world.js` | Renderer, scene, camera, lights, sky, scrolling road |
| `js/input.js` | Keyboard + touch → semantic actions |
| `js/player.js` | **Player controller** — lanes, jump arc, duck, grind, animation |
| `js/track.js` | **Track generator** — rows, pooling, fairness validator |
| `js/upgrades.js` | **Upgrade manager** — registry, rolling, stats folding |
| `js/ui.js` | **UI renderer** — screens, HUD, cards, summary |
| `js/collision.js` | AABB tests, near misses, grind mounting, the coin magnet |
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

**Nothing outruns collision.** `MAX_FRAME_DT` clamps a frame to 0.05s, but at
50 u/s that still advances 2.5 units, and the z-window in which the player and
a gantry overlap is only 1.28 units — an obstacle could step clean over the
player between two frames. Every frame is therefore split into substeps of at
most `SUBSTEP_DT`, which bounds travel per collision test to 0.8 units at any
speed the game can reach. A dropped frame costs frame rate, never correctness.

**Fair tracks.** Obstacle rows are planned by a pure function and validated
before anything is built: every row must leave a survivable lane, that lane
must be reachable from where the player could actually have been, and a jump
is never demanded while the player would still be airborne from the last one.
Because the planner is pure and the RNG is seeded, you can check it yourself
in the browser console:

```js
__RUNNER.selfTest(20000)  // => { rows: 20000, failures: 0, ... }
```

The planner touches no DOM and no WebGL, so the same check runs headless —
useful in CI, and much faster than a browser:

```bash
node --input-type=module -e "
  import { createTrackGenerator } from './js/track.js';
  import { makeRng } from './js/rng.js';
  console.log(createTrackGenerator({ add() {} }, makeRng(1)).selfTest(60000));
"
```

`failures` must be 0. It holds past a million metres, at the tightest row
spacing and highest density the endless curve can produce.

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
