// Groups: data layer (docs/groups-spec.md §7). No DOM here.
//
// - Each group has an AES-GCM key per version. The server keeps it wrapped for each member
//   (ECDH between the wrapper's and the member's P-256 keys → AES-GCM), and invite links carry it
//   wrapped with a secret that lives only after the '#' of the link.
// - A group is an append-only, encrypted event log. Every phone folds the log into the board (fold()).
// - The server authenticates phones by signature (identity.signRequest) and never sees plaintext.

import * as db from './db.js'
import * as identity from './identity.js'
import { baseUrl } from './sync.js'

export const MAX_MEMBERS = 20
export const CHAT = '__chat'
export const EMOJIS = ['😼', '🔥', '👑', '🎯', '🧨', '🍰', '🦹', '🐍', '🌶️', '💜']

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s))
export const newId = (prefix) => `${prefix}${b64url(crypto.getRandomValues(new Uint8Array(12)))}`

// ---------- Crypto ----------

const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
async function open(key, data) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)))
}

async function sharedKey(myKeys, theirDhPub) {
  const priv = await crypto.subtle.importKey('jwk', myKeys.dhPriv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey'])
  const pub = await crypto.subtle.importKey('jwk', theirDhPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Wraps a raw group key for a member. The blob names the wrapper's public key so the member can unwrap it. */
export async function wrapFor(myKeys, theirDhPub, raw) {
  const ct = await seal(await sharedKey(myKeys, theirDhPub), raw)
  const { kty, crv, x, y } = myKeys.dhPub
  return JSON.stringify({ from: { kty, crv, x, y }, ct: b64(ct) })
}
export async function unwrap(myKeys, wrapped) {
  const w = JSON.parse(wrapped)
  return open(await sharedKey(myKeys, w.from), unb64(w.ct))
}

/** Invite secrets: the link carries S; the server gets SHA-256(auth(S)); keys are wrapped with wrap(S). */
async function inviteParts(secret) {
  const auth = hex(await sha256(`nk-inv-auth:${secret}`))
  const wrapKey = await aesKey(await sha256(`nk-inv-wrap:${secret}`))
  return { auth, authHash: hex(await sha256(auth)), wrapKey }
}

export async function encryptEvent(raw, ev) {
  return b64(await seal(await aesKey(raw), enc.encode(JSON.stringify(ev))))
}
export async function decryptEvent(raw, data) {
  return JSON.parse(dec.decode(await open(await aesKey(raw), unb64(data))))
}

// ---------- Board state (pure; tested in tests/groups.test.mjs) ----------

/**
 * Folds a group's events into its board. `events`: [{ seq, author, at, ev }] in seq order;
 * `roles`: Map memberId → 'admin' | 'member' (current roles, used for permissions).
 */
export function fold(events, roles = new Map()) {
  const isAdmin = (m) => roles.get(m) === 'admin'
  const state = { meta: { name: 'קבוצה', emoji: '😼' }, profiles: new Map(), revenges: new Map(), comments: new Map(), chat: [], lastSeq: 0 }
  for (const { seq, author, at, ev } of events) {
    state.lastSeq = seq
    if (!ev || typeof ev !== 'object') continue
    const r = ev.id ? state.revenges.get(ev.id) : null
    const mayEdit = r && (r.createdBy === author || isAdmin(author))
    switch (ev.t) {
      case 'group.meta':
        if (isAdmin(author) || seq === events[0]?.seq) state.meta = { name: String(ev.name || '').slice(0, 30) || 'קבוצה', emoji: ev.emoji || '😼' }
        break
      case 'member.profile':
        state.profiles.set(author, { nickname: String(ev.nickname || '').slice(0, 20), color: ev.color, accessory: ev.accessory })
        break
      case 'revenge.put': {
        if (r && !mayEdit) break
        const base = r || { id: ev.id, createdBy: author, createdAt: at, votes: new Set(), status: 'open', assignee: null }
        state.revenges.set(ev.id, {
          ...base, name: String(ev.name || '').slice(0, 60), why: String(ev.why || '').slice(0, 2000), type: ev.type || 'creative',
          plan: ev.plan ? String(ev.plan).slice(0, 2000) : '', photoId: ev.photoId || null, updatedAt: at,
        })
        break
      }
      case 'revenge.delete':
        if (mayEdit) state.revenges.delete(ev.id)
        break
      case 'vote.set':
        if (r) ev.on ? r.votes.add(author) : r.votes.delete(author)
        break
      case 'assign.set':
        if (!r) break
        if (ev.to === author || (ev.to === null && (r.assignee === author || isAdmin(author))) || isAdmin(author)) r.assignee = ev.to || null
        break
      case 'revenge.done':
        if (r && r.status === 'open') Object.assign(r, { status: 'done', doneBy: author, doneAt: at, notes: ev.notes ? String(ev.notes).slice(0, 2000) : '', docPhotoId: ev.docPhotoId || null })
        break
      case 'revenge.reopen':
        if (r && r.status === 'done' && (r.doneBy === author || isAdmin(author))) Object.assign(r, { status: 'open', doneBy: null, doneAt: null })
        break
      case 'comment.put': {
        const text = String(ev.text || '').trim().slice(0, 500)
        if (!text || !ev.cid) break
        const c = { cid: ev.cid, on: ev.id, author, at, text }
        if (ev.id === CHAT) state.chat.push(c)
        else if (state.revenges.has(ev.id)) {
          if (!state.comments.has(ev.id)) state.comments.set(ev.id, [])
          state.comments.get(ev.id).push(c)
        }
        break
      }
      case 'comment.delete': {
        const lists = [state.chat, ...state.comments.values()]
        for (const list of lists) {
          const i = list.findIndex((c) => c.cid === ev.cid)
          if (i >= 0 && (list[i].author === author || isAdmin(author))) list.splice(i, 1)
        }
        break
      }
    }
  }
  return state
}

/** Board lists: proposals by votes then newest; in progress; done newest first. */
export function board(state) {
  const all = [...state.revenges.values()]
  const byNew = (a, b) => (a.createdAt < b.createdAt ? 1 : -1)
  return {
    proposals: all.filter((r) => r.status === 'open' && !r.assignee).sort((a, b) => b.votes.size - a.votes.size || byNew(a, b)),
    doing: all.filter((r) => r.status === 'open' && r.assignee).sort(byNew),
    done: all.filter((r) => r.status === 'done').sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)),
  }
}

// ---------- Network ----------

function me() {
  const id = identity.load()
  if (!id?.keys) throw Object.assign(new Error('צריך קודם ליצור את החתול שלך'), { code: 'no-identity' })
  return id
}

async function api(method, path, body, raw) {
  const { keys } = me()
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
  const headers = await identity.signRequest(keys, method, path, payload)
  const res = await fetch(baseUrl() + path, {
    method,
    headers: { ...headers, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : payload,
  })
  if (!res.ok) {
    const err = new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return (res.headers.get('Content-Type') || '').includes('json') ? res.json() : new Uint8Array(await res.arrayBuffer())
}

/** Registers this phone's public keys with the server (once per identity). */
export async function register() {
  const { keys } = me()
  try {
    if (localStorage.getItem('nk.registered') === keys.memberId) return
  } catch { /* ignore */ }
  await api('POST', '/v2/identity', { signPub: { kty: 'EC', crv: 'P-256', x: keys.signPub.x, y: keys.signPub.y }, dhPub: { kty: 'EC', crv: 'P-256', x: keys.dhPub.x, y: keys.dhPub.y } })
  try {
    localStorage.setItem('nk.registered', keys.memberId)
  } catch { /* ignore */ }
}

// ---------- Local records ----------
// { id, role, keyVersion, keys: { [version]: base64 raw }, members: [{ id, role, dhPub }], since, events: [...],
//   outbox: [ev], seenSeq, removed }

const rawKey = (rec, v) => (rec.keys[v] ? unb64(rec.keys[v]) : null)
const currentKey = (rec) => rawKey(rec, rec.keyVersion)

export async function localGroups() {
  return (await db.allGroups().catch(() => [])).filter((g) => !g.removed)
}
export const localGroup = (id) => db.getGroup(id).catch(() => null)

/** The group folded from its log; kept until the log or the members change. Treat it as read-only. */
const folded = new Map()
export function stateOf(rec) {
  const key = `${rec.events.length}|${rec.events.at(-1)?.seq || 0}|${(rec.members || []).map((m) => m.id + m.role).join()}`
  const hit = folded.get(rec.id)
  if (hit && hit.key === key) return hit.state
  const state = fold(rec.events, new Map((rec.members || []).map((m) => [m.id, m.role])))
  folded.set(rec.id, { key, state })
  return state
}

export async function createGroup({ name, emoji }) {
  await register()
  const { keys, profile } = me()
  const id = newId('g')
  const raw = crypto.getRandomValues(new Uint8Array(32))
  await api('POST', '/v2/groups', { id, wrapped: await wrapFor(keys, keys.dhPub, raw) })
  const rec = { id, role: 'admin', keyVersion: 1, keys: { 1: b64(raw) }, members: [{ id: keys.memberId, role: 'admin', dhPub: keys.dhPub }], since: 0, events: [], outbox: [], seenSeq: 0 }
  await db.putGroup(rec)
  await post(id, [{ t: 'group.meta', name, emoji }, { t: 'member.profile', ...pick(profile) }])
  await refresh(id).catch(() => undefined)
  return id
}
const pick = (p) => ({ nickname: p.nickname, color: p.color, accessory: p.accessory })

/**
 * Adds events (queued locally first, so nothing is lost offline). `notify` = { body } asks the server to tell
 * the other members; the text is encrypted with the group key, so only their phones can read it.
 */
export async function post(gid, evs, notify = null) {
  const rec = await db.getGroup(gid)
  const at = new Date().toISOString()
  rec.outbox = [...(rec.outbox || []), ...evs.map((ev) => ({ ...ev, at }))]
  if (notify?.body) {
    const st = stateOf(rec)
    rec.notify = { title: `${st.meta.emoji} ${st.meta.name}`.slice(0, 60), body: String(notify.body).slice(0, 160) }
  }
  await db.putGroup(rec)
  try {
    const res = await flush(gid)
    // Show what I just did right away (and anything that arrived meanwhile), without waiting for the next poll.
    if (res.sent) await pull(gid).catch(() => undefined)
    return res
  } catch (e) {
    if (e.status === 403) throw e
    return { queued: true }
  }
}

async function flush(gid) {
  const rec = await db.getGroup(gid)
  if (!rec?.outbox?.length) return { sent: 0 }
  const raw = currentKey(rec)
  const events = []
  for (const ev of rec.outbox) events.push({ keyVersion: rec.keyVersion, data: await encryptEvent(raw, ev) })
  // A notification that waited offline is old news; only send it if it is fresh.
  const fresh0 = rec.notify && Date.now() - Date.parse(rec.outbox[rec.outbox.length - 1].at) < 10 * 60e3
  const notify = fresh0 ? { keyVersion: rec.keyVersion, data: await encryptEvent(raw, rec.notify) } : undefined
  await api('POST', `/v2/groups/${gid}/events`, { events, notify })
  const fresh = await db.getGroup(gid)
  fresh.outbox = fresh.outbox.slice(rec.outbox.length)
  delete fresh.notify
  await db.putGroup(fresh)
  return { sent: events.length }
}

/** Members, keys (unwrapped), key rotation if needed, then new events. Returns the number of new events. */
const INFO_MAX_AGE = 10 * 60e3

/**
 * Brings one group up to date. Usually one request: the new events (the answer also says whether the members or
 * keys changed). The full group info is reloaded only when those changed, every 10 minutes, or with `full`.
 */
export async function refresh(gid, { full = false } = {}) {
  await register()
  const known = await db.getGroup(gid)
  let got = 0
  if (!full && known && !known.removed && known.keys?.[known.keyVersion] && known.mv && Date.now() - (known.infoAt || 0) < INFO_MAX_AGE) {
    try {
      await flush(gid).catch(() => undefined)
      const { added, meta } = await pull(gid)
      got = added
      if (meta && meta.mv === known.mv && meta.keyVersion === known.keyVersion && !meta.needsRotation) {
        await introduce(gid)
        return added
      }
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e
    }
  }
  return got + (await fullRefresh(gid))
}

async function fullRefresh(gid) {
  const { keys } = me()
  let info
  try {
    info = await api('GET', `/v2/groups/${gid}`)
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      const rec = await db.getGroup(gid)
      if (rec) await db.putGroup({ ...rec, removed: true })
      throw Object.assign(new Error('removed'), { code: 'removed' })
    }
    throw e
  }
  const rec = (await db.getGroup(gid)) || { id: gid, keys: {}, since: 0, events: [], outbox: [], seenSeq: 0 }
  rec.role = info.role
  rec.muted = !!info.muted
  rec.members = info.members
  for (const k of info.keys) if (!rec.keys[k.version]) rec.keys[k.version] = b64(await unwrap(keys, k.wrapped))
  rec.keyVersion = info.keyVersion
  rec.mv = info.mv || null
  rec.infoAt = Date.now()
  await db.putGroup(rec)

  if (info.needsRotation) await rotate(gid).catch(() => undefined)
  await flush(gid).catch(() => undefined)

  const { added } = await pull(gid)
  await introduce(gid)
  return added
}

/** Does this group already know my cat as it is now? */
function profileKnown(rec) {
  const { keys, profile } = me()
  if (!profile) return true
  const mine = stateOf(rec).profiles.get(keys.memberId)
  return !!mine && mine.nickname === profile.nickname && mine.color === profile.color && mine.accessory === profile.accessory
}

/** Make sure the others know who I am (once, and again after I edit my cat). */
async function introduce(gid) {
  const { keys, profile } = me()
  const rec = await db.getGroup(gid)
  if (!profile || profileKnown(rec)) return
  const mine = stateOf(rec).profiles.get(keys.memberId)
  // The first introduction also tells the others someone joined.
  await post(gid, [{ t: 'member.profile', ...pick(profile) }], mine ? null : { body: `🐾 ${profile.nickname} הצטרף/ה לקבוצה` })
}

/** New events since the last pull (just the event log; members and keys come from refresh()). */
async function pull(gid) {
  let added = 0
  let meta = null
  for (;;) {
    const cur = await db.getGroup(gid)
    const page = await api('GET', `/v2/groups/${gid}/events?since=${cur.since}`)
    meta = { mv: page.mv, keyVersion: page.keyVersion, needsRotation: page.needsRotation }
    for (const e of page.events) {
      if (e.seq <= cur.since) continue
      const raw = rawKey(cur, e.key_version)
      let ev = null
      if (raw) ev = await decryptEvent(raw, e.data).catch(() => null)
      cur.events.push({ seq: e.seq, author: e.author_id, at: ev?.at || new Date(e.created_at).toISOString(), ev })
      added++
    }
    cur.since = page.seq
    await db.putGroup(cur)
    if (!page.more) break
  }
  return { added, meta }
}

/** After someone left: a new key version, wrapped for everyone still in the group. */
async function rotate(gid) {
  const { keys } = me()
  const rec = await db.getGroup(gid)
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = []
  for (const m of rec.members) wrapped.push({ memberId: m.id, wrapped: await wrapFor(keys, m.dhPub, raw) })
  const version = rec.keyVersion + 1
  await api('POST', `/v2/groups/${gid}/keys`, { version, wrapped })
  rec.keys[version] = b64(raw)
  rec.keyVersion = version
  await db.putGroup(rec)
}

export async function listRemote() {
  await register()
  return (await api('GET', '/v2/groups')).groups
}

/** Fetches every group I'm in (also groups joined on another phone of mine). */
export async function refreshAll() {
  const remote = await listRemote()
  const ids = new Set(remote.map((g) => g.id))
  // A group I was removed from (or left on another phone) counts as a change, so the list updates.
  let added = 0
  for (const rec of await db.allGroups()) {
    if (!ids.has(rec.id) && !rec.removed) {
      await db.putGroup({ ...rec, removed: true })
      added++
    }
  }
  // Only groups whose log moved (or whose keys or my role changed) are fetched.
  for (const g of remote) {
    const rec = await db.getGroup(g.id)
    const same = rec && !rec.removed && rec.since === g.seq && rec.keyVersion === g.keyVersion && rec.role === g.role && !g.needsRotation && !rec.outbox?.length
    if (same && Date.now() - (rec.infoAt || 0) < INFO_MAX_AGE && profileKnown(rec)) continue
    added += await refresh(g.id).catch(() => 0)
  }
  return added
}

// ---------- Invites ----------

export async function createInvite(gid, { days = 7, maxUses = 20 } = {}) {
  const rec = await db.getGroup(gid)
  const secret = b64url(crypto.getRandomValues(new Uint8Array(18)))
  const { authHash, wrapKey } = await inviteParts(secret)
  const wrappedKeys = []
  for (const [v, k] of Object.entries(rec.keys)) wrappedKeys.push({ version: Number(v), wrapped: b64(await seal(wrapKey, unb64(k))) })
  const id = newId('i')
  const res = await api('POST', `/v2/groups/${gid}/invites`, { id, authHash, wrappedKeys, days, maxUses })
  return { id, secret, code: `${id}.${secret}`, expiresAt: res.expiresAt }
}

/** Finds an invite in pasted text: the whole link, or just the code after '#/join/'. */
export function extractInvite(text) {
  const t = String(text || '').trim()
  const m = /#\/join\/([\w.-]+)/.exec(t)
  const code = m ? decodeURIComponent(m[1]) : t
  return parseInvite(code) ? code : null
}

export function parseInvite(code) {
  const m = /^(i[A-Za-z0-9_-]{10,30})\.([A-Za-z0-9_-]{16,40})$/.exec(String(code || '').trim())
  return m ? { id: m[1], secret: m[2] } : null
}

/** What the invite shows before joining: the group's name, emoji and members' cats (decrypted here). */
export async function peekInvite(code) {
  const inv = parseInvite(code)
  if (!inv) throw Object.assign(new Error('הקישור לא תקין'), { code: 'bad' })
  const { auth, wrapKey } = await inviteParts(inv.secret)
  const res = await fetch(`${baseUrl()}/v2/invites/${inv.id}/peek`, { method: 'POST', body: JSON.stringify({ auth }) })
  if (!res.ok) {
    const reason = res.status === 410 ? 'expired' : 'missing'
    throw Object.assign(new Error(reason === 'expired' ? 'ההזמנה פגה או בוטלה. בקשו קישור חדש.' : 'לא מצאתי את ההזמנה.'), { code: reason })
  }
  const data = await res.json()
  const keys = {}
  for (const k of data.wrappedKeys) keys[k.version] = await open(wrapKey, unb64(k.wrapped))
  const events = []
  for (const e of data.events) {
    const raw = keys[e.key_version]
    const ev = raw ? await decryptEvent(raw, e.data).catch(() => null) : null
    events.push({ seq: e.seq, author: e.author_id, at: ev?.at, ev })
  }
  const st = fold(events)
  return { groupId: data.groupId, keys, members: data.members, full: data.full, meta: st.meta, profiles: st.profiles }
}

export async function joinInvite(code) {
  const inv = parseInvite(code)
  const peek = await peekInvite(code)
  if (peek.full) throw Object.assign(new Error('הקבוצה מלאה (20 חברים).'), { code: 'full' })
  await register()
  const { keys } = me()
  const { auth } = await inviteParts(inv.secret)
  const wrappedForMe = []
  for (const [v, raw] of Object.entries(peek.keys)) wrappedForMe.push({ version: Number(v), wrapped: await wrapFor(keys, keys.dhPub, raw) })
  await api('POST', `/v2/invites/${inv.id}/accept`, { auth, wrappedForMe })
  const prev = await db.getGroup(peek.groupId)
  if (prev?.removed) await db.deleteGroup(peek.groupId)
  await refresh(peek.groupId)
  return peek.groupId
}

// ---------- Members ----------

export async function leave(gid) {
  const { keys } = me()
  await api('DELETE', `/v2/groups/${gid}/members/${keys.memberId}`)
  await db.deleteGroup(gid)
}
export async function removeMember(gid, memberId) {
  await api('DELETE', `/v2/groups/${gid}/members/${memberId}`)
  await refresh(gid)
}
export async function makeAdmin(gid, memberId) {
  await api('POST', `/v2/groups/${gid}/members/${memberId}/admin`)
  await refresh(gid)
}
export async function deleteGroup(gid) {
  await api('DELETE', `/v2/groups/${gid}`)
  await db.deleteGroup(gid)
}

// ---------- Photos (encrypted with the current group key; 1 byte of key version in front) ----------

export async function uploadPhoto(gid, blob) {
  const rec = await db.getGroup(gid)
  const sealed = await seal(await aesKey(currentKey(rec)), new Uint8Array(await blob.arrayBuffer()))
  const body = new Uint8Array(sealed.length + 1)
  body[0] = rec.keyVersion
  body.set(sealed, 1)
  const id = newId('p')
  await api('PUT', `/v2/groups/${gid}/photos/${id}`, undefined, body)
  await db.putPhoto({ id, kind: 'group', blob, createdAt: new Date().toISOString() })
  return id
}

/** Makes sure a group photo is on this phone (downloads and decrypts it once). */
export async function ensurePhoto(gid, id) {
  if (!id || (await db.getPhoto(id).catch(() => null))) return
  const rec = await db.getGroup(gid)
  const data = await api('GET', `/v2/groups/${gid}/photos/${id}`)
  const raw = rawKey(rec, data[0])
  if (!raw) return
  const bytes = await open(await aesKey(raw), data.subarray(1))
  await db.putPhoto({ id, kind: 'group', blob: new Blob([bytes], { type: 'image/jpeg' }), createdAt: new Date().toISOString() })
}

/** Unread = events by others after what I last saw. */
export function unread(rec, myId) {
  return rec.events.filter((e) => e.seq > (rec.seenSeq || 0) && e.author !== myId).length
}
export async function markSeen(gid) {
  const rec = await db.getGroup(gid)
  if (rec && rec.seenSeq !== rec.since) await db.putGroup({ ...rec, seenSeq: rec.since })
}

/** "חבר אחד" / "3 חברים". */
export const membersText = (n) => (n === 1 ? 'חבר אחד' : `${n} חברים`)

// ---------- Push ----------

export async function pushKey() {
  const res = await fetch(`${baseUrl()}/v2/push/key`)
  if (!res.ok) throw new Error('התראות לא זמינות כרגע')
  return (await res.json()).key
}
export async function savePush(sub) {
  await register()
  const j = sub.toJSON()
  await api('PUT', '/v2/push', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
}
export async function removePush(endpoint) {
  await api('POST', '/v2/push/off', { endpoint })
}
export async function testPush() {
  await api('POST', '/v2/push/test', {})
}
export async function setMute(gid, muted) {
  await api('POST', `/v2/groups/${gid}/mute`, { muted })
  const rec = await db.getGroup(gid)
  if (rec) await db.putGroup({ ...rec, muted })
}

export const inviteLink = (code) => `${location.origin}${location.pathname}#/join/${code}`
