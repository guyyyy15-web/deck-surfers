// Pure logic with no DOM: dates, grouping, stats, calendar files, crop maths, backups.
// Everything here is covered by tests/logic.test.mjs.

export const TYPES = [
  { id: 'cruel', label: 'אכזרית', icon: 'flame', fill: 'lilac-300' },
  { id: 'big', label: 'גדולה', icon: 'crown', fill: 'sun' },
  { id: 'creative', label: 'יצירתית', icon: 'bulb', fill: 'sun' },
  { id: 'small', label: 'קטנה', icon: 'cupcake', fill: 'blush' },
]
export const typeOf = (id) => TYPES.find((t) => t.id === id) || TYPES[2]

export const AVATAR_COLORS = ['var(--blush)', 'var(--sun)', 'var(--lilac-200)']

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** First letter for the avatar ("השליח" → "ה"); skips quotes, spaces and emoji modifiers. */
export function initialOf(name) {
  const m = String(name || '').trim().match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '?'
}

/** A stable avatar colour per name. */
export function colorFor(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// ---------- Dates ----------
// Reminders are calendar days ("YYYY-MM-DD", local). Created / done are ISO timestamps.

const pad = (n) => String(n).padStart(2, '0')
export const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const fmt = (opts) => new Intl.DateTimeFormat('he-IL', opts)
const F_DAY_MONTH = fmt({ day: 'numeric', month: 'long' })
const F_FULL = fmt({ day: 'numeric', month: 'long', year: 'numeric' })
const F_WEEKDAY = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
const F_MONTH = fmt({ month: 'long', year: 'numeric' })
const F_MONTH_SHORT = fmt({ month: 'short' })

/** "3 בנובמבר", with the year only when it isn't this year. */
export function dayMonth(date, now = new Date()) {
  const d = new Date(date)
  return d.getFullYear() === now.getFullYear() ? F_DAY_MONTH.format(d) : F_FULL.format(d)
}
export const fullDate = (date) => F_FULL.format(new Date(date))
/** "יום ראשון, 15 בנובמבר" */
export const weekdayDate = (day) => F_WEEKDAY.format(parseDay(day))
/** "נובמבר 2026" */
export const monthTitle = (date) => F_MONTH.format(new Date(date))
export const monthShort = (date) => F_MONTH_SHORT.format(new Date(date))

/** Days from today to a reminder day: 0 today, 1 tomorrow, negative when late. */
export function daysUntil(day, now = new Date()) {
  const d = parseDay(day)
  if (!d) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d - today) / 86400000)
}

/** Short reminder label for a card, or null. */
export function dueLabel(day, now = new Date()) {
  const n = daysUntil(day, now)
  if (n === null) return null
  if (n < 0) return { text: n === -1 ? 'התזכורת הייתה אתמול' : `באיחור של ${-n} ימים`, late: true }
  if (n === 0) return { text: 'היום!', late: true }
  if (n === 1) return { text: 'מחר', late: false }
  if (n <= 7) return { text: `בעוד ${n} ימים`, late: false }
  return { text: dayMonth(parseDay(day), now), late: false }
}

// ---------- Lists ----------

/** Open revenges: due reminders first (soonest first), then newest. */
export function sortOpen(list) {
  return [...list].sort((a, b) => {
    const ar = a.remindOn || '9999', br = b.remindOn || '9999'
    if (ar !== br) return ar < br ? -1 : 1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

/** Done revenges grouped by the month they were done, newest month first. */
export function groupByMonth(list) {
  const done = [...list].sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1))
  const groups = []
  for (const r of done) {
    const d = new Date(r.doneAt)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) groups.push((g = { key, title: monthTitle(d), items: [] }))
    g.items.push(r)
  }
  return groups
}

export function matches(r, q) {
  q = q.trim().toLowerCase()
  if (!q) return true
  return [r.name, r.why, r.plan, r.notes].some((s) => (s || '').toLowerCase().includes(q))
}

// ---------- Stats ----------

