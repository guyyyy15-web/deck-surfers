// Yards: the data layer. No DOM here.
//
// A yard is an append-only, encrypted event log (the same server and crypto as the groups in נקמות שלי):
// - Each yard has an AES-GCM key per version. The server keeps it wrapped for each member (ECDH between the
//   wrapper's and the member's P-256 keys), and invite links carry it wrapped with a secret after the '#'.
// - Every phone folds the log into the yard's state (fold()). Permissions are checked there, by the author the
//   server verified from the signature and by current roles, never by what an event says about itself.
// - The server authenticates phones by signature and never sees plaintext: not names, not items, not chores.

import * as db from './db.js'
import * as identity from './identity.js'

export const MAX_MEMBERS = 20
export const CHAT = '__chat'
const PROD_API = 'https://chatzer-sync.guyyyy15-web.workers.dev'

export function apiUrl() {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    try {
      return localStorage.getItem('cz.api') || PROD_API
    } catch {
      return PROD_API
    }
  }
  return PROD_API
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
export async function wrapFor(myKeys, theirDhPub, raw) {
  const ct = await seal(await sharedKey(myKeys, theirDhPub), raw)
  const { kty, crv, x, y } = myKeys.dhPub
  return JSON.stringify({ from: { kty, crv, x, y }, ct: b64(ct) })
}
export async function unwrap(myKeys, wrapped) {
  const w = JSON.parse(wrapped)
  return open(await sharedKey(myKeys, w.from), unb64(w.ct))
}
async function inviteParts(secret) {
  const auth = hex(await sha256(`cz-inv-auth:${secret}`))
  const wrapKey = await aesKey(await sha256(`cz-inv-wrap:${secret}`))
  return { auth, authHash: hex(await sha256(auth)), wrapKey }
}
export async function encryptEvent(raw, ev) {
  return b64(await seal(await aesKey(raw), enc.encode(JSON.stringify(ev))))
}
export async function decryptEvent(raw, data) {
  return JSON.parse(dec.decode(await open(await aesKey(raw), unb64(data))))
}

// ---------- State (pure; tested in tests/chatzer.test.mjs) ----------

export const EVERY = {
  day: { label: 'כל יום', days: 1 },
  '2days': { label: 'כל יומיים', days: 2 },
  week: { label: 'כל שבוע', days: 7 },
  '2weeks': { label: 'כל שבועיים', days: 14 },
  month: { label: 'כל חודש', days: 30 },
}
const str = (v, n) => String(v ?? '').trim().slice(0, n)
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** A local date-time from <input type="datetime-local"> ("2026-11-20T18:30"), or null. */
const localDateTime = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)

/**
 * Folds a yard's events into its state. `events`: [{ seq, author, at, ev }] in seq order.
 * `roles`: Map memberId → 'admin' | 'member' (current members and their roles).
 */
