// The Worker's Web Push code, checked the way a browser and a push service would check it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptPayload, vapidAuth, b64u, unb64u, allowedEndpoint } from '../src/webpush.js'

const enc = new TextEncoder()
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** A browser's side of RFC 8291: decrypt an aes128gcm body with the subscription's private key and auth. */
async function browserDecrypt(ua, uaPub, auth, body) {
  const salt = body.subarray(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
  const idlen = body[20]
  const asPub = body.subarray(21, 21 + idlen)
  const ct = body.subarray(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256))
  const ikm = await hkdf(auth, shared, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPub, ...asPub]), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct))
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter')
  return { rs, idlen, text: new TextDecoder().decode(plain.subarray(0, -1)) }
}

async function subscription() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { ua, uaPub, auth, p256dh: b64u(uaPub), authB64: b64u(auth) }
}

test('payload encryption: a browser can decrypt it (RFC 8291 aes128gcm)', async () => {
  const s = await subscription()
  const msg = JSON.stringify({ g: 'gabc', v: 2, d: 'ciphertext-from-the-phone' })
  const body = await encryptPayload(s.p256dh, s.authB64, enc.encode(msg))
  const out = await browserDecrypt(s.ua, s.uaPub, s.auth, body)
  assert.deepEqual([out.rs, out.idlen, out.text], [4096, 65, msg])
  // Every push is encrypted afresh.
  const again = await encryptPayload(s.p256dh, s.authB64, enc.encode(msg))
  assert.notDeepEqual(again.subarray(0, 40), body.subarray(0, 40))
  // A different subscriber cannot read it.
  const other = await subscription()
  await assert.rejects(browserDecrypt(other.ua, other.uaPub, other.auth, body))
  await assert.rejects(encryptPayload('short', s.authB64, enc.encode('x')))
})

test('VAPID: a valid ES256 JWT for the push service origin, cached per origin', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const vapid = { privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey), publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), subject: 'https://example.app/' }
  const now = Date.now()
  const h = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vapid, now)
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)
  assert.equal(k, vapid.publicKey)
  const [head, claims, sig] = jwt.split('.')
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(head))), { typ: 'JWT', alg: 'ES256' })
  const c = JSON.parse(new TextDecoder().decode(unb64u(claims)))
  assert.equal(c.aud, 'https://fcm.googleapis.com')
  assert.equal(c.sub, 'https://example.app/')
  assert.ok(c.exp > now / 1000 && c.exp <= now / 1000 + 24 * 3600)
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64u(sig), enc.encode(`${head}.${claims}`)))
  assert.equal(await vapidAuth('https://fcm.googleapis.com/other', vapid, now + 1000), h, 'same origin → cached token')
  assert.notEqual(await vapidAuth('https://web.push.apple.com/x', vapid, now), h)
})

test('push endpoints: only real push services (and localhost in tests)', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QK', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(allowedEndpoint(ok), ok)
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/', 'http://127.0.0.1:9/x', 'not a url', 'https://169.254.169.254/']) assert.ok(!allowedEndpoint(bad), bad)
  assert.ok(allowedEndpoint('http://127.0.0.1:9/x', true))
})
