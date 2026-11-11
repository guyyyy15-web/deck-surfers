import { groupsRoute } from './groups.js'

// נקמות שלי sync server: a Cloudflare Worker with D1 (records) and R2 (photos).
// Everything it stores is encrypted by the phone; it cannot read names, reasons or photos.
//
// Auth: each request carries X-Space (space id) and Authorization: Bearer <token>. Both are derived
// on the phone from the sync code; the server keeps only SHA-256(token).

export const LIMITS = {
  itemsPerPush: 200,
  itemBytes: 64 * 1024, // one encrypted revenge record
  itemsPerSpace: 5000,
  photoBytes: 3 * 1024 * 1024,
  spaceBytes: 300 * 1024 * 1024,
  // Stop well inside R2's free 10 GB so the account is never charged.
  totalBytes: 8 * 1024 * 1024 * 1024,
  spacesPerClientPerHour: 10,
  totalSpaces: 20000,
}

// Sent with every response.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

const ID = /^[A-Za-z0-9_-]{6,64}$/
const SPACE = /^[a-f0-9]{32}$/
const TOKEN = /^[a-f0-9]{64}$/

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env)
    const headers = { ...SECURITY_HEADERS, ...cors }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    try {
      const res = await route(req, env, ctx)
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
      return res
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, headers)
      // Never log request bodies: they are ciphertext, but they are the users' data.
      console.error(`${req.method} ${new URL(req.url).pathname}: ${err?.stack || err}`)
      return json({ error: 'server error' }, 500, headers)
    }
  },
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message)
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const ok = allowed.includes(origin) || (env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Space, X-Member, X-Time, X-Sig',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' }
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string comparison. */
export function same(a, b) {
  if (a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}

async function authed(req, env) {
  const space = req.headers.get('X-Space') || ''
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  if (!SPACE.test(space) || !TOKEN.test(token)) fail(401, 'missing credentials')
  const row = await env.DB.prepare('SELECT id, auth, seq, bytes FROM spaces WHERE id = ?').bind(space).first()
  if (!row || !same(row.auth, await sha256hex(token))) fail(401, 'unknown space')
  return row
}

export async function readJson(req, max) {
  const len = Number(req.headers.get('Content-Length') || 0)
  if (len > max) fail(413, 'too large')
  const text = await req.text()
  if (text.length > max) fail(413, 'too large')
  try {
    return JSON.parse(text)
  } catch {
    fail(400, 'bad json')
  }
}

async function route(req, env, ctx) {
  const url = new URL(req.url)
  const p = url.pathname

  if (p === '/' || p === '/v1/health') return json({ ok: true, service: 'nekamot-sync' })
  if (p.startsWith('/v2/')) return groupsRoute(req, env, url, ctx)

  // Create a space. The phone generates the id and token from a fresh sync code.
  if (p === '/v1/spaces' && req.method === 'POST') {
    const body = await readJson(req, 1024)
    if (!SPACE.test(body?.space || '') || !TOKEN.test(body?.token || '')) fail(400, 'bad space')
    await limit(env, req, 'spaces', LIMITS.spacesPerClientPerHour)
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM spaces').first('n')
    if (total >= LIMITS.totalSpaces) fail(507, 'service full')
    const r = await env.DB.prepare('INSERT OR IGNORE INTO spaces (id, auth, seq, bytes, created_at) VALUES (?, ?, 0, 0, ?)')
      .bind(body.space, await sha256hex(body.token), Date.now())
      .run()
    if (!r.meta.changes) fail(409, 'exists')
    return json({ ok: true }, 201)
  }

  if (p === '/v1/spaces' && req.method === 'DELETE') {
    const sp = await authed(req, env)
    let cursor
    do {
      const list = await env.PHOTOS.list({ prefix: `${sp.id}/`, cursor })
      if (list.objects.length) await env.PHOTOS.delete(list.objects.map((o) => o.key))
      cursor = list.truncated ? list.cursor : undefined
    } while (cursor)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM items WHERE space = ?').bind(sp.id),
      env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(sp.id),
    ])
    return json({ ok: true })
  }

  // Everything changed after `since`.
  if (p === '/v1/changes' && req.method === 'GET') {
    const sp = await authed(req, env)
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0)
    const { results } = await env.DB.prepare(
      'SELECT id, kind, updated_at, deleted, data, seq FROM items WHERE space = ? AND seq > ? ORDER BY seq LIMIT 500',
    )
      .bind(sp.id, since)
      .all()
    const items = results.map((r) => ({ id: r.id, kind: r.kind, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.data, seq: r.seq }))
    return json({ items, seq: items.length ? items[items.length - 1].seq : since, more: items.length === 500 })
  }

  // Push changed records. Last write wins: an item only replaces a stored one with an older updatedAt.
  if (p === '/v1/items' && req.method === 'POST') {
    const sp = await authed(req, env)
    const body = await readJson(req, LIMITS.itemsPerPush * (LIMITS.itemBytes + 200))
    const items = Array.isArray(body?.items) ? body.items : fail(400, 'no items')
    if (items.length > LIMITS.itemsPerPush) fail(413, 'too many items')
    for (const it of items) {
      if (!ID.test(it?.id || '') || !['revenge', 'photo', 'meta'].includes(it.kind) || typeof it.updatedAt !== 'string' || it.updatedAt.length > 40) fail(400, 'bad item')
      if (!it.deleted && (typeof it.data !== 'string' || it.data.length > LIMITS.itemBytes)) fail(400, 'bad item data')
    }
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE space = ?').bind(sp.id).first('n')
    if (count + items.length > LIMITS.itemsPerSpace) fail(507, 'space full')

    let applied = 0
    for (const it of items) {
      const cur = await env.DB.prepare('SELECT updated_at, deleted, kind FROM items WHERE space = ? AND id = ?').bind(sp.id, it.id).first()
      if (cur && cur.updated_at >= it.updatedAt) continue
      const seq = await env.DB.prepare('UPDATE spaces SET seq = seq + 1 WHERE id = ? RETURNING seq').bind(sp.id).first('seq')
      await env.DB.prepare(
        `INSERT INTO items (space, id, kind, updated_at, deleted, data, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (space, id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at,
           deleted = excluded.deleted, data = excluded.data, seq = excluded.seq`,
      )
        .bind(sp.id, it.id, it.kind, it.updatedAt, it.deleted ? 1 : 0, it.deleted ? null : it.data, seq)
        .run()
      // A deleted photo record frees its file.
      if (it.kind === 'photo' && it.deleted) await dropPhoto(env, sp.id, it.id)
      applied++
    }
    const seq = await env.DB.prepare('SELECT seq FROM spaces WHERE id = ?').bind(sp.id).first('seq')
    return json({ applied, seq })
  }

  const m = /^\/v1\/photos\/([A-Za-z0-9_-]{6,64})$/.exec(p)
  if (m && req.method === 'PUT') {
    const sp = await authed(req, env)
    const body = await req.arrayBuffer()
    if (!body.byteLength || body.byteLength > LIMITS.photoBytes) fail(413, 'photo too large')
    const key = `${sp.id}/${m[1]}`
    const had = await env.PHOTOS.head(key)
    if (had) return json({ ok: true, existed: true })
    if (sp.bytes + body.byteLength > LIMITS.spaceBytes) fail(507, 'space full')
    const total = await totalBytes(env)
    if (total + body.byteLength > LIMITS.totalBytes) fail(507, 'storage full')
    await env.PHOTOS.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' } })
    await env.DB.prepare('UPDATE spaces SET bytes = bytes + ? WHERE id = ?').bind(body.byteLength, sp.id).run()
    return json({ ok: true }, 201)
  }
  if (m && req.method === 'GET') {
    const sp = await authed(req, env)
    const obj = await env.PHOTOS.get(`${sp.id}/${m[1]}`)
    if (!obj) fail(404, 'no photo')
    return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store' } })
  }

  fail(404, 'not found')
}

/** At most `max` actions of this kind per client per hour. Clients are hashed IPs, rotated daily. */
export async function limit(env, req, kind, max) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local'
  const hour = Math.floor(Date.now() / 3600000)
  const day = Math.floor(hour / 24)
  const key = `${kind}:${(await sha256hex(`${day}:${ip}`)).slice(0, 32)}`
  const n = await env.DB.prepare(
    'INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1) ON CONFLICT (key, window) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(key, hour)
    .first('count')
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(hour - 2).run()
  if (n > max) fail(429, 'too many requests')
}

async function dropPhoto(env, space, id) {
  const key = `${space}/${id}`
  const obj = await env.PHOTOS.head(key)
  if (!obj) return
  await env.PHOTOS.delete(key)
  await env.DB.prepare('UPDATE spaces SET bytes = MAX(0, bytes - ?) WHERE id = ?').bind(obj.size, space).run()
}

/** Photo bytes stored in R2 by backups and groups together. */
export async function totalBytes(env) {
  const a = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM spaces').first('b')
  const b = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM groups').first('b')
  return a + b
}