export function fold(events, roles = new Map()) {
  const isAdmin = (m) => roles.get(m) === 'admin'
  const s = {
    meta: { name: 'חצר', emoji: '🏡', kind: 'event', when: null, where: '', open: true },
    profiles: new Map(), items: new Map(), chores: new Map(), polls: new Map(), chat: [], lastSeq: 0,
    reports: [], hidden: new Set(),
  }
  const first = events[0]?.seq
  for (const { seq, author, at, ev } of events) {
    s.lastSeq = seq
    if (!ev || typeof ev !== 'object') continue
    switch (ev.t) {
      case 'yard.meta':
        if (isAdmin(author) || seq === first) {
          s.meta = {
            name: str(ev.name, 30) || 'חצר', emoji: str(ev.emoji, 8) || '🏡', kind: ev.kind === 'home' ? 'home' : 'event',
            when: typeof ev.when === 'string' && !Number.isNaN(Date.parse(ev.when)) ? ev.when : null, where: str(ev.where, 60),
            open: ev.open !== false,
          }
        }
        break
      case 'member.profile':
        s.profiles.set(author, {
          nickname: str(ev.nickname, 20), voice: ev.voice === 'm' || ev.voice === 'f' ? ev.voice : null, morning: ev.morning === 'off' ? 'off' : 'on',
          ...Object.fromEntries(identity.LOOK_KEYS.filter((k) => typeof ev[k] === 'string').map((k) => [k, ev[k].slice(0, 16)])),
        })
        break

      // Things to bring (event) or one-off tasks (home).
      case 'item.put': {
        const it = s.items.get(ev.id)
        if (!ev.id || (it && it.createdBy !== author && !isAdmin(author))) break
        const name = str(ev.name, 60)
        if (!name) break
        const base = it || { id: ev.id, createdBy: author, createdAt: at, claimedBy: null, claimedAt: null, helpers: [], done: false, doneBy: null, doneAt: null, photoId: null }
        const need = Math.min(10, Math.max(1, Math.floor(Number(ev.need)) || 1))
        s.items.set(ev.id, { ...base, name, qty: str(ev.qty, 20), due: localDateTime(ev.due), need, helpers: base.helpers.slice(0, need - 1) })
        break
      }
      case 'item.delete': {
        const it = s.items.get(ev.id)
        if (it && (it.createdBy === author || isAdmin(author))) s.items.delete(ev.id)
        break
      }
      case 'item.claim': {
        const it = s.items.get(ev.id)
        if (!it || it.done) break
        // First ones in the log win (as many as the item needs); only the one who took it (or an admin) can let it go.
        // claimedBy stays the first taker, so older app versions still read it.
        if (ev.on) {
          if (!it.claimedBy) Object.assign(it, { claimedBy: author, claimedAt: at })
          else if (it.claimedBy !== author && !it.helpers.includes(author) && 1 + it.helpers.length < (it.need || 1)) it.helpers.push(author)
        } else if (it.claimedBy === author) {
          const [next, ...rest] = it.helpers
          Object.assign(it, { claimedBy: next || null, claimedAt: next ? at : null, helpers: rest })
        } else if (it.helpers.includes(author)) it.helpers = it.helpers.filter((x) => x !== author)
        else if (isAdmin(author)) Object.assign(it, { claimedBy: null, claimedAt: null, helpers: [] })
        break
      }
      case 'item.assign': {
        // Whoever runs the yard can give a task to someone (or free it), whoever had it.
        const it = s.items.get(ev.id)
        if (!it || it.done || !isAdmin(author)) break
        if (ev.to === null) Object.assign(it, { claimedBy: null, claimedAt: null, helpers: [] })
        else if (typeof ev.to === 'string' && (!roles.size || roles.has(ev.to))) Object.assign(it, { claimedBy: ev.to, claimedAt: at, assignedBy: author, helpers: it.helpers.filter((x) => x !== ev.to) })
        break
      }
      case 'item.done': {
        const it = s.items.get(ev.id)
        if (!it) break
        if (ev.on && !it.done && (!it.claimedBy || it.claimedBy === author || isAdmin(author))) {
          Object.assign(it, { done: true, doneBy: author, doneAt: at, claimedBy: it.claimedBy || author, photoId: typeof ev.photoId === 'string' ? ev.photoId : null })
        } else if (!ev.on && it.done && (it.doneBy === author || isAdmin(author))) Object.assign(it, { done: false, doneBy: null, doneAt: null, photoId: null })
        break
      }

      // Chores that come back, in turns.
      case 'chore.put': {
        const c = s.chores.get(ev.id)
        if (!ev.id || (c && c.createdBy !== author && !isAdmin(author))) break
        const name = str(ev.name, 40)
        // `everyone`: the rotation is the yard's members in the order they joined, newcomers included.
        const everyone = !!ev.everyone
        const order = everyone ? [] : Array.isArray(ev.order) ? [...new Set(ev.order.filter((m) => typeof m === 'string'))].slice(0, MAX_MEMBERS) : []
        if (!name || (!everyone && !order.length)) break
        const base = c || { id: ev.id, createdBy: author, createdAt: at, turnOf: everyone ? author : order[0], lastDoneAt: null, history: [] }
        const next = { ...base, name, emoji: str(ev.emoji, 8) || '✨', every: EVERY[ev.every] ? ev.every : 'week', everyone, order, time: TIME.test(ev.time || '') ? ev.time : null }
        // A new chore starts with the first in its rotation. An edit keeps the current turn, unless that person
        // is no longer part of a chosen rotation (and the turn wasn't handed to them by an admin).
        if (!everyone && !order.includes(next.turnOf) && (!c || !c.slot)) next.turnOf = order[0]
        s.chores.set(ev.id, next)
        break
      }
      case 'chore.delete': {
        const c = s.chores.get(ev.id)
        if (c && (c.createdBy === author || isAdmin(author))) s.chores.delete(ev.id)
        break
      }
      case 'chore.assign': {
        // Whoever runs the yard can hand this turn to anyone, even against the rotation. They stand in for the
        // turn's owner (`slot`): once it's done, the rotation goes on after the owner, as if nothing happened.
        const c = s.chores.get(ev.id)
        if (!c || !isAdmin(author) || typeof ev.to !== 'string' || (roles.size && !roles.has(ev.to))) break
        if (!c.slot) c.slot = c.turnOf
        if (ev.to === c.slot) c.slot = null
        c.history = [{ by: author, at, kind: 'assign', to: ev.to }, ...c.history].slice(0, 30)
        c.turnOf = ev.to
        break
      }
      case 'chore.done': {
        const c = s.chores.get(ev.id)
        if (!c) break
        c.history = [{ by: author, at, photoId: typeof ev.photoId === 'string' ? ev.photoId : null, kind: 'done', prev: { turnOf: c.turnOf, slot: c.slot || null, lastDoneAt: c.lastDoneAt } }, ...c.history].slice(0, 30)
        c.lastDoneAt = at
        c.turnOf = nextInOrder(orderOf(c, roles), c.slot || c.turnOf, roles)
        c.slot = null
        break
      }
      case 'chore.pass': {
        const c = s.chores.get(ev.id)
        if (!c || c.turnOf !== author) break
        c.history = [{ by: author, at, kind: 'pass', prev: { turnOf: c.turnOf, slot: c.slot || null, lastDoneAt: c.lastDoneAt } }, ...c.history].slice(0, 30)
        c.turnOf = nextInOrder(orderOf(c, roles), c.slot || c.turnOf, roles)
        c.slot = null
        break
      }
      case 'chore.undo': {
        // Takes back the latest "done" or "pass", only by whoever did it (or an admin), only if nothing came after.
        const c = s.chores.get(ev.id)
        const h = c?.history[0]
        if (!h || !h.prev || (h.by !== author && !isAdmin(author))) break
        Object.assign(c, { turnOf: h.prev.turnOf, slot: h.prev.slot, lastDoneAt: h.prev.lastDoneAt })
        c.history = c.history.slice(1)
        break
      }

      case 'poll.put': {
        const opts = Array.isArray(ev.options) ? ev.options.map((o) => str(o, 40)).filter(Boolean).slice(0, 6) : []
        const q = str(ev.q, 80)
        if (!ev.id || s.polls.has(ev.id) || !q || opts.length < 2) break
        s.polls.set(ev.id, { id: ev.id, q, options: opts, createdBy: author, createdAt: at, votes: new Map(), closed: false })
        break
      }
      case 'poll.vote': {
        const p = s.polls.get(ev.id)
        if (!p || p.closed) break
        if (Number.isInteger(ev.opt) && ev.opt >= 0 && ev.opt < p.options.length) p.votes.set(author, ev.opt)
        else if (ev.opt === null) p.votes.delete(author)
        break
      }
      case 'poll.close': {
        const p = s.polls.get(ev.id)
        if (p && (p.createdBy === author || isAdmin(author))) p.closed = !!ev.on
        break
      }
      case 'poll.delete': {
        const p = s.polls.get(ev.id)
        if (p && (p.createdBy === author || isAdmin(author))) s.polls.delete(ev.id)
        break
      }

      case 'comment.put': {
        const text = str(ev.text, 500)
        if (text && ev.cid) s.chat.push({ cid: ev.cid, author, at, text })
        break
      }
      case 'comment.delete': {
        const i = s.chat.findIndex((c) => c.cid === ev.cid)
        if (i >= 0 && (s.chat[i].author === author || isAdmin(author))) s.chat.splice(i, 1)
        break
      }

      // Reports go to whoever runs the yard. One open report per reporter per thing; an admin closes it by
      // removing the thing (comment.delete / photo.hide) or by dismissing it (report.close).
      case 'report.put': {
        const what = ev.cid ? { cid: String(ev.cid) } : ev.photoId ? { photoId: String(ev.photoId) } : null
        if (!what || !ev.rid) break
        const key = what.cid || what.photoId
        if (s.reports.some((r) => r.key === key && r.by === author && r.open)) break
        s.reports.push({ rid: String(ev.rid), ...what, key, by: author, at, reason: str(ev.reason, 200), open: true })
        break
      }
      case 'report.close': {
        if (!isAdmin(author)) break
        for (const r of s.reports) if (r.rid === ev.rid || (ev.key && r.key === ev.key)) r.open = false
        break
      }
      case 'photo.hide':
        if (isAdmin(author) && typeof ev.photoId === 'string') s.hidden.add(ev.photoId)
        break
    }
  }
  // A report about something that is gone is settled.
  const live = new Set([...s.chat.map((c) => c.cid)])
  for (const r of s.reports) if ((r.cid && !live.has(r.cid)) || (r.photoId && s.hidden.has(r.photoId))) r.open = false
  return s
}

