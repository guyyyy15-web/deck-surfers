// החצר: folding a yard's event log into its state (chatzer/js/yard.js), and that the app's files are cached.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fold, openReports, plannedReminders, choreRemindAt, splitList, summaryText, eventIcs, googleCalendarUrl, eventBoard, homeBoard, nextInOrder, turnOf, orderOf, dueState, weekDuck, pollResults, extractInvite, parseItem, takers, isFull, eveBefore, nextMorning, icsFile, gcalLink, RRULES } from '../chatzer/js/yard.js'

const A = 'a'.repeat(24)
const B = 'b'.repeat(24)
const C = 'c'.repeat(24)
let seq = 0
const e = (author, ev, at = '2026-11-10T10:00:00.000Z') => ({ seq: ++seq, author, at, ev })
const roles = new Map([[A, 'admin'], [B, 'member'], [C, 'member']])

test('the first event names the yard; later only an admin can rename it', () => {
  const s = fold([
    e(A, { t: 'yard.meta', name: 'מנגל שישי', emoji: '🔥', kind: 'event', when: '2026-11-14T14:00', where: 'רמת גן' }),
    e(B, { t: 'yard.meta', name: 'נגנב', emoji: '😈' }),
  ], roles)
  assert.equal(s.meta.name, 'מנגל שישי')
  assert.equal(s.meta.kind, 'event')
  assert.equal(s.meta.where, 'רמת גן')
})

