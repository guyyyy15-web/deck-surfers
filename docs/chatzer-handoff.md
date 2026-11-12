# החצר — handoff for the next agent

Read this after `CLAUDE.md`. It says where things stand, how Guy (the owner) likes to work, and what is still open.
Keep it current: when you finish a piece of work, update "Where things stand" and "Open" in the same commit.

## Where things stand (2026-11-12)

- **Live:** 0.9.0 at https://hechatzer.pages.dev/ (Pages publishes `chatzer/` on every push to `main`).
  Worker `chatzer-sync` serves the API (same `server/` code as `nekamot-sync`, `--env chatzer`).
- **Users:** first real day, 14 ducklings, 7 yards, 11 active in 24h. Run `bash scripts/chatzer-stats.sh` for now.
- **Product docs (Claude artifacts, Guy's account):**
  - PRD: https://claude.ai/artifact/NX1myfDzagv5GJ1LN1WULE
  - Brand and product document: https://claude.ai/artifact/HTTbopvam3TmaxNYWGiwVh
  - First sketch (screens): https://claude.ai/artifact/3onsa63qRgzV6AA3QqgJEr
  - "החצר מבפנים" (architecture page): https://claude.ai/artifact/GUmiJahxi2AxwQjKWgGjSs
  Read them with the Artifact tool (`action: read`), not web fetch.

### What the app does (by version)
- 0.4 chore ideas (incl. pets), custom chores, close buttons · 0.5 edit/assign, times, reminders, "היום שלי"
- 0.6 duckling closet (slots, clothes, moods) · 0.7 admin team view · 0.8 transparency toggle, smart join + install
  guide, undo, paste a list, WhatsApp summary, calendar, "עוד אחד כזה"; no age box, no feminine default
- 0.9 short welcome (name + voice, random color), direct "אירוע חדש / חצר לבית", WhatsApp-style invite preview,
  install steps with icons, calmer board + "את מביאה", amounts ("קולה x3"), items several people bring (`need`,
  `helpers`), admin nudge (`yard.nudge`), reminder the evening before an event (`e_<member>`), morning summary in
  home yards (`d_<member>`, `morning: off` in the profile), joy hop, one tip at a time, new icon.

## How Guy works

- Writes in Hebrew; answer in Hebrew. Code, commits and docs stay in English.
- **Proposes → asks → builds.** When he asks for ideas, give a short ranked list and *ask which to build*.
  Build only what he picked. A clear "תבנה / תטמיע X" is the go-ahead.
- Wants short progress notes during long work, and a clear "done / published / what to check" at the end.
- Show, don't tell: screenshots of new screens (Playwright, iPhone 13, `deviceScaleFactor: 2`), a captioned sheet
  for flows. Look at every screenshot yourself before sending.
- Never paste secrets in chat; ask for keys with the secure credential form.
- Audience: young women and teens (13+). Funny and warm, never mean. No revenge content in החצר.
- Address by `g(f, m)`; when the user has not chosen, the neutral slash form. Never feminine by default.

## Releasing (the full loop)

1. Change code; bump `APP_VERSION` (chatzer/js/app.js) and `VERSION` (chatzer/sw.js) together.
2. `npm test` and `npm run smoke:chatzer` (add a check for every new feature in `scripts/chatzer-smoke.cjs`).
   Before trusting a smoke failure, make sure no stale `wrangler dev`/`workerd` from an earlier run holds the
   port (`ps aux | grep workerd`): a leftover server makes the test read the wrong database.
3. Commit, push the `claude/…` branch, `node scripts/ci-watch.mjs` (in the background) until green.
4. Fast-forward `main` (`git push origin HEAD:main`), wait until `https://hechatzer.pages.dev/sw.js` shows the new
   VERSION, then `node scripts/chatzer-live.cjs` and remove its two test identities with the printed query.
5. Server change? Migrations + deploy **both** Workers (`npm run deploy:server`, and `--env chatzer`).

## Production data rules

- Real users' rows are untouchable. The only rows you may delete are your own test identities (created during
  your run, never in a yard, no save, no push subscription).
- Read-only stats: `bash scripts/chatzer-stats.sh`.

## Cost model (checked 2026-11-12)

- Account plan: Cloudflare Free + **R2 Paid** (pay-as-you-go above the free tier). Workers, D1 and Pages are on
  the free plan: past the limits they stop for the day, they do not bill. R2 is the only thing that can bill.
- Usage on day one: ~2% of the Workers daily limit, <2% of D1, ~4 MB of R2.
- Guards in the Worker today: photo 3 MB, 300 MB per space, 8 GB total, 10 new spaces per client per hour.

## Open (proposed to Guy, not built unless he says so)

- Cost guards (proposed 2026-11-12, waiting for his pick): a monthly R2 operations budget in the Worker that pauses
  photo uploads at 80% of the free tier; per-member rate limits; a kill switch variable (photos off / read-only);
  a daily usage check that pushes a note to Guy above 50%; a Cloudflare billing notification.
- UX ideas he did not pick yet: swap a turn ("תחליפי איתי השבוע?") and vacation mode (skip me for a few days).
- Not verified on a real phone yet: the evening-before reminder and the morning summary (tested in unit tests and
  the local Worker only). Ask Guy to confirm one arrives.
- Possible later: a custom domain (needs Related Origin Requests for saved passkeys, see CLAUDE.md), automated
  Worker deploy from CI (needs a Cloudflare token as a GitHub secret).
