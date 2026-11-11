// Runs the Worker locally (wrangler dev, local D1 + R2) and exercises the API.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes, createECDH } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = 8790
const BASE = `http://127.0.0.1:${PORT}`
const dir = new URL('..', import.meta.url).pathname
const persist = mkdtempSync(join(tmpdir(), 'nk-sync-'))
let proc

// A pretend push service: records what the Worker sends; /gone/… answers 410 like an expired subscription.
const PUSH_PORT = 8799
const pushed = []
const pushService = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    pushed.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) })
    res.writeHead(req.url.startsWith('/gone/') ? 410 : 201)
    res.end()
  })
})
const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const VAPID_PUBLIC = Buffer.from(await crypto.subtle.exportKey('raw', vapidKeys.publicKey)).toString('base64url')
const VAPID_PRIVATE = JSON.stringify(await crypto.subtle.exportKey('jwk', vapidKeys.privateKey))

const wr = (args) => execFileSync('npx', ['wrangler', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' } })

before(async () => {
  wr(['d1', 'migrations', 'apply', 'nekamot-sync', '--local', '--persist-to', persist])
  await new Promise((r) => pushService.listen(PUSH_PORT, '127.0.0.1', r))
  proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1', '--var', 'ALLOWED_ORIGINS:https://guyyyy15-web.github.io',
    '--var', `VAPID_PUBLIC:${VAPID_PUBLIC}`, '--var', `VAPID_PRIVATE_JWK:${VAPID_PRIVATE}`, '--var', 'VAPID_SUBJECT:https://example.test/'], {
    cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' },
  })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/v1/health`)).ok) return
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('wrangler dev did not start')
})
after(() => {
  pushService.close()
  try { process.kill(-proc.pid) } catch { /* gone */ }
  rmSync(persist, { recursive: true, force: true })
})

const newSpace = () => ({ space: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex') })
const h = (s) => ({ 'X-Space': s.space, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' })
const post = (path, s, body) => fetch(BASE + path, { method: 'POST', headers: s ? h(s) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const get = (path, s) => fetch(BASE + path, { headers: h(s) })

test('create a space once; it stores only a hash of the token', async () => {
  const s = newSpace()
  assert.equal((await post('/v1/spaces', null, s)).status, 201)
  assert.equal((await post('/v1/spaces', null, s)).status, 409)
  assert.equal((await post('/v1/spaces', null, { space: 'x', token: 'y' })).status, 400)
  const out = wr(['d1', 'execute', 'nekamot-sync', '--local', '--persist-to', persist, '--json', '--command', `SELECT auth FROM spaces WHERE id='${s.space}'`]).toString()
  const auth = JSON.parse(out)[0].results[0].auth
  assert.equal(auth, createHash('sha256').update(s.token).digest('hex'))
  assert.ok(!out.includes(s.token))
})

test('wrong or missing credentials are refused', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  assert.equal((await get('/v1/changes', { ...s, token: 'a'.repeat(64) })).status, 401)
  assert.equal((await fetch(`${BASE}/v1/changes`)).status, 401)
})

test('push and pull with a cursor; last write wins', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  let r = await (await post('/v1/items', s, { items: [
    { id: 'rev001', kind: 'revenge', updatedAt: '2026-11-11T10:00:00.000Z', data: 'ENC1' },
    { id: 'rev002', kind: 'revenge', updatedAt: '2026-11-11T10:00:00.000Z', data: 'ENC2' },
  ] })).json()
  assert.deepEqual(r, { applied: 2, seq: 2 })
  // An older copy loses, a newer copy wins.
  r = await (await post('/v1/items', s, { items: [
    { id: 'rev001', kind: 'revenge', updatedAt: '2026-11-11T09:00:00.000Z', data: 'OLD' },
    { id: 'rev002', kind: 'revenge', updatedAt: '2026-11-11T11:00:00.000Z', data: 'NEW' },
  ] })).json()
  assert.equal(r.applied, 1)
  const all = await (await get('/v1/changes?since=0', s)).json()
  assert.deepEqual(all.items.map((i) => [i.id, i.data]), [['rev001', 'ENC1'], ['rev002', 'NEW']])
  const later = await (await get(`/v1/changes?since=${2}`, s)).json()
  assert.deepEqual(later.items.map((i) => i.id), ['rev002'])
  // Deletion is a tombstone that also syncs.
  await post('/v1/items', s, { items: [{ id: 'rev001', kind: 'revenge', updatedAt: '2026-11-11T12:00:00.000Z', deleted: true }] })
  const after = await (await get(`/v1/changes?since=${all.seq}`, s)).json()
  assert.deepEqual(after.items.map((i) => [i.id, i.deleted, i.data]), [['rev001', true, null]])
})

test('spaces cannot see each other', async () => {
  const a = newSpace(), b = newSpace()
  await post('/v1/spaces', null, a)
  await post('/v1/spaces', null, b)
  await post('/v1/items', a, { items: [{ id: 'secret1', kind: 'revenge', updatedAt: '2026-11-11T10:00:00Z', data: 'X' }] })
  assert.equal((await (await get('/v1/changes?since=0', b)).json()).items.length, 0)
})

test('bad items are rejected', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  assert.equal((await post('/v1/items', s, { items: [{ id: '../x', kind: 'revenge', updatedAt: 'x', data: 'a' }] })).status, 400)
  assert.equal((await post('/v1/items', s, { items: [{ id: 'abcdef', kind: 'other', updatedAt: 'x', data: 'a' }] })).status, 400)
  assert.equal((await post('/v1/items', s, { items: [{ id: 'abcdef', kind: 'revenge', updatedAt: 'x', data: 'a'.repeat(70000) }] })).status, 400)
})

test('photos: upload, download, size limit, freed when the photo record is deleted', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  const bytes = randomBytes(5000)
  const put = await fetch(`${BASE}/v1/photos/photo01`, { method: 'PUT', headers: h(s), body: bytes })
  assert.equal(put.status, 201)
  const back = Buffer.from(await (await get('/v1/photos/photo01', s)).arrayBuffer())
  assert.ok(back.equals(bytes))
  assert.equal((await fetch(`${BASE}/v1/photos/photo02`, { method: 'PUT', headers: h(s), body: randomBytes(3 * 1024 * 1024 + 1) })).status, 413)
  await post('/v1/items', s, { items: [{ id: 'photo01', kind: 'photo', updatedAt: '2026-11-11T10:00:00Z', deleted: true }] })
  assert.equal((await get('/v1/photos/photo01', s)).status, 404)
})

test('delete a whole space', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  await fetch(`${BASE}/v1/photos/photo09`, { method: 'PUT', headers: h(s), body: randomBytes(100) })
  assert.equal((await fetch(`${BASE}/v1/spaces`, { method: 'DELETE', headers: h(s) })).status, 200)
  assert.equal((await get('/v1/changes', s)).status, 401)
})

test('CORS: only the app and localhost', async () => {
  const ok = await fetch(`${BASE}/v1/health`, { method: 'OPTIONS', headers: { Origin: 'https://guyyyy15-web.github.io' } })
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://guyyyy15-web.github.io')
  const bad = await fetch(`${BASE}/v1/health`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null)
})

test('security headers on every response', async () => {
  const r = await fetch(`${BASE}/v1/health`)
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(r.headers.get('Cache-Control'), 'no-store')
  assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer')
  const e = await fetch(`${BASE}/v1/changes`)
  assert.equal(e.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('one client can create only 10 backups an hour', async () => {
  const ip = { 'CF-Connecting-IP': '203.0.113.7', 'Content-Type': 'application/json' }
  const codes = []
  for (let i = 0; i < 11; i++) {
    codes.push((await fetch(`${BASE}/v1/spaces`, { method: 'POST', headers: ip, body: JSON.stringify(newSpace()) })).status)
  }
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(201))
  assert.equal(codes[10], 429)
  // Another client is not affected.
  const other = await fetch(`${BASE}/v1/spaces`, { method: 'POST', headers: { ...ip, 'CF-Connecting-IP': '198.51.100.9' }, body: JSON.stringify(newSpace()) })
  assert.equal(other.status, 201)
})

test('the identity record (kind meta) syncs like any other record', async () => {
  const s = newSpace()
  await post('/v1/spaces', null, s)
  const r = await post('/v1/items', s, { items: [{ id: 'identity', kind: 'meta', updatedAt: '8000000000000.1790000000000', data: 'ENC' }] })
  assert.equal((await r.json()).applied, 1)
  const all = await (await get('/v1/changes?since=0', s)).json()
  assert.deepEqual(all.items.map((i) => [i.id, i.kind]), [['identity', 'meta']])
})

// ---------- Groups (/v2) ----------
const { newKeys, signRequest } = await import('../../js/identity.js')

async function phone() {
  const keys = await newKeys()
  const call = async (method, path, body, raw) => {
    const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
    const headers = { ...(await signRequest(keys, method, path, payload)), 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }
    const res = await fetch(BASE + path, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : payload })
    const data = res.headers.get('Content-Type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
    return { status: res.status, data }
  }
  const reg = await call('POST', '/v2/identity', { signPub: keys.signPub, dhPub: keys.dhPub })
  assert.equal(reg.status, 200, JSON.stringify(reg.data))
  return { keys, id: keys.memberId, call }
}
const gid = () => `g${randomBytes(9).toString('hex')}`
const sha = (s) => createHash('sha256').update(s).digest('hex')

test('groups: identity registration checks the key and the signature', async () => {
  const k = await newKeys()
  const body = JSON.stringify({ signPub: k.signPub, dhPub: k.dhPub })
  const h = await signRequest(k, 'POST', '/v2/identity', body)
  // Claiming someone else's id fails.
  const wrongId = await fetch(`${BASE}/v2/identity`, { method: 'POST', headers: { ...h, 'X-Member': 'a'.repeat(24) }, body })
  assert.equal(wrongId.status, 400)
  // A tampered body fails the signature.
  const tampered = await fetch(`${BASE}/v2/identity`, { method: 'POST', headers: h, body: body.replace('"kty"', '"kty" ') })
  assert.equal(tampered.status, 401)
  // Unsigned requests are refused everywhere.
  assert.equal((await fetch(`${BASE}/v2/groups`)).status, 401)
  // An old signature is refused.
  const old = await signRequest(k, 'GET', '/v2/groups', '')
  old['X-Time'] = String(Date.now() - 10 * 60e3)
  assert.equal((await fetch(`${BASE}/v2/groups`, { headers: old })).status, 401)
})

test('groups: create, invite, peek, join, post and read events', async () => {
  const a = await phone(), b = await phone(), c = await phone()
  const g = gid()
  assert.equal((await a.call('POST', '/v2/groups', { id: g, wrapped: 'WRAPPED-A-1' })).status, 201)
  assert.equal((await a.call('POST', '/v2/groups', { id: g, wrapped: 'x' })).status, 409)
  assert.equal((await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'META' }] })).data.seq, 1)
  // Strangers can't read.
  assert.equal((await b.call('GET', `/v2/groups/${g}/events?since=0`)).status, 403)
  // Invite: the server gets only a hash of the auth value.
  const auth = randomBytes(32).toString('hex')
  const inv = `i${randomBytes(9).toString('hex')}`
  assert.equal((await a.call('POST', `/v2/groups/${g}/invites`, { id: inv, authHash: sha(auth), wrappedKeys: [{ version: 1, wrapped: 'INV-1' }], maxUses: 2 })).status, 201)
  // Peek with a wrong auth: nothing.
  assert.equal((await fetch(`${BASE}/v2/invites/${inv}/peek`, { method: 'POST', body: JSON.stringify({ auth: 'f'.repeat(64) }) })).status, 404)
  const peek = await (await fetch(`${BASE}/v2/invites/${inv}/peek`, { method: 'POST', body: JSON.stringify({ auth }) })).json()
  assert.deepEqual([peek.groupId, peek.members, peek.wrappedKeys[0].wrapped, peek.events.length], [g, 1, 'INV-1', 1])
  // Join.
  const join = await b.call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [{ version: 1, wrapped: 'WRAPPED-B-1' }] })
  assert.equal(join.status, 200)
  const info = (await b.call('GET', `/v2/groups/${g}`)).data
  assert.deepEqual(info.members.map((x) => [x.id, x.role]), [[a.id, 'admin'], [b.id, 'member']])
  assert.deepEqual(info.keys, [{ version: 1, wrapped: 'WRAPPED-B-1' }])
  assert.ok(info.members.every((x) => x.dhPub.kty === 'EC' && !x.dhPub.d))
  await b.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'B1' }, { keyVersion: 1, data: 'B2' }] })
  const evs = (await a.call('GET', `/v2/groups/${g}/events?since=1`)).data.events
  assert.deepEqual(evs.map((e) => [e.seq, e.author_id, e.data]), [[2, b.id, 'B1'], [3, b.id, 'B2']])
  // The invite has two uses; the third person may join, a fourth may not.
  assert.equal((await c.call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [{ version: 1, wrapped: 'C' }] })).status, 200)
  const d = await phone()
  assert.equal((await d.call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [] })).status, 410)
  // My groups.
  assert.deepEqual((await c.call('GET', '/v2/groups')).data.groups.map((x) => x.id), [g])
})

test('groups: removal locks the member out and asks for a new key', async () => {
  const a = await phone(), b = await phone(), c = await phone()
  const g = gid()
  await a.call('POST', '/v2/groups', { id: g, wrapped: 'A1' })
  const auth = randomBytes(32).toString('hex'), inv = `i${randomBytes(9).toString('hex')}`
  await a.call('POST', `/v2/groups/${g}/invites`, { id: inv, authHash: sha(auth), wrappedKeys: [] })
  for (const x of [b, c]) await x.call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [{ version: 1, wrapped: 'K' }] })
  // A member can't remove others; an admin can.
  assert.equal((await b.call('DELETE', `/v2/groups/${g}/members/${c.id}`)).status, 403)
  assert.equal((await a.call('DELETE', `/v2/groups/${g}/members/${c.id}`)).status, 200)
  assert.equal((await c.call('GET', `/v2/groups/${g}/events?since=0`)).status, 403)
  const info = (await b.call('GET', `/v2/groups/${g}`)).data
  assert.equal(info.needsRotation, true)
  // Rotation must cover every current member, and only the next version is accepted.
  assert.equal((await b.call('POST', `/v2/groups/${g}/keys`, { version: 2, wrapped: [{ memberId: a.id, wrapped: 'A2' }] })).status, 400)
  assert.equal((await b.call('POST', `/v2/groups/${g}/keys`, { version: 3, wrapped: [] })).status, 409)
  assert.equal((await b.call('POST', `/v2/groups/${g}/keys`, { version: 2, wrapped: [{ memberId: a.id, wrapped: 'A2' }, { memberId: b.id, wrapped: 'B2' }] })).status, 200)
  const after = (await a.call('GET', `/v2/groups/${g}`)).data
  assert.deepEqual([after.keyVersion, after.needsRotation, after.keys.map((k) => k.wrapped)], [2, false, ['A1', 'A2']])
  // Events can't claim a key version that doesn't exist yet.
  assert.equal((await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 3, data: 'x' }] })).status, 400)
  // The last admin leaving hands admin to the longest-standing member; the last member leaving deletes the group.
  await a.call('DELETE', `/v2/groups/${g}/members/${a.id}`)
  assert.equal((await b.call('GET', `/v2/groups/${g}`)).data.role, 'admin')
  assert.equal((await b.call('DELETE', `/v2/groups/${g}/members/${b.id}`)).data.deleted, true)
})

test('groups: encrypted photos for members only; group limit of 20', async () => {
  const a = await phone(), stranger = await phone()
  const g = gid()
  await a.call('POST', '/v2/groups', { id: g, wrapped: 'A1' })
  const bytes = randomBytes(3000)
  assert.equal((await a.call('PUT', `/v2/groups/${g}/photos/ph0001`, undefined, bytes)).status, 201)
  const back = await a.call('GET', `/v2/groups/${g}/photos/ph0001`)
  assert.ok(back.data.equals(bytes))
  assert.equal((await stranger.call('GET', `/v2/groups/${g}/photos/ph0001`)).status, 403)
  // Fill the group to 20 and the 21st is refused.
  const auth = randomBytes(32).toString('hex'), inv = `i${randomBytes(9).toString('hex')}`
  await a.call('POST', `/v2/groups/${g}/invites`, { id: inv, authHash: sha(auth), wrappedKeys: [], maxUses: 20 })
  for (let i = 0; i < 19; i++) assert.equal((await (await phone()).call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [] })).status, 200)
  const auth2 = randomBytes(32).toString('hex'), inv2 = `i${randomBytes(9).toString('hex')}`
  await a.call('POST', `/v2/groups/${g}/invites`, { id: inv2, authHash: sha(auth2), wrappedKeys: [] })
  assert.equal((await (await phone()).call('POST', `/v2/invites/${inv2}/accept`, { auth: auth2, wrappedForMe: [] })).status, 409)
  // Deleting the group removes its photos.
  assert.equal((await a.call('DELETE', `/v2/groups/${g}`)).status, 200)
  assert.equal((await a.call('GET', `/v2/groups/${g}/photos/ph0001`)).status, 403)
})

// ---------- Push notifications ----------

/** A browser subscription pointing at the pretend push service. */
function subscription(name, gone = false) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return { ecdh, authBytes: auth, endpoint: `http://127.0.0.1:${PUSH_PORT}/${gone ? 'gone' : 'push'}/${name}-${randomBytes(4).toString('hex')}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }
}

async function decryptPush(sub, body) {
  // RFC 8291 decryption, done here with WebCrypto as a browser would.
  const enc = new TextEncoder()
  const hk = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8))
  const salt = body.subarray(0, 16), asPub = body.subarray(21, 21 + body[20]), ct = body.subarray(21 + body[20])
  const shared = sub.ecdh.computeSecret(asPub)
  const ikm = await hk(sub.authBytes, shared, Buffer.concat([enc.encode('WebPush: info\0'), sub.ecdh.getPublicKey(), asPub]), 32)
  const key = await crypto.subtle.importKey('raw', await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12) }, key, ct))
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, -1)))
}
const settle = () => new Promise((r) => setTimeout(r, 1200))
const sentTo = (sub) => pushed.filter((p) => sub.endpoint.endsWith(p.path))

