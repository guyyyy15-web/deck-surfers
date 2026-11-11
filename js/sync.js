// Cloud backup and sync between phones, end-to-end encrypted.
//
// One sync code (shown as a link or as XXXX-XXXX-… text) does everything: from it each phone derives
// the space id, the access token and the AES-GCM key. The server (server/ in this repo) only ever gets
// ciphertext, so it can't read names, reasons or photos. Without the code there's no way back in.
//
// The phone stays the source of truth and works offline; sync runs in the background when online.
// Conflicts: last write wins per revenge (by updatedAt). Deletions travel as tombstones.

import * as db from './db.js'

const PROD_URL = 'https://nekamot-sync.guyyyy15-web.workers.dev'
const STATE = 'nk.sync'
const TOMBS = 'nk.sync.tombs'

// ---------- Codes and keys (pure; tested in tests/sync.test.mjs) ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32: no I, L, O, U

export function newCode(bytes = crypto.getRandomValues(new Uint8Array(16))) {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31]
  return out // 26 characters, 128 bits
}

/** Accepts the code as typed or pasted: any case, spaces/dashes, O→0, I/L→1, or a whole pairing link. */
export function normalizeCode(input) {
  const s = String(input || '')
  const fromLink = /#\/pair\/([^/?#\s]+)/.exec(s)
  const raw = (fromLink ? decodeURIComponent(fromLink[1]) : s).toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
  return raw.length === 26 && [...raw].every((c) => ALPHABET.includes(c)) ? raw : null
}

export const formatCode = (code) => code.match(/.{1,4}/g).join('-')

const enc = new TextEncoder()
async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function deriveKeys(code) {
  const space = hex(await sha256(`nk-space:${code}`)).slice(0, 32)
  const token = hex(await sha256(`nk-token:${code}`))
  const key = await crypto.subtle.importKey('raw', await sha256(`nk-key:${code}`), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { space, token, key }
}

const b64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
export async function decryptBytes(key, data) {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, key, d.subarray(12)))
}
export const encryptJson = async (key, obj) => b64(await encryptBytes(key, enc.encode(JSON.stringify(obj))))
export const decryptJson = async (key, s) => JSON.parse(new TextDecoder().decode(await decryptBytes(key, unb64(s))))

// ---------- State ----------

function read(k, fallback) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fallback
  } catch {
    return fallback
  }
}
function write(k, v) {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private mode */
  }
}

const state = () => read(STATE, null)
const setState = (patch) => write(STATE, { ...state(), ...patch })
export const isOn = () => !!state()?.code
export const status = () => {
  const s = state()
  return s ? { on: true, code: s.code, lastOk: s.lastOk || null, error: s.error || null, busy: running !== null } : { on: false }
}

function baseUrl() {
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && read('nk.syncUrl', null)
  return local || PROD_URL
}

/** A revenge was saved here: it supersedes any pending deletion of it. */
export function touched(id) {
  const t = read(TOMBS, [])
  if (t.some((x) => x.id === id)) write(TOMBS, t.filter((x) => x.id !== id))
}
/** Something was deleted here; tell the other phones. */
export function deleted(id, kind) {
  if (!isOn() || !id) return
  write(TOMBS, [...read(TOMBS, []).filter((x) => x.id !== id), { id, kind, at: new Date().toISOString() }])
}
/** After an import: push everything again (the server keeps whichever copy is newer). */
export function pushAllNextTime() {
  if (isOn()) setState({ lastPush: '' })
}

// ---------- Network ----------

let keys = null
async function session() {
  const s = state()
  if (!s?.code) return null
  if (!keys || keys.code !== s.code) keys = { code: s.code, ...(await deriveKeys(s.code)) }
  return keys
}

