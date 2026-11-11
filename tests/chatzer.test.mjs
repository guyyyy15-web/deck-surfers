// החצר: folding a yard's event log into its state (chatzer/js/yard.js), and that the app's files are cached.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fold, eventBoard, homeBoard, nextInOrder, turnOf, orderOf, dueState, weekDuck, pollResults, extractInvite } from '../chatzer/js/yard.js'

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