export function stats(list, now = new Date()) {
  const open = list.filter((r) => r.status === 'open')
  const done = list.filter((r) => r.status === 'done')
  const ym = (d) => `${d.getFullYear()}-${d.getMonth()}`
  const thisMonth = done.filter((r) => ym(new Date(r.doneAt)) === ym(now)).length
  const byType = TYPES.map((t) => ({ ...t, count: list.filter((r) => r.type === t.id).length }))
  const months = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ date: d, count: done.filter((r) => ym(new Date(r.doneAt)) === ym(d)).length })
  }
  const waits = done.map((r) => (new Date(r.doneAt) - new Date(r.createdAt)) / 86400000).filter((n) => n >= 0)
  const avgDays = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null
  const names = new Map()
  for (const r of list) {
    const k = r.name.trim()
    names.set(k, (names.get(k) || 0) + 1)
  }
  const [topName, topCount] = [...names].sort((a, b) => b[1] - a[1])[0] || [null, 0]
  const rate = list.length ? Math.round((done.length / list.length) * 100) : 0
  return { open: open.length, done: done.length, total: list.length, thisMonth, byType, months, avgDays, rate,
    regular: topCount > 1 ? { name: topName, count: topCount } : null }
}

// ---------- Calendar reminder (.ics) ----------

const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** Folds lines at 73 octets as RFC 5545 asks (UTF-8 aware, never splits a character). */
function fold(line) {
  const enc = new TextEncoder()
  const out = []
  let cur = '', size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > 73) {
      out.push(cur)
      cur = ' '
      size = 1
    }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n')
}

/** An all-day calendar event with a 9:00 alert on the reminder day. */
export function reminderIcs(r, stamp = new Date()) {
  const start = parseDay(r.remindOn)
  if (!start) return null
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  const ymd = (d) => toDay(d).replace(/-/g, '')
  const utc = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nekamot//he', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${r.id}@nekamot`, `DTSTAMP:${utc}`, `DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(end)}`,
    `SUMMARY:${icsText(`נקמה: ${r.name}`)}`, `DESCRIPTION:${icsText(r.why + (r.plan ? `\nהתוכנית: ${r.plan}` : ''))}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${icsText(`הגיע הזמן לנקום ב${r.name}`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ---------- Crop maths ----------
// The stage is a square of side S with a circle of diameter D in its centre. The image (w×h) is drawn at
// `scale` with its top-left at (x, y). The circle must always be covered by the image.

export const CIRCLE = 0.82

export function cropBase(w, h, D) {
  return Math.max(D / w, D / h)
}

/** Keeps the image covering the circle. */
export function clampPos(x, y, w, h, scale, S, D) {
  const c0 = (S - D) / 2
  const iw = w * scale, ih = h * scale
  return {
    x: Math.min(c0, Math.max(c0 + D - iw, x)),
    y: Math.min(c0, Math.max(c0 + D - ih, y)),
  }
}

/** Zooms to `next` keeping the stage point (px, py) still. */
export function zoomAt(state, next, px, py) {
  const k = next / state.scale
  return { scale: next, x: px - (px - state.x) * k, y: py - (py - state.y) * k }
}

/** The square of the image (in image pixels) inside the circle. */
export function cropRect(x, y, scale, S, D) {
  const c0 = (S - D) / 2
  return { sx: (c0 - x) / scale, sy: (c0 - y) / scale, size: D / scale }
}

/** The size to draw an image at so its longest side is at most `max` (never enlarged). */
export function fitWithin(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// ---------- Backup ----------

export const BACKUP_KIND = 'nekamot-backup'

/** Checks a parsed backup file and returns its revenges and photos, or throws a Hebrew message. */
export function readBackup(data) {
  if (!data || data.kind !== BACKUP_KIND || !Array.isArray(data.revenges)) throw new Error('זה לא קובץ גיבוי של נקמות שלי')
  const revenges = data.revenges.filter(
    (r) => r && typeof r.id === 'string' && typeof r.name === 'string' && (r.status === 'open' || r.status === 'done'),
  )
  const photos = (Array.isArray(data.photos) ? data.photos : []).filter(
    (p) => p && typeof p.id === 'string' && /^data:image\/[a-z+]+;base64,/.test(p.data || ''),
  )
  return { revenges, photos }
}

/** Merges imported revenges into the current ones; the newer copy of the same id wins. */
export function mergeRevenges(current, incoming) {
  const map = new Map(current.map((r) => [r.id, r]))
  let added = 0, updated = 0
  for (const r of incoming) {
    const have = map.get(r.id)
    if (!have) {
      map.set(r.id, r)
      added++
    } else if ((r.updatedAt || '') > (have.updatedAt || '')) {
      map.set(r.id, r)
      updated++
    }
  }
  return { list: [...map.values()], added, updated }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