/** Open reports, one entry per reported thing (with how many reported it). */
export function openReports(s) {
  const by = new Map()
  for (const r of s.reports) {
    if (!r.open) continue
    const cur = by.get(r.key) || { ...r, count: 0, reasons: [] }
    cur.count++
    if (r.reason) cur.reasons.push(r.reason)
    by.set(r.key, cur)
  }
  return [...by.values()]
}

/** The next one in the turn order after `cur`, skipping people who left the yard. */
export function nextInOrder(order, cur, roles = new Map()) {
  const here = (m) => !roles.size || roles.has(m)
  const start = order.indexOf(cur)
  for (let k = 1; k <= order.length; k++) {
    const m = order[(start + k + order.length) % order.length]
    if (here(m)) return m
  }
  return order[0] ?? null
}

/** The rotation: the chosen members, or everyone in the yard (in the order they joined). */
export function orderOf(chore, roles = new Map()) {
  if (!chore.everyone) return chore.order
  return roles.size ? [...roles.keys()] : [chore.createdBy]
}

/** Whose turn it is now (someone who left hands it to the next one). */
export function turnOf(chore, roles = new Map()) {
  if (!roles.size || roles.has(chore.turnOf)) return chore.turnOf
  return nextInOrder(orderOf(chore, roles), chore.turnOf, roles)
}

const DAY = 86400e3
const startOfDay = (t) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** When the chore is due next: a cycle after it was last done, or right away if it never was. */
export function dueAt(chore) {
  if (!chore.lastDoneAt) return Date.parse(chore.createdAt)
  return startOfDay(Date.parse(chore.lastDoneAt)) + EVERY[chore.every].days * DAY
}

/** 'late' | 'today' | 'soon' (date of the day it is due). */
export function dueState(chore, now = Date.now()) {
  const due = dueAt(chore)
  const today = startOfDay(now)
  if (due < today) return 'late'
  if (due < today + DAY) return 'today'
  return 'soon'
}

/** Who brings it: the first taker, then the ones who joined (an item can need a few people). */
export const takers = (it) => [it.claimedBy, ...(it.helpers || [])].filter(Boolean)
export const isFull = (it) => takers(it).length >= (it.need || 1)

/** The event list: still open first, then mine, then the others'. An item that needs 3 is taken when 3 took it. */
export function eventBoard(s, me) {
  const all = [...s.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const mine = all.filter((i) => takers(i).includes(me))
  const free = all.filter((i) => !isFull(i) && !takers(i).includes(me))
  const others = all.filter((i) => isFull(i) && !takers(i).includes(me))
  return { free, mine, others, total: all.length, taken: all.filter(isFull).length }
}

/** "קולה x3", "קולה ×3", "קולה *3" → { name: 'קולה', qty: '3' }. Anything else stays the name. */
export function parseItem(text) {
  const t = String(text || '').trim()
  const m = /^(.+?)\s*[x×X*]\s*(\d{1,3})$/.exec(t) || /^(\d{1,3})\s*[x×X*]\s*(.+)$/.exec(t)
  if (!m) return { name: t.slice(0, 60), qty: '' }
  const [name, qty] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]
  return { name: name.trim().slice(0, 60), qty }
}

/** The home yard: my chores that are due, all chores, open and done tasks, and the duckling of the week. */
export function homeBoard(s, me, roles = new Map(), now = Date.now()) {
  const chores = [...s.chores.values()].map((c) => ({ ...c, turn: turnOf(c, roles), due: dueState(c, now), dueAt: dueAt(c) }))
  chores.sort((a, b) => a.dueAt - b.dueAt)
  const myTurn = chores.filter((c) => c.turn === me && c.due !== 'soon')
  const items = [...s.items.values()]
  const open = items.filter((i) => !i.done).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const done = items.filter((i) => i.done).sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 10)
  return { chores, myTurn, open, done, weekDuck: weekDuck(s, now) }
}

