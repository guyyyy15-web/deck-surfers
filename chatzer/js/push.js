// Push notifications on this phone. The text is encrypted with the yard key and decrypted in sw.js.
import * as Y from './yard.js'
import * as identity from './identity.js'

const FLAG = 'cz.push' // { on, endpoint, savedAt }
const ASKED = 'cz.pushAsked'

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k))
  } catch {
    return null
  }
}
const write = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, JSON.stringify(v))
  } catch { /* private mode */ }
}
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** 'needs-install' (iPhone in Safari) | 'unsupported' | 'needs-duck' | 'denied' | 'on' | 'off' */
export function status() {
  if (isIOS() && !standalone()) return 'needs-install'
  if (!supported()) return 'unsupported'
  if (!identity.load()?.keys) return 'needs-duck'
  if (Notification.permission === 'denied') return 'denied'
  return read(FLAG)?.on && Notification.permission === 'granted' ? 'on' : 'off'
}

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

/** Must run from a tap (iPhone only shows the permission prompt for a user gesture). */
export async function enable() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw Object.assign(new Error('בלי הרשאה אי אפשר לשלוח התראות'), { code: permission })
  const reg = await navigator.serviceWorker.ready
  const want = b64uToBytes(await Y.pushKey())
  let sub = await reg.pushManager.getSubscription()
  const have = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  await Y.savePush(sub)
  write(FLAG, { on: true, endpoint: sub.endpoint, savedAt: Date.now() })
}

export async function disable() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  write(FLAG, { on: false })
  if (sub) {
    await Y.removePush(sub.endpoint).catch(() => undefined)
    await sub.unsubscribe().catch(() => undefined)
  }
}

/** On start: keep the server's copy of the subscription fresh (at most daily). */
export async function refresh() {
  if (status() !== 'on') return
  const flag = read(FLAG)
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return write(FLAG, { on: false })
  if (sub.endpoint === flag.endpoint && Date.now() - (flag.savedAt || 0) < 86400e3) return
  await Y.savePush(sub)
  write(FLAG, { on: true, endpoint: sub.endpoint, savedAt: Date.now() })
}

// Asked after something someone did in a yard (never on first launch); again after a week, at most 3 times.
const askedState = (k) => {
  const a = read(k)
  if (!a) return { at: 0, n: 0 }
  return typeof a === 'number' ? { at: a, n: 1 } : a
}
const mayAsk = (k) => {
  const a = askedState(k)
  return a.n === 0 || (a.n < 3 && Date.now() - a.at > 7 * 86400e3)
}
const bump = (k) => write(k, { at: Date.now(), n: askedState(k).n + 1 })
export const shouldAsk = () => status() === 'off' && mayAsk(ASKED)
export const markAsked = () => bump(ASKED)
/** iPhone in Safari: offer the home screen (or the calendar) instead, on the same terms. */
export const shouldOfferInstall = () => status() === 'needs-install' && mayAsk('cz.installAsked')
export const markOfferedInstall = () => bump('cz.installAsked')

/** "Send me a test notification" (the server sends one to each of my phones). */
export const test = () => Y.api('POST', '/v2/push/test')

/** Closes this yard's notifications that are still on the lock screen / in the notification center. */
export function closeShown(tag) {
  try {
    navigator.serviceWorker?.ready.then((reg) => reg.getNotifications?.({ tag })).then((list) => list?.forEach((n) => n.close())).catch(() => undefined)
  } catch { /* not supported */ }
}

export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch(() => undefined)
    else navigator.clearAppBadge?.()?.catch(() => undefined)
  } catch { /* not supported */ }
}
