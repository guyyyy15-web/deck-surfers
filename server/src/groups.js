// Groups API (/v2). See docs/groups-spec.md §7.
//
// Auth: every request is signed by the phone (X-Member, X-Time, X-Sig over method, path, time and the
// SHA-256 of the body) with the ECDSA key registered at /v2/identity. No accounts, no passwords.
// Content: the server never sees plaintext; events and photos are encrypted with the group key.

import { LIMITS, fail, json, readJson, sha256hex, same, limit, totalBytes } from './index.js'
import { sendPush, allowedEndpoint, unb64u } from './webpush.js'

const G = {
  maxMembers: 20,
  vaultBytes: 8192,
  vaultsPerMember: 4,
  vaultReadsPerHour: 30,
  eventBytes: 32 * 1024,
  eventsPerPost: 50,
  groupBytes: 300 * 1024 * 1024,
  invitesPerGroup: 50,
  inviteDays: 30,
  // Push: a member gets at most one notification per group per cooldown; at most this many sends per post.
  pushCooldownMs: 30e3,
  pushPerPost: 30,
  subsPerMember: 3,
  notifyBytes: 2048,
}

const MEMBER = /^[a-f0-9]{24}$/
const GID = /^[A-Za-z0-9_-]{10,40}$/
const PID = /^[A-Za-z0-9_-]{6,64}$/
const HASH = /^[a-f0-9]{64}$/

const enc = new TextEncoder()
const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function importSignKey(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') fail(400, 'bad key')
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
}
function checkDhKey(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.d) fail(400, 'bad key')
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
}

async function verifySig(pubKey, req, path, bodyBytes) {
  const time = req.headers.get('X-Time') || ''
  const sig = req.headers.get('X-Sig') || ''
  if (!/^\d{12,14}$/.test(time) || Math.abs(Date.now() - Number(time)) > 5 * 60e3) fail(401, 'stale signature')
  const bodyHash = hexOf(await crypto.subtle.digest('SHA-256', bodyBytes))
  let ok = false
  try {
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64ToBytes(sig), enc.encode(`${req.method}\n${path}\n${time}\n${bodyHash}`))
  } catch {
    ok = false
  }
  if (!ok) fail(401, 'bad signature')
}

/** The signed-in phone: verifies the signature against its registered key. */
async function caller(req, env, path, bodyBytes) {
  const id = req.headers.get('X-Member') || ''
  if (!MEMBER.test(id)) fail(401, 'unsigned')
  const row = await env.DB.prepare('SELECT sign_pub FROM identities WHERE id = ?').bind(id).first()
  if (!row) fail(401, 'unknown member')
  await verifySig(await importSignKey(JSON.parse(row.sign_pub)), req, path, bodyBytes)
  return id
}

async function membership(env, gid, mid) {
  const m = await env.DB.prepare('SELECT role FROM members WHERE group_id = ? AND member_id = ? AND removed_at IS NULL').bind(gid, mid).first()
  if (!m) fail(403, 'not a member')
  return m
}

const parse = (bytes, max) => {
  if (bytes.byteLength > max) fail(413, 'too large')
  try {
    return JSON.parse(new TextDecoder().decode(bytes) || '{}')
  } catch {
    fail(400, 'bad json')
  }
}