/** Who did the most in the last 7 days (chores done + tasks done); null if nobody did anything. */
export function weekDuck(s, now = Date.now()) {
  const since = now - 7 * DAY
  const count = new Map()
  const add = (m, at) => {
    if (m && Date.parse(at) >= since) count.set(m, (count.get(m) || 0) + 1)
  }
  for (const c of s.chores.values()) for (const h of c.history) if (h.kind === 'done') add(h.by, h.at)
  for (const i of s.items.values()) if (i.done) add(i.doneBy, i.doneAt)
  let best = null
  for (const [m, n] of count) if (!best || n > best.n) best = { member: m, n }
  return best
}

// ---------- Reminders at a time ----------

const atTime = (dayMs, hhmm) => {
  const d = new Date(dayMs)
  const [h, m] = hhmm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** The evening before (19:00); for an event early in the morning, still the evening before. */
export const eveBefore = (eventMs) => atTime(startOfDay(eventMs) - DAY, '19:00')
/** The next 8:00 (today's, if it hasn't come yet). */
export const nextMorning = (now = Date.now()) => {
  const today = atTime(startOfDay(now), '08:00')
  return today > now ? today : atTime(startOfDay(now) + DAY + 3 * 3600e3, '08:00') // +3h: a DST day is not 24h
}

/** When a chore with an hour should remind: its due day at that hour; if that already passed, the next such hour. */
export function choreRemindAt(chore, now = Date.now()) {
  if (!chore.time) return null
  let at = atTime(dueAt(chore), chore.time)
  while (at <= now) at += DAY
  return at
}

/**
 * The reminders this yard should have right now: { id, to (member or null = everyone), at, body }.
 * Ids come from the chore or task, so every phone computes the same set and keeps one reminder current.
 */
export function plannedReminders(s, roles = new Map(), now = Date.now()) {
  const out = []
  const members = [...roles.keys()]
  const voice = (m) => s.profiles.get(m)?.voice
  const list = (xs) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} ועוד ${xs.length - 4}` : xs.join(', '))
  if (s.meta.kind === 'event' && s.meta.when) {
    const at = eveBefore(Date.parse(s.meta.when))
    if (at > now && at - now < 60 * DAY) {
      for (const m of members) {
        const mine = [...s.items.values()].filter((i) => takers(i).includes(m)).map((i) => `${i.name}${i.qty ? ` (${i.qty})` : ''}`)
        if (!mine.length) continue
        const v = voice(m)
        out.push({ id: `e_${m}`.slice(0, 64), to: m, at, body: `🧺 מחר ${s.meta.emoji} ${s.meta.name}! ${v === 'm' ? 'אתה מביא' : v === 'f' ? 'את מביאה' : 'מביאים'}: ${list(mine)}` })
      }
    }
  }
  if (s.meta.kind === 'home') {
    const at = nextMorning(now)
    const end = startOfDay(at) + DAY
    for (const m of members) {
      if (s.profiles.get(m)?.morning === 'off') continue
      const chores = [...s.chores.values()].filter((c) => turnOf(c, roles) === m && dueAt(c) < end).map((c) => `${c.emoji} ${c.name}${c.time ? ` ${c.time}` : ''}`)
      const tasks = [...s.items.values()].filter((i) => !i.done && i.claimedBy === m && i.due && Date.parse(i.due) < end).map((i) => `📌 ${i.name}`)
      const all = [...chores, ...tasks]
      if (all.length) out.push({ id: `d_${m}`.slice(0, 64), to: m, at, body: `☀️ בוקר טוב! היום ברשימה: ${list(all)}`, go: '#/today' })
    }
  }
  for (const c of s.chores.values()) {
    const at = choreRemindAt(c, now)
    if (at && at - now < 60 * DAY) out.push({ id: `c_${c.id}`.slice(0, 64), to: turnOf(c, roles), at, body: `⏰ תורך: ${c.emoji} ${c.name}`, go: `?chore=${c.id}` })
  }
  for (const it of s.items.values()) {
    if (it.done || !it.due) continue
    const at = Date.parse(it.due)
    if (at > now && at - now < 60 * DAY) out.push({ id: `t_${it.id}`.slice(0, 64), to: it.claimedBy || null, at, go: `?item=${it.id}`, body: it.claimedBy ? `⏰ ${it.name}` : `⏰ ${it.name} (עוד אף אחד לא לקח)` })
  }
  return out
}

/** "חומוס, פיתות\nקרח" (or a pasted list with bullets) → ['חומוס', 'פיתות', 'קרח']. One line stays one item. */
export function splitList(text) {
  const parts = String(text || '').split(/\n|,|،|;|\u2022/).map((x) => x.replace(/^\s*(?:[-*•·✔✅☐⬜▪]+|\d+[.)])\s*/, '').trim()).filter(Boolean)
  return [...new Set(parts.map((x) => x.slice(0, 60)))].slice(0, 40)
}

/** The yard as plain text for WhatsApp: what is taken by whom, what is free, and whose turn it is. */
export function summaryText(s, nameOf, { link = '', now = Date.now() } = {}) {
  const lines = [`${s.meta.emoji} ${s.meta.name}`]
  if (s.meta.kind === 'event') {
    if (s.meta.when) lines[0] += ` · ${new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s.meta.when))}`
    if (s.meta.where) lines[0] += ` · ${s.meta.where}`
    const items = [...s.items.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    const free = items.filter((i) => !isFull(i))
    const names = (i) => takers(i).map(nameOf).join(' + ')
    lines.push('', 'מי מביא מה:')
    for (const i of items.filter(isFull)) lines.push(`✅ ${i.name}${i.qty ? ` (${i.qty})` : ''}: ${names(i)}`)
    for (const i of free) lines.push(`⬜ ${i.name}${i.qty ? ` (${i.qty})` : ''}: ${takers(i).length ? `${names(i)}, ועוד מקום ל־${(i.need || 1) - takers(i).length}` : 'עוד פנוי'}`)
    if (free.length) lines.push('', `עוד ${free.length === 1 ? 'דבר אחד' : `${free.length} דברים`} שאף אחד לא לקח 👀`)
  } else {
    lines.push('', 'תורות:')
    for (const c of s.chores.values()) lines.push(`${c.emoji} ${c.name}: ${nameOf(c.turnOf)}${c.time ? ` (${c.time})` : ''}`)
    const open = [...s.items.values()].filter((i) => !i.done)
    if (open.length) {
      lines.push('', 'משימות:')
      for (const i of open) lines.push(`${i.claimedBy ? '✅' : '⬜'} ${i.name}${i.claimedBy ? `: ${nameOf(i.claimedBy)}` : ''}`)
    }
  }
  if (link) lines.push('', `לוקחים כאן: ${link}`)
  return lines.join('\n')
}

const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (t) => String(t).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')

/** A calendar event for an event yard (3 hours from its time); null without a time. */
const icsDay = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
const trigger = (min) => (min === 0 ? 'PT0M' : min > 0 ? `-PT${min}M` : `PT${-min}M`)
/** A chore's "every" as a calendar repeat rule. */
export const RRULES = { day: 'FREQ=DAILY', week: 'FREQ=WEEKLY', '2weeks': 'FREQ=WEEKLY;INTERVAL=2', month: 'FREQ=MONTHLY' }

/**
 * Events → one .ics file, made on the phone (the server never sees it). Each event:
 * { uid, start, minutes = 60, allDay, title, notes, where, url, rrule, alarms: minutes before (negative = after start) }.
 * All-day events remind at 9:00 by default.
 */
export function icsFile(events, now = Date.now()) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hechatzer//he', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${String(e.uid).replace(/[^\w.-]/g, '')}@hechatzer.pages.dev`, `DTSTAMP:${icsDate(now)}`)
    if (e.allDay) L.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(startOfDay(e.start) + DAY + 3 * 3600e3)}`)
    else L.push(`DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.start + (e.minutes || 60) * 60e3)}`)
    L.push(`SUMMARY:${icsText(e.title)}`)
    if (e.where) L.push(`LOCATION:${icsText(e.where)}`)
    if (e.notes || e.url) L.push(`DESCRIPTION:${icsText([e.notes, e.url].filter(Boolean).join('\n'))}`)
    if (e.url) L.push(`URL:${e.url}`)
    if (e.rrule) L.push(`RRULE:${e.rrule}`)
    for (const a of e.alarms || (e.allDay ? [-540] : [0])) L.push('BEGIN:VALARM', `TRIGGER:${trigger(a)}`, 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'END:VALARM')
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n')
}

/** The same event as a Google Calendar "add event" link (Android, and anyone not on iPhone). */
export function gcalLink(e) {
  const dates = e.allDay ? `${icsDay(e.start)}/${icsDay(startOfDay(e.start) + DAY + 3 * 3600e3)}` : `${icsDate(e.start)}/${icsDate(e.start + (e.minutes || 60) * 60e3)}`
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: [e.notes, e.url].filter(Boolean).join('\n'), location: e.where || '' })
  if (e.rrule) q.set('recur', `RRULE:${e.rrule}`)
  return `https://calendar.google.com/calendar/render?${q}`
}

