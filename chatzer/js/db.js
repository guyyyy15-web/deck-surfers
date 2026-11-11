// This phone's copy of each yard (decrypted event log, keys, members) and photos, in IndexedDB.
// localStorage holds only small settings.

const DB_NAME = 'chatzer'
const VERSION = 1
let dbp = null

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('yards')) db.createObjectStore('yards', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => {
      dbp = null
      reject(req.error)
    }
  })
  return dbp
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        t.oncomplete = () => resolve(req?.result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error || new Error('aborted'))
      }),
  )
}

export const allYards = () => tx('yards', 'readonly', (s) => s.getAll())
export const getYard = (id) => tx('yards', 'readonly', (s) => s.get(id))
export const putYard = (y) => tx('yards', 'readwrite', (s) => s.put(y))
export const deleteYard = (id) => tx('yards', 'readwrite', (s) => s.delete(id))

export const getPhoto = (id) => tx('photos', 'readonly', (s) => s.get(id))
export const putPhoto = (p) => tx('photos', 'readwrite', (s) => s.put(p))

export function persist() {
  navigator.storage?.persist?.().catch(() => undefined)
}

// ---------- Settings ----------

const KEY = 'cz.settings'
const DEFAULTS = { voice: 'f', hideInstall: false }

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch { /* private mode */ }
}
