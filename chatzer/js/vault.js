// "Save your duckling": optional quick sign-in, end-to-end encrypted.
//
// The duckling (keys + look + form of address) is encrypted on the phone and kept on the server as a "vault".
// Two ways to open it, both giving the same 32 secret bytes that only the person has:
// - a passkey (Face ID / fingerprint / device code) through the WebAuthn PRF extension;
// - a save code (16 characters, 80 bits) to write down.
// From those bytes: HKDF → the vault's id (SHA-256 of a derived value: finding a vault needs the secret too) and
// its AES-GCM key. The server sees neither. Passkeys are shared between Safari and the home-screen app on
// iPhone, so this is also how a duckling moves into the installed app.
import * as identity from './identity.js'
import * as Y from './yard.js'
import * as db from './db.js'

const LOCAL = 'cz.vault' // [{ kind: 'passkey' | 'code', id, key (b64), at }]
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const rand = (n) => crypto.getRandomValues(new Uint8Array(n))
const err = (code, msg) => Object.assign(new Error(msg), { code })

let saltP = null
const salt = () => (saltP ??= crypto.subtle.digest('SHA-256', enc.encode('chatzer-vault-v1')).then((b) => new Uint8Array(b)))

async function derive(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  const bits = async (info) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, 256))
  const lookup = await bits('cz-vault-id')
  return { id: hex(await crypto.subtle.digest('SHA-256', lookup)), key: await bits('cz-vault-key') }
}

// ---------- What this phone remembers ----------

export function saved() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL)) || []
  } catch {
    return []
  }
}
function remember(entry) {
  const list = saved().filter((v) => v.kind !== entry.kind)
  try {
    localStorage.setItem(LOCAL, JSON.stringify([...list, entry]))
  } catch { /* private mode */ }
}
function forgetLocal(kind) {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(saved().filter((v) => v.kind !== kind)))
  } catch { /* private mode */ }
}

// ---------- Vault contents ----------

async function seal(keyBytes, vaults) {
  const id = identity.load()
  // `vaults`: every save of this duckling (kind, id, key), so a phone that opens one can also update or remove the others.
  const plain = enc.encode(JSON.stringify({ v: 1, keys: id.keys, profile: id.profile, voice: db.loadSettings().voice, vaults }))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const iv = rand(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return b64(out)
}
async function unseal(keyBytes, data) {
  const bytes = unb64(data)
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))))
}

/** Writes one save. `list`: all saves after this write (defaults to what this phone knows). */
async function upload(v, list = saved()) {
  await Y.register()
  await Y.api('PUT', `/v2/vault/${v.id}`, { data: await seal(v.key, list) })
}

/** Opens a vault and becomes that duckling on this phone; then fetches its yards. */
async function restore(v, kind) {
  const res = await fetch(`${Y.apiUrl()}/v2/vault/${v.id}`)
  if (res.status === 404) throw err('not-found', kind === 'code' ? 'הקוד לא מתאים לאף ברווזון' : 'לא מצאתי ברווזון שמור עם הכניסה הזאת')
  if (res.status === 429) throw err('rate', 'יותר מדי ניסיונות. נסו שוב בעוד שעה')
  if (!res.ok) throw err('net', 'אין חיבור כרגע. נסו שוב')
  let body
  try {
    body = await unseal(v.key, (await res.json()).data)
  } catch {
    throw err('bad', 'לא הצלחתי לפתוח את הברווזון השמור')
  }
  await identity.adopt({ keys: body.keys, profile: body.profile })
  if (body.voice === 'f' || body.voice === 'm') db.saveSettings({ ...db.loadSettings(), voice: body.voice })
  remember({ kind, id: v.id, key: b64(v.key), at: new Date().toISOString() })
  for (const other of Array.isArray(body.vaults) ? body.vaults : []) {
    if (other?.kind && other.kind !== kind && /^[a-f0-9]{64}$/.test(other.id || '') && other.key) remember(other)
  }
  try {
    localStorage.removeItem('cz.registered')
  } catch { /* ignore */ }
  await Y.refreshAll().catch(() => undefined)
  return body.profile
}

/** A new save: written with the full list, then the other saves are rewritten so they list it too. */
async function saveNew(kind, v) {
  const entry = { kind, id: v.id, key: b64(v.key), at: new Date().toISOString() }
  const list = [...saved().filter((x) => x.kind !== kind), entry]
  await upload(v, list)
  remember(entry)
  await refreshSaved()
}