/** The event yard as a calendar event: 3 hours, reminders the day before and 3 hours before. */
const eventOf = (s, { uid, notes = '', url = '' }) => ({ uid: uid || 'yard', start: Date.parse(s.meta.when), minutes: 180, title: `${s.meta.emoji} ${s.meta.name}`, where: s.meta.where, notes, url, alarms: [1440, 180] })
export function eventIcs(s, { uid, now = Date.now(), notes = '', url = '' } = {}) {
  if (s.meta.kind !== 'event' || !s.meta.when) return null
  return icsFile([eventOf(s, { uid, notes, url })], now)
}
export function googleCalendarUrl(s, { notes = '', url = '' } = {}) {
  if (s.meta.kind !== 'event' || !s.meta.when) return null
  return gcalLink(eventOf(s, { notes, url }))
}

/** Votes per option and who voted for what. */
export function pollResults(p) {
  const counts = p.options.map(() => 0)
  for (const opt of p.votes.values()) counts[opt]++
  return counts
}

// ---------- Network ----------

function me() {
  const id = identity.load()
  if (!id?.keys) throw Object.assign(new Error('צריך קודם ברווזון'), { code: 'no-identity' })
  return id
}

/** A signed request to the server as this phone's duckling (used by vault.js too). */
export async function api(method, path, body, raw) {
  const { keys } = me()
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body))
  const headers = await identity.signRequest(keys, method, path, payload)
  const res = await fetch(apiUrl() + path, {
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

export async function register() {
  const { keys } = me()
  try {
    if (localStorage.getItem('cz.registered') === keys.memberId) return
  } catch { /* ignore */ }
  await api('POST', '/v2/identity', { signPub: { kty: 'EC', crv: 'P-256', x: keys.signPub.x, y: keys.signPub.y }, dhPub: { kty: 'EC', crv: 'P-256', x: keys.dhPub.x, y: keys.dhPub.y } })
  try {
    localStorage.setItem('cz.registered', keys.memberId)
  } catch { /* ignore */ }
}

// ---------- Local records ----------
// { id, role, keyVersion, keys: { [v]: base64 }, members: [{ id, role, dhPub }], since, events, outbox, seenSeq, removed, muted }

const rawKey = (rec, v) => (rec.keys[v] ? unb64(rec.keys[v]) : null)
const currentKey = (rec) => rawKey(rec, rec.keyVersion)
export const rolesOf = (rec) => new Map((rec.members || []).map((m) => [m.id, m.role]))
/** The yard as this phone sees it: what the server has, plus what is still waiting to be sent (shown at once). */
export function stateOf(rec) {
  const mine = identity.myId()
  const last = rec.events.at(-1)?.seq || 0
  const waiting = (rec.outbox || []).map((ev, i) => ({ seq: last + 1 + i, author: mine, at: ev.at, ev }))
  return fold(waiting.length ? [...rec.events, ...waiting] : rec.events, rolesOf(rec))
}

export async function localYards() {
  return (await db.allYards().catch(() => [])).filter((y) => !y.removed)
}
export const localYard = (id) => db.getYard(id).catch(() => null)
// How others should address me (feminine/masculine) travels with my duckling, so the yard says "מביאה" or "מביא".
const pick = (p) => ({
  nickname: p.nickname, voice: db.loadSettings().voice, morning: db.loadSettings().morning === false ? 'off' : 'on',
  ...Object.fromEntries(identity.LOOK_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])),
})

