// "The duckling that is you": a name, a look, and this phone's keys behind them.
//
// No account and no password. Each phone makes two P-256 key pairs: ECDSA to sign requests, ECDH to receive
// yard keys. The member id is derived from the signing public key; the server knows nothing else about you.

const KEY = 'cz.identity'

export function validName(s) {
  const n = String(s || '').trim()
  return n.length >= 2 && n.length <= 20
}

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function memberIdOf(signPubJwk) {
  const key = await crypto.subtle.importKey('jwk', signPubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
  const raw = await crypto.subtle.exportKey('raw', key)
  return hex(await crypto.subtle.digest('SHA-256', raw)).slice(0, 24)
}

export async function newKeys() {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const keys = {
    signPub: await crypto.subtle.exportKey('jwk', sign.publicKey),
    signPriv: await crypto.subtle.exportKey('jwk', sign.privateKey),
    dhPub: await crypto.subtle.exportKey('jwk', dh.publicKey),
    dhPriv: await crypto.subtle.exportKey('jwk', dh.privateKey),
    createdAt: new Date().toISOString(),
  }
  keys.memberId = await memberIdOf(keys.signPub)
  return keys
}

/** What the server checks: method, path, time and the body's hash, signed with this phone's key. */
export async function signRequest(keys, method, path, body = '') {
  const time = String(Date.now())
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', bytes))
  const priv = await crypto.subtle.importKey('jwk', keys.signPriv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(`${method}\n${path}\n${time}\n${bodyHash}`))
  return { 'X-Member': keys.memberId, 'X-Time': time, 'X-Sig': btoa(String.fromCharCode(...new Uint8Array(sig))) }
}

// { keys, profile: { nickname, color, mood, hat, face, neck, body, bodyColor, held, accessory (for older apps), updatedAt } }
export const LOOK_KEYS = ['color', 'mood', 'hat', 'face', 'neck', 'body', 'bodyColor', 'held', 'accessory']
export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}
function store(id) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id))
  } catch { /* private mode */ }
}

export const profile = () => load()?.profile || null
export const myId = () => load()?.keys?.memberId || null

/** Saves the duckling; makes the keys the first time. */
export async function saveProfile(v) {
  if (!validName(v.nickname)) throw new Error('השם צריך להיות באורך 2–20 תווים')
  const cur = load()
  const keys = cur?.keys || (await newKeys())
  const look = Object.fromEntries(LOOK_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, String(v[k]).slice(0, 16)]))
  const next = { keys, profile: { nickname: v.nickname.trim(), ...look, updatedAt: new Date().toISOString() } }
  store(next)
  return next
}

// ---------- Moving to the home-screen app (iPhone keeps Safari's and the app's storage apart) ----------
// A one-time code with this phone's keys and duckling. It only ever goes through this phone's clipboard,
// and is only accepted when pasted by hand (never from a link), so nobody can push an identity onto you.

const MOVE = 'cz-move:'
const toB64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))))

export function moveCode() {
  const id = load()
  return id?.keys ? MOVE + toB64u(JSON.stringify({ keys: id.keys, profile: id.profile })) : null
}

/** Returns the identity inside a pasted move code, or null. */
export function readMove(text) {
  const m = new RegExp(`${MOVE}([A-Za-z0-9_-]+)`).exec(String(text || ''))
  if (!m) return null
  try {
    const id = JSON.parse(fromB64u(m[1]))
    return id?.keys?.signPriv && id.keys.memberId && id.profile ? id : null
  } catch {
    return null
  }
}

export async function adoptMove(id) {
  if ((await memberIdOf(id.keys.signPub)) !== id.keys.memberId) throw new Error('הקוד לא תקין')
  store({ keys: id.keys, profile: id.profile })
}

/** Takes on a saved duckling (from the vault): checks the keys belong together first. */
export const adopt = adoptMove