// ---------- Passkey ----------

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isAndroid = () => /Android/.test(navigator.userAgent)
/** How the passkey is called on this device, for buttons: "Face ID", "טביעת אצבע", or "מפתח גישה". */
export const passkeyName = () => (isIOS() ? 'Face ID' : isAndroid() ? 'טביעת אצבע' : 'מפתח גישה')

export function passkeysAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create && window.isSecureContext)
}

async function prfGet(allowId = null) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 120000,
      ...(allowId ? { allowCredentials: [{ type: 'public-key', id: allowId }] } : {}),
      extensions: { prf: { eval: { first: await salt() } } },
    },
  })
  const out = a?.getClientExtensionResults?.().prf?.results?.first
  if (!out) throw err('no-prf', 'המכשיר הזה לא תומך בשמירה עם מפתח גישה. אפשר להשתמש בקוד שמירה')
  return new Uint8Array(out)
}

const cancelled = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError'

/** Saves the duckling with a new passkey. May ask for Face ID twice (create, then read the secret). */
export async function savePasskey() {
  const id = identity.load()
  if (!id?.keys) throw err('no-duck', 'צריך קודם ברווזון')
  let cred
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'החצר', id: location.hostname },
        user: { id: rand(16), name: id.profile.nickname, displayName: `${id.profile.nickname} · החצר` },
        challenge: rand(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        timeout: 120000,
        extensions: { prf: { eval: { first: await salt() } } },
      },
    })
  } catch (e) {
    if (cancelled(e)) throw err('cancelled', 'בוטל')
    throw err('failed', 'לא הצלחתי ליצור מפתח גישה במכשיר הזה')
  }
  const ext = cred.getClientExtensionResults?.() || {}
  if (ext.prf && ext.prf.enabled === false) throw err('no-prf', 'המכשיר הזה לא תומך בשמירה עם מפתח גישה. אפשר להשתמש בקוד שמירה')
  let secret = ext.prf?.results?.first ? new Uint8Array(ext.prf.results.first) : null
  if (!secret) {
    try {
      secret = await prfGet(cred.rawId)
    } catch (e) {
      if (cancelled(e)) throw err('cancelled', 'בוטל')
      throw e
    }
  }
  await saveNew('passkey', await derive(secret))
}

export async function signInPasskey() {
  let secret
  try {
    secret = await prfGet()
  } catch (e) {
    if (cancelled(e)) throw err('cancelled', 'בוטל')
    throw e
  }
  return restore(await derive(secret), 'passkey')
}

// ---------- Save code ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford: no I, L, O, U
export function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
}
export const formatCode = (c) => c.match(/.{1,4}/g).join('-')
const codeSecret = (c) => enc.encode(`cz-code:${c}`)

/** Makes a save code (80 bits), saves the duckling with it, and returns it to show once. */
export async function makeCode() {
  const bytes = rand(10)
  let bits = 0
  let val = 0
  let code = ''
  for (const b of bytes) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) {
      code += ALPHABET[(val >>> (bits - 5)) & 31]
      bits -= 5
    }
    val &= (1 << bits) - 1 // keep only the bits not used yet (stays far below 32 bits)
  }
  await saveNew('code', await derive(codeSecret(code)))
  return formatCode(code)
}

export async function signInCode(text) {
  const c = normalizeCode(text)
  if (c.length !== 16 || [...c].some((ch) => !ALPHABET.includes(ch))) throw err('format', 'קוד שמירה הוא 16 תווים, למשל 7KQ2-M9XD-4TRA-WP1C')
  return restore(await derive(codeSecret(c)), 'code')
}

// ---------- Keeping it fresh ----------

/** After a change to the duckling: re-save every vault this phone knows (no Face ID needed). */
export async function refreshSaved() {
  for (const v of saved()) await upload({ id: v.id, key: unb64(v.key) }).catch(() => undefined)
}

export async function remove(kind) {
  const v = saved().find((x) => x.kind === kind)
  if (!v) return
  await Y.api('DELETE', `/v2/vault/${v.id}`).catch(() => undefined)
  forgetLocal(kind)
  await refreshSaved() // the remaining saves stop listing it
}
