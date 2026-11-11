import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newCode, normalizeCode, formatCode, deriveKeys, encryptJson, decryptJson, encryptBytes, decryptBytes } from '../js/sync.js'

test('codes: 26 Crockford characters from 128 random bits', () => {
  const c = newCode()
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{26}$/)
  assert.notEqual(newCode(), c)
  assert.equal(newCode(new Uint8Array(16)), '0'.repeat(26))
  assert.equal(newCode(new Uint8Array(16).fill(255)), 'Z'.repeat(25) + 'W')
})

test('codes survive typing and pasting', () => {
  const c = newCode()
  assert.equal(normalizeCode(c), c)
  assert.equal(normalizeCode(formatCode(c).toLowerCase()), c)
  assert.equal(normalizeCode(` ${formatCode(c)} `), c)
  assert.equal(normalizeCode(`https://guyyyy15-web.github.io/deck-surfers/#/pair/${c}`), c)
  assert.equal(normalizeCode('O'.repeat(26)), '0'.repeat(26)) // O is read as zero
  assert.equal(normalizeCode('IL' + '0'.repeat(24)), '11' + '0'.repeat(24))
  assert.equal(normalizeCode('too short'), null)
  assert.equal(normalizeCode(c + 'X'), null)
  assert.equal(formatCode('ABCDEFGHJK'), 'ABCD-EFGH-JK')
})

test('the same code gives the same space and token on every phone; different codes differ', async () => {
  const c = newCode()
  const a = await deriveKeys(c), b = await deriveKeys(c), d = await deriveKeys(newCode())
  assert.match(a.space, /^[a-f0-9]{32}$/)
  assert.match(a.token, /^[a-f0-9]{64}$/)
  assert.equal(a.space, b.space)
  assert.equal(a.token, b.token)
  assert.notEqual(a.space, d.space)
  assert.ok(!a.token.startsWith(a.space), 'space id and token are independent')
  // A record encrypted on one phone opens on the other.
  const box = await encryptJson(a.key, { name: 'רונית מהחשבות', why: 'מייל לכל המחלקה' })
  assert.deepEqual(await decryptJson(b.key, box), { name: 'רונית מהחשבות', why: 'מייל לכל המחלקה' })
  assert.ok(!Buffer.from(box, 'base64').toString('utf8').includes('רונית'))
  await assert.rejects(decryptJson(d.key, box))
})

test('photos encrypt and decrypt byte for byte; each encryption is different', async () => {
  const { key } = await deriveKeys(newCode())
  const bytes = crypto.getRandomValues(new Uint8Array(60000))
  const e1 = await encryptBytes(key, bytes), e2 = await encryptBytes(key, bytes)
  assert.notDeepEqual(e1, e2)
  assert.deepEqual(await decryptBytes(key, e1), bytes)
  e1[40] ^= 1
  await assert.rejects(decryptBytes(key, e1), 'tampering is detected')
})
