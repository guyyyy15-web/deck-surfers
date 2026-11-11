import { test } from 'node:test'
import assert from 'node:assert/strict'
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const G = await import('../js/groups.js')
const { newKeys } = await import('../js/identity.js')

let seq = 0
const e = (author, ev, at = `2026-11-11T10:${String(seq).padStart(2, '0')}:00Z`) => ({ seq: ++seq, author, at, ev })
const roles = new Map([['admin', 'admin'], ['dani', 'member'], ['rona', 'member']])

test('fold: proposals, votes, taking, done, chat', () => {
  seq = 0
  const st = G.fold([
    e('admin', { t: 'group.meta', name: 'שותפים לדירה', emoji: '🔥' }),
    e('dani', { t: 'member.profile', nickname: 'דני', color: 'sun', accessory: 'crown' }),
    e('dani', { t: 'revenge.put', id: 'r1', name: 'השכן', why: 'מקדחה בשבת', type: 'big' }),
    e('rona', { t: 'revenge.put', id: 'r2', name: 'המזגן', why: 'קר', type: 'small' }),
    e('admin', { t: 'vote.set', id: 'r2', on: true }),
    e('dani', { t: 'vote.set', id: 'r2', on: true }),
    e('dani', { t: 'vote.set', id: 'r2', on: false }),
    e('rona', { t: 'vote.set', id: 'r2', on: true }),
    e('rona', { t: 'assign.set', id: 'r1', to: 'rona' }),
    e('rona', { t: 'revenge.done', id: 'r1', notes: 'פלייליסט ילדים' }),
    e('dani', { t: 'comment.put', cid: 'c1', id: G.CHAT, text: 'שלום' }),
    e('dani', { t: 'comment.put', cid: 'c2', id: 'r2', text: 'אני בעד' }),
  ], roles)
  assert.deepEqual(st.meta, { name: 'שותפים לדירה', emoji: '🔥' })
  assert.equal(st.profiles.get('dani').nickname, 'דני')
  const b = G.board(st)
  assert.deepEqual(b.proposals.map((r) => [r.id, r.votes.size]), [['r2', 2]])
  assert.deepEqual(b.done.map((r) => [r.id, r.doneBy, r.notes]), [['r1', 'rona', 'פלייליסט ילדים']])
  assert.equal(st.chat.length, 1)
  assert.equal(st.comments.get('r2')[0].text, 'אני בעד')
})

test('fold: permissions come from the author (set by the server) and current roles', () => {
  seq = 0
  const st = G.fold([
    e('admin', { t: 'group.meta', name: 'א', emoji: '😼' }),
    e('dani', { t: 'revenge.put', id: 'r1', name: 'של דני', why: 'x' }),
    e('rona', { t: 'revenge.put', id: 'r1', name: 'רונה משנה', why: 'y' }), // not hers: ignored
    e('rona', { t: 'revenge.delete', id: 'r1' }), // not hers: ignored
    e('rona', { t: 'group.meta', name: 'השתלטות' }), // not admin: ignored
    e('rona', { t: 'assign.set', id: 'r1', to: 'dani' }), // can't assign others
    e('dani', { t: 'assign.set', id: 'r1', to: 'dani' }), // can take
    e('rona', { t: 'assign.set', id: 'r1', to: null }), // can't unassign others
    e('dani', { t: 'comment.put', cid: 'c1', id: 'r1', text: 'שלי' }),
    e('rona', { t: 'comment.delete', cid: 'c1' }), // not hers
    e('admin', { t: 'revenge.put', id: 'r1', name: 'מנהל מתקן', why: 'z' }), // admin may
  ], roles)
  const r = st.revenges.get('r1')
  assert.deepEqual([r.name, r.createdBy, r.assignee], ['מנהל מתקן', 'dani', 'dani'])
  assert.equal(st.meta.name, 'א')
  assert.equal(st.comments.get('r1').length, 1)
  const del = G.fold([e('dani', { t: 'revenge.put', id: 'r9', name: 'n', why: 'w' }), e('admin', { t: 'revenge.delete', id: 'r9' })], roles)
  assert.equal(del.revenges.size, 0)
})

test('fold: garbage and undecryptable events are skipped', () => {
  seq = 0
  const st = G.fold([e('dani', null), e('dani', { t: 'nope' }), e('dani', { t: 'comment.put', cid: 'c', id: G.CHAT, text: '   ' })], roles)
  assert.equal(st.chat.length, 0)
  assert.equal(st.lastSeq, 3)
})

test('keys: a key wrapped by A opens only for B', async () => {
  const a = await newKeys(), b = await newKeys(), c = await newKeys()
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const w = await G.wrapFor(a, b.dhPub, raw)
  assert.deepEqual(await G.unwrap(b, w), raw)
  await assert.rejects(G.unwrap(c, w))
  assert.ok(!w.includes('"d"'), 'no private key material in the blob')
  const self = await G.wrapFor(a, a.dhPub, raw)
  assert.deepEqual(await G.unwrap(a, self), raw)
})

test('events encrypt with the group key', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const data = await G.encryptEvent(raw, { t: 'comment.put', text: 'סוד' })
  assert.ok(!Buffer.from(data, 'base64').toString().includes('סוד'))
  assert.equal((await G.decryptEvent(raw, data)).text, 'סוד')
  await assert.rejects(G.decryptEvent(crypto.getRandomValues(new Uint8Array(32)), data))
})

test('invite codes parse; junk does not', () => {
  assert.deepEqual(G.parseInvite('iAbCdEfGhIjKlM.SeCrEt_SeCrEt-SeCrEt12'), { id: 'iAbCdEfGhIjKlM', secret: 'SeCrEt_SeCrEt-SeCrEt12' })
  assert.equal(G.parseInvite('nope'), null)
  assert.equal(G.parseInvite('iAbCdEfGhIjKlM'), null)
})
