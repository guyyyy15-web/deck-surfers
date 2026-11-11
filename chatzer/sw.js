// Offline: every file the app needs is cached on install. Bump VERSION (and APP_VERSION in js/app.js) on
// every change; tests/chatzer.test.mjs checks that every file is listed here.
const VERSION = 'chatzer-v0.2.2'
const CACHE = `chatzer:${VERSION}`
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/duck.js',
  'js/identity.js',
  'js/images.js',
  'js/push.js',
  'js/vault.js',
  'js/yard.js',
  'fonts/fredoka-hebrew.woff2',
  'fonts/fredoka-latin.woff2',
  'fonts/rubik-hebrew.woff2',
  'fonts/rubik-latin.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chatzer:') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  const scope = new URL(self.registration.scope).pathname
  const rel = url.pathname.slice(scope.length)
  if (rel !== '' && rel !== 'index.html' && !FILES.includes(rel)) return
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then((c) => c.match('index.html')).then((r) => r || fetch(req)))
    return
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || fetch(req)))
})

// ---------- Push ----------
// The server sends { g: yard, v: key version, d: encrypted { title, body } }. Only this phone has the yard key
// (IndexedDB 'chatzer' → 'yards'). iPhone requires a notification for every push, so unreadable ones get a
// generic text.

function yardRecord(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('chatzer')
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('yards')) return resolve(null)
      const get = db.transaction('yards', 'readonly').objectStore('yards').get(id)
      get.onsuccess = () => resolve(get.result || null)
      get.onerror = () => resolve(null)
    }
  })
}

async function readNote(msg) {
  const rec = await yardRecord(msg.g)
  const raw = rec && rec.keys && rec.keys[msg.v]
  if (!raw) return null
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
  const data = Uint8Array.from(atob(msg.d), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12))
  return JSON.parse(new TextDecoder().decode(plain))
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg = {}
    try {
      msg = e.data ? e.data.json() : {}
    } catch { /* not JSON */ }
    let title = 'החצר'
    let body = msg.test ? 'ההתראות עובדות! 🐥' : 'יש חדש בחצר 🐥'
    if (msg.g && msg.d) {
      try {
        const note = await readNote(msg)
        if (note) {
          title = String(note.title || title).slice(0, 60)
          body = String(note.body || body).slice(0, 160)
        }
      } catch { /* generic text */ }
    }
    if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => undefined)
    await self.registration.showNotification(title, {
      body, tag: msg.g || 'chatzer', renotify: true, lang: 'he', dir: 'rtl',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { hash: msg.g ? `#/y/${msg.g}` : '#/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const hash = (e.notification.data && e.notification.data.hash) || '#/'
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      w.postMessage({ nav: hash })
      return w.focus()
    }
    return self.clients.openWindow(new URL(`./${hash}`, self.registration.scope).href)
  })())
})