async function groupOf(n) {
  const people = []
  for (let i = 0; i < n; i++) people.push(await phone())
  const [a] = people
  const g = gid()
  await a.call('POST', '/v2/groups', { id: g, wrapped: 'A1' })
  const auth = randomBytes(32).toString('hex'), inv = `i${randomBytes(9).toString('hex')}`
  await a.call('POST', `/v2/groups/${g}/invites`, { id: inv, authHash: sha(auth), wrappedKeys: [] })
  for (const x of people.slice(1)) await x.call('POST', `/v2/invites/${inv}/accept`, { auth, wrappedForMe: [] })
  return { g, people }
}

test('push: public key, subscribe rules', async () => {
  assert.equal((await (await fetch(`${BASE}/v2/push/key`)).json()).key, VAPID_PUBLIC)
  const a = await phone()
  const sub = subscription('a')
  assert.equal((await a.call('PUT', '/v2/push', { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })).status, 200)
  assert.equal((await a.call('PUT', '/v2/push', { endpoint: 'https://evil.example/x', p256dh: sub.p256dh, auth: sub.auth })).status, 400)
  assert.equal((await a.call('PUT', '/v2/push', { endpoint: sub.endpoint, p256dh: 'short', auth: sub.auth })).status, 400)
  assert.equal((await fetch(`${BASE}/v2/push`, { method: 'PUT', body: '{}' })).status, 401)
  // Only the newest 3 subscriptions per person are kept.
  const subs = [subscription('a1'), subscription('a2'), subscription('a3'), subscription('a4')]
  for (const s of subs) {
    await a.call('PUT', '/v2/push', { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
    await new Promise((r) => setTimeout(r, 5))
  }
  const rows = JSON.parse(wr(['d1', 'execute', 'nekamot-sync', '--local', '--persist-to', persist, '--json', '--command', `SELECT endpoint FROM push_subs WHERE member_id='${a.id}'`]).toString())[0].results
  assert.deepEqual(rows.map((r) => r.endpoint).sort(), subs.slice(1).map((x) => x.endpoint).sort(), 'the oldest subscription was dropped')
})

test('push: posting with a notification reaches the other members only, encrypted end to end', async () => {
  const { g, people: [a, b, c] } = await groupOf(3)
  const subs = { a: subscription('pa'), b: subscription('pb'), c: subscription('pc') }
  for (const [x, s] of [[a, subs.a], [b, subs.b], [c, subs.c]]) await x.call('PUT', '/v2/push', { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
  const r = await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'EV' }], notify: { keyVersion: 1, data: 'NOTE-CIPHERTEXT' } })
  assert.equal(r.status, 200)
  await settle()
  assert.equal(sentTo(subs.a).length, 0, 'the author gets nothing')
  for (const s of [subs.b, subs.c]) {
    const got = sentTo(s)
    assert.equal(got.length, 1)
    assert.equal(got[0].headers['content-encoding'], 'aes128gcm')
    assert.match(got[0].headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    assert.ok(Number(got[0].headers.ttl) > 0)
    assert.deepEqual(await decryptPush(s, got[0].body), { g, v: 1, d: 'NOTE-CIPHERTEXT', s: r.data.seq })
  }
  // Cooldown: a second post right away doesn't push again.
  await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'EV2' }], notify: { keyVersion: 1, data: 'N2' } })
  await settle()
  assert.equal(sentTo(subs.b).length, 1, 'cooldown holds the second push')
})