test('who brings what: first claim wins, only the claimer or an admin lets go', () => {
  const s = fold([
    e(A, { t: 'item.put', id: 'i1', name: 'פיתות', qty: '20' }),
    e(A, { t: 'item.put', id: 'i2', name: 'חומוס' }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
    e(C, { t: 'item.claim', id: 'i1', on: true }),
    e(C, { t: 'item.claim', id: 'i1', on: false }),
  ], roles)
  assert.equal(s.items.get('i1').claimedBy, B)
  const b = eventBoard(s, C)
  assert.deepEqual([b.total, b.taken, b.free.length, b.others.length], [2, 1, 1, 1])
  const s2 = fold([...[
    e(A, { t: 'item.put', id: 'i1', name: 'פיתות' }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
  ], e(A, { t: 'item.claim', id: 'i1', on: false })], roles)
  assert.equal(s2.items.get('i1').claimedBy, null, 'admin can free an item')
})

test('items: only the one who added it (or an admin) can edit or delete it', () => {
  const s = fold([
    e(B, { t: 'item.put', id: 'i1', name: 'קרח' }),
    e(C, { t: 'item.put', id: 'i1', name: 'שונה' }),
    e(C, { t: 'item.delete', id: 'i1' }),
  ], roles)
  assert.equal(s.items.get('i1').name, 'קרח')
  assert.equal(fold([e(B, { t: 'item.put', id: 'i1', name: 'קרח' }), e(A, { t: 'item.delete', id: 'i1' })], roles).items.size, 0)
})

test('one-off tasks: done marks who did it; someone else cannot finish a task taken by another', () => {
  const s = fold([
    e(A, { t: 'item.put', id: 't1', name: 'נייר טואלט' }),
    e(B, { t: 'item.claim', id: 't1', on: true }),
    e(C, { t: 'item.done', id: 't1', on: true }),
  ], roles)
  assert.equal(s.items.get('t1').done, false)
  const s2 = fold([e(A, { t: 'item.put', id: 't1', name: 'נייר טואלט' }), e(C, { t: 'item.done', id: 't1', on: true, photoId: 'p1' })], roles)
  const t = s2.items.get('t1')
  assert.deepEqual([t.done, t.doneBy, t.claimedBy, t.photoId], [true, C, C, 'p1'])
})

test('chores rotate: done moves the turn on, pass only by whoever has the turn', () => {
  const evs = [
    e(A, { t: 'chore.put', id: 'c1', name: 'כלים', emoji: '🫧', every: 'day', order: [A, B, C] }),
    e(A, { t: 'chore.done', id: 'c1' }, '2026-11-10T20:00:00.000Z'),
    e(C, { t: 'chore.pass', id: 'c1' }),
  ]
  let s = fold(evs, roles)
  assert.equal(s.chores.get('c1').turnOf, B, 'C cannot pass B’s turn')
  s = fold([...evs, e(B, { t: 'chore.pass', id: 'c1' })], roles)
  assert.equal(s.chores.get('c1').turnOf, C)
  s = fold([...evs, e(B, { t: 'chore.pass', id: 'c1' }), e(C, { t: 'chore.done', id: 'c1' })], roles)
  assert.equal(s.chores.get('c1').turnOf, A, 'wraps around')
  assert.equal(s.chores.get('c1').history.length, 3)
})

test('a rotation of everyone includes whoever joins later', () => {
  const two = new Map([[A, 'admin'], [B, 'member']])
  const evs = [e(A, { t: 'chore.put', id: 'c1', name: 'זבל', every: 'week', everyone: true }), e(A, { t: 'chore.done', id: 'c1' })]
  assert.equal(fold(evs, two).chores.get('c1').turnOf, B)
  const s = fold([...evs, e(B, { t: 'chore.done', id: 'c1' })], roles)
  assert.equal(s.chores.get('c1').turnOf, C, 'C joined and is next')
})

test('someone who left is skipped in the turn order', () => {
  const now = new Map([[A, 'admin'], [C, 'member']])
  assert.equal(nextInOrder([A, B, C], A, now), C)
  assert.equal(turnOf({ order: [A, B, C], turnOf: B }, now), C)
})

test('due dates: never done is due now; done today is due after its cycle', () => {
  const now = Date.parse('2026-11-11T12:00:00')
  const base = { createdAt: '2026-11-01T10:00:00', every: 'day', lastDoneAt: null }
  assert.equal(dueState(base, now), 'late')
  assert.equal(dueState({ ...base, lastDoneAt: '2026-11-10T09:00:00' }, now), 'today')
  assert.equal(dueState({ ...base, lastDoneAt: '2026-11-11T09:00:00' }, now), 'soon')
  assert.equal(dueState({ ...base, every: 'week', lastDoneAt: '2026-11-08T09:00:00' }, now), 'soon')
})

test('home board: my turn shows only chores that are due; duckling of the week counts the last 7 days', () => {
  const now = Date.parse('2026-11-11T12:00:00')
  const s = fold([
    e(A, { t: 'chore.put', id: 'c1', name: 'כלים', every: 'day', order: [B, A] }, '2026-11-01T10:00:00'),
    e(B, { t: 'chore.done', id: 'c1' }, '2026-11-10T09:00:00'),
    e(A, { t: 'chore.put', id: 'c2', name: 'זבל', every: 'week', order: [A, B] }, '2026-11-01T10:00:00'),
    e(A, { t: 'chore.done', id: 'c2' }, '2026-10-01T08:00:00'),
    e(B, { t: 'chore.done', id: 'c2' }, '2026-11-11T08:00:00'),
  ], roles)
  const h = homeBoard(s, A, roles, now)
  assert.deepEqual(h.myTurn.map((c) => c.id), ['c1'])
  // B twice this week (11-10, 11-11); A's October one is out of the week.
  assert.deepEqual(weekDuck(s, now), { member: B, n: 2 })
})

test('polls: one vote each, changeable; closed polls ignore votes', () => {
  const s = fold([
    e(A, { t: 'poll.put', id: 'p1', q: 'איפה?', options: ['אצלי', 'בפארק', ''] }),
    e(B, { t: 'poll.vote', id: 'p1', opt: 0 }),
    e(B, { t: 'poll.vote', id: 'p1', opt: 1 }),
    e(C, { t: 'poll.vote', id: 'p1', opt: 9 }),
    e(A, { t: 'poll.close', id: 'p1', on: true }),
    e(C, { t: 'poll.vote', id: 'p1', opt: 0 }),
  ], roles)
  const p = s.polls.get('p1')
  assert.equal(p.options.length, 2)
  assert.deepEqual(pollResults(p), [0, 1])
})

test('chat: only the author or an admin deletes a message', () => {
  const s = fold([
    e(B, { t: 'comment.put', cid: 'm1', text: 'מי מביא מלח?' }),
    e(C, { t: 'comment.delete', cid: 'm1' }),
  ], roles)
  assert.equal(s.chat.length, 1)
})

test('invite links are found in pasted text', () => {
  const code = 'iAbCdEfGhIjKlMnOp.QrStUvWxYz0123456789ab'
  assert.equal(extractInvite(`בואי! https://hechatzer…/#/join/${code}`), code)
  assert.equal(extractInvite('סתם טקסט'), null)
})

test('every app file is in the service worker cache list, and nothing missing', () => {
  const root = path.join(import.meta.dirname, '..', 'chatzer')
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8')
  const listed = JSON.parse(/const FILES = (\[[\s\S]*?\])/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'))
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]))
  const files = walk('.').map((f) => f.replace(/^\.\//, '')).filter((f) => !/(^sw\.js$|^_headers$|LICENSE|\.md$)/.test(f))
  // index.html is cached as './' (Pages redirects /index.html → /, see sw.js).
  assert.ok(!listed.includes('index.html'), 'index.html must be cached as ./ only')
  for (const f of files) if (f !== 'index.html') assert.ok(listed.includes(f), `${f} is not in FILES (sw.js)`)
  for (const f of listed) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `${f} is listed but missing`)
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8')
  assert.equal(/APP_VERSION = '([^']+)'/.exec(app)[1], /VERSION = 'chatzer-v([^']+)'/.exec(sw)[1], 'APP_VERSION and sw VERSION match')
})

test('save codes are read forgivingly: case, spaces, O/0 and I/L/1', async () => {
  const { normalizeCode, formatCode } = await import('../chatzer/js/vault.js')
  assert.equal(normalizeCode('7kq2 m9xd-4tra wp1c'), '7KQ2M9XD4TRAWP1C')
  assert.equal(normalizeCode('OOOO-IIII-LLLL-0000'), '0000111111110000')
  assert.equal(formatCode('7KQ2M9XD4TRAWP1C'), '7KQ2-M9XD-4TRA-WP1C')
})

test('reports reach the admin; deleting the message or hiding the photo settles them; only admins hide photos', () => {
  const evs = [
    e(B, { t: 'comment.put', cid: 'm1', text: 'משהו לא נעים' }),
    e(C, { t: 'report.put', rid: 'r1', cid: 'm1', reason: 'לא נעים' }),
    e(C, { t: 'report.put', rid: 'r2', cid: 'm1' }),
    e(A, { t: 'report.put', rid: 'r3', photoId: 'p9' }),
    e(C, { t: 'photo.hide', photoId: 'p9' }),
  ]
  let s = fold(evs, roles)
  assert.deepEqual(openReports(s).map((r) => [r.key, r.count]), [['m1', 1], ['p9', 1]], 'a second report by the same person counts once')
  assert.equal(s.hidden.size, 0, 'a member cannot hide a photo')
  s = fold([...evs, e(A, { t: 'comment.delete', cid: 'm1' }), e(A, { t: 'photo.hide', photoId: 'p9' })], roles)
  assert.equal(openReports(s).length, 0)
  assert.ok(s.hidden.has('p9'))
  s = fold([...evs, e(B, { t: 'report.close', rid: 'r1' })], roles)
  assert.equal(openReports(s).length, 2, 'only an admin dismisses a report')
})

test('longer cycles: every two weeks and monthly chores come due after 14 and 30 days', () => {
  const now = Date.parse('2026-11-11T12:00:00')
  const base = { createdAt: '2026-10-01T10:00:00' }
  assert.equal(dueState({ ...base, every: '2weeks', lastDoneAt: '2026-11-01T09:00:00' }, now), 'soon')
  assert.equal(dueState({ ...base, every: '2weeks', lastDoneAt: '2026-10-28T09:00:00' }, now), 'today')
  assert.equal(dueState({ ...base, every: 'month', lastDoneAt: '2026-10-20T09:00:00' }, now), 'soon')
  assert.equal(dueState({ ...base, every: 'month', lastDoneAt: '2026-10-01T09:00:00' }, now), 'late')
  // An unknown cycle (say, from a newer app) falls back to weekly.
  const st = fold([e(A, { t: 'chore.put', id: 'c8', name: 'x', every: 'yearly', everyone: true })], roles)
  assert.equal(st.chores.get('c8').every, 'week')
})

test('the admin hands a turn to anyone; it is a stand-in, and the rotation goes on after the owner', () => {
  const evs = [
    e(A, { t: 'chore.put', id: 'c1', name: 'כלים', every: 'day', order: [A, B, C] }),
    e(B, { t: 'chore.assign', id: 'c1', to: C }),
  ]
  assert.equal(fold(evs, roles).chores.get('c1').turnOf, A, 'a member cannot reassign')
  const s1 = fold([...evs, e(A, { t: 'chore.assign', id: 'c1', to: C })], roles)
  assert.equal(s1.chores.get('c1').turnOf, C, 'the admin can, even against the rotation')
  // C does it (standing in for A): next is B, as if A had done it.
  const s2 = fold([...evs, e(A, { t: 'chore.assign', id: 'c1', to: C }), e(C, { t: 'chore.done', id: 'c1' })], roles)
  assert.equal(s2.chores.get('c1').turnOf, B)
  // Editing the chore keeps whose turn it is, and keeps the hour.
  const s3 = fold([...evs, e(A, { t: 'chore.assign', id: 'c1', to: C }), e(A, { t: 'chore.put', id: 'c1', name: 'כלים בערב', every: 'day', order: [A, B], time: '20:00' })], roles)
  assert.deepEqual([s3.chores.get('c1').turnOf, s3.chores.get('c1').name, s3.chores.get('c1').time], [C, 'כלים בערב', '20:00'])
  assert.equal(fold([e(A, { t: 'chore.put', id: 'c2', name: 'x', every: 'day', everyone: true, time: '25:00' })], roles).chores.get('c2').time, null, 'a bad hour is ignored')
})

test('the admin assigns a task to someone (or frees it); members cannot', () => {
  const evs = [e(B, { t: 'item.put', id: 't1', name: 'לתקן את הברז', due: '2026-11-20T18:30' }), e(C, { t: 'item.claim', id: 't1', on: true })]
  assert.equal(fold([...evs, e(B, { t: 'item.assign', id: 't1', to: B })], roles).items.get('t1').claimedBy, C)
  const s1 = fold([...evs, e(A, { t: 'item.assign', id: 't1', to: B })], roles)
  assert.deepEqual([s1.items.get('t1').claimedBy, s1.items.get('t1').due], [B, '2026-11-20T18:30'])
  assert.equal(fold([...evs, e(A, { t: 'item.assign', id: 't1', to: null })], roles).items.get('t1').claimedBy, null)
  assert.equal(fold([e(B, { t: 'item.put', id: 't2', name: 'x', due: 'מחר' })], roles).items.get('t2').due, null, 'a bad date is ignored')
})

test('reminders: a chore with an hour reminds whoever has the turn, on its due day; tasks with a date remind at that time', () => {
  const now = Date.parse('2026-11-11T12:00:00')
  const s = fold([
    e(A, { t: 'chore.put', id: 'c1', name: 'כלים', emoji: '🫧', every: 'day', order: [B, A], time: '20:00' }, '2026-11-01T10:00:00'),
    e(A, { t: 'chore.put', id: 'c2', name: 'זבל', every: 'week', order: [A], time: '08:00' }, '2026-11-01T10:00:00'),
    e(A, { t: 'chore.done', id: 'c2' }, '2026-11-10T09:00:00'),
    e(A, { t: 'chore.put', id: 'c3', name: 'בלי שעה', every: 'day', order: [A] }, '2026-11-01T10:00:00'),
    e(A, { t: 'item.put', id: 't1', name: 'לקנות מתנה', due: '2026-11-12T17:00' }),
    e(A, { t: 'item.put', id: 't2', name: 'עבר', due: '2026-11-10T17:00' }),
  ], roles)
  const plan = plannedReminders(s, roles, now)
  const by = Object.fromEntries(plan.map((r) => [r.id, r]))
  assert.deepEqual(Object.keys(by).sort(), ['c_c1', 'c_c2', 't_t1'])
  assert.equal(by.c_c1.to, B)
  assert.equal(new Date(by.c_c1.at).toString(), new Date('2026-11-11T20:00:00').toString(), 'late chore: today at 20:00')
  assert.equal(new Date(by.c_c2.at).toString(), new Date('2026-11-17T08:00:00').toString(), 'weekly, done on the 10th: the 17th at 08:00')
  assert.equal(by.t_t1.to, null, 'nobody took the task yet: everyone is reminded')
  assert.equal(choreRemindAt({ time: '09:00', createdAt: '2026-11-01T10:00:00', lastDoneAt: null, every: 'day' }, now) > now, true)
})

test('ducklings: an old single accessory moves into its slot; new looks keep every slot; unknown ids are ignored', async () => {
  const { lookOf, legacyAccessory, duck } = await import('../chatzer/js/duck.js')
  assert.equal(lookOf({ accessory: 'shades' }).face, 'shades')
  assert.equal(lookOf({ accessory: 'scarf' }).neck, 'scarf')
  assert.equal(lookOf({ accessory: 'cap', color: 'mint' }).hat, 'cap')
  assert.equal(lookOf({ accessory: 'cap', hat: 'none' }).hat, 'none', 'a new profile with slots wins over the old field')
  const l = lookOf({ color: 'pink', hat: 'chef', face: 'hearts', neck: 'pearls', body: 'dress', bodyColor: 'purple', held: 'balloon', mood: 'wink' })
  assert.deepEqual(l, { color: 'pink', mood: 'wink', hat: 'chef', face: 'hearts', neck: 'pearls', body: 'dress', bodyColor: 'purple', held: 'balloon' })
  assert.deepEqual(lookOf({ hat: 'jetpack', color: 'neon' }), lookOf({}), 'unknown items from a newer app are ignored')
  assert.equal(legacyAccessory(l), 'chef')
  assert.ok(duck(null, 20).startsWith('<svg') && duck({ accessory: 'bow' }, 20).includes('#FF6B8A'))
  // fold keeps the whole look of a member
  const s = fold([e(B, { t: 'member.profile', nickname: 'מאיה', color: 'mint', hat: 'beret', body: 'hoodie', bodyColor: 'black', accessory: 'beret', evil: 'x' })], roles)
  assert.deepEqual(s.profiles.get(B), { nickname: 'מאיה', voice: null, morning: 'on', color: 'mint', hat: 'beret', body: 'hoodie', bodyColor: 'black', accessory: 'beret' })
})

test('undo: "done" and "pass" can be taken back by whoever did them (or an admin), only the latest one', () => {
  const base = [
    e(A, { t: 'chore.put', id: 'c1', name: 'כלים', every: 'day', order: [A, B, C] }),
    e(A, { t: 'chore.done', id: 'c1' }, '2026-11-10T20:00:00.000Z'),
  ]
  assert.equal(fold([...base, e(C, { t: 'chore.undo', id: 'c1' })], roles).chores.get('c1').turnOf, B, 'someone else cannot undo it')
  const s1 = fold([...base, e(A, { t: 'chore.undo', id: 'c1' })], roles).chores.get('c1')
  assert.deepEqual([s1.turnOf, s1.lastDoneAt, s1.history.length], [A, null, 0])
  const s2 = fold([...base, e(B, { t: 'chore.pass', id: 'c1' }), e(B, { t: 'chore.undo', id: 'c1' })], roles).chores.get('c1')
  assert.equal(s2.turnOf, B, 'B takes back passing the turn')
  // A stand-in's done, undone, goes back to the stand-in (and keeps the owner's slot).
  const s3 = fold([e(A, { t: 'chore.put', id: 'c2', name: 'x', every: 'day', order: [A, B, C] }), e(A, { t: 'chore.assign', id: 'c2', to: C }), e(C, { t: 'chore.done', id: 'c2' }), e(C, { t: 'chore.undo', id: 'c2' })], roles).chores.get('c2')
  assert.deepEqual([s3.turnOf, s3.slot], [C, A])
})

test('transparency: on by default; only the admin turns it off', () => {
  assert.equal(fold([e(A, { t: 'yard.meta', name: 'בית', kind: 'home' })], roles).meta.open, true)
  assert.equal(fold([e(A, { t: 'yard.meta', name: 'בית', kind: 'home' }), e(A, { t: 'yard.meta', name: 'בית', kind: 'home', open: false })], roles).meta.open, false)
  assert.equal(fold([e(A, { t: 'yard.meta', name: 'בית', kind: 'home' }), e(B, { t: 'yard.meta', name: 'בית', kind: 'home', open: false })], roles).meta.open, true)
})

test('a pasted list becomes items; numbers that are amounts stay', () => {
  assert.deepEqual(splitList('חומוס, פיתות\n- קרח\n1. 20 פיתות\n• 2 קילו בשר\nחומוס'), ['חומוס', 'פיתות', 'קרח', '20 פיתות', '2 קילו בשר'])
  assert.deepEqual(splitList('מלח גס'), ['מלח גס'])
  assert.deepEqual(splitList('  ,  '), [])
})

test('summary for WhatsApp, and the event in a calendar', () => {
  const s = fold([
    e(A, { t: 'yard.meta', name: 'מנגל', emoji: '🔥', kind: 'event', when: '2026-11-20T14:00', where: 'רמת גן, בגינה' }),
    e(A, { t: 'item.put', id: 'i1', name: 'פיתות', qty: '20' }),
    e(A, { t: 'item.put', id: 'i2', name: 'חומוס' }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
  ], roles)
  const text = summaryText(s, (m) => (m === B ? 'מאיה' : '?'), { link: 'https://x/#/join/abc' })
  assert.match(text, /✅ פיתות \(20\): מאיה/)
  assert.match(text, /⬜ חומוס: עוד פנוי/)
  assert.match(text, /עוד דבר אחד שאף אחד לא לקח/)
  assert.match(text, /לוקחים כאן: https:\/\/x\/#\/join\/abc$/)
  const ics = eventIcs(s, { uid: 'g1', now: Date.parse('2026-11-12T10:00:00Z') })
  assert.match(ics, /BEGIN:VEVENT/)
  assert.match(ics, /LOCATION:רמת גן\\, בגינה/)
  assert.ok(ics.includes(`DTSTART:${new Date('2026-11-20T14:00').toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`))
  assert.match(googleCalendarUrl(s), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/)
  assert.equal(eventIcs(fold([e(A, { t: 'yard.meta', name: 'בית', kind: 'home' })], roles)), null)
})

test('0.9: an item a few people bring together; the first taker stays claimedBy (older versions read it)', () => {
  const s = fold([
    e(A, { t: 'item.put', id: 'i1', name: 'קולה', qty: '3', need: 2 }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
    e(C, { t: 'item.claim', id: 'i1', on: true }),
    e(A, { t: 'item.claim', id: 'i1', on: true }), // full: a third one is not added
  ], roles)
  const it = s.items.get('i1')
  assert.deepEqual(takers(it), [B, C])
  assert.equal(it.claimedBy, B)
  assert.ok(isFull(it))
  assert.deepEqual([eventBoard(s, A).taken, eventBoard(s, A).free.length, eventBoard(s, C).mine.length], [1, 0, 1])
  const s2 = fold([
    e(A, { t: 'item.put', id: 'i1', name: 'קולה', need: 3 }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
    e(C, { t: 'item.claim', id: 'i1', on: true }),
    e(B, { t: 'item.claim', id: 'i1', on: false }), // the first one leaves: the next one moves up
  ], roles)
  assert.equal(s2.items.get('i1').claimedBy, C)
  assert.deepEqual(eventBoard(s2, A).free.map((i) => i.id), ['i1'], 'needs 3, has 1: still open')
  assert.equal(fold([e(A, { t: 'item.put', id: 'x', name: 'y', need: 99 })], roles).items.get('x').need, 10)
})

test('0.9: "קולה x3" keeps the amount; plain names stay names', () => {
  assert.deepEqual(parseItem('קולה x3'), { name: 'קולה', qty: '3' })
  assert.deepEqual(parseItem('קרח ×2'), { name: 'קרח', qty: '2' })
  assert.deepEqual(parseItem('3x בירה'), { name: 'בירה', qty: '3' })
  assert.deepEqual(parseItem('7up'), { name: '7up', qty: '' })
  assert.deepEqual(parseItem('פיתות'), { name: 'פיתות', qty: '' })
})

test('0.9: the evening before an event, each one hears what they bring; a morning summary in home yards', () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime()
  const ev = fold([
    e(A, { t: 'yard.meta', name: 'מנגל', emoji: '🔥', kind: 'event', when: '2026-11-14T14:00' }),
    e(B, { t: 'member.profile', nickname: 'מאיה', voice: 'f' }),
    e(A, { t: 'item.put', id: 'i1', name: 'פיתות', qty: '20' }),
    e(B, { t: 'item.claim', id: 'i1', on: true }),
  ], roles)
  const plan = plannedReminders(ev, roles, now)
  const mine = plan.find((r) => r.id === `e_${B}`)
  assert.equal(mine.to, B)
  assert.equal(mine.at, eveBefore(new Date(2026, 10, 14, 14).getTime()))
  assert.equal(new Date(mine.at).getDate(), 13)
  assert.match(mine.body, /את מביאה: פיתות \(20\)/)
  assert.ok(!plan.some((r) => r.id === `e_${C}`), 'nothing to bring: no reminder')

  const home = (morning) => fold([
    e(A, { t: 'yard.meta', name: 'הבית', emoji: '🏡', kind: 'home' }),
    e(B, { t: 'member.profile', nickname: 'מאיה', ...(morning ? { morning } : {}) }),
    e(A, { t: 'chore.put', id: 'c1', name: 'זבל', emoji: '🗑️', every: 'day', order: [B] }),
  ], roles)
  const d = plannedReminders(home(), roles, now).find((r) => r.id === `d_${B}`)
  assert.equal(d.at, nextMorning(now))
  assert.equal(new Date(d.at).getHours(), 8)
  assert.match(d.body, /בוקר טוב.*זבל/)
  assert.ok(!plannedReminders(home('off'), roles, now).some((r) => r.id === `d_${B}`), 'turned off: no morning summary')
  assert.equal(nextMorning(new Date(2026, 10, 10, 6, 0).getTime()), new Date(2026, 10, 10, 8, 0).getTime())
})

test('0.10: calendar files made on the phone: all-day with a 9:00 reminder, repeats, Google link', () => {
  const day = new Date(2026, 10, 16).getTime()
  const ics = icsFile([
    { uid: 'g1-c1', start: day, allDay: true, title: '🧹 ניקיון סלון', rrule: RRULES.week, url: 'https://x/#/y/g1' },
    { uid: 'g1-t1', start: new Date(2026, 10, 17, 10).getTime(), title: '📌 נייר טואלט', alarms: [60, 0] },
  ], Date.parse('2026-11-12T10:00:00Z'))
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2)
  assert.match(ics, /DTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261117/)
  assert.match(ics, /RRULE:FREQ=WEEKLY/)
  assert.match(ics, /TRIGGER:PT540M/, 'all day: reminds at 9:00')
  assert.match(ics, /TRIGGER:-PT60M[\s\S]*TRIGGER:PT0M/)
  assert.match(ics, /URL:https:\/\/x\/#\/y\/g1/)
  const link = new URL(gcalLink({ start: day, allDay: true, title: 'x', rrule: RRULES['2weeks'] }))
  assert.equal(link.searchParams.get('dates'), '20261116/20261117')
  assert.equal(link.searchParams.get('recur'), 'RRULE:FREQ=WEEKLY;INTERVAL=2')
})
