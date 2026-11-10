// Everything is stored on this phone only, in IndexedDB: revenges and their photos (faces and documentation).
// No server, no account. localStorage is used only for small settings.

const DB_NAME = 'nekamot'
const VERSION = 1
let dbp = null

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('revenges')) db.createObjectStore('revenges', { keyPath: 'id' })
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

export const allRevenges = () => tx('revenges', 'readonly', (s) => s.getAll())
export const putRevenge = (r) => tx('revenges', 'readwrite', (s) => s.put(r))
export const deleteRevenge = (id) => tx('revenges', 'readwrite', (s) => s.delete(id))

export const getPhoto = (id) => tx('photos', 'readonly', (s) => s.get(id))
export const putPhoto = (p) => tx('photos', 'readwrite', (s) => s.put(p))
export const deletePhoto = (id) => tx('photos', 'readwrite', (s) => s.delete(id))
export const allPhotos = () => tx('photos', 'readonly', (s) => s.getAll())

export async function clearAll() {
  await tx('revenges', 'readwrite', (s) => s.clear())
  await tx('photos', 'readwrite', (s) => s.clear())
}

/** Ask the browser not to clear the data when the phone runs low on space. */
export function persist() {
  navigator.storage?.persist?.().catch(() => undefined)
}

export async function storageUsed() {
  try {
    return (await navigator.storage?.estimate?.())?.usage ?? null
  } catch {
    return null
  }
}

// ---------- Settings (localStorage) ----------

const KEY = 'nk.settings'
const DEFAULTS = { voice: 'f', theme: 'auto', hideInstall: false }

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
  } catch {
    /* private mode: settings just don't persist */
  }
}
