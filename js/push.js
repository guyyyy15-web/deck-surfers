// Push notifications on this phone: support checks, turning them on and off, and keeping the server's copy
// of the subscription fresh. Notifications are about groups; their text is decrypted by the service
// worker with the group key (sw.js), never by the server.
import * as G from './groups.js'
import * as identity from './identity.js'

const FLAG = 'nk.push' // { on, endpoint, savedAt }
const ASKED = 'nk.pushAsked'

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
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

/** 'unsupported' | 'needs-install' (iPhone in Safari) | 'needs-cat' | 'denied' | 'on' | 'off' */
export function status() {
  if (isIOS() && !standalone()) return 'needs-install'
  if (!supported()) return 'unsupported'
  if (!identity.load()?.keys) return 'needs-cat'
  if (Notification.permission === 'denied') return 'denied'
  return read(FLAG)?.on && Notification.permission === 'granted' ? 'on' : 'off'
}

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

/** Must be called from a tap (iPhone requires the permission prompt to come from a user gesture). */
export async function enable() {
  // Ask first, while we are still inside the tap.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw Object.assign(new Error('בלי הרשאה אי אפשר לשלוח התראות'), { code: permission })
  const reg = await navigator.serviceWorker.ready
  const key = await G.pushKey()
  let sub = await reg.pushManager.getSubscription()
  const want = b64uToBytes(key)
  // A subscription made with another key (an old server key) cannot receive our pushes: renew it.
  const have = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  await G.savePush(sub)
  write(FLAG, { on: true, endpoint: sub.endpoint, savedAt: Date.now() })
}

export async function disable() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  write(FLAG, { on: false })
  if (sub) {
    await G.removePush(sub.endpoint).catch(() => undefined)
    await sub.unsubscribe().catch(() => undefined)
  }
}

/** On app start: if notifications are on, tell the server about the current subscription (at most daily). */
export async function refresh() {
  if (status() !== 'on') return
  const flag = read(FLAG)
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) {
    write(FLAG, { on: false })
    return
  }
  if (sub.endpoint === flag.endpoint && Date.now() - (flag.savedAt || 0) < 86400e3) return
  await G.savePush(sub)
  write(FLAG, { on: true, endpoint: sub.endpoint, savedAt: Date.now() })
}

/** Ask once, after the first thing someone does in a group (not on first launch). */
export function shouldAsk() {
  return status() === 'off' && !read(ASKED)
}
export const markAsked = () => write(ASKED, Date.now())

/** The app icon's badge: unread group updates (iPhone home-screen apps and Android). */
export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch(() => undefined)
    else navigator.clearAppBadge?.()?.catch(() => undefined)
  } catch { /* not supported */ }
}