async function api(k, path, opts = {}) {
  const res = await fetch(baseUrl() + path, {
    ...opts,
    headers: { 'X-Space': k.space, Authorization: `Bearer ${k.token}`, ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
  })
  if (!res.ok) {
    const err = new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return res
}

/** Turn on backup with a fresh code. */
export async function enable() {
  const code = newCode()
  const k = await deriveKeys(code)
  const res = await fetch(`${baseUrl()}/v1/spaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ space: k.space, token: k.token }) })
  if (!res.ok) throw new Error('השרת לא זמין כרגע. נסו שוב עוד מעט.')
  write(TOMBS, [])
  write(STATE, { code, since: 0, lastPush: '', uploaded: [] })
  return sync()
}

/** Join an existing backup from another phone. Local revenges are merged in, not replaced. */
export async function join(input) {
  const code = normalizeCode(input)
  if (!code) throw new Error('הקוד לא נראה תקין. הוא בנוי מ־26 אותיות ומספרים.')
  const k = await deriveKeys(code)
  try {
    await api(k, '/v1/changes?since=0&probe=1')
  } catch (e) {
    throw new Error(e.status === 401 ? 'לא מצאתי גיבוי עם הקוד הזה.' : 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.')
  }
  write(TOMBS, [])
  write(STATE, { code, since: 0, lastPush: '', uploaded: [] })
  keys = null
  return sync()
}

/** This phone stops syncing. Nothing is deleted, here or in the cloud. */
export function disconnect() {
  write(STATE, null)
  write(TOMBS, [])
  keys = null
}

/** Delete the cloud backup for every phone, then disconnect. Local data stays. */
export async function deleteCloud() {
  const k = await session()
  if (k) await api(k, '/v1/spaces', { method: 'DELETE' })
  disconnect()
}

// ---------- Sync ----------

let running = null
let again = false
let timer = null
let onChange = () => {}
export function onRemoteChange(fn) {
  onChange = fn
}

/** Sync soon (debounced), e.g. after each save. */
export function soon(ms = 1500) {
  if (!isOn()) return
  clearTimeout(timer)
  timer = setTimeout(() => sync().catch(() => undefined), ms)
}

/** Push local changes, then pull everyone else's. Resolves to { pulled, pushed }. */
export function sync() {
  if (!isOn()) return Promise.resolve({ pulled: 0, pushed: 0 })
  if (running) {
    again = true
    return running
  }
  running = run()
    .then((r) => {
      setState({ lastOk: new Date().toISOString(), error: null })
      return r
    })
    .catch((e) => {
      if (isOn()) setState({ error: navigator.onLine === false ? 'offline' : e.message || 'error' })
      throw e
    })
    .finally(() => {
      running = null
      if (again) {
        again = false
        soon(200)
      }
    })
  return running
}

async function run() {
  const k = await session()
  if (!k) return { pulled: 0, pushed: 0 }
  const s = state()
  const mark = new Date().toISOString()
  let pushed = 0

  // Push: photos first (so a revenge never arrives before its picture), then records and deletions.
  const uploaded = new Set(s.uploaded || [])
  const items = []
  for (const p of await db.allPhotos()) {
    if (uploaded.has(p.id)) continue
    const bytes = new Uint8Array(await p.blob.arrayBuffer())
    await api(k, `/v1/photos/${p.id}`, { method: 'PUT', body: await encryptBytes(k.key, bytes) })
    items.push({ id: p.id, kind: 'photo', updatedAt: p.createdAt || mark, data: await encryptJson(k.key, { kind: p.kind, createdAt: p.createdAt }) })
    uploaded.add(p.id)
  }
  for (const r of await db.allRevenges()) {
    if (!s.lastPush || (r.updatedAt || '') > s.lastPush) items.push({ id: r.id, kind: 'revenge', updatedAt: r.updatedAt || mark, data: await encryptJson(k.key, r) })
  }
  const tombs = read(TOMBS, [])
  for (const t of tombs) items.push({ id: t.id, kind: t.kind, updatedAt: t.at, deleted: true })
  for (let i = 0; i < items.length; i += 100) {
    await api(k, '/v1/items', { method: 'POST', json: { items: items.slice(i, i + 100) } })
  }
  pushed = items.length
  const sentTombs = new Set(tombs.map((t) => t.id))
  write(TOMBS, read(TOMBS, []).filter((t) => !sentTombs.has(t.id)))
  setState({ lastPush: mark, uploaded: [...uploaded] })

  // Pull.
  let since = state().since || 0
  let pulled = 0
  const have = new Set((await db.allPhotos()).map((p) => p.id))
  const localById = new Map((await db.allRevenges()).map((r) => [r.id, r]))
  for (;;) {
    const page = await (await api(k, `/v1/changes?since=${since}`)).json()
    for (const it of page.items) {
      if (it.kind === 'revenge') {
        const local = localById.get(it.id)
        if (it.deleted) {
          if (local && (local.updatedAt || '') <= it.updatedAt) {
            await db.deleteRevenge(it.id)
            localById.delete(it.id)
            pulled++
          }
        } else if (!local || (local.updatedAt || '') < it.updatedAt) {
          const r = await decryptJson(k.key, it.data)
          await db.putRevenge(r)
          localById.set(r.id, r)
          pulled++
        }
      } else if (it.kind === 'photo') {
        if (it.deleted) {
          if (have.has(it.id)) {
            await db.deletePhoto(it.id)
            have.delete(it.id)
            pulled++
          }
        } else if (!have.has(it.id)) {
          const meta = await decryptJson(k.key, it.data)
          const res = await api(k, `/v1/photos/${it.id}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)))
          if (res) {
            const bytes = await decryptBytes(k.key, await res.arrayBuffer())
            await db.putPhoto({ id: it.id, kind: meta.kind, createdAt: meta.createdAt, blob: new Blob([bytes], { type: 'image/jpeg' }) })
            have.add(it.id)
            uploaded.add(it.id)
            pulled++
          }
        }
      }
    }
    since = page.seq
    setState({ since, uploaded: [...uploaded] })
    if (!page.more) break
  }
  if (pulled) onChange(pulled)
  return { pulled, pushed }
}

export function pairLink(code) {
  return `${location.origin}${location.pathname}#/pair/${code}`
}
