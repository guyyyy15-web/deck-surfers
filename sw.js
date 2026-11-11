// Offline: every file the app needs is cached on install. Bump VERSION whenever a file changes
// (tests/files.test.mjs checks that every app file is listed here).
const VERSION = 'nekamot-v1.2.0'
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
  'js/icons.js',
  'js/ideas.js',
  'js/images.js',
  'js/logic.js',
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