export async function groupsRoute(req, env, url, ctx) {
  const path = url.pathname + url.search
  const p = url.pathname
  const m = req.method
  // Every /v2 body is read once as bytes, because the signature covers its hash.
  const bytes = m === 'GET' || m === 'DELETE' ? new Uint8Array(0) : new Uint8Array(await req.arrayBuffer())

  // The VAPID public key the app subscribes with (public by design).
  if (p === '/v2/push/key' && m === 'GET') {
    if (!env.VAPID_PUBLIC) fail(503, 'push not configured')
    return json({ key: env.VAPID_PUBLIC })
  }

  // Saved ducklings (vaults). The id is a hash only the passkey or save-code holder can compute.
  const vm = /^\/v2\/vault\/([a-f0-9]{64})$/.exec(p)
  if (vm) {
    if (m === 'GET') {
      await limit(env, req, 'vault', G.vaultReadsPerHour)
      const row = await env.DB.prepare('SELECT data, updated_at FROM vaults WHERE id = ?').bind(vm[1]).first()
      if (!row) fail(404, 'no such vault')
      return json({ data: row.data, updatedAt: row.updated_at })
    }
    const me = await caller(req, env, path, bytes)
    const row = await env.DB.prepare('SELECT member_id FROM vaults WHERE id = ?').bind(vm[1]).first()
    if (row && row.member_id !== me) fail(409, 'taken')
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM vaults WHERE id = ? AND member_id = ?').bind(vm[1], me).run()
      return json({ ok: true })
    }
    if (m === 'PUT') {
      const body = parse(bytes, G.vaultBytes + 256)
      if (typeof body.data !== 'string' || !body.data || body.data.length > G.vaultBytes) fail(400, 'bad vault')
      const now = Date.now()
      await env.DB.batch([
        env.DB.prepare('INSERT INTO vaults (id, member_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
          .bind(vm[1], me, body.data, now),
        // A few per member (a passkey, a save code, one spare): the oldest beyond that go.
        env.DB.prepare('DELETE FROM vaults WHERE member_id = ? AND id NOT IN (SELECT id FROM vaults WHERE member_id = ? ORDER BY updated_at DESC LIMIT ?)')
          .bind(me, me, G.vaultsPerMember),
      ])
      return json({ ok: true })
    }
  }

  // Register this phone's public keys. Signed by the key being registered.
  if (p === '/v2/identity' && m === 'POST') {
    const body = parse(bytes, 4096)
    const key = await importSignKey(body.signPub)
    const dh = checkDhKey(body.dhPub)
    const raw = await crypto.subtle.exportKey('raw', key)
    const id = hexOf(await crypto.subtle.digest('SHA-256', raw)).slice(0, 24)
    if (req.headers.get('X-Member') !== id) fail(400, 'member id does not match key')
    await verifySig(key, req, path, bytes)
    const jwk = { kty: 'EC', crv: 'P-256', x: body.signPub.x, y: body.signPub.y }
    await env.DB.prepare('INSERT INTO identities (id, sign_pub, dh_pub, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET dh_pub = excluded.dh_pub')
      .bind(id, JSON.stringify(jwk), JSON.stringify(dh), Date.now())
      .run()
    return json({ ok: true, id })
  }

  // Look at an invite before joining (no identity needed: knowing the link is the permission).
  let im = /^\/v2\/invites\/([A-Za-z0-9_-]{10,40})\/(peek|accept)$/.exec(p)
  if (im && m === 'POST') {
    const body = parse(bytes, 64 * 1024)
    if (!HASH.test(body.auth || '')) fail(400, 'bad invite')
    const inv = await env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(im[1]).first()
    if (!inv || !same(inv.auth_hash, await sha256hex(body.auth))) fail(404, 'no such invite')
    if (inv.revoked) fail(410, 'revoked')
    if (inv.expires_at < Date.now()) fail(410, 'expired')
    const group = await env.DB.prepare('SELECT id, key_version FROM groups WHERE id = ?').bind(inv.group_id).first()
    if (!group) fail(410, 'group deleted')
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND removed_at IS NULL').bind(group.id).first('n')

    if (im[2] === 'peek') {
      await limit(env, req, 'peek', 120)
      const { results } = await env.DB.prepare('SELECT seq, author_id, key_version, data FROM events WHERE group_id = ? ORDER BY seq DESC LIMIT 300')
        .bind(group.id)
        .all()
      return json({ groupId: group.id, wrappedKeys: JSON.parse(inv.wrapped_keys), members: count, full: count >= G.maxMembers,
        usesLeft: Math.max(0, inv.max_uses - inv.uses), events: results.reverse() })
    }

    const me = await caller(req, env, path, bytes)
    const already = await env.DB.prepare('SELECT removed_at FROM members WHERE group_id = ? AND member_id = ?').bind(group.id, me).first()
    if (already && already.removed_at === null) return json({ ok: true, groupId: group.id, already: true })
    if (inv.uses >= inv.max_uses) fail(410, 'used up')
    if (count >= G.maxMembers) fail(409, 'group full')
    const keys = Array.isArray(body.wrappedForMe) ? body.wrappedForMe : fail(400, 'no keys')
    const stmts = [
      env.DB.prepare(
        `INSERT INTO members (group_id, member_id, role, joined_at, removed_at) VALUES (?, ?, 'member', ?, NULL)
         ON CONFLICT (group_id, member_id) DO UPDATE SET removed_at = NULL, joined_at = excluded.joined_at`,
      ).bind(group.id, me, Date.now()),
      env.DB.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').bind(inv.id),
    ]
    for (const k of keys.slice(0, 50)) {
      if (!Number.isInteger(k.version) || typeof k.wrapped !== 'string' || k.wrapped.length > 4096) fail(400, 'bad key')
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO group_keys (group_id, version, member_id, wrapped) VALUES (?, ?, ?, ?)').bind(group.id, k.version, me, k.wrapped))
    }
    await env.DB.batch(stmts)
    return json({ ok: true, groupId: group.id })
  }

  const me = await caller(req, env, path, bytes)

  // This phone's push subscription (signed, so it belongs to this identity).
  if (p === '/v2/push' && m === 'PUT') {
    const body = parse(bytes, 4096)
    if (!allowedEndpoint(body.endpoint, env.ALLOW_LOCALHOST === '1') || body.endpoint.length > 1024) fail(400, 'bad endpoint')
    let ok = false
    try {
      ok = unb64u(body.p256dh || '').length === 65 && unb64u(body.auth || '').length === 16
    } catch { /* bad base64 */ }
    if (!ok) fail(400, 'bad keys')
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(body.endpoint, me, body.p256dh, body.auth, Date.now())
      .run()
    // Keep only the newest few subscriptions per member (old phones, reinstalls).
    await env.DB.prepare(
      'DELETE FROM push_subs WHERE member_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE member_id = ? ORDER BY created_at DESC LIMIT ?)',
    )
      .bind(me, me, G.subsPerMember)
      .run()
    return json({ ok: true })
  }
  // "Send me a test notification" (to check a phone; a few per hour).
  if (p === '/v2/push/test' && m === 'POST') {
    await limit(env, req, 'pushtest', 6)
    if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) fail(503, 'push not configured')
    const { results } = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE member_id = ?').bind(me).all()
    if (!results.length) fail(404, 'no subscription')
    const vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT || 'https://guyyyy15-web.github.io/deck-surfers/' }
    const statuses = await Promise.all(results.map((s) => sendPush(s, JSON.stringify({ test: true }), { vapid, ttl: 600 }).catch(() => 0)))
    return json({ ok: statuses.some((x) => x >= 200 && x < 300), sent: statuses.filter((x) => x >= 200 && x < 300).length })
  }
  if (p === '/v2/push/off' && m === 'POST') {
    const body = parse(bytes, 4096)
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND member_id = ?').bind(String(body.endpoint || ''), me).run()
    return json({ ok: true })
  }

  // Create a group. The creator becomes admin and stores key version 1 wrapped for themself.
  if (p === '/v2/groups' && m === 'POST') {
    const body = parse(bytes, 8192)
    if (!GID.test(body.id || '') || typeof body.wrapped !== 'string' || body.wrapped.length > 4096) fail(400, 'bad group')
    await limit(env, req, 'groups', 20)
    const r = await env.DB.prepare('INSERT OR IGNORE INTO groups (id, key_version, seq, bytes, created_at) VALUES (?, 1, 0, 0, ?)').bind(body.id, Date.now()).run()
    if (!r.meta.changes) fail(409, 'exists')
    await env.DB.batch([
      env.DB.prepare("INSERT INTO members (group_id, member_id, role, joined_at) VALUES (?, ?, 'admin', ?)").bind(body.id, me, Date.now()),
      env.DB.prepare('INSERT INTO group_keys (group_id, version, member_id, wrapped) VALUES (?, 1, ?, ?)').bind(body.id, me, body.wrapped),
    ])
    return json({ ok: true }, 201)
  }

  // My groups.
  if (p === '/v2/groups' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT g.id, g.key_version, g.needs_rotation, g.seq, m.role FROM members m JOIN groups g ON g.id = m.group_id
       WHERE m.member_id = ? AND m.removed_at IS NULL ORDER BY m.joined_at`,
    )
      .bind(me)
      .all()
    return json({ groups: results.map((r) => ({ id: r.id, keyVersion: r.key_version, needsRotation: !!r.needs_rotation, seq: r.seq, role: r.role })) })
  }

  const gm = /^\/v2\/groups\/([A-Za-z0-9_-]{10,40})(\/.*)?$/.exec(p)
  if (!gm) fail(404, 'not found')
  const gid = gm[1]
  const rest = gm[2] || ''
  const role = (await membership(env, gid, me)).role
  const group = await env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(gid).first()

  if (rest === '' && m === 'GET') {
    const { results: members } = await env.DB.prepare(
      `SELECT m.member_id AS id, m.role, m.joined_at, i.dh_pub FROM members m JOIN identities i ON i.id = m.member_id
       WHERE m.group_id = ? AND m.removed_at IS NULL ORDER BY m.joined_at`,
    )
      .bind(gid)
      .all()
    const { results: keys } = await env.DB.prepare(
      `SELECT k.version, k.wrapped FROM group_keys k WHERE k.group_id = ? AND k.member_id = ? ORDER BY k.version`,
    )
      .bind(gid, me)
      .all()
    const muted = !!(await env.DB.prepare('SELECT 1 AS x FROM push_mutes WHERE group_id = ? AND member_id = ?').bind(gid, me).first('x'))
    return json({
      id: gid, keyVersion: group.key_version, needsRotation: !!group.needs_rotation, seq: group.seq, role, muted,
      members: members.map((x) => ({ id: x.id, role: x.role, joinedAt: x.joined_at, dhPub: JSON.parse(x.dh_pub) })),
      keys,
    })
  }

  // Delete the whole group (admin).
  if (rest === '' && m === 'DELETE') {
    if (role !== 'admin') fail(403, 'admins only')
    await deleteGroup(env, gid)
    return json({ ok: true })
  }

  if (rest === '/events' && m === 'GET') {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0)
    const { results } = await env.DB.prepare(
      'SELECT seq, author_id, key_version, data, created_at FROM events WHERE group_id = ? AND seq > ? ORDER BY seq LIMIT 500',
    )
      .bind(gid, since)
      .all()
    return json({ events: results, seq: results.length ? results[results.length - 1].seq : since, more: results.length === 500,
      keyVersion: group.key_version, needsRotation: !!group.needs_rotation })
  }

  if (rest === '/events' && m === 'POST') {
    const body = parse(bytes, G.eventsPerPost * (G.eventBytes + 100))
    const events = Array.isArray(body.events) ? body.events : fail(400, 'no events')
    if (events.length > G.eventsPerPost) fail(413, 'too many events')
    for (const e of events) {
      if (typeof e.data !== 'string' || e.data.length > G.eventBytes || !Number.isInteger(e.keyVersion)) fail(400, 'bad event')
      if (e.keyVersion > group.key_version) fail(400, 'unknown key version')
    }
    const stmts = [env.DB.prepare('UPDATE groups SET seq = seq + ? WHERE id = ?').bind(events.length, gid)]
    let seq = group.seq
    for (const e of events) {
      seq++
      stmts.push(env.DB.prepare('INSERT INTO events (group_id, seq, author_id, key_version, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(gid, seq, me, e.keyVersion, e.data, Date.now()))
    }
    await env.DB.batch(stmts)
    // Optional notification (encrypted on the phone with the group key). Older app versions send none.
    const n = body.notify
    if (n && typeof n.data === 'string' && n.data.length <= G.notifyBytes && Number.isInteger(n.keyVersion)) {
      // `to`: only these members (e.g. "your turn"); the server sees who, never what.
      const to = Array.isArray(n.to) ? n.to.filter((x) => typeof x === 'string' && /^[0-9a-f]{24}$/.test(x)).slice(0, G.maxMembers) : null
      const work = notifyMembers(env, gid, me, { g: gid, v: n.keyVersion, d: n.data, s: seq }, to)
      if (ctx?.waitUntil) ctx.waitUntil(work.catch((e) => console.error(`push ${gid}: ${e}`)))
      else await work.catch(() => undefined)
    }
    return json({ ok: true, seq })
  }

  if (rest === '/mute' && m === 'POST') {
    const body = parse(bytes, 256)
    await env.DB.prepare(body.muted ? 'INSERT OR IGNORE INTO push_mutes (group_id, member_id) VALUES (?, ?)' : 'DELETE FROM push_mutes WHERE group_id = ? AND member_id = ?')
      .bind(gid, me)
      .run()
    return json({ ok: true, muted: !!body.muted })
  }

  // A new key version, wrapped for every current member (after someone left).
  if (rest === '/keys' && m === 'POST') {
    const body = parse(bytes, 128 * 1024)
    if (body.version !== group.key_version + 1) fail(409, 'stale version')
    const { results: members } = await env.DB.prepare('SELECT member_id FROM members WHERE group_id = ? AND removed_at IS NULL').bind(gid).all()
    const wrapped = new Map((Array.isArray(body.wrapped) ? body.wrapped : []).map((w) => [w.memberId, w.wrapped]))
    for (const x of members) if (typeof wrapped.get(x.member_id) !== 'string') fail(400, 'missing a member')
    const stmts = members.map((x) =>
      env.DB.prepare('INSERT OR REPLACE INTO group_keys (group_id, version, member_id, wrapped) VALUES (?, ?, ?, ?)').bind(gid, body.version, x.member_id, wrapped.get(x.member_id)),
    )
    stmts.push(env.DB.prepare('UPDATE groups SET key_version = ?, needs_rotation = 0 WHERE id = ? AND key_version = ?').bind(body.version, gid, group.key_version))
    await env.DB.batch(stmts)
    return json({ ok: true, keyVersion: body.version })
  }

  // Invite links.
  if (rest === '/invites' && m === 'POST') {
    const body = parse(bytes, 128 * 1024)
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(body.id || '') || !HASH.test(body.authHash || '') || !Array.isArray(body.wrappedKeys)) fail(400, 'bad invite')
    const days = Math.min(G.inviteDays, Math.max(1, Number(body.days) || 7))
    const uses = Math.min(G.maxMembers, Math.max(1, Number(body.maxUses) || 20))
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE group_id = ? AND revoked = 0').bind(gid).first('n')
    if (n >= G.invitesPerGroup) fail(429, 'too many invites')
    await env.DB.prepare('INSERT INTO invites (id, group_id, auth_hash, wrapped_keys, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(body.id, gid, body.authHash, JSON.stringify(body.wrappedKeys.slice(0, 50)), me, Date.now() + days * 86400e3, uses)
      .run()
    return json({ ok: true, expiresAt: Date.now() + days * 86400e3 }, 201)
  }
  const iv = /^\/invites\/([A-Za-z0-9_-]{10,40})$/.exec(rest)
  if (iv && m === 'DELETE') {
    const inv = await env.DB.prepare('SELECT created_by FROM invites WHERE id = ? AND group_id = ?').bind(iv[1], gid).first()
    if (!inv) fail(404, 'no such invite')
    if (role !== 'admin' && inv.created_by !== me) fail(403, 'not yours')
    await env.DB.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').bind(iv[1]).run()
    return json({ ok: true })
  }

  // Leave (yourself) or remove (admin). The next member's phone rotates the key.
  const mm = /^\/members\/([a-f0-9]{24})$/.exec(rest)
  if (mm && m === 'DELETE') {
    const target = mm[1]
    if (target !== me && role !== 'admin') fail(403, 'admins only')
    await env.DB.prepare('UPDATE members SET removed_at = ? WHERE group_id = ? AND member_id = ? AND removed_at IS NULL').bind(Date.now(), gid, target).run()
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND removed_at IS NULL').bind(gid).first('n')
    if (!left) {
      await deleteGroup(env, gid)
      return json({ ok: true, deleted: true })
    }
    // Keep at least one admin: if the last admin left, the longest-standing member becomes admin.
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND removed_at IS NULL AND role = 'admin'").bind(gid).first('n')
    const stmts = [env.DB.prepare('UPDATE groups SET needs_rotation = 1 WHERE id = ?').bind(gid)]
    if (!admins) {
      stmts.push(env.DB.prepare(
        "UPDATE members SET role = 'admin' WHERE group_id = ? AND member_id = (SELECT member_id FROM members WHERE group_id = ? AND removed_at IS NULL ORDER BY joined_at LIMIT 1)",
      ).bind(gid, gid))
    }
    await env.DB.batch(stmts)
    return json({ ok: true })
  }

  // Make another member admin.
  const am = /^\/members\/([a-f0-9]{24})\/admin$/.exec(rest)
  if (am && m === 'POST') {
    if (role !== 'admin') fail(403, 'admins only')
    await env.DB.prepare("UPDATE members SET role = 'admin' WHERE group_id = ? AND member_id = ? AND removed_at IS NULL").bind(gid, am[1]).run()
    return json({ ok: true })
  }

  // Encrypted photos.
  const pm = /^\/photos\/([A-Za-z0-9_-]{6,64})$/.exec(rest)
  if (pm && m === 'PUT') {
    if (!PID.test(pm[1])) fail(400, 'bad id')
    if (!bytes.byteLength || bytes.byteLength > LIMITS.photoBytes) fail(413, 'photo too large')
    const key = `groups/${gid}/${pm[1]}`
    if (await env.PHOTOS.head(key)) return json({ ok: true, existed: true })
    if (group.bytes + bytes.byteLength > G.groupBytes) fail(507, 'group full')
    if ((await totalBytes(env)) + bytes.byteLength > LIMITS.totalBytes) fail(507, 'storage full')
    await env.PHOTOS.put(key, bytes)
    await env.DB.prepare('UPDATE groups SET bytes = bytes + ? WHERE id = ?').bind(bytes.byteLength, gid).run()
    return json({ ok: true }, 201)
  }
  if (pm && m === 'GET') {
    const obj = await env.PHOTOS.get(`groups/${gid}/${pm[1]}`)
    if (!obj) fail(404, 'no photo')
    return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } })
  }

  fail(404, 'not found')
}

/** Pushes one notification to every other member's phones (not muted, not pushed in the last cooldown). */
async function notifyMembers(env, gid, author, payload, to = null) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return
  if (to && !to.length) return
  const now = Date.now()
  const { results } = await env.DB.prepare(
    `SELECT s.endpoint, s.member_id, s.p256dh, s.auth FROM push_subs s
     JOIN members m ON m.member_id = s.member_id AND m.group_id = ? AND m.removed_at IS NULL
     WHERE s.member_id != ?
       AND s.member_id NOT IN (SELECT member_id FROM push_mutes WHERE group_id = ?)
       AND s.member_id NOT IN (SELECT member_id FROM push_sent WHERE group_id = ? AND at > ?)
       AND (? IS NULL OR s.member_id IN (SELECT value FROM json_each(?)))
     LIMIT ?`,
  )
    .bind(gid, author, gid, gid, now - (Number(env.PUSH_COOLDOWN_MS) || G.pushCooldownMs), to && JSON.stringify(to), to && JSON.stringify(to), G.pushPerPost)
    .all()
  if (!results.length) return
  const vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT || 'https://guyyyy15-web.github.io/deck-surfers/' }
  const body = new TextEncoder().encode(JSON.stringify(payload))
  const sent = new Set()
  const gone = []
  await Promise.all(results.map(async (s) => {
    try {
      const status = await sendPush(s, body, { vapid, topic: gid.slice(0, 32) })
      if (status === 404 || status === 410) gone.push(s.endpoint)
      else if (status < 300) sent.add(s.member_id)
    } catch {
      /* one bad subscription doesn't stop the others */
    }
  }))
  const stmts = [...sent].map((mid) => env.DB.prepare('INSERT OR REPLACE INTO push_sent (group_id, member_id, at) VALUES (?, ?, ?)').bind(gid, mid, now))
  for (const e of gone) stmts.push(env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e))
  if (stmts.length) await env.DB.batch(stmts)
}

async function deleteGroup(env, gid) {
  let cursor
  do {
    const list = await env.PHOTOS.list({ prefix: `groups/${gid}/`, cursor })
    if (list.objects.length) await env.PHOTOS.delete(list.objects.map((o) => o.key))
    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)
  await env.DB.batch(['events', 'invites', 'group_keys', 'members', 'push_mutes', 'push_sent'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE group_id = ?`).bind(gid))
    .concat([env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(gid)]))
}
