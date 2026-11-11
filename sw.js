// Offline: every file the app needs is cached on install. Bump VERSION whenever a file changes
// (tests/files.test.mjs checks that every app file is listed here).
const VERSION = 'nekamot-v1.5.0'
// Every app on guyyyy15-web.github.io shares one origin, so cache names carry this app's path.
const SCOPE = new URL(self.registration.scope).pathname
const CACHE = `nekamot:${SCOPE}:${VERSION}`
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/groups.js',
  'js/groups-ui.js',
  'js/icons.js',
  'js/ideas.js',
  'js/identity.js',
  'js/images.js',
  'js/logic.js',
  'js/push.js',
  'js/sync.js',
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(`nekamot:${SCOPE}:`) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  // Only this app's own files; other pages under the same path (like game/) are left alone.
  const rel = url.pathname.slice(SCOPE.length)
  if (rel !== '' && rel !== 'index.html' && !FILES.includes(rel)) return
  // Pages: the cached app shell (hash routes all live in index.html).
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then((c) => c.match('index.html')).then((r) => r || fetch(req)))
    return
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || fetch(req)))
})

// ---------- Push notifications ----------
// The server sends { g: group, v: key version, d: encrypted { title, body } }. Only this phone has the group
// key (IndexedDB 'nekamot' → 'groups'), so the text is decrypted here. iPhone requires showing a
// notification for every push, so anything unreadable still shows a generic one.

function groupRecord(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('nekamot')
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('groups')) return resolve(null)
      const get = db.transaction('groups', 'readonly').objectStore('groups').get(id)
      get.onsuccess = () => resolve(get.result || null)
      get.onerror = () => resolve(null)
    }
  })
}

async function readNote(msg) {
  const rec = await groupRecord(msg.g)
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
    let title = 'נקמות שלי'
    let body = msg.test ? 'ההתראות עובדות! 🎉' : 'יש חדש באחת הקבוצות 😼'
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
      body,
      tag: msg.g || 'nekamot',
      renotify: true,
      lang: 'he',
      dir: 'rtl',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { hash: msg.g ? `#/g/${msg.g}` : '#/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const hash = (e.notification.data && e.notification.data.hash) || '#/'
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        w.postMessage({ nav: hash })
        return w.focus()
      }
    }
    return self.clients.openWindow(new URL(`./${hash}`, self.registration.scope).href)
  })())
})
