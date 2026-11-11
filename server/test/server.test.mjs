// Runs the Worker locally (wrangler dev, local D1 + R2) and exercises the API.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const PORT = 8790
const BASE = `http://127.0.0.1:${PORT}`
const dir = new URL('..', import.meta.url).pathname
const persist = mkdtempSync(join(tmpdir(), 'nk-sync-'))
let proc

const wr = (args) => execFileSync('npx', ['wrangler', ...args], { cwd: dir, stdio: 'pipe', env: { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' } })

before(async () => {
  wr(['d1', 'execute', 'nekamot-sync', '--local', '--persist-to', persist, '--file', 'schema.sql'])
  proc = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1', '--var', 'ALLOWED_ORIGINS:https://guyyyy15-web.github.io'], {
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