test('push: old app versions (no notify) send nothing; mute; expired subscriptions are dropped', async () => {
  const { g, people: [a, b, c] } = await groupOf(3)
  const sb = subscription('mb'), sc = subscription('mc', true)
  await b.call('PUT', '/v2/push', { endpoint: sb.endpoint, p256dh: sb.p256dh, auth: sb.auth })
  await c.call('PUT', '/v2/push', { endpoint: sc.endpoint, p256dh: sc.p256dh, auth: sc.auth })
  // An event from an older app (no notify field) still works and pushes nothing.
  assert.equal((await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'OLD' }] })).status, 200)
  await settle()
  assert.equal(sentTo(sb).length + sentTo(sc).length, 0)
  // B mutes the group.
  assert.equal((await b.call('POST', `/v2/groups/${g}/mute`, { muted: true })).data.muted, true)
  assert.equal((await b.call('GET', `/v2/groups/${g}`)).data.muted, true)
  await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'E' }], notify: { keyVersion: 1, data: 'N' } })
  await settle()
  assert.equal(sentTo(sb).length, 0, 'muted')
  // C's subscription answered 410: it is removed, so the next push doesn't try it again.
  assert.equal(sentTo(sc).length, 1)
  await b.call('POST', `/v2/groups/${g}/mute`, { muted: false })
  await new Promise((r) => setTimeout(r, 100))
  const before = pushed.length
  await b.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'E' }], notify: { keyVersion: 1, data: 'N' } })
  await settle()
  assert.equal(sentTo(sc).length, 1, 'gone subscription not retried')
  assert.ok(pushed.length >= before)
  // Turning push off removes the subscription.
  assert.equal((await b.call('POST', '/v2/push/off', { endpoint: sb.endpoint })).status, 200)
  // An oversize notification is ignored, the events are still stored.
  assert.equal((await a.call('POST', `/v2/groups/${g}/events`, { events: [{ keyVersion: 1, data: 'E' }], notify: { keyVersion: 1, data: 'x'.repeat(3000) } })).status, 200)
})
