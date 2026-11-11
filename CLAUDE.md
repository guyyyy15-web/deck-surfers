# נקמות שלי — project rules

Hebrew RTL PWA for tracking small, harmless revenges, built for iPhone. Live at
https://guyyyy15-web.github.io/deck-surfers/ (GitHub Pages, served from `main`).
The repo is named `deck-surfers` for historical reasons; the old game lives in `game/`.

## Where things live

| What | Where | Why there |
|---|---|---|
| App code, server code, schema, specs, tests | git (this repo) | Single source of truth, reviewed history |
| Users' revenges and photos | Each phone (IndexedDB) | Local-first; works offline |
| Encrypted cloud backup and sync | Cloudflare: Worker `nekamot-sync`, D1 `nekamot-sync`, R2 `nekamot-photos` (all WEUR) | Free tier, never sleeps, server sees only ciphertext |
| Credentials (Cloudflare API, Supabase PAT) | The cloud dev environment's network secrets | Never in git, never in chat |
| Supabase | Not used by this app (see `docs/groups-spec.md` §10) | E2E encryption makes its auth/RLS moot |

## Layout

```
index.html manifest.webmanifest sw.js   app shell (no build step)
css/app.css                             design tokens (light + dark) and components
js/app.js     screens, router, sheets, crop          js/logic.js  pure logic (tested)
js/sync.js    E2E-encrypted backup/sync client       js/db.js     IndexedDB + settings
js/identity.js  your cat + device keys (ECDSA/ECDH)  js/groups.js js/groups-ui.js  groups (data / screens)
js/images.js js/icons.js js/ideas.js
server/       Cloudflare Worker + D1 migrations + API tests (wrangler dev)
tests/        node --test unit tests                 scripts/     serve, smoke, sync-smoke, icons
docs/         README screenshots, feature specs      game/        Deck Surfers (separate app)
```

## Rules

- **Releasing an app change:** bump `APP_VERSION` in `js/app.js` **and** `VERSION` in `sw.js` together
  (a test checks). New app files must be added to `FILES` in `sw.js` (a test checks).
- **Inline script in `index.html` changed?** Update its `sha256-…` in the CSP meta tag (a test prints the
  right value). Never add `'unsafe-inline'` to `script-src`.
- **Database changes** go in a new `server/migrations/NNNN_name.sql`, never by editing an applied one.
  Apply with `npm run deploy:server` (runs `wrangler d1 migrations apply --remote`, then deploys).
- **Groups:** never trust event content for permissions; `fold()` checks the author (set by the server from
  the signature) and current roles. Tests must never call the production server (stub or local Worker).
- **Push:** the notification text is encrypted with the group key on the phone and decrypted in `sw.js`;
  the Worker only relays it (`server/src/webpush.js`). VAPID private key = Wrangler secret `VAPID_PRIVATE_JWK`
  (never in git or chat). Keep the economy rules: no push for votes/profiles, 30 s cooldown per member per
  group, ≤ 30 sends per post, ≤ 3 devices per member. `sw.js` must always show a notification on push (iOS).
- **Privacy:** the server must never receive plaintext user content. Everything user-written is encrypted
  in `js/sync.js` before upload. Never log request bodies in the Worker.
- **Cost guard:** keep the Worker limits (photo 3 MB, 300 MB per space, 8 GB total, 10 new spaces per
  client per hour) unless deliberately changing the budget.
- **UI copy:** Hebrew, gendered via `g(feminine, masculine)` (user setting). Inputs ≥ 16px, tap targets
  ≥ 44px, safe-area insets. Design tokens only from `css/app.css`.
- **Content:** ideas and copy stay funny and harmless (nothing that hurts, costs money or humiliates).

## Commands

```bash
npm run serve          # http://localhost:8080/
npm test               # unit tests (fast; run before every commit)
npm run test:server    # Worker API tests against wrangler dev (needs: cd server && npm ci)
npm run smoke          # iPhone browser test, screenshots in screenshots/
npm run smoke:sync     # 2–4 phones syncing through the local Worker
npm run smoke:groups   # 3 phones in a group through the local Worker, incl. push end to end (full headless Chromium)
npm run test:all       # everything
npm run deploy:server  # migrations + deploy the Worker (needs CLOUDFLARE_* env, see below)
```

Deploying the app = pushing to `main` (GitHub Pages). CI (`.github/workflows/ci.yml`) runs all tests on
every push. **Push to the `claude/…` branch first, wait for green, then fast-forward `main`.**

Waiting for CI: always `node scripts/ci-watch.mjs` (run in the background), never an open-ended loop.
It exits 2 if a step runs past `--stall` minutes and 3 past `--deadline`: then read the job log
(GitHub MCP `get_job_logs`), fix, and push again (the new push cancels the old run).
Every CI job and slow step has `timeout-minutes`; keep it that way when adding steps.

In the cloud dev environment, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN=proxy-injected` and
`SUPABASE_ACCESS_TOKEN=sbp_000…` are placeholders: the real tokens are injected by the network proxy.
If a session predates those variables, export them in the command.
