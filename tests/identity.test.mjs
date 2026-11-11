import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// localStorage for node
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
const id = await import('../js/identity.js')
beforeEach(() => mem.clear())

test('nicknames: valid, varied, never the same twice in a row', () => {
  let n = ''
  for (let i = 0; i < 50; i++) {
    const next = id.suggestNickname(n)
    assert.notEqual(next, n)
    assert.ok(id.validNickname(next), next)
    n = next
  }
  assert.ok(!id.validNickname('א'))
  assert.ok(!id.validNickname('א'.repeat(21)))
  assert.ok(id.validNickname('  דני  '))
})

test('every color and accessory draws', () => {
  for (const c of id.CAT_COLORS) for (const a of id.ACCESSORIES) {
    const svg = id.catAvatar({ color: c.id, accessory: a.id }, 40)
    assert.ok(svg.startsWith('<svg') && svg.includes(c.fill), `${c.id}/${a.id}`)
  }
  assert.ok(id.catAvatar({}, 40, 'דני "החניה"').includes('aria-label="דני &quot;החניה&quot;"'))
})

test('keys: member id comes from the signing key, and signatures verify', async () => {
  const k = await id.newKeys()
  assert.match(k.memberId, /^[a-f0-9]{24}$/)
  assert.equal(await id.memberIdOf(k.signPub), k.memberId)
  const h = await id.signRequest(k, 'POST', '/v2/groups', '{"a":1}')
  assert.equal(h['X-Member'], k.memberId)
  const pub = await crypto.subtle.importKey('jwk', k.signPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const bodyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('{"a":1}')))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const msg = new TextEncoder().encode(`POST\n/v2/groups\n${h['X-Time']}\n${bodyHash}`)
  const sig = Uint8Array.from(atob(h['X-Sig']), (c) => c.charCodeAt(0))
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg))
})

test('saving a profile creates keys once and keeps them', async () => {
  await assert.rejects(id.saveProfile({ nickname: 'x', color: 'lilac', accessory: 'none' }))
  const a = await id.saveProfile({ nickname: 'דני', color: 'lilac', accessory: 'crown' })
  const b = await id.saveProfile({ nickname: 'דני החניה', color: 'sun', accessory: 'none' })
  assert.equal(a.keys.memberId, b.keys.memberId)
  assert.equal(id.profile().nickname, 'דני החניה')
})

test('two phones of one person converge: older keys win, newer profile wins', async () => {
  const older = { keys: { ...(await id.newKeys()), createdAt: '2026-01-01T00:00:00.000Z' }, profile: { nickname: 'ישן', color: 'sun', accessory: 'none', updatedAt: '2026-01-01T00:00:00.000Z' } }
  const newer = { keys: { ...(await id.newKeys()), createdAt: '2026-02-01T00:00:00.000Z' }, profile: { nickname: 'חדש', color: 'mint', accessory: 'crown', updatedAt: '2026-03-01T00:00:00.000Z' } }
  localStorage.setItem('nk.identity', JSON.stringify(newer))
  assert.ok(id.adopt(older))
  const merged = id.load()
  assert.equal(merged.keys.memberId, older.keys.memberId)
  assert.equal(merged.profile.nickname, 'חדש')
  assert.ok(!id.adopt(older), 'adopting the same again changes nothing')
  // The backup stamp orders older keys above newer ones, and newer profiles above older ones.
  assert.ok(id.backupStamp(older) > id.backupStamp(newer))
  const edited = { ...older, profile: { ...older.profile, updatedAt: '2026-04-01T00:00:00.000Z' } }
  assert.ok(id.backupStamp(edited) > id.backupStamp(older))
  assert.ok(id.backupStamp(older).length <= 40)
})
