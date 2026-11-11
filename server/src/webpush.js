// Web Push from a Worker with WebCrypto only: VAPID (RFC 8292) and aes128gcm payloads (RFC 8291).
// The payload itself is already encrypted with the group key on the phone; this layer is the transport
// encryption every push service requires.

const enc = new TextEncoder()

export const b64u = (bytes) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** RFC 8291: encrypts `plaintext` for one subscription (p256dh and auth from the browser, base64url). */
export async function encryptPayload(p256dh, auth, plaintext, { salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  const uaPub = unb64u(p256dh)
  const authSecret = unb64u(auth)
  if (uaPub.length !== 65 || authSecret.length !== 16) throw new Error('bad subscription keys')
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record: the plaintext, then the 0x02 delimiter that marks the last record.
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))
  const rs = new Uint8Array([0, 0, 0x10, 0]) // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, body)
}

// VAPID tokens are valid for up to 24 h; one per push service, reused across requests in this isolate.
const tokens = new Map()

/** RFC 8292: the Authorization header for a push service. `vapid` = { publicKey (b64url raw), privateJwk, subject }. */
export async function vapidAuth(endpoint, vapid, now = Date.now()) {
  const aud = new URL(endpoint).origin
  const hit = tokens.get(aud)
  if (hit && hit.exp - now > 3600e3) return hit.header
  const exp = now + 12 * 3600e3
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(exp / 1000), sub: vapid.subject })))
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // WebCrypto's ECDSA signature is already r||s, which is what JWS ES256 wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  const value = `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`
  tokens.set(aud, { exp, header: value })
  return value
}

/** Sends one push. Returns the push service's status (201 sent, 404/410 subscription is gone). */
export async function sendPush(sub, payload, { vapid, ttl = 6 * 3600, topic, urgency = 'normal' }) {
  const body = await encryptPayload(sub.p256dh, sub.auth, typeof payload === 'string' ? enc.encode(payload) : payload)
  const headers = {
    Authorization: await vapidAuth(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  }
  if (topic) headers.Topic = topic
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body })
  return res.status
}

/** Push services we deliver to (no requests to arbitrary hosts from the Worker). */
export function allowedEndpoint(url, allowLocal = false) {
  let u
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (allowLocal && u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return true
  if (u.protocol !== 'https:') return false
  return (
    u.hostname === 'fcm.googleapis.com' ||
    u.hostname === 'updates.push.services.mozilla.com' ||
    u.hostname === 'web.push.apple.com' ||
    u.hostname.endsWith('.push.apple.com') ||
    u.hostname.endsWith('.notify.windows.com')
  )
}