/** Opens a yard: meta, my duckling, and the starting items or chores, in one go. */
export async function createYard(meta, starters = []) {
  await register()
  const { keys, profile } = me()
  const id = newId('g')
  const raw = crypto.getRandomValues(new Uint8Array(32))
  await api('POST', '/v2/groups', { id, wrapped: await wrapFor(keys, keys.dhPub, raw) })
  const rec = { id, role: 'admin', keyVersion: 1, keys: { 1: b64(raw) }, members: [{ id: keys.memberId, role: 'admin', dhPub: keys.dhPub }], since: 0, events: [], outbox: [], seenSeq: 0 }
  await db.putYard(rec)
  await post(id, [{ t: 'yard.meta', ...meta }, { t: 'member.profile', ...pick(profile) }, ...starters])
  await refresh(id).catch(() => undefined)
  return id
}

/**
 * Where a notification opens: `go` is a full app hash ('#/today') or a part after the yard ('?item=…', '/chat').
 * Anything else falls back to the yard. sw.js checks it again before opening.
 */
export const GO = /^#\/[\w/-]*(\?[\w=&-]*)?$/
export const goFor = (yid, go = '') => {
  const h = !go ? `#/y/${yid}` : go.startsWith('#') ? go : `#/y/${yid}${go}`
  return GO.test(h) ? h : `#/y/${yid}`
}

/**
 * Adds events (queued first, so nothing is lost offline). `notify` = { body, to?, go? } asks the server to tell
 * the others (or only `to`); the text is encrypted with the yard key, so only their phones can read it.
 */
export async function post(yid, evs, notify = null) {
  const rec = await db.getYard(yid)
  const at = new Date().toISOString()
  rec.outbox = [...(rec.outbox || []), ...evs.map((ev) => ({ ...ev, at }))]
  if (notify?.body) {
    const st = stateOf(rec)
    rec.notify = { title: `${st.meta.emoji} ${st.meta.name}`.slice(0, 60), body: String(notify.body).slice(0, 160), go: goFor(yid, notify.go), to: notify.to || null }
  }
  await db.putYard(rec)
  try {
    const res = await flush(yid)
    if (res.sent) await pull(yid).catch(() => undefined)
    if (res.sent) syncReminders(yid).catch(() => undefined)
    return res
  } catch (e) {
    if (e.status === 403) throw e
    return { queued: true }
  }
}

async function flush(yid) {
  const rec = await db.getYard(yid)
  if (!rec?.outbox?.length) return { sent: 0 }
  const raw = currentKey(rec)
  const events = []
  for (const ev of rec.outbox) events.push({ keyVersion: rec.keyVersion, data: await encryptEvent(raw, ev) })
  // A notification that waited offline is old news; only send it if it is fresh.
  const fresh = rec.notify && Date.now() - Date.parse(rec.outbox[rec.outbox.length - 1].at) < 10 * 60e3
  let notify
  if (fresh) {
    const { to, ...text } = rec.notify
    notify = { keyVersion: rec.keyVersion, data: await encryptEvent(raw, text), ...(to ? { to } : {}) }
  }
  await api('POST', `/v2/groups/${yid}/events`, { events, notify })
  const after = await db.getYard(yid)
  after.outbox = after.outbox.slice(rec.outbox.length)
  delete after.notify
  await db.putYard(after)
  return { sent: events.length }
}

/** Members, keys, key rotation if someone left, then new events. Returns how many events arrived. */
export async function refresh(yid) {
  await register()
  const { keys, profile } = me()
  let info
  try {
    info = await api('GET', `/v2/groups/${yid}`)
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      const rec = await db.getYard(yid)
      if (rec) await db.putYard({ ...rec, removed: true })
      throw Object.assign(new Error('removed'), { code: 'removed' })
    }
    throw e
  }
  const known = await db.getYard(yid)
  // A yard new to this phone (just joined, or a saved duckling signing in): what is already there is not news.
  const fresh = !known || known.removed
  const rec = known || { id: yid, keys: {}, since: 0, events: [], outbox: [], seenSeq: 0 }
  rec.role = info.role
  rec.muted = !!info.muted
  rec.members = info.members
  for (const k of info.keys) if (!rec.keys[k.version]) rec.keys[k.version] = b64(await unwrap(keys, k.wrapped))
  rec.keyVersion = info.keyVersion
  await db.putYard(rec)
  if (info.needsRotation) await rotate(yid).catch(() => undefined)
  await flush(yid).catch(() => undefined)
  const added = await pull(yid)
  if (fresh) await markSeen(yid)
  syncReminders(yid).catch(() => undefined) // sends only what changed (the morning summary moves on each day)
  // Make sure the others know who I am (once, and again after I change my duckling).
  const st = stateOf(await db.getYard(yid))
  const mine = st.profiles.get(keys.memberId)
  const want = pick(profile || {})
  if (profile && (!mine || ['nickname', 'voice', 'morning', ...identity.LOOK_KEYS].some((k) => mine[k] !== want[k]))) {
    await post(yid, [{ t: 'member.profile', ...want }], mine ? null : { body: `🐥 ${profile.nickname} בחצר!` })
  }
  return added
}

