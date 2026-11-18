# החצר — handoff for the next agent

Read this after `CLAUDE.md`. It says where things stand, how Guy (the owner) likes to work, and what is still open.
Keep it current: when you finish a piece of work, update "Where things stand" and "Open" in the same commit.

## Where things stand (2026-11-18)

- **Live:** 0.15.0 at https://hechatzer.pages.dev/ (Pages publishes `chatzer/` on every push to `main`).
  Worker `chatzer-sync` serves the API (same `server/` code as `nekamot-sync`, `--env chatzer`).
- **Users:** 2026-11-18: 20 ducklings, 12 yards, active 11 → 5 → 2 people a day, only 4 phones with push (why 0.14/0.15 aim at retention). Run `bash scripts/chatzer-stats.sh` for now.
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
- 0.10 notifications reach more people: asked right after taking something / finishing a chore (again after a
  week, 3 times at most); in iPhone Safari the offer is "add to the home screen, or to the calendar"; a test push
  after turning on (and a button in "הברווזון שלי"); a quiet 🔕 line in a yard when your reminders there won't
  arrive; the admin's "מי עושה מה" shows who gets notifications (server: `push` per member in the group info).
  "Add to calendar", made on the phone (`icsFile`, `gcalLink` in yard.js): the event with what I bring, a task
  with a date, my chore turn (a repeating event when I'm alone in the rotation), and "הכל ליומן" for my week.
  Calendar entries don't update by themselves (the sheet says so).
- 0.11 deep links: every notification carries `go` inside the encrypted note (`goFor()` in yard.js; sw.js checks
  it with the same `GO` rule, a test keeps them equal). Routes: `#/y/<id>?item=…|chore=…|poll=…|reports=1`
  (`openFromLink()` opens the sheet, then the address goes back to `#/y/<id>`), `#/y/<id>/chat`, `#/today`
  (morning summary, the admin's nudge). New notifications: pass `go` to `Y.post(..., { body, to, go })`.
- 0.12 what waits for me: `attention()` in yard.js derives it from the yard as it is now (unread chat, my due
  turns, tasks given to me, polls I haven't voted in, new items still free, open reports for the admin), so each
  mark goes away by itself. Home cards: a badge with the count and chips ("💬 הודעה", "📊 הצבעה"); the app icon
  badge is the total. In a yard: chat count, "עוד לא הצבעת" on polls, "חדש" on new items. The chat has its own
  seen pointer (`rec.chatSeq`, set when the chat opens). Opening a yard, or a yard with nothing waiting, closes
  its notifications still on the lock screen (`push.closeShown`).
- 0.13 lighter sync (same in נקמות שלי 1.6.0, js/groups.js): a check is one request (`/events?since=`), whose
  answer carries `mv` (members version: count, last join, last removal, admins); the full group info is reloaded
  only when `mv`/keys change or every 10 min. Home skips yards whose `seq` didn't move. Polling backs off from
  12 s / 45 s to 2 min while nothing changes; taps, a notification (sw.js posts `news`) or returning resets it.
  `stateOf()` is cached per yard (treat it as read-only). Measured idle phone: ~600 → ~40 requests/hour.
- 0.14 retention: an invite card in yards of fewer than 3 (`inviteCard`, closes twice at most, `settings.invClosed`);
  a notification card on home (`pushCard`, replaced the old install nudge; back after 3 days, 3 times at most);
  a daily streak (`markActive`/`streakNow`, "🔥 N ימים ברצף") and duckling mood (cool at 3+, sleepy after 3 days
  away, "התגעגענו!"); ready-made home templates (`HOME_TEMPLATES`: flat, family, dorm, couple).
- 0.15 turns: **swap** (`chore.swap` {id, with} by the turn holder → `chore.swapOk` by the one asked: the turn is
  theirs, `owe` {by, to} makes the asker take their next natural turn; `chore.swapNo` by either side; attention
  kind `swap`, a card on the yard). **Vacation** (profile `away` = last day away, from `settings.away`, "🏖️ אני
  בחופש" in the yard menu of home yards): `isAway()`, every rotation skips them (`nextInOrder(..., skip)`), the
  turns they hold move on at once (history kind `away`). **Weekly summary** for each admin of a home yard:
  reminder `w_<admin>` Sunday 18:00 (`nextSunday18`) with the chores done in the last 7 days, opens `/team`.

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

- Cost guards (Guy said yes 2026-11-18, next): a monthly R2 operations budget in the Worker that pauses
  photo uploads at 80% of the free tier; a kill switch variable (photos off / read-only). Deploy both Workers.
- Notification ideas he did not pick yet: a subscribed calendar feed (server-made, generic titles because of E2E),
  "remind on WhatsApp" for the admin, an Android app via Google Play (TWA).
- Not verified on a real iPhone yet: that tapping "ליומן של האייפון" in the home-screen app opens the calendar
  import (blob download with `download`); Google Calendar link is the fallback.
- Not verified on a real phone yet: the weekly admin summary (Sunday 18:00) and a swap request notification.
- Not verified on a real phone yet: the evening-before reminder and the morning summary (tested in unit tests and
  the local Worker only). Ask Guy to confirm one arrives.
- Possible later: a custom domain (needs Related Origin Requests for saved passkeys, see CLAUDE.md), automated
  Worker deploy from CI (needs a Cloudflare token as a GitHub secret).