async function pull(yid) {
  let added = 0
  for (;;) {
    const cur = await db.getYard(yid)
    const page = await api('GET', `/v2/groups/${yid}/events?since=${cur.since}`)
    for (const e of page.events) {
      if (e.seq <= cur.since) continue
      const raw = rawKey(cur, e.key_version)
      let ev = null
      if (raw) ev = await decryptEvent(raw, e.data).catch(() => null)
      cur.events.push({ seq: e.seq, author: e.author_id, at: ev?.at || new Date(e.created_at).toISOString(), ev })
      added++
    }
    cur.since = page.seq
    await db.putYard(cur)
    if (!page.more) break
  }
  return added
}

async function rotate(yid) {
  const { keys } = me()
  const rec = await db.getYard(yid)
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const wrapped = []
  for (const m of rec.members) wrapped.push({ memberId: m.id, wrapped: await wrapFor(keys, m.dhPub, raw) })
  const version = rec.keyVersion + 1
  await api('POST', `/v2/groups/${yid}/keys`, { version, wrapped })
  rec.keys[version] = b64(raw)
  rec.keyVersion = version
  await db.putYard(rec)
}

/** Every yard I'm in. Returns how many things changed. */
export async function refreshAll() {
  await register()
  const remote = (await api('GET', '/v2/groups')).groups
  const ids = new Set(remote.map((g) => g.id))
  let added = 0
  for (const rec of await db.allYards()) {
    if (!ids.has(rec.id) && !rec.removed) {
      await db.putYard({ ...rec, removed: true })
      added++
    }
  }
  for (const g of remote) added += await refresh(g.id).catch(() => 0)
  return added
}

// ---------- Invites ----------

export async function createInvite(yid, { days = 14, maxUses = 20 } = {}) {
  const rec = await db.getYard(yid)
  const secret = b64url(crypto.getRandomValues(new Uint8Array(18)))
  const { authHash, wrapKey } = await inviteParts(secret)
  const wrappedKeys = []
  for (const [v, k] of Object.entries(rec.keys)) wrappedKeys.push({ version: Number(v), wrapped: b64(await seal(wrapKey, unb64(k))) })
  const id = newId('i')
  const res = await api('POST', `/v2/groups/${yid}/invites`, { id, authHash, wrappedKeys, days, maxUses })
  return { id, code: `${id}.${secret}`, expiresAt: res.expiresAt }
}

/** Finds an invite in pasted text: the whole link or just the code. */
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

/** What the invite shows before joining (decrypted here): the yard, who's in, what's still free. */
export async function peekInvite(code) {
  const inv = parseInvite(code)
  if (!inv) throw Object.assign(new Error('הקישור לא תקין'), { code: 'bad' })
  const { auth, wrapKey } = await inviteParts(inv.secret)
  const res = await fetch(`${apiUrl()}/v2/invites/${inv.id}/peek`, { method: 'POST', body: JSON.stringify({ auth }) })
  if (!res.ok) {
    const reason = res.status === 410 ? 'expired' : 'missing'
    throw Object.assign(new Error(reason === 'expired' ? 'ההזמנה פגה או בוטלה.' : 'לא מצאתי את ההזמנה.'), { code: reason })
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
  // Roles aren't known before joining: the first author opened the yard, so they run it.
  const roles = events.length ? new Map([[events[0].author, 'admin']]) : new Map()
  const st = fold(events, roles)
  return { groupId: data.groupId, keys, members: data.members, full: data.full, state: st, opener: events[0]?.author }
}

export async function joinInvite(code) {
  const inv = parseInvite(code)
  const peek = await peekInvite(code)
  if (peek.full) throw Object.assign(new Error(`החצר מלאה (${MAX_MEMBERS} ברווזונים).`), { code: 'full' })
  await register()
  const { keys } = me()
  const { auth } = await inviteParts(inv.secret)
  const wrappedForMe = []
  for (const [v, raw] of Object.entries(peek.keys)) wrappedForMe.push({ version: Number(v), wrapped: await wrapFor(keys, keys.dhPub, raw) })
  await api('POST', `/v2/invites/${inv.id}/accept`, { auth, wrappedForMe })
  const prev = await db.getYard(peek.groupId)
  if (prev?.removed) await db.deleteYard(peek.groupId)
  await refresh(peek.groupId)
  return peek.groupId
}

// ---------- Members ----------

export async function leave(yid) {
  const { keys } = me()
  await api('DELETE', `/v2/groups/${yid}/members/${keys.memberId}`)
  await db.deleteYard(yid)
}
export async function removeMember(yid, memberId) {
  await api('DELETE', `/v2/groups/${yid}/members/${memberId}`)
  await refresh(yid)
}
export async function makeAdmin(yid, memberId) {
  await api('POST', `/v2/groups/${yid}/members/${memberId}/admin`)
  await refresh(yid)
}
export async function deleteYard(yid) {
  await api('DELETE', `/v2/groups/${yid}`)
  await db.deleteYard(yid)
}

// ---------- Photos (encrypted with the current yard key; 1 byte of key version in front) ----------

export async function uploadPhoto(yid, blob) {
  const rec = await db.getYard(yid)
  const sealed = await seal(await aesKey(currentKey(rec)), new Uint8Array(await blob.arrayBuffer()))
  const body = new Uint8Array(sealed.length + 1)
  body[0] = rec.keyVersion
  body.set(sealed, 1)
  const id = newId('p')
  await api('PUT', `/v2/groups/${yid}/photos/${id}`, undefined, body)
  await db.putPhoto({ id, blob, createdAt: new Date().toISOString() })
  return id
}
export async function ensurePhoto(yid, id) {
  if (!id || (await db.getPhoto(id).catch(() => null))) return
  const rec = await db.getYard(yid)
  const data = await api('GET', `/v2/groups/${yid}/photos/${id}`)
  const raw = rawKey(rec, data[0])
  if (!raw) return
  const bytes = await open(await aesKey(raw), data.subarray(1))
  await db.putPhoto({ id, blob: new Blob([bytes], { type: 'image/jpeg' }), createdAt: new Date().toISOString() })
}

export function unread(rec, myId) {
  return rec.events.filter((e) => e.seq > (rec.seenSeq || 0) && e.author !== myId).length
}
/** Opening the yard marks what's new as seen; opening the chat (`chat: true`) marks its messages too. */
export async function markSeen(yid, { chat = false } = {}) {
  const rec = await db.getYard(yid)
  if (!rec) return
  const chatSeq = chat ? rec.since : rec.chatSeq ?? rec.seenSeq ?? 0
  if (rec.seenSeq !== rec.since || rec.chatSeq !== chatSeq) await db.putYard({ ...rec, seenSeq: rec.since, chatSeq })
}

/**
 * What in this yard is waiting for me. Each signal is computed from the yard as it is now, so it goes away by
 * itself once it no longer holds: the chore was done or passed, the item was taken, I voted, the poll closed,
 * the report was handled, or I opened the chat. Returns [{ kind, ref?, n }]:
 *   chat (unread messages) · chore (my turn, due or late) · task (given to me by someone else, not done)
 *   poll (open, not mine, I haven't voted) · item (new since I last looked, still free) · report (admin, open).
 */
export function attention(rec, s, me, roles = new Map(), now = Date.now()) {
  const seen = rec.seenSeq || 0
  const chatSeen = rec.chatSeq ?? seen
  const first = new Map()
  for (const e of rec.events || []) {
    const ev = e.ev
    if (!ev) continue
    const k = ev.t === 'comment.put' ? `m:${ev.cid}` : ev.t === 'item.put' ? `i:${ev.id}` : ev.t === 'poll.put' ? `p:${ev.id}` : null
    if (k && !first.has(k)) first.set(k, e.seq)
  }
  const out = []
  const chat = s.chat.filter((c) => c.author !== me && (first.get(`m:${c.cid}`) || 0) > chatSeen).length
  if (chat) out.push({ kind: 'chat', n: chat })
  for (const c of s.chores.values()) if (turnOf(c, roles) === me && dueState(c, now) !== 'soon') out.push({ kind: 'chore', ref: c.id, n: 1 })
  for (const it of s.items.values()) {
    if (it.done) continue
    if (s.meta.kind === 'home' && it.claimedBy === me && it.assignedBy && it.assignedBy !== me) out.push({ kind: 'task', ref: it.id, n: 1 })
    else if (it.createdBy !== me && (first.get(`i:${it.id}`) || 0) > seen && !isFull(it) && !takers(it).includes(me)) out.push({ kind: 'item', ref: it.id, n: 1 })
  }
  for (const p of s.polls.values()) if (!p.closed && p.createdBy !== me && !p.votes.has(me)) out.push({ kind: 'poll', ref: p.id, n: 1 })
  if (roles.get(me) === 'admin') {
    const n = openReports(s).length
    if (n) out.push({ kind: 'report', n })
  }
  return out
}
export const attentionCount = (list) => list.reduce((n, x) => n + x.n, 0)

// ---------- Push ----------

export async function pushKey() {
  const res = await fetch(`${apiUrl()}/v2/push/key`)
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
/**
 * Brings the server's reminders for this yard in line with plannedReminders(), sending only what changed since
 * this phone last sent it. The text is encrypted with the yard key, like every notification.
 */
export async function syncReminders(yid) {
  const rec = await db.getYard(yid)
  if (!rec || rec.removed || !rec.keys?.[rec.keyVersion]) return
  const key = `cz.rem.${yid}`
  let sent = {}
  try {
    sent = JSON.parse(localStorage.getItem(key) || '{}')
  } catch { /* nothing sent yet */ }
  const st = stateOf(rec)
  const planned = plannedReminders(st, rolesOf(rec))
  const raw = currentKey(rec)
  const title = `${st.meta.emoji} ${st.meta.name}`.slice(0, 60)
  const ops = []
  const next = {}
  for (const r of planned) {
    const go = goFor(yid, r.go)
    const sig = `${r.to}|${r.at}|${r.body}|${go}`
    next[r.id] = sig
    if (sent[r.id] !== sig) ops.push({ id: r.id, to: r.to, at: r.at, keyVersion: rec.keyVersion, data: await encryptEvent(raw, { title, body: r.body.slice(0, 160), go }) })
  }
  for (const id of Object.keys(sent)) if (!next[id]) ops.push({ id, delete: true })
  if (!ops.length) return
  for (let i = 0; i < ops.length; i += 50) await api('POST', `/v2/groups/${yid}/reminders`, { reminders: ops.slice(i, i + 50) })
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch { /* private mode */ }
}

export async function setMute(yid, muted) {
  await api('POST', `/v2/groups/${yid}/mute`, { muted })
  const rec = await db.getYard(yid)
  if (rec) await db.putYard({ ...rec, muted })
}

export const inviteLink = (code) => `${location.origin}${location.pathname}#/join/${code}`
