// החצר: screens, router and sheets. Data lives in yard.js (encrypted yards) and identity.js (your duckling).
import * as Y from './yard.js'
import * as identity from './identity.js'
import * as db from './db.js'
import * as push from './push.js'
import * as V from './vault.js'
import { duck, DUCK_COLORS, CLOTH_COLORS, MOODS, SLOTS, lookOf, legacyAccessory } from './duck.js'
import { shrinkFile, photoUrl } from './images.js'

export const APP_VERSION = '0.13.0'

// The same files are also on GitHub Pages (this repo); the real home is hechatzer.pages.dev.
if (/github\.io$/.test(location.hostname)) location.replace(`https://hechatzer.pages.dev/${location.hash}`)

const $app = document.getElementById('app')
let settings = db.loadSettings()
/**
 * Speaks to the user in their chosen form: g(feminine, masculine). Until they choose, a neutral slash form
 * ("מביא/ה"), never one gender by default.
 */
const neutral = (f, m) => (f.startsWith(m) ? `${m}/${f.slice(m.length)}` : `${m}/${f}`)
const g = (f, m) => (settings.voice === 'm' ? m : settings.voice === 'f' ? f : neutral(f, m))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const me = () => identity.myId()
const VOICE_ERR = 'עוד רגע: אישה או גבר? ככה נדע איך לפנות'
const offlineLine = () => `<div class="offline">אין רשת כרגע. מה ${g('שתעשי', 'שתעשה')} יישלח ${g('כשתחזרי', 'כשתחזור')}</div>`

const ICON = {
  back: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  plus: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>',
  camera: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  cal: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  x: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4L3 11l7 3 3 7z"/></svg>',
}

// ---------- Small helpers ----------

let toastTimer = 0
function toast(msg, action = null) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.innerHTML = `${esc(msg)}${action ? ` <button class="link-btn" style="color:inherit" type="button">${esc(action.label)}</button>` : ''}`
  if (action) el.querySelector('button').onclick = () => {
    el.remove()
    action.run()
  }
  document.body.append(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3200)
}

const errText = (e) => {
  if (!navigator.onLine) return 'אין רשת כרגע. ננסה שוב כשתחזרי'
  if (e?.code === 'removed') return 'כבר לא בחצר הזאת'
  if (e?.status === 429) return 'רגע, יותר מדי בבת אחת. נסו שוב עוד דקה'
  return e?.message && /[֐-׿]/.test(e.message) ? e.message : 'משהו השתבש. נסו שוב'
}
async function act(fn) {
  try {
    return await fn()
  } catch (e) {
    console.error(e)
    toast(errText(e))
    return undefined
  }
}

function busy(btn, on, text) {
  if (!btn) return
  if (on) {
    btn.dataset.label = btn.innerHTML
    btn.disabled = true
    if (text) btn.textContent = text
  } else {
    btn.disabled = false
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label
  }
}

const whenText = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const soon = d.getTime() - Date.now() < 6 * 86400e3 && d.getTime() > Date.now() - 86400e3
  return new Intl.DateTimeFormat('he-IL', soon ? { weekday: 'long', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d)
}
const dueText = (c) => {
  if (c.due === 'late') return 'באיחור'
  if (c.due === 'today') return 'היום'
  const days = Math.round((c.dueAt - new Date().setHours(0, 0, 0, 0)) / 86400e3)
  if (days === 1) return 'מחר'
  if (days > 6) return `ב־${new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' }).format(new Date(c.dueAt))}`
  return `ביום ${new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(c.dueAt)).replace('יום ', '')}`
}
const hhmm = (ms) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
const dayStart = (ms = Date.now()) => new Date(ms).setHours(0, 0, 0, 0)
/** "היום 18:30", "מחר 09:00", "ה׳ 20.11 18:30" */
function whenShort(ms) {
  const diff = Math.round((dayStart(ms) - dayStart()) / 86400e3)
  const day = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : diff === -1 ? 'אתמול' : new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(ms))
  return `${day} ${hhmm(ms)}`
}
const count = (n, one, many) => (n === 1 ? one : `${n} ${many}`)

/** A member's display: their duckling and name, from the yard's profiles. `w.g(f, m)` speaks about them. */
function who(st, rec, id) {
  const p = st.profiles.get(id) || {}
  const role = (rec?.members || []).find((m) => m.id === id)?.role
  const voice = id === me() ? settings.voice : p.voice
  return {
    name: id === me() ? g('את', 'אתה') : p.nickname || 'ברווזון', look: p, admin: role === 'admin',
    g: (f, m) => (voice === 'm' ? m : voice === 'f' ? f : neutral(f, m)),
  }
}
const duckOf = (st, rec, id, size = 26) => {
  const w = who(st, rec, id)
  return duck(w.look, size, { crown: w.admin, label: w.name })
}

// ---------- Sheets (a layer in history, so the back gesture closes them) ----------

let sheet = null
let pendingRender = false
let skipPop = 0

function openSheet(html, bind) {
  closeSheetNow()
  const wrap = document.createElement('div')
  wrap.className = 'sheet-wrap'
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button type="button" class="sheet-x" aria-label="סגירה"><span>${ICON.x}</span></button><div class="grip" aria-hidden="true"></div>${html}</div>`
  wrap.querySelector('.sheet-x').onclick = () => closeSheet()
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeSheet()
  })
  document.body.append(wrap)
  sheet = wrap
  history.pushState({ sheet: true }, '')
  bind?.(wrap.querySelector('.sheet'))
  wrap.querySelector('h2')?.setAttribute('tabindex', '-1')
  wrap.querySelector('h2')?.focus({ preventScroll: true })
  return wrap
}
function closeSheetNow() {
  if (!sheet) return
  sheet.remove()
  sheet = null
  if (pendingRender) {
    pendingRender = false
    render(true)
  }
}
/** Closes the sheet; resolves once history is back where it was (safe to navigate after). */
function closeSheet() {
  if (!sheet) return Promise.resolve()
  closeSheetNow()
  if (history.state?.sheet) {
    return new Promise((resolve) => {
      skipPop++
      const done = () => {
        window.removeEventListener('popstate', done)
        resolve()
      }
      window.addEventListener('popstate', done)
      history.back()
    })
  }
  return Promise.resolve()
}
window.addEventListener('popstate', () => {
  if (skipPop) {
    skipPop--
    return
  }
  if (sheet) closeSheetNow()
})
const go = async (hash) => {
  await closeSheet()
  location.hash = hash
}

// ---------- Router ----------

let view = { name: '', id: null }
let pollTimer = 0

function parse() {
  const [path, query = ''] = location.hash.slice(1).split('?')
  const h = decodeURIComponent(path) || '/'
  const q = new URLSearchParams(query)
  const open = ['item', 'chore', 'poll', 'reports'].find((k) => q.has(k))
  let m
  if (open && (m = /^\/y\/([\w-]+)$/.exec(h))) return { name: 'yard', id: m[1], open: { kind: open, ref: q.get(open) } }
  if ((m = /^\/join\/(.+)$/.exec(h))) return { name: 'join', id: m[1] }
  if ((m = /^\/y\/([\w-]+)\/chat$/.exec(h))) return { name: 'chat', id: m[1] }
  if ((m = /^\/y\/([\w-]+)\/team$/.exec(h))) return { name: 'team', id: m[1] }
  if ((m = /^\/y\/([\w-]+)$/.exec(h))) return { name: 'yard', id: m[1] }
  if (h === '/me') return { name: 'me' }
  if (h === '/today') return { name: 'today' }
  return { name: 'home' }
}

async function render(soft = false) {
  if (sheet && soft) {
    pendingRender = true
    return
  }
  const next = parse()
  const same = next.name === view.name && next.id === view.id
  view = next
  const y = same ? scrollY : 0
  const active = document.activeElement
  // Never throw away what someone is typing. An empty field is fine to redraw: focus goes back to it after.
  const typing = active?.matches?.('input, textarea') && $app.contains(active)
  if (soft && typing && active.value) return
  const refocus = soft && typing && active.id
  if (!identity.load()?.keys && view.name !== 'join') return welcome()
  if (view.name === 'join') await joinScreen(view.id)
  else if (view.name === 'yard') {
    await yardScreen(view.id)
    if (view.open) await openFromLink(view.id, view.open)
  }
  else if (view.name === 'chat') await chatScreen(view.id)
  else if (view.name === 'team') await teamScreen(view.id)
  else if (view.name === 'me') meScreen()
  else if (view.name === 'today') await todayScreen()
  else await homeScreen()
  if (refocus) document.getElementById(refocus)?.focus({ preventScroll: true })
  if (same) scrollTo(0, y)
  else scrollTo(0, 0)
  schedulePoll()
}

/**
 * A notification's deep link (#/y/<yard>?item=…): open that thing on top of its yard, once. The address goes back
 * to the plain yard first, so "back" closes the sheet and a refresh doesn't open it again.
 */
async function openFromLink(id, { kind, ref }) {
  history.replaceState(null, '', `#/y/${id}`)
  view = { name: 'yard', id }
  const st = Y.stateOf(await Y.localYard(id))
  if (kind === 'item' && st.items.has(ref)) return itemSheet(id, ref)
  if (kind === 'chore' && st.chores.has(ref)) return choreSheet(id, ref)
  if (kind === 'reports') return reportsSheet(id)
  if (kind === 'poll') {
    const card = document.querySelector(`.poll[data-poll="${CSS.escape(ref || '')}"]`)
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card?.classList.add('flash')
  }
}

/**
 * How often to check for news: quick while things happen (12 s in a yard, 45 s on home), slower and slower while
 * nothing changes (up to 2 minutes). Anything you do, a notification, or coming back to the app makes it quick again.
 */
let pollIdle = 0
const pollBase = () => (['yard', 'chat', 'team'].includes(view.name) ? 12e3 : 45e3)
const pollMs = () => Math.min(120e3, pollBase() * 1.6 ** pollIdle)
function pollSoon() {
  const wasSlow = pollIdle > 0
  pollIdle = 0
  if (wasSlow) schedulePoll()
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, pollSoon, { passive: true })

function schedulePoll() {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && navigator.onLine && identity.load()?.keys) {
      try {
        const added = view.id && view.name !== 'join' ? await Y.refresh(view.id) : await Y.refreshAll()
        pollIdle = added ? 0 : pollIdle + 1
        if (added) await render(true)
      } catch (e) {
        if (e.code === 'removed' && view.id) {
          toast('הוצאת מהחצר הזאת')
          return go('#/')
        }
      }
    }
    schedulePoll()
  }, pollMs())
}

// ---------- Welcome (first launch) ----------

function parade(ducks) {
  return `<div class="parade" role="img" aria-label="ברווזונים הולכים אחרי אמא ברווזה">${ducks.join('')}</div>`
}
const demoParade = () => parade([
  duck({ color: 'sun' }, 90, { crown: true }), duck({ color: 'mint', hat: 'cap', body: 'tshirt', bodyColor: 'blue' }, 60), duck({ color: 'pink', face: 'shades', neck: 'scarf' }, 56), duck({ color: 'sky' }, 52),
])

/** The duckling form: name, color, accessory, and how the app speaks to you. */
const PETS = [
  { id: 'none', label: 'אין' },
  { id: 'dog', label: 'כלב 🐕' },
  { id: 'cat', label: 'חתול 🐈' },
  { id: 'other', label: 'אחר 🐾' },
]
const hasPet = () => !!settings.pet && settings.pet !== 'none'

/** The closet: a row per part of the look; each choice shows *your* duckling with it, so you see before you pick. */
function closetHtml(look) {
  const row = (slot, title, items, render) => `<span class="lbl" id="cl-${slot}">${title}</span>
    <div class="closet-row" role="group" aria-labelledby="cl-${slot}">${items.map(render).join('')}</div>`
  const chip = (slot, it) => `<button type="button" class="look-chip" data-slot="${slot}" data-val="${it.id}" aria-pressed="${look[slot] === it.id}">${duck({ ...look, [slot]: it.id }, 58)}<span>${it.label}</span></button>`
  const swatch = (slot, c) => `<button type="button" class="swatch" data-slot="${slot}" data-val="${c.id}" aria-label="${c.label}" aria-pressed="${look[slot] === c.id}" style="background:${c.fill}"></button>`
  return `<div class="closet-tools"><button type="button" class="chip-btn" data-closet="random">🎲 הפתעה</button><button type="button" class="chip-btn" data-closet="clear">בלי כלום</button></div>
    <span class="lbl" id="cl-color">צבע</span><div class="swatches" role="group" aria-labelledby="cl-color">${DUCK_COLORS.map((c) => swatch('color', c)).join('')}</div>
    ${row('mood', 'הבעה', MOODS, (m) => chip('mood', m))}
    ${Object.entries(SLOTS).map(([slot, def]) => row(slot, def.label, def.items, (it) => chip(slot, it)) + (slot === 'body' && look.body !== 'none'
      ? `<span class="lbl" id="cl-bc" style="margin-top:8px">צבע הבגד</span><div class="swatches" role="group" aria-labelledby="cl-bc">${CLOTH_COLORS.map((c) => swatch('bodyColor', c)).join('')}</div>` : '')).join('')}`
}

function duckForm(p = {}, { compact = false, pets = false } = {}) {
  const look = lookOf(p)
  return `
    <label class="lbl" for="nick">איך קוראים לך?</label>
    <input class="input" id="nick" maxlength="20" autocomplete="nickname" value="${esc(p.nickname || '')}" placeholder="השם שיראו בחצר">
    ${compact ? `<div class="mine-duck"><button type="button" class="mine-duck-btn" data-closet="color" aria-label="צבע אחר לברווזון" id="mypreview">${duck(look, 64)}</button>
      <span class="small muted">זה הברווזון שלך. לחיצה עליו = צבע אחר.<br>בגדים וכובעים: אחר כך, ב"הברווזון שלי".</span></div>`
    : `<div id="closet">${closetHtml(look)}</div>`}
    <span class="lbl" id="voice-l">איך לפנות? אני…</span>
    <div class="choices" role="group" aria-labelledby="voice-l">
      <button type="button" class="choice" data-voice="f" aria-pressed="${settings.voice === 'f'}">אישה</button>
      <button type="button" class="choice" data-voice="m" aria-pressed="${settings.voice === 'm'}">גבר</button>
    </div>
    ${pets ? `<span class="lbl" id="pet-l">יש בעל חיים בבית?</span>
    <div class="choices" role="group" aria-labelledby="pet-l">${PETS.map((x) => `<button type="button" class="choice" data-pet="${x.id}" aria-pressed="${(settings.pet || 'none') === x.id}">${x.label}</button>`).join('')}</div>
    <p class="small muted" style="margin:4px 0 0">ככה נציע גם מטלות כמו טיול עם הכלב.</p>` : ''}`
}
function bindDuckForm(root, onChange = () => undefined, start = identity.profile()) {
  const state = lookOf(start)
  const press = (sel, el) => root.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b === el)))
  const closet = root.querySelector('#closet')
  const pickAny = (list, none = 0.4) => (Math.random() < none ? 'none' : list[1 + Math.floor(Math.random() * (list.length - 1))].id)
  const redraw = () => {
    if (closet) {
      const rows = [...closet.querySelectorAll('.closet-row')].map((r) => r.scrollLeft)
      closet.innerHTML = closetHtml(state)
      closet.querySelectorAll('.closet-row').forEach((r, i) => (r.scrollLeft = rows[i] || 0))
    } else {
      root.querySelectorAll('[data-slot="color"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === state.color)))
      const pv = root.querySelector('#mypreview')
      if (pv) pv.innerHTML = duck(state, 64)
    }
    onChange(state)
  }
  // Listen on the form (re-created with each screen), never on #app (it stays, so listeners would pile up).
  const host = root.querySelector('form') || root
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot], [data-closet]')
    if (!b || !host.contains(b)) return
    if (b.dataset.slot) state[b.dataset.slot] = b.dataset.val
    else if (b.dataset.closet === 'color') {
      const others = DUCK_COLORS.filter((c) => c.id !== state.color)
      state.color = others[Math.floor(Math.random() * others.length)].id
      b.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.15) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 260 })
    } else if (b.dataset.closet === 'clear') Object.assign(state, { hat: 'none', face: 'none', neck: 'none', body: 'none', held: 'none', mood: 'happy' })
    else {
      Object.assign(state, {
        color: DUCK_COLORS[Math.floor(Math.random() * DUCK_COLORS.length)].id, mood: MOODS[Math.floor(Math.random() * MOODS.length)].id,
        hat: pickAny(SLOTS.hat.items, 0.25), face: pickAny(SLOTS.face.items, 0.6), neck: pickAny(SLOTS.neck.items, 0.5),
        body: pickAny(SLOTS.body.items, 0.3), bodyColor: CLOTH_COLORS[Math.floor(Math.random() * CLOTH_COLORS.length)].id, held: pickAny(SLOTS.held.items, 0.5),
      })
    }
    redraw()
  })
  root.querySelectorAll('[data-voice]').forEach((b) => (b.onclick = () => {
    press('[data-voice]', b)
    settings = { ...settings, voice: b.dataset.voice }
    db.saveSettings(settings)
  }))
  root.querySelectorAll('[data-pet]').forEach((b) => (b.onclick = () => {
    press('[data-pet]', b)
    settings = { ...settings, pet: b.dataset.pet }
    db.saveSettings(settings)
  }))
  return () => ({ nickname: root.querySelector('#nick').value, ...state, accessory: legacyAccessory(state) })
}

const freshLook = () => ({ color: DUCK_COLORS[Math.floor(Math.random() * 6)].id })

function welcome() {
  const fresh = freshLook()
  $app.innerHTML = `<main class="hero">
    <div class="hill hill-a" aria-hidden="true"></div><div class="hill hill-b" aria-hidden="true"></div>
    <span class="tag">מי מביא מה, תור מי</span>
    <h1>ברוכים הבאים לחצר</h1>
    <p class="lead">מנגל, ארוחת שישי, יום הולדת או מטלות הבית: כולם רואים מה חסר, לוקחים בלחיצה, ואף אחד לא שוכח.</p>
    ${demoParade()}
    <form class="panel" id="f" novalidate>${duckForm(fresh, { compact: true })}<p class="err" id="err" role="alert"></p>
<p class="small muted" style="margin:12px 0 0">בהמשך מסכימים ל<button type="button" class="link-btn" data-privacy style="min-height:auto;padding:0;font-size:13px">מדיניות הפרטיות ותנאי השימוש</button>.</p>
      <button class="btn btn-primary btn-wide" type="submit" style="margin-top:12px">יאללה, לחצר! 🦆</button></form>
    <button type="button" class="link-btn" id="signin" style="font-weight:700">כבר יש לי ברווזון</button>
    <button type="button" class="link-btn" id="paste">יש לי קישור הזמנה</button>
    <p class="fine">בלי הרשמה, בלי מספר טלפון. הכל מוצפן בטלפון שלך.</p>
  </main>`
  const read = bindDuckForm($app, undefined, fresh)
  bindPrivacyLinks($app)
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const v = read()
    if (!identity.validName(v.nickname)) return ($app.querySelector('#err').textContent = 'שם באורך 2–20 תווים, בבקשה')
    if (!settings.voice) return ($app.querySelector('#err').textContent = VOICE_ERR)
    await act(async () => {
      await identity.saveProfile(v)
      db.persist()
      location.hash = '#/'
      await render()
    })
  }
  $app.querySelector('#paste').onclick = quickPaste
  $app.querySelector('#signin').onclick = () => signInSheet()
}

/** "כבר יש לי ברווזון": Face ID / fingerprint, or a save code. `after`: what to show once signed in. */
function signInSheet(after = null) {
  const pk = V.passkeysAvailable()
  openSheet(`<h2>כבר יש לי ברווזון 🐥</h2>
    <p class="lead">נכנסים בנגיעה, וכל החצרות חוזרות. בלי סיסמה ובלי מספר טלפון.</p>
    <div class="stack">
      ${pk ? `<button class="btn btn-primary" id="pk" type="button">כניסה עם ${V.passkeyName()}</button>` : ''}
    </div>
    <form id="signf" novalidate>
      <label class="lbl" for="scode">קוד שמירה</label>
      <input class="input" id="scode" dir="ltr" style="text-align:center;letter-spacing:1px" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX">
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-soft btn-wide" type="submit">כניסה עם קוד</button>
    </form>
    <div class="stack"><button class="link-btn" id="link" type="button">יש לי רק קישור הזמנה</button></div>
    <p class="fine">אין ${pk ? `${V.passkeyName()} שמור ואין ` : ''}קוד? אפשר להתחיל ברווזון חדש ולבקש קישור מחדש.</p>`, (root) => {
    const errEl = root.querySelector('#err')
    const done = async (profile) => {
      toast(`${g('ברוכה השבה', 'ברוך השב')}, ${profile.nickname} 🐥`)
      await closeSheet()
      if (after) after()
      else {
        location.hash = '#/'
        await render()
      }
    }
    const guard = async () => {
      const cur = identity.load()
      if (cur?.keys && (await Y.localYards()).length) return confirm('להחליף את הברווזון שבטלפון הזה בברווזון השמור?')
      return true
    }
    root.querySelector('#pk')?.addEventListener('click', async (e) => {
      if (!(await guard())) return
      const btn = e.currentTarget
      busy(btn, true, 'רגע…')
      errEl.textContent = ''
      try {
        await done(await V.signInPasskey())
      } catch (x) {
        if (x.code !== 'cancelled') errEl.textContent = errText(x)
      } finally {
        busy(btn, false)
      }
    })
    root.querySelector('#signf').onsubmit = async (e) => {
      e.preventDefault()
      if (!(await guard())) return
      const btn = e.currentTarget.querySelector('[type="submit"]')
      busy(btn, true, 'בודקת…')
      errEl.textContent = ''
      try {
        await done(await V.signInCode(root.querySelector('#scode').value))
      } catch (x) {
        errEl.textContent = errText(x)
      } finally {
        busy(btn, false)
      }
    }
    root.querySelector('#link').onclick = pasteSheet
  })
}

/** Saving the duckling: the card on "הברווזון שלי". */
function saveCard() {
  const list = V.saved()
  const pk = list.find((v) => v.kind === 'passkey')
  const code = list.find((v) => v.kind === 'code')
  const can = V.passkeysAvailable()
  const day = (iso) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' }).format(new Date(iso))
  if (!list.length) {
    return `<section class="turn-card" aria-label="שמירת הברווזון">
      <span class="big" style="font-size:22px;line-height:28px">שמירת הברווזון</span>
      <span class="note" style="font-size:15px;line-height:21px">אם הטלפון מתחלף או נמחק, נכנסים בנגיעה וכל החצרות חוזרות.${push.isIOS() && !push.standalone() ? ' כדאי גם לפני שמוסיפים למסך הבית.' : ''}</span>
      <div class="actions" style="flex-direction:column">
        ${can ? `<button class="done-btn" id="save-pk" type="button">שמירה עם ${V.passkeyName()}</button>` : ''}
        <button class="pass-btn" id="save-code" type="button">${can ? 'או קוד שמירה במקום' : 'קוד שמירה'}</button>
      </div></section>`
  }
  return `<section aria-label="שמירת הברווזון" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
    ${pk ? `<div class="row" style="background:var(--green-soft)"><span class="what" style="padding:0"><span class="t">${V.passkeyName()} ✓</span><span class="s">נשמר ב־${day(pk.at)}. אפשר להיכנס בנגיעה מכל מכשיר שלך.</span></span><button class="link-btn" data-unsave="passkey" type="button">הסרה</button></div>` : can ? `<button class="btn btn-soft" id="save-pk" type="button">גם שמירה עם ${V.passkeyName()}</button>` : ''}
    ${code ? `<div class="row" style="background:var(--green-soft)"><span class="what" style="padding:0"><span class="t">קוד שמירה ✓</span><span class="s">נוצר ב־${day(code.at)}. הקוד עצמו לא נשמר כאן.</span></span><button class="link-btn" data-unsave="code" type="button">הסרה</button></div>` : '<button class="btn btn-ghost" id="save-code" type="button">גם קוד שמירה (גיבוי)</button>'}
  </section>`
}
function bindSaveCard(root, rerender) {
  root.querySelector('#save-pk')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    busy(btn, true, 'רגע…')
    try {
      await V.savePasskey()
      toast(`הברווזון שמור עם ${V.passkeyName()} 🐥`)
      rerender()
    } catch (x) {
      if (x.code !== 'cancelled') toast(errText(x))
      busy(btn, false)
    }
  })
  root.querySelector('#save-code')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    busy(btn, true, 'רגע…')
    const code = await act(() => V.makeCode())
    busy(btn, false)
    if (code) codeSheet(code, rerender)
  })
  root.querySelectorAll('[data-unsave]').forEach((b) => (b.onclick = async () => {
    if (!confirm('להסיר את השמירה הזאת? אפשר לשמור שוב בכל רגע.')) return
    await V.remove(b.dataset.unsave)
    rerender()
  }))
}
function codeSheet(code, after) {
  openSheet(`<h2>קוד השמירה שלך</h2>
    <div class="invite-box" style="font-size:22px;letter-spacing:1px;text-align:center;font-family:var(--font-display);font-weight:600;color:var(--ink);white-space:nowrap;overflow-wrap:normal">${esc(code)}</div>
    <div class="stack"><button class="btn btn-soft" id="copy" type="button">העתקת הקוד</button></div>
    <p class="lead">${g('שמרי', 'שמור')} אותו בפתקים או במנהל הסיסמאות. מי שיש לו את הקוד נכנס בתור הברווזון שלך, אז לא שולחים אותו בצ׳אט. הוא לא יוצג שוב.</p>
    <div class="stack"><button class="btn btn-primary" id="ok" type="button">${g('שמרתי', 'שמרתי')}</button></div>`, (root) => {
    root.querySelector('#copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(code)
        toast('הקוד הועתק')
      } catch {
        toast('לא הצלחתי להעתיק. אפשר לצלם מסך')
      }
    }
    root.querySelector('#ok').onclick = async () => {
      await closeSheet()
      after?.()
    }
  })
}

// ---------- Age and privacy ----------

function bindPrivacyLinks(root) {
  root.querySelectorAll('[data-privacy]').forEach((b) => (b.onclick = (e) => {
    e.preventDefault()
    privacySheet()
  }))
}

function privacySheet() {
  openSheet(`<h2>פרטיות בחצר</h2>
    <p class="lead">בקצרה: אין חשבון, אין מספר טלפון ואין מייל, והשרת לא יכול לקרוא מה כותבים בחצר.</p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:14px;font-size:15px;line-height:22px">
      <p style="margin:0"><b>מה מוצפן בטלפון שלך לפני שהוא יוצא ממנו:</b> השמות, הרשימות, המטלות, ההצבעות, ההודעות, התמונות וטקסט ההתראות. רק מי שבחצר יכול לפתוח אותם.</p>
      <p style="margin:0"><b>מה השרת רואה:</b> מזהה אקראי לכל ברווזון (לא שם), לאילו חצרות הוא שייך, מתי נשלח משהו ובאיזה גודל, ואם הפעלת התראות, את הכתובת הטכנית לשליחה אליהן. אם קובעים שעה למטלה או תאריך למשימה: מתי לשלוח תזכורת ולמי (בלי מה, הטקסט מוצפן). הגנה מעומס שומרת מונה שעתי לפי תמצית מוצפנת של כתובת הרשת, שמתחלפת כל יום.</p>
      <p style="margin:0"><b>מה אין:</b> פרסומות, מעקב, אנליטיקס, מכירת מידע, או חיפוש אנשים. נכנסים לחצר רק עם קישור.</p>
      <p style="margin:0"><b>שמירת הברווזון</b> (רשות): נשמר עותק מוצפן, שרק ה־Face ID או קוד השמירה שלך פותחים.</p>
      <p style="margin:0"><b>מחיקה:</b> עוזבים חצר מהתפריט שלה; מי שמנהלת חצר יכולה למחוק אותה לכולם, וזה מוחק גם את התמונות. שמירות מוסרים במסך "הברווזון שלי".</p>
      <p style="margin:0"><b>גיל:</b> מגיל 13. החצר היא פרויקט בבטא, לחברים. אם משהו לא נעים, מדווחים לאמא ברווזה מההודעה או מהתמונה.</p>
      <p style="margin:0"><b>שרתים:</b> Cloudflare, באירופה.</p>
    </div>
    <div class="stack"><button class="btn btn-soft" id="ok" type="button">הבנתי</button></div>`, (root) => {
    root.querySelector('#ok').onclick = closeSheet
  })
}

/** Once, for ducklings made before the app asked: how to address you. */
function askVoice() {
  if (settings.voice || settings.askedVoice || !identity.load()?.keys) return
  settings = { ...settings, askedVoice: true }
  db.saveSettings(settings)
  openSheet(`<h2>איך לפנות? 🙂</h2>
    <p class="lead">ככה האפליקציה תכתוב לך, וככה הברווזונים בחצר יראו אותך ("מאיה מביאה", "דני מביא").</p>
    <div class="stack"><button class="btn btn-soft" data-v="f" type="button">אני אישה</button><button class="btn btn-soft" data-v="m" type="button">אני גבר</button>
      <button class="link-btn" data-v="" type="button">אחר כך</button></div>`, (root) => {
    root.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.v) {
        settings = { ...settings, voice: b.dataset.v }
        db.saveSettings(settings)
        Y.refreshAll().catch(() => undefined) // the yards learn it with the profile
      }
      await closeSheet()
      render(true)
    }))
  })
}

// ---------- What waits for me ----------

const ATT = {
  chat: (n) => `💬 ${n === 1 ? 'הודעה' : `${n} הודעות`}`,
  chore: () => '⏰ תורך',
  task: () => '📌 משימה בשבילך',
  poll: () => '📊 הצבעה',
  item: () => '🆕 חדש ברשימה',
  report: (n) => `🚩 ${n === 1 ? 'דיווח' : `${n} דיווחים`}`,
}
/** "💬 2 הודעות · 📊 הצבעה": one chip per kind, in the order above. */
function attIcons(att) {
  const by = new Map()
  for (const x of att) by.set(x.kind, (by.get(x.kind) || 0) + x.n)
  return Object.keys(ATT).filter((k) => by.has(k)).map((k) => `<span class="att-chip">${ATT[k](by.get(k))}</span>`).join('')
}

// ---------- Home: my yards ----------

async function homeScreen() {
  const recs = await Y.localYards()
  const myId = me()
  const cards = recs.map((rec) => {
    const st = Y.stateOf(rec)
    const roles = Y.rolesOf(rec)
    let meta
    let bar = ''
    let alert = 0
    if (st.meta.kind === 'home') {
      const h = Y.homeBoard(st, myId, roles)
      alert = h.myTurn.length
      meta = `${count(rec.members?.length || 1, 'ברווזון אחד', 'ברווזונים')}${h.myTurn.length ? ` · <b>תורך: ${esc(h.myTurn[0].name)}</b>` : ''}`
    } else {
      const b = Y.eventBoard(st, myId)
      meta = [whenText(st.meta.when), b.total ? `${b.taken} מתוך ${b.total} נלקחו` : 'הרשימה עוד ריקה'].filter(Boolean).map(esc).join(' · ')
      if (b.total) bar = `<span class="bar" aria-hidden="true"><span style="width:${Math.round((b.taken / b.total) * 100)}%"></span></span>`
    }
    const att = Y.attention(rec, st, myId, roles)
    const waits = Y.attentionCount(att)
    if (!waits) push.closeShown(rec.id) // nothing waits here any more: its notifications on the lock screen go too
    const last = rec.events.at(-1)?.at || ''
    return { last, waits, alert, html: `<a class="yard-card" href="#/y/${rec.id}">
      <span class="tile ${st.meta.kind}" aria-hidden="true">${esc(st.meta.emoji)}</span>
      <span class="body"><span class="name">${esc(st.meta.name)}</span><span class="meta">${meta}</span>${att.length ? `<span class="att">${attIcons(att)}</span>` : ''}${bar}</span>
      ${waits ? `<span class="badge" aria-label="${count(waits, 'דבר אחד מחכה לך', 'דברים מחכים לך')}">${waits > 99 ? '99+' : waits}</span>` : ''}</a>` }
  }).sort((a, b) => (a.last < b.last ? 1 : -1))
  const waiting = cards.reduce((n, c) => n + c.alert, 0)
  const ag = await agenda()
  const soon = [...ag.late, ...ag.today]
  const todayCard = soon.length ? `<section class="poll" aria-label="היום שלך" style="margin-top:14px">
    <div class="q" style="display:flex;align-items:center;gap:8px"><span style="flex:1">היום שלך</span><a class="link-btn" href="#/today" style="font-size:15px">כל הלו״ז</a></div>
    <ul class="list" style="margin-top:4px">${soon.slice(0, 3).map((x) => agendaRow(x)).join('')}</ul>
    ${soon.length > 3 ? `<p class="small muted" style="margin:8px 0 0">ועוד ${soon.length - 3}</p>` : ''}</section>` : ''
  push.setBadge(cards.reduce((n, c) => n + c.waits, 0))
  const p = identity.profile()
  if (!p) return welcome() // the duckling went away while this screen was loading (signed out, storage cleared)
  const showSave = recs.length > 0 && !V.saved().length && !settings.hideSave
  const showInstall = !showSave && !push.standalone() && !settings.hideInstall && recs.length > 0
  $app.innerHTML = `<main class="screen">
    ${navigator.onLine ? '' : offlineLine()}
    <header class="top"><h1>החצרות שלי</h1><a class="icon-btn" href="#/today" aria-label="היום שלי">${ICON.cal}</a><a class="me-btn" href="#/me" aria-label="הברווזון שלי">${duck(p, 48)}</a></header>
    <p class="lead">שלום ${esc(p?.nickname)} 🦆${waiting ? ` יש ${count(waiting, 'דבר אחד', 'דברים')} ${waiting === 1 ? 'שמחכה' : 'שמחכים'} לך` : ''}</p>
    ${todayCard}
    ${cards.length ? `<div class="cards">${cards.map((c) => c.html).join('')}</div>` : `
      <div class="empty">${demoParade()}<b>עוד אין חצרות</b><span>${g('פתחי', 'פתח')} חצר ו${g('הזמיני', 'הזמן')} את החבר׳ה, או ${g('בקשי', 'בקש')} קישור ממי שמארגנ/ת.</span></div>`}
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:22px">
      <div class="new-row"><button class="btn btn-soft" data-new="event" type="button">🔥 אירוע חדש</button><button class="btn btn-soft" data-new="home" type="button">🏡 חצר לבית</button></div>
      <button class="link-btn" id="paste" type="button">יש לי קישור הזמנה</button>
    </div>
    ${showSave ? `<div class="nudge" style="margin-top:22px"><span style="flex:1"><b>${g('שמרי', 'שמור')} את הברווזון</b>, כדי לא לאבד את החצרות אם הטלפון מתחלף.</span><a class="pill soft" href="#/me" style="display:inline-flex;align-items:center;text-decoration:none">${g('לשמירה', 'לשמירה')}</a></div>` : ''}
    ${showInstall ? `<div class="nudge" style="margin-top:22px"><span style="flex:1">רוצה לדעת כשתורך? ${g('הוסיפי', 'הוסף')} את החצר למסך הבית.</span><button class="pill soft" id="install" type="button">איך?</button></div>` : ''}
  </main>`
  $app.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => newYardSheet({ kind: b.dataset.new })))
  $app.querySelector('#paste').onclick = quickPaste
  $app.querySelector('#install')?.addEventListener('click', installSheet)
}

// ---------- New yard ----------

const TEMPLATES = {
  bbq: { label: 'מנגל', emoji: '🔥', items: ['פחמים ומנגל', 'בשר ועוף', 'פיתות', 'חומוס', 'סלטים', 'שתייה קלה', 'בירות', 'קרח', 'קינוח', 'צלחות, כוסות ומפיות'] },
  friday: { label: 'ארוחת שישי', emoji: '🍷', items: ['חלות', 'יין', 'סלט', 'מנה עיקרית', 'תוספת', 'קינוח', 'פירות'] },
  birthday: { label: 'יום הולדת', emoji: '🎂', items: ['עוגה', 'נרות', 'בלונים', 'שתייה', 'חטיפים', 'צלחות ומפיות', 'מתנה משותפת'] },
  picnic: { label: 'פיקניק', emoji: '🧺', items: ['שמיכה', 'סנדוויצ׳ים', 'פירות', 'שתייה', 'צידנית וקרח', 'משחק', 'שקיות זבל'] },
  none: { label: 'רשימה ריקה', emoji: '🎉', items: [] },
}
// Ideas for chores in turns. `on`: picked by default in a new home yard; `pet`: only shown to people with that pet
// ('any' = any pet).
const CHORE_STARTERS = [
  { name: 'שטיפת כלים', emoji: '🫧', every: 'day', on: true },
  { name: 'להוריד את הזבל', emoji: '🗑️', every: '2days', on: true },
  { name: 'ניקיון סלון', emoji: '🧹', every: 'week', on: true },
  { name: 'ניקיון שירותים ואמבטיה', emoji: '🛁', every: 'week' },
  { name: 'שטיפת רצפה', emoji: '🧽', every: 'week' },
  { name: 'שאיבת אבק', emoji: '🌀', every: 'week' },
  { name: 'ניקוי המטבח (משטחים וכיריים)', emoji: '🍽️', every: '2days' },
  { name: 'בישול ארוחת ערב', emoji: '🍳', every: 'day' },
  { name: 'קניות לבית', emoji: '🛒', every: 'week' },
  { name: 'כביסה', emoji: '🧺', every: 'week' },
  { name: 'קיפול וסידור כביסה', emoji: '👕', every: 'week' },
  { name: 'החלפת מצעים', emoji: '🛏️', every: '2weeks' },
  { name: 'ניקוי חלונות', emoji: '🪟', every: 'month' },
  { name: 'ניקוי המקרר', emoji: '🧊', every: 'month' },
  { name: 'השקיית עציצים', emoji: '🪴', every: 'week' },
  { name: 'טיול עם הכלב', emoji: '🐕', every: 'day', pet: 'dog' },
  { name: 'ניקוי ארגז החול', emoji: '🐈', every: '2days', pet: 'cat' },
  { name: 'האכלת בעלי החיים', emoji: '🦴', every: 'day', pet: 'any' },
  { name: 'מים טריים לחיות', emoji: '💧', every: 'day', pet: 'any' },
]
/** The ideas this person should see: pet chores only with a matching pet. */
const choreIdeas = () => CHORE_STARTERS.filter((c) => !c.pet || (hasPet() && (c.pet === 'any' || c.pet === settings.pet || settings.pet === 'other')))
/** The chore ideas as chips; `picked` keeps what was already chosen (by index), new pet chores come pre-picked. */
const choreChips = (picked = null) => choreIdeas().map((c) => {
  const i = CHORE_STARTERS.indexOf(c)
  const on = picked ? picked.has(String(i)) || (!!c.pet && !!c.on) : !!c.on
  return `<button type="button" class="choice" data-chore="${i}" aria-pressed="${on}">${c.emoji} ${c.name}</button>`
}).join('')
const everyOptions = (sel = 'week') => Object.entries(Y.EVERY).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v.label}</option>`).join('')
const EVENT_EMOJI = ['🔥', '🎂', '🍷', '🧺', '🎉', '🏖️', '🎄', '🥳']
const HOME_EMOJI = ['🏡', '🏠', '🛋️', '🧹', '🪴', '🐕']

/** `start`: { kind } opens with that kind picked; { again: true, kind, name, emoji, items } is "one more like this". */
function newYardSheet(start = {}) {
  const prefill = start.again ? start : null
  let kind = null
  openSheet(`<h2>חצר חדשה</h2><p class="lead">מה מארגנים?</p>
    <div class="kind-cards" style="margin-top:14px">
      <button type="button" class="kind" data-kind="event" aria-pressed="false"><span class="k-emo" aria-hidden="true">🔥</span><span class="k-t">אירוע</span><span class="k-s">מנגל, שישי, יום הולדת: מי מביא מה</span></button>
      <button type="button" class="kind" data-kind="home" aria-pressed="false"><span class="k-emo" aria-hidden="true">🏡</span><span class="k-t">הבית</span><span class="k-s">מטלות בתורות, משימות וקניות</span></button>
    </div>
    <form id="details" hidden novalidate></form>`, (root) => {
    const form = root.querySelector('#details')
    if (start.kind) setTimeout(() => root.querySelector(`[data-kind="${start.kind}"]`)?.click())
    root.querySelectorAll('.kind').forEach((b) => (b.onclick = () => {
      kind = b.dataset.kind
      root.querySelectorAll('.kind').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      form.hidden = false
      form.innerHTML = kind === 'event' ? `
        <span class="lbl" id="tpl-l">רשימה מוכנה</span>
        <div class="choices" role="group" aria-labelledby="tpl-l">${Object.entries(TEMPLATES).map(([k, t], i) => `<button type="button" class="choice" data-tpl="${k}" aria-pressed="${i === 0}">${t.emoji} ${t.label}</button>`).join('')}</div>
        <label class="lbl" for="yname">איך קוראים לאירוע?</label>
        <input class="input" id="yname" maxlength="30" placeholder="למשל: מנגל שישי אצל הילה">
        <label class="lbl" for="when">מתי? (לא חובה)</label>
        <input class="input" id="when" type="datetime-local">
        <label class="lbl" for="where">איפה? (לא חובה)</label>
        <input class="input" id="where" maxlength="60" placeholder="למשל: רמת גן">
        <span class="lbl" id="emo-l">אימוג׳י</span>
        <div class="choices" role="group" aria-labelledby="emo-l">${EVENT_EMOJI.map((e, i) => `<button type="button" class="choice" data-emo="${e}" aria-pressed="${i === 0}" aria-label="${e}">${e}</button>`).join('')}</div>
        <label class="lbl" for="citem">עוד משהו לרשימה? (אפשר גם אחר כך)</label>
        <div class="add-row" style="margin-top:0"><input class="input" id="citem" maxlength="60" placeholder="למשל: קרח, מחצלות" autocomplete="off" enterkeyhint="done">
          <button class="add-btn" id="citem-add" type="button" aria-label="הוספה לרשימה">${ICON.plus}</button></div>
        <div class="choices" id="citems" style="margin-top:8px"></div>`
        : `
        <label class="lbl" for="yname">איך קוראים לחצר?</label>
        <input class="input" id="yname" maxlength="30" placeholder="למשל: הדירה בפלורנטין">
        <span class="lbl" id="pet-l">יש בעל חיים בבית?</span>
        <div class="choices" role="group" aria-labelledby="pet-l">${PETS.map((x) => `<button type="button" class="choice" data-pet="${x.id}" aria-pressed="${(settings.pet || 'none') === x.id}">${x.label}</button>`).join('')}</div>
        <span class="lbl" id="ch-l">מטלות בתורות (בוחרים כמה שרוצים, אפשר לשנות אחר כך)</span>
        <div class="choices" role="group" aria-labelledby="ch-l" id="chorelist">${choreChips()}</div>
        <label class="lbl" for="cchore">מטלה משלך</label>
        <div class="add-row" style="margin-top:0"><input class="input" id="cchore" maxlength="40" placeholder="למשל: להאכיל את הדגים" autocomplete="off" enterkeyhint="done">
          <label class="sr" for="cevery">כל כמה זמן</label><select class="input" id="cevery" style="flex:0 0 auto;width:auto;padding:0 10px">${everyOptions('week')}</select>
          <button class="add-btn" id="cchore-add" type="button" aria-label="הוספת מטלה">${ICON.plus}</button></div>
        <div class="choices" id="cchores" style="margin-top:8px"></div>
        <span class="lbl" id="emo-l">אימוג׳י</span>
        <div class="choices" role="group" aria-labelledby="emo-l">${HOME_EMOJI.map((e, i) => `<button type="button" class="choice" data-emo="${e}" aria-pressed="${i === 0}" aria-label="${e}">${e}</button>`).join('')}</div>`
      form.insertAdjacentHTML('beforeend', '<p class="err" id="err" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">פותחים חצר! 🐥</button>')
      if (prefill) root.querySelector('h2').textContent = 'עוד אחד כזה 🔁'
      else root.querySelector('h2').textContent = kind === 'event' ? 'אירוע חדש 🔥' : 'חצר לבית 🏡'
      const single = (sel) => form.querySelectorAll(sel).forEach((x) => (x.onclick = () => form.querySelectorAll(sel).forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
      single('[data-tpl]')
      single('[data-emo]')
      form.querySelectorAll('[data-tpl]').forEach((x) => x.addEventListener('click', () => {
        const t = TEMPLATES[x.dataset.tpl]
        const em = form.querySelector(`[data-emo="${t.emoji}"]`)
        if (em) form.querySelectorAll('[data-emo]').forEach((y) => y.setAttribute('aria-pressed', String(y === em)))
      }))
      const bindChores = () => form.querySelectorAll('[data-chore]').forEach((x) => (x.onclick = () => x.setAttribute('aria-pressed', String(x.getAttribute('aria-pressed') !== 'true'))))
      bindChores()
      form.querySelectorAll('[data-pet]').forEach((b) => (b.onclick = () => {
        form.querySelectorAll('[data-pet]').forEach((y) => y.setAttribute('aria-pressed', String(y === b)))
        settings = { ...settings, pet: b.dataset.pet }
        db.saveSettings(settings)
        const picked = new Set([...form.querySelectorAll('[data-chore][aria-pressed="true"]')].map((x) => x.dataset.chore))
        form.querySelector('#chorelist').innerHTML = choreChips(picked)
        bindChores()
      }))
      // Own chores / items: each becomes a picked chip (tap to drop it). Enter adds instead of submitting.
      const addOwn = (inputSel, listSel, make) => {
        const input = form.querySelector(inputSel)
        if (!input) return
        const add = () => {
          const name = input.value.trim()
          if (name.length < 2) return input.focus()
          const chip = document.createElement('button')
          chip.type = 'button'
          chip.className = 'choice'
          chip.setAttribute('aria-pressed', 'true')
          const data = make(name)
          chip.dataset.own = JSON.stringify(data)
          chip.textContent = data.label
          chip.onclick = () => chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
          form.querySelector(listSel).append(chip)
          input.value = ''
          input.focus()
        }
        form.querySelector(`${inputSel}-add`).onclick = add
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }
      }
      // A pasted list in "עוד משהו לרשימה" becomes several chips.
      form.querySelector('#citem')?.addEventListener('paste', (e) => {
        const list = Y.splitList(e.clipboardData?.getData('text') || '')
        if (list.length < 2) return
        e.preventDefault()
        for (const n of list) {
          form.querySelector('#citem').value = n
          form.querySelector('#citem-add').click()
        }
      })
      addOwn('#cchore', '#cchores', (name) => {
        const every = form.querySelector('#cevery').value
        return { kind: 'chore', name, every, label: `✨ ${name} · ${Y.EVERY[every].label}` }
      })
      addOwn('#citem', '#citems', (name) => ({ kind: 'item', name, label: name }))
      form.querySelector('#yname').focus()
      if (prefill && kind === prefill.kind) {
        form.querySelector('[data-tpl="none"]')?.click()
        form.querySelector('#yname').value = prefill.name || ''
        form.querySelector(`[data-emo="${prefill.emoji}"]`)?.click()
        for (const n of prefill.items || []) {
          form.querySelector('#citem').value = n
          form.querySelector('#citem-add').click()
        }
        form.querySelector('#when')?.focus()
      }
    }))
    form.onsubmit = async (e) => {
      e.preventDefault()
      const name = form.querySelector('#yname').value.trim()
      if (name.length < 2) return (form.querySelector('#err').textContent = 'צריך שם לחצר (לפחות 2 תווים)')
      const emoji = form.querySelector('[data-emo][aria-pressed="true"]')?.dataset.emo || (kind === 'home' ? '🏡' : '🎉')
      let meta
      let starters
      if (kind === 'event') {
        const when = form.querySelector('#when').value
        meta = { name, emoji, kind, when: when || null, where: form.querySelector('#where').value.trim() }
        const tpl = TEMPLATES[form.querySelector('[data-tpl][aria-pressed="true"]')?.dataset.tpl || 'none']
        const own = [...form.querySelectorAll('[data-own][aria-pressed="true"]')].map((x) => JSON.parse(x.dataset.own).name)
        starters = [...tpl.items, ...own].map((n) => ({ t: 'item.put', id: Y.newId('t'), ...Y.parseItem(n) }))
      } else {
        meta = { name, emoji, kind }
        starters = [...form.querySelectorAll('[data-chore][aria-pressed="true"]')].map((x) => {
          const { name, emoji, every } = CHORE_STARTERS[Number(x.dataset.chore)]
          return { t: 'chore.put', id: Y.newId('c'), name, emoji, every, everyone: true }
        })
        for (const x of form.querySelectorAll('[data-own][aria-pressed="true"]')) {
          const o = JSON.parse(x.dataset.own)
          starters.push({ t: 'chore.put', id: Y.newId('c'), name: o.name, emoji: '✨', every: o.every, everyone: true })
        }
      }
      const btn = form.querySelector('[type="submit"]')
      busy(btn, true, 'פותחת את החצר…')
      const id = await act(() => Y.createYard(meta, starters))
      busy(btn, false)
      if (!id) return
      await go(`#/y/${id}`)
      setTimeout(() => inviteSheet(id, true), 50)
    }
  })
}

// ---------- Join from an invite link ----------

async function joinScreen(code) {
  const hero = (inner) => {
    $app.innerHTML = `<main class="hero"><div class="hill hill-a" aria-hidden="true"></div><div class="hill hill-b" aria-hidden="true"></div>${inner}</main>`
  }
  if (!Y.parseInvite(code)) {
    hero(`<h1>הקישור לא שלם 🤔</h1><p class="lead">אולי הוא נחתך בהעתקה. ${g('בקשי', 'בקש')} אותו שוב ממי ${g('ששלחה', 'ששלח')}.</p><a class="btn btn-soft" style="margin-top:20px" href="#/">לחצרות שלי</a>`)
    return
  }
  hero(`<span class="tag">רגע…</span><h1>בודקת את ההזמנה</h1>${demoParade()}`)
  let peek
  try {
    peek = await Y.peekInvite(code)
  } catch (e) {
    const expired = e.code === 'expired'
    hero(`<h1>${expired ? 'הקישור פג 😕' : 'לא מצאתי את החצר 😕'}</h1>
      <p class="lead">${expired ? 'קישורים לחצר תקפים שבועיים, או שבוטלו.' : navigator.onLine ? 'אולי החצר נמחקה.' : 'אין רשת כרגע. נסו שוב כשיש.'} ${g('בקשי', 'בקש')} קישור חדש ממי שמארגנ/ת.</p>
      <a class="btn btn-soft" style="margin-top:20px" href="#/">לחצרות שלי</a>`)
    return
  }
  const local = await Y.localYard(peek.groupId)
  if (local && !local.removed && identity.load()?.keys) {
    location.replace(`#/y/${peek.groupId}`)
    return
  }
  const st = peek.state
  const opener = st.profiles.get(peek.opener)
  const ids = [...st.profiles.keys()]
  const others = ids.filter((m) => m !== peek.opener).slice(0, 4).map((m) => duck(st.profiles.get(m), 54 + Math.random() * 8))
  const ducks = [...others.reverse(), duck(opener || {}, 92, { crown: true })]
  let lead
  if (st.meta.kind === 'home') lead = `${count(peek.members, 'ברווזון אחד', 'ברווזונים')} · ${count(st.chores.size, 'מטלה אחת', 'מטלות')} בתורות`
  else {
    const b = Y.eventBoard(st, null)
    lead = [whenText(st.meta.when), st.meta.where, `${count(peek.members, 'ברווזון אחד כבר', 'ברווזונים כבר')} בחצר`, b.free.length ? `עוד ${count(b.free.length, 'דבר אחד', 'דברים')} שאף אחד לא לקח` : ''].filter(Boolean).map(esc).join(' · ')
  }
  const p = identity.profile()
  const fresh = freshLook()
  hero(`
    <span class="tag">${opener?.nickname ? `${esc(opener.nickname)} ${opener.voice === 'm' ? 'מזמין' : opener.voice === 'f' ? 'מזמינה' : 'מזמין/ה'} אותך לחצר` : 'הזמנה לחצר'}</span>
    <h1>${esc(st.meta.name)} ${esc(st.meta.emoji)}</h1>
    <p class="lead">${lead}</p>
    ${parade(ducks)}
    <form class="panel" id="f" novalidate>
      ${p ? `<div class="member">${duck(p, 48)}<span class="n">${g('תיכנסי', 'תיכנס')} בתור <b>${esc(p.nickname)}</b></span><a class="link-btn" href="#/me">שינוי</a></div>` : `${duckForm(fresh, { compact: true })}<p class="small muted" style="margin:12px 0 0">בהמשך מסכימים ל<button type="button" class="link-btn" data-privacy style="min-height:auto;padding:0;font-size:13px">מדיניות הפרטיות ותנאי השימוש</button>.</p><button class="link-btn" type="button" id="signin" style="margin-top:6px">כבר יש לי ברווזון? כניסה</button>`}
      ${peek.full ? '<p class="err">החצר מלאה (20 ברווזונים). אי אפשר להצטרף כרגע.</p>' : '<p class="err" id="err" role="alert"></p>'}
      <button class="btn btn-primary btn-wide" type="submit" ${peek.full ? 'disabled' : ''}>אני בחצר! 🦆</button>
    </form>
    <p class="fine">בלי הרשמה ובלי להתקין. אפשר להוסיף למסך הבית אחר כך, בשביל התראות.</p>
    ${push.isIOS() && !push.standalone() ? `<button class="link-btn" type="button" id="copyforapp" style="font-size:14px">כבר יש לך את החצר על מסך הבית? העתקת הקישור, והדבקה שם</button>` : ''}`)
  const read = p ? null : bindDuckForm($app, undefined, fresh)
  bindPrivacyLinks($app)
  $app.querySelector('#signin')?.addEventListener('click', () => signInSheet(() => joinScreen(code)))
  $app.querySelector('#copyforapp')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      toast('הועתק. פותחים את החצר מהמסך ולוחצים "הדבקת קישור"')
    } catch {
      toast('לא הצלחתי להעתיק. לחיצה ארוכה על שורת הכתובת')
    }
  })
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    if (read) {
      const v = read()
      if (!identity.validName(v.nickname)) return ($app.querySelector('#err').textContent = 'שם באורך 2–20 תווים, בבקשה')
      if (!settings.voice) return ($app.querySelector('#err').textContent = VOICE_ERR)
      await identity.saveProfile(v)
      db.persist()
    }
    const btn = $app.querySelector('[type="submit"]')
    busy(btn, true, 'נכנסת…')
    const id = await act(() => Y.joinInvite(code))
    busy(btn, false)
    if (!id) return
    location.replace(`#/y/${id}`)
    // Joined in the browser on a phone: next, the small guided step to get the app on the home screen.
    if (!push.standalone() && /iPhone|iPad|iPod|Android/.test(navigator.userAgent) && !settings.afterJoinShown) {
      settings = { ...settings, afterJoinShown: true }
      db.saveSettings(settings)
      setTimeout(() => installSheet({ joined: true }), 1200)
    }
  }
}

// ---------- A yard ----------

async function yardScreen(id) {
  let rec = await Y.localYard(id)
  if (!rec || rec.removed) {
    $app.innerHTML = '<main class="screen"><div class="empty"><b>טוענת את החצר…</b></div></main>'
    try {
      await Y.refresh(id)
      rec = await Y.localYard(id)
    } catch {
      $app.innerHTML = `<main class="screen"><div class="empty"><b>החצר לא נמצאה</b><span>אולי היא נמחקה, או שכבר לא בחצר.</span><a class="btn btn-soft" href="#/">לחצרות שלי</a></div></main>`
      return
    }
  }
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const myId = me()
  const isAdmin = roles.get(myId) === 'admin'
  const sub = st.meta.kind === 'event' ? [whenText(st.meta.when), st.meta.where].filter(Boolean).map(esc).join(' · ') : count(rec.members?.length || 1, 'ברווזון אחד', 'ברווזונים')
  const pending = rec.outbox?.length ? `<div class="offline">${count(rec.outbox.length, 'שינוי אחד מחכה', 'שינויים מחכים')} לרשת</div>` : ''
  const att = Y.attention(rec, st, myId, roles)
  const unreadChat = att.find((x) => x.kind === 'chat')?.n || 0
  const fresh = new Set(att.filter((x) => x.kind === 'item').map((x) => x.ref))
  const unvoted = new Set(att.filter((x) => x.kind === 'poll').map((x) => x.ref))
  const body = st.meta.kind === 'home' ? homeYardBody(rec, st, roles, myId) : eventYardBody(rec, st, myId, fresh)
  const polls = [...st.polls.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((p) => pollCard(rec, st, p, myId, isAdmin, unvoted.has(p.id))).join('')
  $app.innerHTML = `<main class="screen">
    ${navigator.onLine ? pending : offlineLine()}
    <header class="top">
      <a class="icon-btn" href="#/" aria-label="חזרה לחצרות">${ICON.back}</a>
      <h1>${esc(st.meta.name)} ${esc(st.meta.emoji)}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>
      <button class="icon-btn" id="menu" type="button" aria-label="אפשרויות החצר">${ICON.dots}</button>
    </header>
    ${isAdmin && Y.openReports(st).length ? `<div class="nudge" style="background:var(--tile-orange)"><span style="flex:1">🚩 ${count(Y.openReports(st).length, 'דיווח פתוח', 'דיווחים פתוחים')} בחצר</span><button class="pill soft" id="reports" type="button">לטפל</button></div>` : ''}
    ${bellHtml(rec, st, myId) || tipHtml(st.meta.kind)}
    ${body}
    ${polls}
    <div class="actions-bar">
      ${isAdmin || st.meta.open ? `<a class="chip-btn" href="#/y/${id}/team">👥 מי עושה מה</a>` : ''}
      ${st.meta.kind === 'event' ? '<button class="chip-btn" id="share" type="button">📤 לוואטסאפ</button>' : ''}
      <button class="chip-btn" id="invite" type="button">🐥 הזמנה</button>
      <button class="chip-btn" id="poll" type="button">📊 הצבעה</button>
      <a class="chip-btn" href="#/y/${id}/chat">💬 צ׳אט${unreadChat ? ` <span class="badge">${unreadChat}</span>` : ''}</a>
    </div>
  </main>`
  bindYard(rec, st, roles, myId)
  Y.markSeen(id) // what's new is seen now; the chat keeps its own "seen" until it is opened
  push.closeShown(id) // and this yard's notifications leave the lock screen
}

/** Members who took nothing yet (the admin can remind them). */
const idleMembers = (rec, st) => (rec.members || []).map((m) => m.id).filter((m) => ![...st.items.values()].some((i) => Y.takers(i).includes(m)))

const TIPS = {
  event: [
    ['e-item', 'לחיצה על שם של פריט: לשנות כמות, או לסמן שמביאים אותו כמה אנשים ביחד.'],
    ['e-qty', 'אפשר להוסיף כמה דברים בבת אחת ("קרח, מחצלות, נרות"), או עם כמות: "קולה x3".'],
    ['e-share', '📤 לוואטסאפ שולח לקבוצה סיכום של מי מביא מה, ומה עוד חסר.'],
  ],
  home: [
    ['h-chore', 'לחיצה על מטלה: לשנות כל כמה זמן, להוסיף שעה עם תזכורת, או לראות מי בתור.'],
    ['h-done', '"בוצע + הוכחה": אפשר לצרף תמונה, והתור עובר לבד לבא בתור.'],
    ['h-day', '📅 בדף הבית, "היום שלי" מרכז את כל מה שמחכה לך מכל החצרות.'],
  ],
}
function tipHtml(kind) {
  const t = (TIPS[kind] || []).find(([k]) => !(settings.tips || []).includes(k))
  return t ? `<div class="tip"><span aria-hidden="true">💡</span><span style="flex:1">${t[1]}</span><button class="link-btn" type="button" id="tipok" data-tip="${t[0]}">הבנתי</button></div>` : ''
}

/** A small hop of joy: my duckling jumps (and the phone buzzes, where it can). */
function celebrate(text = '') {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelector('.joy')?.remove()
  const el = document.createElement('div')
  el.className = 'joy'
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = `<span class="joy-duck">${duck(identity.profile() || {}, 96)}</span>${['✨', '🎉', '⭐', '💛', '✨'].map((x, i) => `<span class="joy-bit" style="--i:${i}">${x}</span>`).join('')}${text ? `<span class="joy-t">${esc(text)}</span>` : ''}`
  document.body.append(el)
  navigator.vibrate?.(25)
  setTimeout(() => el.remove(), 1300)
}

function eventYardBody(rec, st, myId, fresh = new Set()) {
  const b = Y.eventBoard(st, myId)
  const isAdmin = (rec.members || []).some((m) => m.id === myId && m.role === 'admin')
  const mother = duck(who(st, rec, (rec.members || []).find((m) => m.role === 'admin')?.id).look, 44, { crown: true })
  const idle = idleMembers(rec, st).filter((m) => m !== myId)
  const canNudge = isAdmin && b.free.length && idle.length
  const nudge = !b.total
    ? `<div class="nudge">${mother}<span>הרשימה ריקה. מה צריך להביא?</span></div>`
    : b.free.length
      ? `<div class="nudge">${mother}<span style="flex:1"><b>גאגא!</b> עוד ${count(b.free.length, 'דבר אחד', 'דברים')} שאף אחד לא לקח 👀</span>${canNudge ? `<button class="pill soft" id="nudgefree" type="button">🔔 להזכיר</button>` : ''}</div>`
      : '<div class="nudge party"><span>🎉</span><span><b>הכל נלקח!</b> החצר מוכנה.</span></div>'
  const row = (it) => {
    const qty = it.qty ? ` <span class="qty">×${esc(it.qty)}</span>` : ''
    const ts = Y.takers(it)
    const need = it.need || 1
    const mineHere = ts.includes(myId)
    let side = ''
    let cls = 'row'
    if (mineHere) cls += ' mine'
    if (fresh.has(it.id)) cls += ' fresh'
    const ducks = ts.length ? `<span class="who">${ts.slice(0, 3).map((m) => duckOf(st, rec, m)).join('')}${ts.length === 1 ? esc(who(st, rec, ts[0]).name) : ''}${!mineHere && Y.isFull(it) ? ' ✓' : ''}</span>` : ''
    if (!Y.isFull(it) && !mineHere) side = `<button class="pill claim" type="button" data-claim="${it.id}">${ts.length ? 'גם אני!' : g('אני מביאה!', 'אני מביא!')}</button>`
    const sub = need > 1 ? `<span class="s">${ts.map((m) => who(st, rec, m).name).join(' + ') || 'מביאים ביחד'} · ${ts.length}/${need}</span>` : ''
    return `<li class="${cls}"><button class="what" type="button" data-item="${it.id}"><span class="t">${fresh.has(it.id) ? '<span class="new-tag">חדש</span> ' : ''}${esc(it.name)}${qty}</span>${sub}</button>${need > 1 || !side ? ducks : ''}${side}</li>`
  }
  const mineStrip = b.mine.length ? `<div class="mine-strip"><span aria-hidden="true">🧺</span><span><b>${g('את מביאה', 'אתה מביא')}:</b> ${b.mine.map((i) => esc(i.name) + (i.qty ? ` ×${esc(i.qty)}` : '')).join(', ')}</span></div>` : ''
  return `${nudge}${mineStrip}
    ${b.total ? `<div class="progress"><span class="bar" aria-hidden="true"><span style="width:${Math.round((b.taken / b.total) * 100)}%"></span></span><span style="font-size:14px;font-weight:700">${b.taken} מתוך ${b.total}</span></div>` : ''}
    <ul class="list">${[...b.free, ...b.mine, ...b.others].map(row).join('')}</ul>
    <form class="add-row" id="add" novalidate><label class="sr" for="addin">פריט חדש</label>
      <input class="input" id="addin" maxlength="60" placeholder="מה עוד צריך? למשל: קולה x3" autocomplete="off" enterkeyhint="done">
      <button class="add-btn" type="submit" aria-label="הוספה">${ICON.plus}</button></form>`
}

function homeYardBody(rec, st, roles, myId) {
  const h = Y.homeBoard(st, myId, roles)
  const turnCards = h.myTurn.map((c) => {
    const order = Y.orderOf(c, roles)
    const next = Y.nextInOrder(order, c.turn, roles)
    const last = c.history.find((x) => x.kind === 'done')
    const lw = last && who(st, rec, last.by)
    const note = [last ? `${lw.name} ${last.by === myId ? g('עשית', 'עשית') : lw.g('עשתה', 'עשה')} את זה ${relDay(last.at)}` : '', next && next !== myId ? `${g('אחרייך', 'אחריך')}: ${who(st, rec, next).name}` : ''].filter(Boolean).join(', ')
    return `<section class="turn-card" aria-label="התור שלך">
      <span class="big">תורך! ${esc(c.emoji)}</span>
      <span class="what">${esc(c.name)} · ${dueText(c)}${c.time ? ` · ${c.time}` : ''}</span>
      ${note ? `<span class="note">${esc(note)}</span>` : ''}
      <div class="actions"><button class="done-btn" type="button" data-cdone="${c.id}">בוצע + הוכחה</button>${next && next !== myId ? `<button class="pass-btn" type="button" data-pass="${c.id}">להעביר ל${esc(who(st, rec, next).name)}</button>` : ''}</div>
    </section>`
  }).join('')
  const choreRow = (c) => {
    const mine = c.turn === myId
    const when = `${dueText(c)}${c.time ? ` · ${c.time}` : ''}`
    const s = mine ? `<span class="s ${c.due === 'soon' ? '' : 'warn'}">תורך · ${when}</span>` : `<span class="s">${esc(who(st, rec, c.turn).name)} · ${when}</span>`
    return `<li class="row${mine ? ' mine' : ''}"><span class="emo" aria-hidden="true">${esc(c.emoji)}</span><button class="what" type="button" data-chore="${c.id}"><span class="t">${esc(c.name)}</span>${s}</button>${mine ? '' : duckOf(st, rec, c.turn)}</li>`
  }
  const taskRow = (it) => {
    let s
    let side = ''
    if (!it.claimedBy) {
      s = '<span class="s warn">אף אחד לא לקח 👀</span>'
      side = `<button class="pill" type="button" data-claim="${it.id}">אני!</button>`
    } else if (it.claimedBy === myId) {
      s = `<span class="s">${g('את', 'אתה')} על זה</span>`
      side = `<button class="pill soft" type="button" data-tdone="${it.id}">בוצע</button>`
    } else s = `<span class="s">${esc(who(st, rec, it.claimedBy).name)} על זה</span>`
    if (it.due) s = s.replace('</span>', ` · ⏰ ${whenShort(Date.parse(it.due))}</span>`)
    return `<li class="row${it.claimedBy === myId ? ' mine' : ''}"><button class="what" type="button" data-item="${it.id}"><span class="t">${esc(it.name)}</span>${s}</button>${side}</li>`
  }
  const doneRow = (it) => `<li class="row done"><button class="what" type="button" data-item="${it.id}"><span class="t">${esc(it.name)}</span><span class="s ok">${esc(who(st, rec, it.doneBy).name)} · בוצע ${relDay(it.doneAt)} ✓</span></button>${it.photoId && !st.hidden.has(it.photoId) ? `<img class="thumb" alt="תמונת הוכחה" data-photo="${it.photoId}">` : ''}</li>`
  const wd = h.weekDuck
  return `${turnCards}
    <h2 class="section">מטלות בתורות</h2>
    ${h.chores.length ? `<ul class="list">${h.chores.map(choreRow).join('')}</ul>` : '<p class="muted">עוד אין מטלות קבועות.</p>'}
    <button class="chip-btn" id="newchore" type="button" style="margin-top:12px">${ICON.plus} מטלה קבועה</button>
    <h2 class="section">משימות</h2>
    ${h.open.length ? `<ul class="list">${h.open.map(taskRow).join('')}</ul>` : '<p class="muted">אין משימות פתוחות. איזה כיף.</p>'}
    <form class="add-row" id="add" novalidate><label class="sr" for="addin">משימה חדשה</label>
      <input class="input" id="addin" maxlength="60" placeholder="למשל: לקנות נייר טואלט" autocomplete="off" enterkeyhint="done">
      <button class="add-btn" type="submit" aria-label="הוספה">${ICON.plus}</button></form>
    ${h.done.length ? `<ul class="list">${h.done.map(doneRow).join('')}</ul>` : ''}
    ${wd ? `<section class="week" aria-label="ברווזון השבוע">${duck(who(st, rec, wd.member).look, 48)}<span><b>ברווזון השבוע: ${esc(who(st, rec, wd.member).name)}</b><br>${count(wd.n, 'משימה אחת', 'משימות')}, אפס תירוצים</span></section>` : ''}`
}

function relDay(iso) {
  if (!iso) return ''
  const d = new Date(iso).setHours(0, 0, 0, 0)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - d) / 86400e3)
  if (days <= 0) return 'היום'
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

function pollCard(rec, st, p, myId, isAdmin, unvoted = false) {
  const counts = Y.pollResults(p)
  const total = counts.reduce((a, b) => a + b, 0)
  const mine = p.votes.get(myId)
  const faces = (i) => [...p.votes].filter(([, o]) => o === i).slice(0, 4).map(([m]) => duckOf(st, rec, m, 22)).join('')
  return `<section class="poll" aria-label="הצבעה" data-poll="${esc(p.id)}">
    <div class="q">${unvoted ? '<span class="new-tag">עוד לא הצבעת</span> ' : ''}📊 ${esc(p.q)}${p.closed ? ' <span class="small muted">(נסגרה)</span>' : ''}</div>
    ${p.options.map((o, i) => `<button type="button" class="opt" data-vote="${p.id}" data-opt="${i}" aria-pressed="${mine === i}" ${p.closed ? 'disabled' : ''}>
      <span class="fill" style="width:${total ? Math.round((counts[i] / total) * 100) : 0}%"></span>
      <span class="ot">${esc(o)}</span><span class="faces">${faces(i)}</span><span class="on">${counts[i] || ''}</span></button>`).join('')}
    ${p.createdBy === myId || isAdmin ? `<button type="button" class="link-btn" data-pclose="${p.id}" data-on="${!p.closed}">${p.closed ? 'לפתוח מחדש' : 'לסגור את ההצבעה'}</button>` : ''}
  </section>`
}

function bindYard(rec, st, roles, myId) {
  const id = rec.id
  const $ = (s) => $app.querySelector(s)
  $('#menu').onclick = () => yardMenu(id)
  $('#share')?.addEventListener('click', () => summarySheet(id))
  $('#reports')?.addEventListener('click', () => reportsSheet(id))
  $('#invite').onclick = () => inviteSheet(id)
  $('#poll').onclick = () => pollSheet(id)
  $('#newchore')?.addEventListener('click', () => newChoreSheet(id))
  $('#nudgefree')?.addEventListener('click', (e) => nudgeFree(rec, st, e.currentTarget))
  $('#bellon')?.addEventListener('click', async () => {
    if (push.status() === 'needs-install') return installSheet()
    if (await turnPushOn()) render(true)
  })
  $('#bellx')?.addEventListener('click', () => {
    settings = { ...settings, bellHidden: { ...(settings.bellHidden || {}), [id]: Date.now() } }
    db.saveSettings(settings)
    $('.bell')?.remove()
  })
  $('#tipok')?.addEventListener('click', () => {
    settings = { ...settings, tips: [...(settings.tips || []), $('#tipok').dataset.tip] }
    db.saveSettings(settings)
    $('.tip')?.remove()
  })
  $app.querySelectorAll('[data-claim]').forEach((b) => (b.onclick = () => claim(id, b.dataset.claim, true, b)))
  $app.querySelectorAll('[data-item]').forEach((b) => (b.onclick = () => itemSheet(id, b.dataset.item)))
  $app.querySelectorAll('[data-chore]').forEach((b) => (b.onclick = () => choreSheet(id, b.dataset.chore)))
  $app.querySelectorAll('[data-cdone]').forEach((b) => (b.onclick = () => doneSheet(id, { chore: b.dataset.cdone })))
  $app.querySelectorAll('[data-tdone]').forEach((b) => (b.onclick = () => doneSheet(id, { item: b.dataset.tdone })))
  $app.querySelectorAll('[data-pass]').forEach((b) => (b.onclick = () => passTurn(id, b.dataset.pass)))
  $app.querySelectorAll('[data-vote]').forEach((b) => (b.onclick = () => vote(id, b.dataset.vote, Number(b.dataset.opt))))
  $app.querySelectorAll('[data-pclose]').forEach((b) => (b.onclick = () => act(async () => {
    await Y.post(id, [{ t: 'poll.close', id: b.dataset.pclose, on: b.dataset.on === 'true' }])
    await render(true)
  })))
  $app.querySelectorAll('img[data-photo]').forEach(async (img) => {
    await Y.ensurePhoto(id, img.dataset.photo).catch(() => undefined)
    const u = await photoUrl(img.dataset.photo)
    if (u) img.src = u
    else img.hidden = true
  })
  // A pasted list (one per line) becomes "a, b, c" in the one-line field, and then several items.
  $('#addin').addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || ''
    if (!/\n/.test(text.trim())) return
    e.preventDefault()
    $('#addin').value = Y.splitList(text).join(', ')
  })
  $('#add').onsubmit = async (e) => {
    e.preventDefault()
    const input = $('#addin')
    const names = Y.splitList(input.value)
    if (!names.length) return input.focus()
    if (names.length > 1) {
      const p = identity.profile()
      const evs = names.map((n) => ({ t: 'item.put', id: Y.newId('t'), ...(st.meta.kind === 'event' ? Y.parseItem(n) : { name: n }) }))
      input.value = ''
      await act(async () => {
        await Y.post(id, evs, { body: `${p.nickname}: הוספתי ${names.length} דברים: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` })
        await render(true)
        toast(`נוספו ${names.length}`, { label: 'בטל', run: () => act(async () => {
          await Y.post(id, evs.map((x) => ({ t: 'item.delete', id: x.id })))
          await render(true)
        }) })
      })
      return
    }
    const { name, qty } = st.meta.kind === 'event' ? Y.parseItem(names[0]) : { name: names[0], qty: '' }
    const itemId = Y.newId('t')
    const p = identity.profile()
    input.value = ''
    await act(async () => {
      await Y.post(id, [{ t: 'item.put', id: itemId, name, ...(qty ? { qty } : {}) }], st.meta.kind === 'event' ? { body: `${p.nickname}: הוספתי לרשימה ${name}`, go: `?item=${itemId}` } : { body: `${p.nickname}: משימה חדשה, ${name}`, go: `?item=${itemId}` })
      await render(true)
      $app.querySelector('#addin')?.focus()
      toast(`נוסף: ${name}`, { label: st.meta.kind === 'event' ? g('ואני מביאה', 'ואני מביא') : 'ואני על זה', run: () => claim(id, itemId, true) })
    })
  }
}

/** The admin reminds whoever took nothing yet (once in a few hours, so nobody gets nagged). */
async function nudgeFree(rec, st, btn) {
  const last = settings.nudged?.[rec.id] || 0
  if (Date.now() - last < 3 * 3600e3) return toast('כבר הזכרת לא מזמן. אפשר שוב בעוד כמה שעות')
  const idle = idleMembers(rec, st).filter((m) => m !== me())
  const free = Y.eventBoard(st, me()).free.map((i) => i.name)
  busy(btn, true)
  const ok = await act(async () => {
    await Y.post(rec.id, [{ t: 'yard.nudge' }], { body: `${identity.profile().nickname}: עוד חסר ${free.slice(0, 3).join(', ')}${free.length > 3 ? '…' : ''}. מי לוקח/ת? 🙏`, to: idle.slice(0, 30) })
    return true
  })
  busy(btn, false)
  if (!ok) return
  settings = { ...settings, nudged: { ...(settings.nudged || {}), [rec.id]: Date.now() } }
  db.saveSettings(settings)
  toast(`נשלחה תזכורת ל${count(idle.length, 'ברווזון אחד', 'ברווזונים')} 🔔`)
}

async function claim(id, itemId, on, btn) {
  busy(btn, true)
  await act(async () => {
    await Y.post(id, [{ t: 'item.claim', id: itemId, on }])
    const st = Y.stateOf(await Y.localYard(id))
    const it = st.items.get(itemId)
    if (on && it && !Y.takers(it).includes(me())) {
      const w = who(st, null, it.claimedBy)
      toast(`${w.name} ${w.g('הקדימה', 'הקדים')} אותך 🙈`)
    } else if (it) {
      toast(on ? `${it.name}: ${g('לקחת', 'לקחת')} ✓` : `${it.name}: שוחרר`, { label: 'בטל', run: () => claim(id, itemId, !on) })
      if (on) celebrate(Y.eventBoard(st, me()).free.length ? '' : '🎉 הכל נלקח!')
    }
  })
  await closeSheet()
  await render(true)
  if (on) {
    const st = Y.stateOf(await Y.localYard(id))
    const it = st.items.get(itemId)
    if (it && Y.takers(it).includes(me())) {
      const event = st.meta.kind === 'event'
      maybeAskPush({ why: event ? 'event' : 'task', cal: it.due ? () => itemCalendar(id, itemId) : event && st.meta.when ? () => calendarSheet(id) : null })
    }
  }
}

async function vote(id, pollId, opt) {
  const rec = await Y.localYard(id)
  const cur = Y.stateOf(rec).polls.get(pollId)?.votes.get(me())
  await act(() => Y.post(id, [{ t: 'poll.vote', id: pollId, opt: cur === opt ? null : opt }]))
  await render(true)
}

async function passTurn(id, choreId) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const c = st.chores.get(choreId)
  if (!c) return
  const next = Y.nextInOrder(Y.orderOf(c, roles), Y.turnOf(c, roles), roles)
  await act(() => Y.post(id, [{ t: 'chore.pass', id: choreId }], { body: `תורך! ${c.emoji} ${c.name} (העברה מ${identity.profile().nickname})`, to: [next], go: `?chore=${choreId}` }))
  toast(`העברת ל${who(st, rec, next).name}`, { label: 'בטל', run: () => act(async () => {
    await Y.post(id, [{ t: 'chore.undo', id: choreId }])
    await render(true)
  }) })
  await closeSheet()
  await render(true)
}

// ---------- Item / task sheet ----------

async function itemSheet(id, itemId) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const it = st.items.get(itemId)
  if (!it) return
  const myId = me()
  const isAdmin = Y.rolesOf(rec).get(myId) === 'admin'
  const canEdit = it.createdBy === myId || isAdmin
  const event = st.meta.kind === 'event'
  const ts = Y.takers(it)
  const need = it.need || 1
  const mine = ts.includes(myId)
  const status = it.done
    ? `${who(st, rec, it.doneBy).name} · בוצע ${relDay(it.doneAt)} ✓`
    : ts.length ? (() => {
      if (ts.length > 1) return `${ts.map((m) => who(st, rec, m).name).join(' + ')} מביאים`
      const w = who(st, rec, ts[0])
      return `${w.name} ${event ? (ts[0] === myId ? g('מביאה', 'מביא') : w.g('מביאה', 'מביא')) : 'על זה'}`
    })() + (need > ts.length ? ` · עוד מקום ל־${need - ts.length}` : '') : need > 1 ? `מביאים ביחד: צריך ${need}` : 'אף אחד לא לקח עדיין'
  const btns = []
  if (isAdmin && !it.done && (rec.members || []).length > 1) btns.push(`<button class="btn btn-ghost" data-a="assign">👉 ${it.claimedBy ? 'לתת למישהו אחר' : 'לשייך למישהו'}</button>`)
  if (!it.done && !mine && !Y.isFull(it)) btns.push(`<button class="btn btn-primary" data-a="claim">${ts.length ? 'גם אני!' : event ? g('אני מביאה!', 'אני מביא!') : 'אני על זה!'}</button>`)
  if (!event && !it.done && (it.claimedBy === myId || !it.claimedBy)) btns.push('<button class="btn btn-soft" data-a="done">בוצע + הוכחה</button>')
  if (!it.done && ts.length && (mine || isAdmin)) btns.push(`<button class="btn btn-ghost" data-a="unclaim">${mine ? 'בעצם לא אוכל' : 'לשחרר את הפריט'}</button>`)
  if (it.done && (it.doneBy === myId || isAdmin)) btns.push('<button class="btn btn-ghost" data-a="undone">לבטל את הסימון</button>')
  if (!it.done && it.due && (mine || !ts.length)) btns.push('<button class="btn btn-ghost" data-a="cal">📅 ליומן, עם תזכורת</button>')
  else if (event && mine && st.meta.when) btns.push('<button class="btn btn-ghost" data-a="evcal">📅 האירוע ליומן, עם מה שמביאים</button>')
  openSheet(`<h2>${esc(it.name)}${it.qty ? ` (${esc(it.qty)})` : ''}</h2>
    <p class="lead">${esc(status)}${it.due ? ` · ⏰ ${esc(whenShort(Date.parse(it.due)))}` : ''}</p>
    ${it.photoId && !st.hidden.has(it.photoId) ? `<img data-photo="${it.photoId}" alt="תמונת הוכחה" style="width:100%;border-radius:18px;margin-top:12px"><button class="link-btn" type="button" data-photoact="${it.photoId}">${isAdmin ? 'הסתרת התמונה מכולם' : 'דיווח על התמונה'}</button>` : ''}
    <div class="stack">${btns.join('')}</div>
    ${canEdit ? `<form id="edit" novalidate><label class="lbl" for="iname">שם</label><input class="input" id="iname" maxlength="60" value="${esc(it.name)}">
      <label class="lbl" for="iqty">כמה? (לא חובה)</label><input class="input" id="iqty" maxlength="20" value="${esc(it.qty || '')}" placeholder="למשל: 20, 2 קילו">
      ${event ? `<label class="lbl" for="ineed">כמה אנשים מביאים את זה?</label><select class="input" id="ineed">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === need ? ' selected' : ''}>${n === 1 ? 'אחד' : `${n}, ביחד`}</option>`).join('')}</select>` : ''}
      <label class="lbl" for="idue">מתי? (לא חובה: נשלח תזכורת בזמן)</label><input class="input" id="idue" type="datetime-local" value="${esc(it.due || '')}">
      <div class="stack"><button class="btn btn-soft" type="submit">שמירה</button><button class="btn btn-danger" type="button" data-a="delete">למחוק מהרשימה</button></div></form>` : ''}`, (root) => {
    root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a
      if (a === 'assign') return assignSheet(id, { item: itemId })
      if (a === 'cal') return itemCalendar(id, itemId)
      if (a === 'evcal') return calendarSheet(id)
      if (a === 'claim') return claim(id, itemId, true, b)
      if (a === 'unclaim') return claim(id, itemId, false, b)
      if (a === 'done') return doneSheet(id, { item: itemId })
      if (a === 'undone') await act(() => Y.post(id, [{ t: 'item.done', id: itemId, on: false }]))
      if (a === 'delete') {
        if (!confirm(`למחוק את "${it.name}"?`)) return
        await act(() => Y.post(id, [{ t: 'item.delete', id: itemId }]))
        toast(`נמחק: ${it.name}`, { label: 'בטל', run: () => act(async () => {
          await Y.post(id, [{ t: 'item.put', id: itemId, name: it.name, qty: it.qty || '', due: it.due || null, need }])
          await render(true)
        }) })
      }
      await closeSheet()
      await render(true)
    }))
    root.querySelector('[data-photoact]')?.addEventListener('click', () => photoAction(id, it.photoId, isAdmin))
    const img = root.querySelector('img[data-photo]')
    if (img) Y.ensurePhoto(id, it.photoId).catch(() => undefined).then(() => photoUrl(it.photoId)).then((u) => (u ? (img.src = u) : (img.hidden = true)))
    const form = root.querySelector('#edit')
    if (form) form.onsubmit = async (e) => {
      e.preventDefault()
      const name = form.querySelector('#iname').value.trim()
      if (!name) return
      await act(() => Y.post(id, [{ t: 'item.put', id: itemId, name, qty: form.querySelector('#iqty').value.trim(), due: form.querySelector('#idue').value || null, need: Number(form.querySelector('#ineed')?.value || need) }]))
      await closeSheet()
      await render(true)
    }
  })
}

// ---------- Chores ----------

async function choreSheet(id, choreId) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const c = st.chores.get(choreId)
  if (!c) return
  const myId = me()
  const turn = Y.turnOf(c, roles)
  const order = Y.orderOf(c, roles).filter((m) => !roles.size || roles.has(m))
  const canEdit = c.createdBy === myId || roles.get(myId) === 'admin'
  const hist = c.history.slice(0, 6).map((h) => `<li>${duckOf(st, rec, h.by, 22)}<span style="flex:1">${esc(who(st, rec, h.by).name)} · ${h.kind === 'pass' ? who(st, rec, h.by).g('העבירה את התור', 'העביר את התור') : h.kind === 'assign' ? `${who(st, rec, h.by).g('נתנה', 'נתן')} את התור ל${esc(who(st, rec, h.to).name)}` : 'בוצע'} ${relDay(h.at)}</span>${h.photoId && !st.hidden.has(h.photoId) ? `<img data-photo="${h.photoId}" alt="תמונת הוכחה"><button class="link-btn" type="button" data-photoact="${h.photoId}" style="padding:0 4px">${roles.get(myId) === 'admin' ? 'הסתרה' : 'דיווח'}</button>` : ''}</li>`).join('')
  openSheet(`<h2>${esc(c.emoji)} ${esc(c.name)}</h2>
    <p class="lead">${esc(Y.EVERY[c.every].label)}${c.time ? ` · בשעה ${c.time}` : ''} · ${c.everyone ? 'כל החצר בסבב' : count(order.length, 'ברווזון אחד בסבב', 'ברווזונים בסבב')}</p>
    <span class="lbl">התור</span>
    <div style="display:flex;flex-wrap:wrap;gap:10px">${order.map((m) => `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:13px;${m === turn ? 'font-weight:700' : 'opacity:.75'}">${duckOf(st, rec, m, m === turn ? 44 : 34)}${esc(who(st, rec, m).name)}${m === turn ? ' ⬅' : ''}</span>`).join('')}</div>
    <div class="stack"><button class="btn btn-primary" data-a="done">בוצע + הוכחה</button>${turn === myId && order.length > 1 ? `<button class="btn btn-ghost" data-a="pass">להעביר ל${esc(who(st, rec, Y.nextInOrder(order, turn, roles)).name)}</button>` : ''}${turn === myId ? `<button class="btn btn-ghost" data-a="cal">📅 ${order.length === 1 ? 'ליומן (חוזר), עם תזכורת' : 'התור שלי ליומן, עם תזכורת'}</button>` : ''}</div>
    ${hist ? `<span class="lbl">מה היה</span><ul class="history">${hist}</ul>` : ''}
    ${roles.get(myId) === 'admin' && (rec.members || []).length > 1 ? '<div class="stack"><button class="btn btn-soft" data-a="assign">👉 לתת את התור הזה למישהו אחר</button></div>' : ''}
    ${canEdit ? '<div class="stack"><button class="btn btn-ghost" data-a="edit">✏️ עריכת המטלה</button><button class="btn btn-danger" data-a="delete">למחוק את המטלה</button></div>' : ''}`, (root) => {
    root.querySelector('[data-a="done"]').onclick = () => doneSheet(id, { chore: choreId })
    root.querySelector('[data-a="assign"]')?.addEventListener('click', () => assignSheet(id, { chore: choreId }))
    root.querySelector('[data-a="edit"]')?.addEventListener('click', () => newChoreSheet(id, choreId))
    root.querySelector('[data-a="pass"]')?.addEventListener('click', () => passTurn(id, choreId))
    root.querySelector('[data-a="cal"]')?.addEventListener('click', () => choreCalendar(id, choreId))
    root.querySelector('[data-a="delete"]')?.addEventListener('click', async () => {
      if (!confirm(`למחוק את "${c.name}"?`)) return
      await act(() => Y.post(id, [{ t: 'chore.delete', id: choreId }]))
      await closeSheet()
      await render(true)
    })
    root.querySelectorAll('[data-photoact]').forEach((b) => (b.onclick = () => photoAction(id, b.dataset.photoact, roles.get(myId) === 'admin')))
    root.querySelectorAll('img[data-photo]').forEach(async (img) => {
      await Y.ensurePhoto(id, img.dataset.photo).catch(() => undefined)
      const u = await photoUrl(img.dataset.photo)
      if (u) img.src = u
      else img.hidden = true
    })
  })
}

// ---------- Reports (to whoever runs the yard) ----------

const adminsOf = (rec) => (rec.members || []).filter((m) => m.role === 'admin').map((m) => m.id)

/** Sends a report; the admins get a push that says only that there is one (the content stays in the yard). */
async function report(id, what) {
  const reason = prompt('מה לא בסדר? (לא חובה)') ?? null
  if (reason === null) return false
  const rec = await Y.localYard(id)
  const ok = await act(() => Y.post(id, [{ t: 'report.put', rid: Y.newId('r'), ...what, reason: reason.trim().slice(0, 200) }], { body: '🚩 יש דיווח חדש בחצר', go: '?reports=1', to: adminsOf(rec).filter((m) => m !== me()) }))
  if (ok !== undefined) toast('הדיווח נשלח לאמא ברווזה. תודה 💛')
  return true
}

async function photoAction(id, photoId, isAdmin) {
  if (isAdmin) {
    if (!confirm('להסתיר את התמונה מכל החצר?')) return
    await act(() => Y.post(id, [{ t: 'photo.hide', photoId }]))
  } else if (!(await report(id, { photoId }))) return
  await closeSheet()
  await render(true)
}

async function messageSheet(id, cid) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const c = st.chat.find((x) => x.cid === cid)
  if (!c) return
  const mine = c.author === me()
  const isAdmin = Y.rolesOf(rec).get(me()) === 'admin'
  openSheet(`<h2>הודעה של ${esc(who(st, rec, c.author).name)}</h2>
    <div class="bubble" style="margin-top:8px">${esc(c.text)}</div>
    <div class="stack">
      ${mine || isAdmin ? '<button class="btn btn-danger" id="del" type="button">מחיקת ההודעה</button>' : ''}
      ${mine ? '' : '<button class="btn btn-ghost" id="rep" type="button">🚩 דיווח לאמא ברווזה</button>'}
    </div>`, (root) => {
    root.querySelector('#del')?.addEventListener('click', async () => {
      if (!confirm('למחוק את ההודעה?')) return
      await act(() => Y.post(id, [{ t: 'comment.delete', cid }]))
      await closeSheet()
      await render(true)
    })
    root.querySelector('#rep')?.addEventListener('click', async () => {
      if (await report(id, { cid })) await closeSheet()
    })
  })
}

/** The admin's list of open reports: delete / hide, or dismiss. */
async function reportsSheet(id) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const list = Y.openReports(st)
  openSheet(`<h2>🚩 דיווחים</h2>
    <p class="lead">רק מי שמנהלת את החצר רואה את זה.</p>
    ${list.map((r) => {
      const msg = r.cid ? st.chat.find((c) => c.cid === r.cid) : null
      const what = msg ? `<div class="bubble"><span class="by">${esc(who(st, rec, msg.author).name)}</span>${esc(msg.text)}</div>` : `<img data-photo="${esc(r.photoId)}" alt="התמונה שדווחה" style="width:100%;border-radius:14px">`
      return `<section class="poll" style="display:flex;flex-direction:column;gap:8px">${what}
        <span class="small muted">${count(r.count, 'דיווח אחד', 'דיווחים')}${r.reasons.length ? `: ${esc(r.reasons.join(' · '))}` : ''}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="pill" type="button" data-remove="${esc(r.key)}" data-kind="${r.cid ? 'cid' : 'photo'}">${r.cid ? 'מחיקת ההודעה' : 'הסתרת התמונה'}</button>
        <button class="pill soft" type="button" data-dismiss="${esc(r.key)}">זה בסדר</button></div></section>`
    }).join('') || '<p class="muted">אין דיווחים פתוחים.</p>'}`, (root) => {
    root.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
      const ev = b.dataset.kind === 'cid' ? { t: 'comment.delete', cid: b.dataset.remove } : { t: 'photo.hide', photoId: b.dataset.remove }
      await act(() => Y.post(id, [ev]))
      await closeSheet()
      await render(true)
    }))
    root.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = async () => {
      await act(() => Y.post(id, [{ t: 'report.close', key: b.dataset.dismiss }]))
      await closeSheet()
      await render(true)
    }))
    root.querySelectorAll('img[data-photo]').forEach(async (img) => {
      await Y.ensurePhoto(id, img.dataset.photo).catch(() => undefined)
      const u = await photoUrl(img.dataset.photo)
      if (u) img.src = u
    })
  })
}

/** The admin gives a chore's turn or a task to someone (even against the rotation); they get a notification. */
async function assignSheet(id, what) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const thing = what.chore ? st.chores.get(what.chore) : st.items.get(what.item)
  if (!thing) return
  const current = what.chore ? Y.turnOf(thing, roles) : thing.claimedBy
  const members = (rec.members || []).map((m) => m.id)
  const myName = identity.profile()?.nickname || ''
  openSheet(`<h2>למי לתת את ${esc(thing.name)}?</h2>
    <p class="lead">${what.chore ? 'רק התור הזה עובר. אחרי שיבוצע, הסבב ממשיך כרגיל מאיפה שהיה.' : 'המשימה תעבור, ומי שמקבל אותה יקבל התראה.'}</p>
    <div class="stack">${members.map((m) => `<button class="btn btn-ghost" type="button" data-to="${m}" ${m === current ? 'disabled' : ''} style="justify-content:flex-start">${duckOf(st, rec, m, 30)} ${esc(who(st, rec, m).name)}${m === current ? ' (עכשיו)' : ''}</button>`).join('')}
      ${what.item && current ? '<button class="btn btn-ghost" type="button" data-to="" style="justify-content:flex-start">לשחרר (שאף אחד לא יהיה עליה)</button>' : ''}</div>`, (root) => {
    root.querySelectorAll('[data-to]').forEach((b) => (b.onclick = async () => {
      const to = b.dataset.to || null
      const ev = what.chore ? { t: 'chore.assign', id: what.chore, to } : { t: 'item.assign', id: what.item, to }
      const body = what.chore ? `תורך! ${thing.emoji} ${thing.name} (מ${myName})` : `📌 ${thing.name}: זה אצלך (מ${myName})`
      await act(() => Y.post(id, [ev], to && to !== me() ? { body, to: [to], go: what.chore ? `?chore=${what.chore}` : `?item=${what.item}` } : null))
      toast(to ? `עבר ל${who(st, rec, to).name}` : 'שוחרר')
      await closeSheet()
      await render(true)
    }))
  })
}

const CHORE_EMOJI = ['✨', ...new Set(CHORE_STARTERS.map((c) => c.emoji))]

async function newChoreSheet(id, editId = null) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const members = (rec.members || []).map((m) => m.id)
  const cur = editId ? st.chores.get(editId) : null
  let picked = cur && !cur.everyone ? cur.order.filter((m) => members.includes(m)) : []
  const have = new Set([...st.chores.values()].map((c) => c.name))
  const ideas = cur ? [] : choreIdeas().filter((c) => !have.has(c.name))
  const emojis = cur && !CHORE_EMOJI.includes(cur.emoji) ? [cur.emoji, ...CHORE_EMOJI] : CHORE_EMOJI
  const pickedEmoji = cur?.emoji || emojis[0]
  const every = cur?.every || 'week'
  const everyone = cur ? cur.everyone : true
  openSheet(`<h2>${cur ? 'עריכת מטלה' : 'מטלה קבועה'}</h2>
    <form id="f" novalidate>
      ${ideas.length ? `<span class="lbl" id="idea-l">רעיונות (לוחצים וזה מתמלא)</span>
      <div class="choices" role="group" aria-labelledby="idea-l">${ideas.map((c) => `<button type="button" class="choice" data-idea="${CHORE_STARTERS.indexOf(c)}" aria-pressed="false">${c.emoji} ${c.name}</button>`).join('')}</div>` : ''}
      <label class="lbl" for="cname">מה צריך לעשות? (אפשר לכתוב כל דבר)</label>
      <input class="input" id="cname" maxlength="40" placeholder="למשל: להאכיל את הדגים" value="${esc(cur?.name || '')}">
      <span class="lbl" id="ce-l">אימוג׳י</span>
      <div class="choices" role="group" aria-labelledby="ce-l">${emojis.map((e) => `<button type="button" class="choice" data-emo="${esc(e)}" aria-pressed="${e === pickedEmoji}" aria-label="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <span class="lbl" id="ev-l">כל כמה זמן?</span>
      <div class="choices" role="group" aria-labelledby="ev-l">${Object.entries(Y.EVERY).map(([k, v]) => `<button type="button" class="choice" data-every="${k}" aria-pressed="${k === every}">${v.label}</button>`).join('')}</div>
      <label class="lbl" for="ctime">באיזו שעה? (לא חובה: מי שתורו יקבל תזכורת)</label>
      <div class="add-row" style="margin-top:0"><input class="input" id="ctime" type="time" value="${esc(cur?.time || '')}" style="flex:0 0 auto;width:auto;min-width:9em"><button class="link-btn" type="button" id="notime">בלי שעה</button></div>
      <span class="lbl" id="who-l">מי בסבב?</span>
      <div class="choices" role="group" aria-labelledby="who-l"><button type="button" class="choice" id="all" aria-pressed="${everyone}">כל החצר (גם מי שיצטרף)</button></div>
      <div class="choices" id="pick" ${everyone ? 'hidden' : ''} style="margin-top:8px">${members.map((m) => `<button type="button" class="choice" data-m="${m}" aria-pressed="${picked.includes(m)}">${duckOf(st, rec, m, 22)} ${esc(who(st, rec, m).name)} <span class="n">${picked.includes(m) ? picked.indexOf(m) + 1 : ''}</span></button>`).join('')}</div>
      <p class="small muted" id="pick-hint" ${everyone ? 'hidden' : ''}>הסדר בסבב הוא הסדר שבו ${g('תבחרי', 'תבחר')}.</p>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">${cur ? 'שמירה' : 'הוספה'}</button>
    </form>`, (root) => {
    const f = root.querySelector('#f')
    const single = (sel) => f.querySelectorAll(sel).forEach((x) => (x.onclick = () => f.querySelectorAll(sel).forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
    single('[data-emo]')
    single('[data-every]')
    f.querySelector('#notime').onclick = () => (f.querySelector('#ctime').value = '')
    f.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => {
      const c = CHORE_STARTERS[Number(b.dataset.idea)]
      f.querySelectorAll('[data-idea]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      f.querySelector('#cname').value = c.name
      f.querySelectorAll('[data-emo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.emo === c.emoji)))
      f.querySelectorAll('[data-every]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.every === c.every)))
    }))
    const all = f.querySelector('#all')
    all.onclick = () => {
      const on = all.getAttribute('aria-pressed') !== 'true'
      all.setAttribute('aria-pressed', String(on))
      f.querySelector('#pick').hidden = on
      f.querySelector('#pick-hint').hidden = on
    }
    f.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
      const m = b.dataset.m
      picked = picked.includes(m) ? picked.filter((x) => x !== m) : [...picked, m]
      f.querySelectorAll('[data-m]').forEach((x) => {
        const i = picked.indexOf(x.dataset.m)
        x.setAttribute('aria-pressed', String(i >= 0))
        x.querySelector('.n').textContent = i >= 0 ? String(i + 1) : ''
      })
    }))
    f.onsubmit = async (e) => {
      e.preventDefault()
      const name = f.querySelector('#cname').value.trim()
      const everyone = all.getAttribute('aria-pressed') === 'true'
      if (name.length < 2) return (f.querySelector('#err').textContent = 'מה המטלה? (לפחות 2 תווים)')
      if (!everyone && !picked.length) return (f.querySelector('#err').textContent = 'בחרו מי בסבב')
      const ev = { t: 'chore.put', id: editId || Y.newId('c'), name, emoji: f.querySelector('[data-emo][aria-pressed="true"]').dataset.emo, every: f.querySelector('[data-every][aria-pressed="true"]').dataset.every, everyone, order: everyone ? [] : picked, time: f.querySelector('#ctime').value || null }
      await act(() => Y.post(id, [ev], editId ? null : { body: `מטלה חדשה בסבב: ${ev.emoji} ${name}`, go: `?chore=${ev.id}` }))
      await closeSheet()
      await render(true)
    }
  })
}

/** Done (+ optional proof photo), for a chore or a task. */
async function doneSheet(id, target) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const name = target.chore ? st.chores.get(target.chore)?.name : st.items.get(target.item)?.name
  let file = null
  openSheet(`<h2>${esc(name || '')}: בוצע! ✨</h2><p class="lead">תמונת הוכחה זה לא חובה, אבל זה כיף.</p>
    <label class="photo-pick" style="margin-top:14px">${ICON.camera}<span id="ph-t">${g('צלמי', 'צלם')} או ${g('בחרי', 'בחר')} תמונה</span>
      <input type="file" accept="image/*" capture="environment" aria-label="תמונת הוכחה"></label>
    <div class="stack"><button class="btn btn-primary" id="ok" type="button">בוצע!</button></div>`, (root) => {
    const input = root.querySelector('input[type="file"]')
    input.onchange = () => {
      file = input.files?.[0] || null
      if (!file) return
      root.querySelector('.photo-pick img')?.remove()
      const img = document.createElement('img')
      img.alt = 'התמונה שנבחרה'
      img.src = URL.createObjectURL(file)
      root.querySelector('.photo-pick').prepend(img)
    }
    root.querySelector('#ok').onclick = async (e) => {
      const btn = e.currentTarget
      busy(btn, true, file ? 'מעלה את ההוכחה…' : 'רגע…')
      const okDone = await act(async () => {
        const photoId = file ? await Y.uploadPhoto(id, await shrinkFile(file)) : null
        const fresh = await Y.localYard(id)
        const s = Y.stateOf(fresh)
        const roles = Y.rolesOf(fresh)
        if (target.chore) {
          const c = s.chores.get(target.chore)
          const next = Y.nextInOrder(Y.orderOf(c, roles), Y.turnOf(c, roles), roles)
          const notify = next && next !== me() ? { body: `תורך! ${c.emoji} ${c.name}`, to: [next], go: `?chore=${target.chore}` } : null
          await Y.post(id, [{ t: 'chore.done', id: target.chore, ...(photoId ? { photoId } : {}) }], notify)
        } else await Y.post(id, [{ t: 'item.done', id: target.item, on: true, ...(photoId ? { photoId } : {}) }])
        return true
      })
      busy(btn, false)
      if (!okDone) return
      await closeSheet()
      celebrate()
      toast('כל הכבוד! 🐥', { label: 'בטל', run: () => act(async () => {
        await Y.post(id, [target.chore ? { t: 'chore.undo', id: target.chore } : { t: 'item.done', id: target.item, on: false }])
        await render(true)
      }) })
      await render(true)
      maybeAskPush({ why: target.chore ? 'chore' : 'task' })
    }
  })
}

// ---------- Polls ----------

function pollSheet(id) {
  openSheet(`<h2>הצבעה חדשה 📊</h2>
    <form id="f" novalidate>
      <label class="lbl" for="q">השאלה</label><input class="input" id="q" maxlength="80" placeholder="למשל: אצל מי עושים?">
      <span class="lbl">תשובות</span>
      <div id="opts" class="stack" style="margin-top:0">
        <input class="input" maxlength="40" aria-label="תשובה 1" placeholder="תשובה 1">
        <input class="input" maxlength="40" aria-label="תשובה 2" placeholder="תשובה 2">
      </div>
      <button class="link-btn" type="button" id="more">+ עוד תשובה</button>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">שליחה לחצר</button>
    </form>`, (root) => {
    const f = root.querySelector('#f')
    const opts = f.querySelector('#opts')
    f.querySelector('#more').onclick = () => {
      const n = opts.children.length
      if (n >= 6) return
      opts.insertAdjacentHTML('beforeend', `<input class="input" maxlength="40" aria-label="תשובה ${n + 1}" placeholder="תשובה ${n + 1}">`)
      opts.lastElementChild.focus()
      if (n + 1 >= 6) f.querySelector('#more').hidden = true
    }
    f.onsubmit = async (e) => {
      e.preventDefault()
      const q = f.querySelector('#q').value.trim()
      const options = [...opts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean)
      if (!q) return (f.querySelector('#err').textContent = 'מה שואלים?')
      if (options.length < 2) return (f.querySelector('#err').textContent = 'צריך לפחות 2 תשובות')
      const pid = Y.newId('p')
      await act(() => Y.post(id, [{ t: 'poll.put', id: pid, q, options }], { body: `הצבעה חדשה: ${q}`, go: `?poll=${pid}` }))
      await closeSheet()
      await render(true)
    }
  })
}

// ---------- Chat ----------

async function chatScreen(id) {
  const rec = await Y.localYard(id)
  if (!rec) return go(`#/y/${id}`)
  const st = Y.stateOf(rec)
  const myId = me()
  const msgs = st.chat.slice(-200).map((c) => `<div class="msg${c.author === myId ? ' me' : ''}">${duckOf(st, rec, c.author, 30)}<div class="bubble">${c.author === myId ? '' : `<span class="by">${esc(who(st, rec, c.author).name)}</span>`}${esc(c.text)}</div><button class="link-btn" type="button" data-msg="${esc(c.cid)}" aria-label="אפשרויות להודעה" style="min-width:44px;padding:0;text-decoration:none;color:var(--ink-faint)">⋯</button></div>`).join('')
  const draft = $app.querySelector('#msg')?.value || ''
  $app.innerHTML = `<main class="screen">
    <header class="top"><a class="icon-btn" href="#/y/${id}" aria-label="חזרה לחצר">${ICON.back}</a><h1>צ׳אט<span class="sub">${esc(st.meta.emoji)} ${esc(st.meta.name)}</span></h1></header>
    <div class="chat" aria-live="polite">${msgs || '<div class="empty"><b>שקט בחצר</b><span>מי ראשון/ה לכתוב?</span></div>'}</div>
    <form class="composer" id="f" novalidate><label class="sr" for="msg">הודעה</label>
      <textarea id="msg" rows="1" maxlength="500" placeholder="הודעה לחצר…" enterkeyhint="send"></textarea>
      <button class="add-btn" type="submit" aria-label="שליחה" style="background:var(--green);color:var(--on-green)">${ICON.send}</button></form>
  </main>`
  const ta = $app.querySelector('#msg')
  ta.value = draft
  $app.querySelectorAll('[data-msg]').forEach((b) => (b.onclick = () => messageSheet(id, b.dataset.msg)))
  scrollTo(0, document.body.scrollHeight)
  Y.markSeen(id, { chat: true })
  push.closeShown(id)
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const text = ta.value.trim()
    if (!text) return
    ta.value = ''
    await act(() => Y.post(id, [{ t: 'comment.put', cid: Y.newId('m'), id: Y.CHAT, text }], { body: `${identity.profile().nickname}: ${text}`.slice(0, 160), go: '/chat' }))
    await render(true)
    $app.querySelector('#msg')?.focus()
    scrollTo(0, document.body.scrollHeight)
  }
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault()
      $app.querySelector('#f').requestSubmit()
    }
  }
}

// ---------- Invite and members ----------

const inviteCache = new Map()

/** The invitation text: what it is, when, what is still missing, and the link. */
function inviteText(st, link) {
  const lines = [`בואו לחצר "${st.meta.name}" ${st.meta.emoji}`]
  if (st.meta.kind === 'event') {
    const when = [whenText(st.meta.when), st.meta.where].filter(Boolean).join(' · ')
    if (when) lines.push(when)
    const free = Y.eventBoard(st, null).free.map((i) => i.name)
    lines.push(free.length ? `עוד חסר: ${free.slice(0, 5).join(', ')}${free.length > 5 ? ` ועוד ${free.length - 5}` : ''}` : 'מי מביא מה? לוחצים ולוקחים:')
    if (free.length) lines.push('לוחצים ולוקחים:')
  } else lines.push(`${count(st.chores.size, 'מטלה אחת', 'מטלות')} בתורות, כל אחד רואה מתי תורו:`)
  if (link) lines.push(link)
  return lines.join('\n')
}

async function inviteSheet(id, fresh = false) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const myId = me()
  const isAdmin = Y.rolesOf(rec).get(myId) === 'admin'
  const members = (rec.members || []).slice().sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1))
  openSheet(`<h2>${fresh ? 'החצר פתוחה! עכשיו מזמינים 🐥' : 'הברווזונים בחצר'}</h2>
    <p class="lead">מי שיש לו את הקישור נכנס תוך 10 שניות, בלי הרשמה. הקישור תקף שבועיים.</p>
    <p class="small muted" style="margin:12px 0 4px">ככה זה ייראה אצל החברים:</p>
    <div class="wa-bubble"><span id="watext">${esc(inviteText(st, ''))}</span><span class="wa-link" id="link">יוצרת קישור…</span><span class="wa-time">${hhmm(Date.now())} ✓✓</span></div>
    <div class="stack">
      <a class="btn btn-primary" id="wa" href="#" target="_blank" rel="noopener" aria-disabled="true">שליחה בוואטסאפ</a>
      ${navigator.share ? '<button class="btn btn-soft" id="share" type="button">שיתוף…</button>' : ''}
      <button class="btn btn-ghost" id="copy" type="button">העתקת הקישור</button>
    </div>
    <span class="lbl">${count(members.length, 'ברווזון אחד', 'ברווזונים')}</span>
    ${members.map((m) => {
      const w = who(st, rec, m.id)
      return `<div class="member">${duck(w.look, 40, { crown: m.role === 'admin' })}<span class="n">${esc(w.name)}${m.role === 'admin' ? ' <span class="r">· אמא ברווזה</span>' : ''}</span>
        ${isAdmin && m.id !== myId ? `<button class="link-btn" data-admin="${m.id}" ${m.role === 'admin' ? 'hidden' : ''}>למנות</button><button class="link-btn" style="color:var(--alert)" data-kick="${m.id}">להוציא</button>` : ''}</div>`
    }).join('')}`, async (root) => {
    const linkBox = root.querySelector('#link')
    let link = inviteCache.get(id)
    if (!link) {
      const inv = await act(() => Y.createInvite(id))
      if (!inv) return (linkBox.textContent = 'לא הצלחתי ליצור קישור. בדקו שיש רשת.')
      link = Y.inviteLink(inv.code)
      inviteCache.set(id, link)
    }
    linkBox.textContent = link
    const text = inviteText(st, link)
    const wa = root.querySelector('#wa')
    wa.href = `https://wa.me/?text=${encodeURIComponent(text)}`
    wa.removeAttribute('aria-disabled')
    root.querySelector('#share')?.addEventListener('click', () => navigator.share({ text }).catch(() => undefined))
    root.querySelector('#copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(link)
        toast('הקישור הועתק')
      } catch {
        toast('לא הצלחתי להעתיק. לחיצה ארוכה על הקישור')
      }
    }
    root.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = async () => {
      if (!confirm(`להוציא את ${who(st, rec, b.dataset.kick).name} מהחצר?`)) return
      await act(() => Y.removeMember(id, b.dataset.kick))
      await closeSheet()
      await render(true)
    }))
    root.querySelectorAll('[data-admin]').forEach((b) => (b.onclick = async () => {
      if (!confirm(`למנות את ${who(st, rec, b.dataset.admin).name} לאמא ברווזה (מנהל/ת)?`)) return
      await act(() => Y.makeAdmin(id, b.dataset.admin))
      await closeSheet()
      await render(true)
    }))
  })
}

async function yardMenu(id) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const isAdmin = Y.rolesOf(rec).get(me()) === 'admin'
  const pushOn = push.status() === 'on'
  openSheet(`<h2>${esc(st.meta.emoji)} ${esc(st.meta.name)}</h2>
    <div class="stack">
      <button class="btn btn-soft" data-a="invite">🐥 הברווזונים וההזמנה</button>
      ${isAdmin || st.meta.open ? '<button class="btn btn-ghost" data-a="team">👥 מי עושה מה (לו״ז של כולם)</button>' : ''}
      <button class="btn btn-ghost" data-a="summary">📤 שליחת סיכום לוואטסאפ</button>
      ${st.meta.kind === 'event' && st.meta.when ? '<button class="btn btn-ghost" data-a="calendar">📅 הוספה ליומן</button>' : ''}
      ${st.meta.kind === 'event' ? '<button class="btn btn-ghost" data-a="again">🔁 אירוע חדש עם אותה רשימה</button>' : ''}
      ${isAdmin ? '<button class="btn btn-ghost" data-a="edit">✏️ עריכת פרטי החצר</button>' : ''}
      ${pushOn ? `<button class="btn btn-ghost" data-a="mute">${rec.muted ? '🔔 להחזיר התראות מהחצר' : '🔕 להשתיק את החצר'}</button>` : ''}
      <button class="btn btn-danger" data-a="leave">🚪 לעזוב את החצר</button>
      ${isAdmin ? '<button class="btn btn-danger" data-a="delete">🗑️ למחוק את החצר לכולם</button>' : ''}
    </div>`, (root) => {
    root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a
      if (a === 'invite') return inviteSheet(id)
      if (a === 'team') return go(`#/y/${id}/team`)
      if (a === 'summary') return summarySheet(id)
      if (a === 'calendar') return calendarSheet(id)
      if (a === 'again') {
        await closeSheet()
        return newYardSheet({ again: true, kind: 'event', name: st.meta.name, emoji: st.meta.emoji, items: [...st.items.values()].sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)).map((i) => i.name) })
      }
      if (a === 'edit') return editYardSheet(id)
      if (a === 'mute') {
        await act(() => Y.setMute(id, !rec.muted))
        toast(rec.muted ? 'ההתראות חזרו' : 'החצר מושתקת')
        return closeSheet()
      }
      if (a === 'leave') {
        if (!confirm('לעזוב את החצר? אפשר לחזור רק עם קישור חדש.')) return
        await act(() => Y.leave(id))
        if (!(await Y.localYard(id))) return go('#/')
      }
      if (a === 'delete') {
        if (!confirm('למחוק את החצר לכולם? אין דרך לשחזר.')) return
        await act(() => Y.deleteYard(id))
        if (!(await Y.localYard(id))) return go('#/')
      }
    }))
  })
}

async function editYardSheet(id) {
  const rec = await Y.localYard(id)
  const m = Y.stateOf(rec).meta
  const emojis = m.kind === 'home' ? HOME_EMOJI : EVENT_EMOJI
  const whenVal = m.when ? m.when.slice(0, 16) : ''
  openSheet(`<h2>פרטי החצר</h2><form id="f" novalidate>
    <label class="lbl" for="yname">שם</label><input class="input" id="yname" maxlength="30" value="${esc(m.name)}">
    ${m.kind === 'event' ? `<label class="lbl" for="when">מתי</label><input class="input" id="when" type="datetime-local" value="${esc(whenVal)}">
    <label class="lbl" for="where">איפה</label><input class="input" id="where" maxlength="60" value="${esc(m.where)}">` : ''}
    <span class="lbl" id="emo-l">אימוג׳י</span>
    <div class="choices" role="group" aria-labelledby="emo-l">${[...new Set([m.emoji, ...emojis])].map((e) => `<button type="button" class="choice" data-emo="${esc(e)}" aria-pressed="${e === m.emoji}" aria-label="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <span class="lbl" id="open-l">שקיפות</span>
    <div class="choices" role="group" aria-labelledby="open-l"><button type="button" class="choice" id="open" aria-pressed="${m.open}">👥 כולם רואים מי עושה מה</button></div>
    <p class="small muted" style="margin:6px 0 0">כשזה כבוי, רק ${g('את רואה', 'אתה רואה')} את המסך "מי עושה מה". ליד כל דבר תמיד רואים מי לקח אותו.</p>
    <div class="stack"><button class="btn btn-primary" type="submit">שמירה</button></div></form>`, (root) => {
    const f = root.querySelector('#f')
    f.querySelector('#open').onclick = (e) => e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true'))
    f.querySelectorAll('[data-emo]').forEach((x) => (x.onclick = () => f.querySelectorAll('[data-emo]').forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
    f.onsubmit = async (e) => {
      e.preventDefault()
      const name = f.querySelector('#yname').value.trim()
      if (name.length < 2) return
      await act(() => Y.post(id, [{ t: 'yard.meta', name, emoji: f.querySelector('[data-emo][aria-pressed="true"]').dataset.emo, kind: m.kind, when: f.querySelector('#when')?.value || null, where: f.querySelector('#where')?.value.trim() || '', open: f.querySelector('#open').getAttribute('aria-pressed') === 'true' }]))
      await closeSheet()
      await render(true)
    }
  })
}

// ---------- Paste a link (or move from Safari) ----------

/** In the app: read the clipboard once; an invite goes straight to joining, anything else opens the paste sheet. */
async function quickPaste() {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch { /* not allowed: the sheet has a field */ }
  const code = Y.extractInvite(text)
  if (code) return go(`#/join/${code}`)
  pasteSheet()
}

function pasteSheet() {
  openSheet(`<h2>יש לי קישור</h2>
    <p class="lead">${g('הדביקי', 'הדבק')} כאן קישור הזמנה לחצר${push.isIOS() && push.standalone() ? ', או את קוד ההעברה מספארי' : ''}.</p>
    <form id="pastef" novalidate>
      <label class="sr" for="code">קישור</label>
      <textarea class="input" id="code" rows="3" placeholder="https://hechatzer…/#/join/…"></textarea>
      ${navigator.clipboard?.readText ? '<button class="link-btn" type="button" id="clip">הדבקה מהלוח</button>' : ''}
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">המשך</button>
    </form>`, (root) => {
    const f = root.querySelector('#pastef')
    const ta = f.querySelector('#code')
    root.querySelector('#clip')?.addEventListener('click', async () => {
      try {
        ta.value = await navigator.clipboard.readText()
      } catch { /* the user said no */ }
    })
    f.onsubmit = async (e) => {
      e.preventDefault()
      const moved = identity.readMove(ta.value)
      if (moved) {
        const cur = identity.load()
        if (cur?.keys && cur.keys.memberId !== moved.keys.memberId && (await Y.localYards()).length && !confirm('להחליף את הברווזון שבאפליקציה בזה מספארי?')) return
        await act(async () => {
          await identity.adoptMove(moved)
          await Y.refreshAll()
          toast(`ברוכה השבה, ${moved.profile.nickname} 🐥`)
          await go('#/')
          await render()
        })
        return
      }
      const code = Y.extractInvite(ta.value)
      if (!code) return (f.querySelector('#err').textContent = 'זה לא נראה כמו קישור לחצר')
      await go(`#/join/${code}`)
    }
  })
}

// ---------- Install ----------

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#2F7DF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 14V3M8.5 6.5 12 3l3.5 3.5"/></svg>'
const ADD_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'

function installSheet({ joined = false } = {}) {
  const ios = push.isIOS()
  openSheet(`<h2>${joined ? `🎉 ${g('את', 'אתה')} בחצר! עוד צעד קטן` : 'החצר על מסך הבית'}</h2>
    <p class="lead">${joined ? 'כדי לקבל תזכורות כשתורך, ולפתוח את החצר בלחיצה מהמסך:' : 'ככה מקבלים התראות כשתורך או כשמוסיפים משהו, ופותחים בלחיצה.'}</p>
    ${ios ? `
      <ol class="steps">
        <li><span class="step-n">1</span><span class="step-pic">🐥</span><span><b>קודם, ${g('שמרי', 'שמור')} את הברווזון</b> (כפתור למטה). האפליקציה שעל מסך הבית לא רואה את מה שבספארי.</span></li>
        <li><span class="step-n">2</span><span class="step-pic">${SHARE_ICON}</span><span>בסרגל של ספארי למטה: <b>שיתוף</b> (אם לא רואים, קודם <b>⋯</b>).</span></li>
        <li><span class="step-n">3</span><span class="step-pic">${ADD_ICON}</span><span><b>"הוספה למסך הבית"</b>, ואז "הוספה".</span></li>
        <li><span class="step-n">4</span><span class="step-pic"><img src="icons/icon-192.png" alt="" width="34" height="34" style="border-radius:9px"></span><span>פותחים מהאייקון ובוחרים <b>"כבר יש לי ברווזון"</b>.</span></li>
      </ol>
      <div class="stack">${V.saved().some((v) => v.kind === 'passkey') ? `<p class="lead">✓ הברווזון שמור עם ${V.passkeyName()}. אפשר להמשיך לשלב 2.</p>` : V.passkeysAvailable() ? `<button class="btn btn-primary" id="savepk" type="button">שמירה עם ${V.passkeyName()}</button>` : ''}
        <button class="link-btn" id="copy" type="button">אין ${V.passkeyName()}? העתקת קוד העברה במקום</button></div>
      <p class="fine">קוד ההעברה הוא המפתח שלך לחצרות. אל ${g('תשלחי', 'תשלח')} אותו לאף אחד.</p>`
      : `<p class="lead" style="margin-top:12px">בכרום: תפריט ⋮ ← "התקנת אפליקציה" או "הוספה למסך הבית".</p>${deferredInstall ? '<div class="stack"><button class="btn btn-primary" id="inst" type="button">התקנה</button></div>' : ''}`}
    <div class="stack"><button class="link-btn" id="hide" type="button">לא עכשיו</button></div>
    ${ios ? `<div class="down-hint" aria-hidden="true"><span>${SHARE_ICON}</span>שיתוף נמצא כאן למטה<span class="down-arrow">⬇</span></div>` : ''}`, (root) => {
    root.querySelector('#savepk')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      busy(btn, true, 'רגע…')
      try {
        await V.savePasskey()
        btn.outerHTML = `<p class="lead">✓ הברווזון שמור עם ${V.passkeyName()}. עכשיו לשלב 2.</p>`
      } catch (x) {
        if (x.code !== 'cancelled') toast(errText(x))
        busy(btn, false)
      }
    })
    root.querySelector('#copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(identity.moveCode())
        toast('הועתק. עכשיו לוחצים על ⬆️ ו"הוספה למסך הבית"')
      } catch {
        toast('לא הצלחתי להעתיק')
      }
    })
    root.querySelector('#inst')?.addEventListener('click', async () => {
      deferredInstall.prompt()
      deferredInstall = null
      await closeSheet()
    })
    root.querySelector('#hide').onclick = async () => {
      settings = { ...settings, hideInstall: true }
      db.saveSettings(settings)
      await closeSheet()
      render(true)
    }
  })
}
let deferredInstall = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e
})

// ---------- Notifications ----------

/** Turns notifications on (from a tap) and sends a test one right away, so you see it works. */
async function turnPushOn() {
  return act(async () => {
    await push.enable()
    toast('ההתראות פועלות 🐥 שלחנו אחת לבדיקה')
    push.test().catch(() => undefined)
    return true
  })
}

/**
 * After something you did (took an item, finished a chore): the moment a reminder makes sense. `why`: 'event' |
 * 'chore' | 'task'; `cal`: how to put this one thing in the calendar instead. Asked again after a week, 3 times at most.
 */
function maybeAskPush({ why = '', cal = null } = {}) {
  const texts = {
    event: ['רוצה תזכורת ערב לפני? 🔔', `נשלח לך ב־19:00, ערב לפני, את מה ש${g('את מביאה', 'אתה מביא')}. רק דברים שנוגעים בך.`],
    chore: ['רוצה לדעת כשתורך שוב? 🔔', 'נשלח התראה כשמגיע תורך, ובבוקר סיכום קצר של מה שמחכה לך. אפשר להשתיק כל חצר.'],
    '': ['רוצה לדעת כשתורך? 🔔', 'נשלח התראה רק כשמשהו נוגע בך: תורך, משהו חדש ברשימה, הצבעה או הודעה. אפשר להשתיק כל חצר.'],
  }
  if (push.shouldAsk()) {
    push.markAsked()
    const [title, lead] = texts[why] || texts['']
    setTimeout(() => openSheet(`<h2>${title}</h2><p class="lead">${lead}</p>
      <div class="stack"><button class="btn btn-primary" id="yes" type="button">כן, ${g('תזכירו', 'תזכירו')} לי</button>${cal ? '<button class="btn btn-ghost" id="cal" type="button">📅 ליומן במקום</button>' : ''}<button class="link-btn" id="no" type="button">אולי אחר כך</button></div>`, (root) => {
      root.querySelector('#yes').onclick = async () => {
        await turnPushOn()
        await closeSheet()
        render(true)
      }
      root.querySelector('#cal')?.addEventListener('click', () => cal())
      root.querySelector('#no').onclick = closeSheet
    }), 600)
  } else if (push.shouldOfferInstall()) {
    push.markOfferedInstall()
    setTimeout(() => openSheet(`<h2>בספארי תזכורות לא מגיעות 🔕</h2>
      <p class="lead">אייפון שולח התראות רק לאפליקציה שעל מסך הבית. שתי דרכים לא לפספס:</p>
      <div class="stack"><button class="btn btn-primary" id="inst" type="button">📲 להוסיף למסך הבית</button>${cal ? '<button class="btn btn-soft" id="cal" type="button">📅 ליומן של האייפון</button>' : ''}<button class="link-btn" id="no" type="button">לא עכשיו</button></div>`, (root) => {
      root.querySelector('#inst').onclick = () => installSheet()
      root.querySelector('#cal')?.addEventListener('click', () => cal())
      root.querySelector('#no').onclick = closeSheet
    }), 600)
  }
}

/** In a yard: a quiet line when reminders here won't reach you (dismissed for a week per yard). */
function bellHtml(rec, st, myId) {
  const status = push.status()
  if (!['off', 'needs-install', 'denied'].includes(status)) return ''
  if (Date.now() - (settings.bellHidden?.[rec.id] || 0) < 7 * 86400e3) return ''
  if (!Y.plannedReminders(st, Y.rolesOf(rec)).some((r) => r.to === myId || r.to === null)) return ''
  const [text, btn] = {
    off: ['יש לך כאן תזכורות, אבל ההתראות כבויות.', 'להפעיל'],
    'needs-install': ['יש לך כאן תזכורות, אבל בספארי הן לא מגיעות.', 'איך מקבלים?'],
    denied: ['ההתראות חסומות בהגדרות של הטלפון (הגדרות ← החצר ← התראות). אפשר גם "הכל ליומן" ב"היום שלי".', ''],
  }[status]
  return `<div class="tip bell"><span aria-hidden="true">🔕</span><span style="flex:1">${text}</span>${btn ? `<button class="pill soft" id="bellon" type="button">${btn}</button>` : ''}<button class="tip-x" id="bellx" type="button" aria-label="לא עכשיו">✕</button></div>`
}

// ---------- My day ----------

/** What is waiting for me, across all yards: my chores (and when), tasks with a date, events this week. */
/**
 * What is waiting for someone (me by default), across all yards or in `recs` only. `undated`: also tasks and items
 * they took that have no date (for the admin's view).
 */
async function agenda(now = Date.now(), { member = me(), recs = null, undated = false } = {}) {
  const myId = member
  const today = dayStart(now)
  const week = today + 7 * 86400e3
  const out = []
  const nodate = []
  for (const rec of recs || (await Y.localYards())) {
    const st = Y.stateOf(rec)
    const roles = Y.rolesOf(rec)
    const yard = { id: rec.id, name: st.meta.name, emoji: st.meta.emoji }
    for (const c of st.chores.values()) {
      if (Y.turnOf(c, roles) !== myId) continue
      const late = Y.dueState(c, now) === 'late'
      const day = late ? today : dayStart(Y.dueAt(c))
      if (day >= week) continue
      const at = c.time ? new Date(day).setHours(...c.time.split(':').map(Number), 0, 0) : day
      out.push({ at, allDay: !c.time, late, emoji: c.emoji, name: c.name, yard, note: late ? 'באיחור' : '', ref: { chore: c.id } })
    }
    for (const it of st.items.values()) {
      if (undated && !it.done && !it.due && Y.takers(it).includes(myId)) nodate.push({ emoji: st.meta.kind === 'event' ? '🧺' : '📌', name: it.name, yard, note: st.meta.kind === 'event' ? 'להביא' : '', ref: { item: it.id } })
      if (it.done || !it.due || (it.claimedBy && !Y.takers(it).includes(myId))) continue
      if (undated && !it.claimedBy) continue // the admin's view lists those once, under "בלי אף אחד"
      const at = Date.parse(it.due)
      if (at >= week) continue
      out.push({ at, allDay: false, late: at < now, emoji: '📌', name: it.name, yard, note: it.claimedBy ? '' : 'עוד אף אחד לא לקח', ref: { item: it.id } })
    }
    if (st.meta.kind === 'event' && st.meta.when) {
      const at = Date.parse(st.meta.when)
      if (at >= today && at < week) {
        const mine = [...st.items.values()].filter((i) => Y.takers(i).includes(myId)).map((i) => i.name)
        const bring = myId === me() ? g('את מביאה', 'אתה מביא') : who(st, rec, myId).g('מביאה', 'מביא')
        out.push({ at, allDay: false, late: false, emoji: st.meta.emoji, name: st.meta.name, yard, note: mine.length ? `${bring}: ${mine.join(', ')}` : '' })
      }
    }
  }
  out.sort((a, b) => a.at - b.at || (a.allDay ? 1 : -1))
  const tomorrow = today + 86400e3
  return {
    late: out.filter((x) => x.late || x.at < today),
    today: out.filter((x) => !x.late && x.at >= today && x.at < tomorrow),
    tomorrow: out.filter((x) => !x.late && x.at >= tomorrow && x.at < tomorrow + 86400e3),
    later: out.filter((x) => !x.late && x.at >= tomorrow + 86400e3),
    nodate,
  }
}

const agendaRow = (x, { showDay = false } = {}) => `<li><a class="row" href="#/y/${x.yard.id}" style="text-decoration:none;color:inherit">
  <span class="when-col">${x.allDay ? '<span class="small muted">כל היום</span>' : `<b>${hhmm(x.at)}</b>`}${showDay ? `<span class="small muted">${new Intl.DateTimeFormat('he-IL', { weekday: 'short' }).format(new Date(x.at))}</span>` : ''}</span>
  <span class="emo" aria-hidden="true">${esc(x.emoji)}</span>
  <span class="what" style="padding:0"><span class="t">${esc(x.name)}</span><span class="s${x.late ? ' warn' : ''}">${esc(x.yard.emoji)} ${esc(x.yard.name)}${x.note ? ` · ${esc(x.note)}` : ''}</span></span></a></li>`

async function todayScreen() {
  const a = await agenda()
  const section = (title, list, opts) => (list.length ? `<h2 class="section">${title}</h2><ul class="list">${list.map((x) => agendaRow(x, opts)).join('')}</ul>` : '')
  const empty = !a.late.length && !a.today.length && !a.tomorrow.length && !a.later.length
  $app.innerHTML = `<main class="screen">
    <header class="top"><a class="icon-btn" href="#/" aria-label="חזרה">${ICON.back}</a><h1>היום שלי<span class="sub">${new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></h1></header>
    ${empty ? `<div class="empty">${demoParade()}<b>אין לך כלום השבוע 🎉</b><span>מטלות עם שעה ומשימות עם תאריך יופיעו כאן, מסודרות לפי הזמן.</span></div>` : ''}
    ${section('באיחור', a.late)}
    ${section('היום', a.today)}
    ${section('מחר', a.tomorrow)}
    ${section('בהמשך השבוע', a.later, { showDay: true })}
    ${empty ? '' : `<div class="stack"><button class="btn btn-soft" id="allcal" type="button">📅 הכל ליומן של הטלפון</button></div>`}
    <p class="small muted" style="margin-top:20px">${push.status() === 'on' ? 'תזכורות נשלחות בשעה שנקבעה.' : 'בלי התראות? "הכל ליומן" שם כל אחד מאלה ביומן של הטלפון, עם תזכורת.'}</p>
  </main>`
  $app.querySelector('#allcal')?.addEventListener('click', () => {
    const list = [...a.late, ...a.today, ...a.tomorrow, ...a.later]
    const today = dayStart()
    calSheet({
      title: 'השבוע שלי ביומן', file: 'החצר - השבוע שלי',
      lead: `${count(list.length, 'דבר אחד', 'דברים')} מהשבוע הקרוב, כל אחד עם תזכורת.`,
      events: list.map((x) => {
        const start = x.late ? (x.allDay ? today : Math.max(x.at, Date.now() + 5 * 60e3)) : x.at
        const ref = x.ref?.chore || x.ref?.item || 'event'
        return { uid: `${x.yard.id}-${ref}-${dayStart(start)}`, start, allDay: x.allDay, minutes: x.ref ? 60 : 180, title: `${x.emoji} ${x.name}`, notes: [x.note, `${x.yard.emoji} ${x.yard.name}`].filter(Boolean).join('\n'), url: yardUrl(x.yard.id), alarms: x.ref ? undefined : [1440, 180] }
      }),
    })
  })
}

// ---------- Summary for WhatsApp, and the calendar ----------

async function summarySheet(id) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const nameOf = (m) => (m === me() ? identity.profile()?.nickname || '' : who(st, rec, m).name)
  let link = inviteCache.get(id) || ''
  openSheet(`<h2>📤 סיכום לוואטסאפ</h2>
    <pre class="summary" id="sum">${esc(Y.summaryText(st, nameOf, { link }))}</pre>
    <div class="stack">
      <a class="btn btn-primary" id="wa" href="#" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
      ${navigator.share ? '<button class="btn btn-soft" id="sh" type="button">שיתוף…</button>' : ''}
      <button class="btn btn-ghost" id="cp" type="button">העתקה</button>
    </div>`, async (root) => {
    const set = () => {
      const text = Y.summaryText(st, nameOf, { link })
      root.querySelector('#sum').textContent = text
      root.querySelector('#wa').href = `https://wa.me/?text=${encodeURIComponent(text)}`
      return text
    }
    set()
    root.querySelector('#sh')?.addEventListener('click', () => navigator.share({ text: set() }).catch(() => undefined))
    root.querySelector('#cp').onclick = async () => {
      try {
        await navigator.clipboard.writeText(set())
        toast('הסיכום הועתק')
      } catch {
        toast('לא הצלחתי להעתיק')
      }
    }
    if (!link) {
      // The summary ends with a link to take things; made in the background, like an invite.
      const inv = await Y.createInvite(id).catch(() => null)
      if (inv) {
        link = Y.inviteLink(inv.code)
        inviteCache.set(id, link)
        if (root.isConnected) set()
      }
    }
  })
}

const yardUrl = (id) => `${location.origin}${location.pathname}#/y/${id}`

/**
 * "Add to calendar": an .ics file made on this phone (the iPhone calendar, Outlook…) and, for a single event, a
 * Google Calendar link. The calendar then reminds by itself, even when the app is closed.
 */
function calSheet({ title, lead, events, file }) {
  const ics = Y.icsFile(events)
  const gcal = events.length === 1 ? Y.gcalLink(events[0]) : null
  openSheet(`<h2>📅 ${esc(title)}</h2>
    <p class="lead">${lead}</p>
    <div class="stack">
      <a class="btn btn-primary" id="ics" href="#" download="${esc(file)}.ics">${push.isIOS() ? 'ליומן של האייפון' : 'קובץ ליומן'}</a>
      ${gcal ? `<a class="btn btn-ghost" id="gcal" href="${esc(gcal)}" target="_blank" rel="noopener">Google Calendar</a>` : ''}
    </div>
    <p class="fine">היומן לא מתעדכן לבד: אם משהו משתנה בחצר, מוסיפים שוב.</p>`, (root) => {
    root.querySelector('#ics').href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  })
}
const remindText = (alarms = [0]) => alarms.map((m) => (m === 0 ? 'בזמן' : m === -540 ? 'ב־9:00 באותו יום' : m >= 1440 ? 'יום לפני' : m >= 60 ? `${m / 60} שעות לפני`.replace('1 שעות', 'שעה') : `${m} דקות לפני`)).join(' ו')

async function calendarSheet(id) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  if (st.meta.kind !== 'event' || !st.meta.when) return toast('לאירוע אין עדיין תאריך')
  const mine = [...st.items.values()].filter((i) => Y.takers(i).includes(me())).map((i) => i.name + (i.qty ? ` ×${i.qty}` : ''))
  const notes = mine.length ? `${g('אני מביאה', 'אני מביא')}: ${mine.join(', ')}` : ''
  calSheet({
    title: `${st.meta.name} ביומן`, file: st.meta.name,
    lead: `${esc(whenText(st.meta.when))}${st.meta.where ? ` · ${esc(st.meta.where)}` : ''}. תזכורת יום לפני ו־3 שעות לפני${mine.length ? `, עם מה ש${g('את מביאה', 'אתה מביא')}` : ''}.`,
    events: [{ uid: id, start: Date.parse(st.meta.when), minutes: 180, title: `${st.meta.emoji} ${st.meta.name}`, where: st.meta.where, notes, url: yardUrl(id), alarms: [1440, 180] }],
  })
}

/** A task (or an item) with a date, to the calendar. */
async function itemCalendar(id, itemId) {
  const st = Y.stateOf(await Y.localYard(id))
  const it = st.items.get(itemId)
  if (!it?.due) return
  calSheet({
    title: `${it.name} ביומן`, file: it.name,
    lead: `${esc(whenShort(Date.parse(it.due)))}. תזכורת ${remindText([60, 0])}.`,
    events: [{ uid: `${id}-${itemId}`, start: Date.parse(it.due), title: `📌 ${it.name}`, notes: `${st.meta.emoji} ${st.meta.name}`, url: yardUrl(id), alarms: [60, 0] }],
  })
}

/** My turn of a chore, to the calendar. Alone in the rotation: the calendar repeats it; otherwise just this turn. */
async function choreCalendar(id, choreId) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const c = st.chores.get(choreId)
  if (!c) return
  const late = Y.dueState(c) === 'late'
  const day = late ? dayStart() : dayStart(Y.dueAt(c))
  const start = c.time ? new Date(day).setHours(...c.time.split(':').map(Number), 0, 0) : day
  const alone = Y.orderOf(c, roles).filter((m) => !roles.size || roles.has(m)).length === 1
  const ev = { uid: `${id}-${choreId}${alone ? '' : `-${day}`}`, start, allDay: !c.time, title: `${c.emoji} ${c.name}`, notes: `${st.meta.emoji} ${st.meta.name}`, url: yardUrl(id), rrule: alone ? Y.RRULES[c.every] : '' }
  calSheet({
    title: `${c.name} ביומן`, file: c.name,
    lead: `${alone ? `${esc(Y.EVERY[c.every].label)}, חוזר ביומן` : `התור שלך: ${esc(new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date(day)))}`}${c.time ? ` בשעה ${c.time}` : ''}. תזכורת ${remindText(c.time ? [0] : [-540])}.`,
    events: [ev],
  })
}

// ---------- Who does what (for whoever runs the yard) ----------

/** Things done in the last 7 days by a member (chores and tasks). */
function doneThisWeek(st, member, now = Date.now()) {
  const since = now - 7 * 86400e3
  let n = 0
  for (const c of st.chores.values()) for (const h of c.history) if (h.kind === 'done' && h.by === member && Date.parse(h.at) >= since) n++
  for (const it of st.items.values()) if (it.done && it.doneBy === member && Date.parse(it.doneAt) >= since) n++
  return n
}

async function teamScreen(id) {
  const rec = await Y.localYard(id)
  if (!rec) return go(`#/y/${id}`)
  const st = Y.stateOf(rec)
  const roles = Y.rolesOf(rec)
  const admin = roles.get(me()) === 'admin'
  if (!admin && !st.meta.open) return go(`#/y/${id}`)
  const event = st.meta.kind === 'event'
  const members = (rec.members || []).map((m) => m.id)
  const free = [...st.items.values()].filter((i) => !i.done && !i.claimedBy)
  const cards = []
  for (const m of members) {
    const a = await agenda(Date.now(), { member: m, recs: [rec], undated: true })
    const open = a.late.length + a.today.length + a.tomorrow.length + a.later.length + a.nodate.length
    cards.push({ m, a, open, done: doneThisWeek(st, m) })
  }
  cards.sort((x, y) => y.open - x.open)
  const line = (x, { showDay = false, noTime = false } = {}) => `<li><button class="row" type="button" data-open='${esc(JSON.stringify(x.ref || {}))}' style="width:100%;text-align:start;font:inherit;color:inherit;border:0">
    ${noTime ? '' : `<span class="when-col">${x.allDay ? '<span class="small muted">כל היום</span>' : `<b>${hhmm(x.at)}</b>`}${showDay ? `<span class="small muted">${new Intl.DateTimeFormat('he-IL', { weekday: 'short' }).format(new Date(x.at))}</span>` : ''}</span>`}
    <span class="emo" aria-hidden="true">${esc(x.emoji)}</span>
    <span class="what" style="padding:0"><span class="t">${esc(x.name)}</span>${x.note ? `<span class="s${x.late ? ' warn' : ''}">${esc(x.note)}</span>` : ''}</span></button></li>`
  const part = (title, list, opts) => (list.length ? `<span class="lbl" style="margin-top:10px">${title}</span><ul class="list" style="margin-top:4px">${list.map((x) => line(x, opts)).join('')}</ul>` : '')
  const hasPush = new Map((rec.members || []).map((x) => [x.id, x.push]))
  const known = (rec.members || []).some((x) => typeof x.push === 'boolean')
  const card = ({ m, a, open, done }) => {
    const w = who(st, rec, m)
    return `<section class="poll team-card" aria-label="${esc(w.name)}">
      <div style="display:flex;align-items:center;gap:10px">${duck(w.look, 52, { crown: w.admin })}
        <div style="flex:1;min-width:0"><div class="q" style="margin:0">${esc(w.name)}${admin && known && hasPush.get(m) === false ? ' <span class="small muted" title="בלי התראות">🔕</span>' : ''}</div>
          <span class="small muted">${open ? count(open, 'דבר אחד פתוח', 'דברים פתוחים') : 'אין כלום פתוח'} · ${done ? count(done, 'בוצע אחד השבוע', 'בוצעו השבוע') : 'עוד כלום השבוע'}</span></div>
        ${admin && m !== me() && open ? `<button class="pill soft" type="button" data-nudge="${m}" data-n="${open}">👋 תזכורת</button>` : ''}</div>
      ${part('באיחור', a.late)}${part('היום', a.today)}${part('מחר', a.tomorrow)}${part('השבוע', a.later, { showDay: true })}${part(event ? 'מביא/ה' : 'בלי תאריך', a.nodate, { noTime: true })}
    </section>`
  }
  $app.innerHTML = `<main class="screen">
    <header class="top"><a class="icon-btn" href="#/y/${id}" aria-label="חזרה לחצר">${ICON.back}</a><h1>מי עושה מה<span class="sub">${esc(st.meta.emoji)} ${esc(st.meta.name)} · ${admin ? (st.meta.open ? 'כל החצר רואה את זה' : `רק ${g('את רואה', 'אתה רואה')} את זה`) : 'לצפייה'}</span></h1></header>
    ${free.length ? `<section class="poll" aria-label="בלי אף אחד" style="background:var(--highlight-soft)"><div class="q">👀 בלי אף אחד (${free.length})</div>
      <ul class="list" style="margin-top:4px">${free.map((it) => `<li class="row"><span class="what" style="padding:0"><span class="t">${esc(it.name)}</span>${it.due ? `<span class="s">⏰ ${esc(whenShort(Date.parse(it.due)))}</span>` : ''}</span>${admin ? `<button class="pill" type="button" data-give="${it.id}">לשייך</button>` : ''}</li>`).join('')}</ul></section>` : ''}
    ${admin && known ? `<p class="small muted" style="margin:10px 4px 0">🔔 ${[...hasPush.values()].filter(Boolean).length} מתוך ${hasPush.size} מקבלים התראות. ל־🔕 תזכורות לא יגיעו: אפשר להזכיר בוואטסאפ, או לבקש שיוסיפו ליומן.</p>` : ''}
    ${cards.map(card).join('')}
  </main>`
  $app.querySelectorAll('[data-give]').forEach((b) => (b.onclick = () => assignSheet(id, { item: b.dataset.give })))
  $app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
    const ref = JSON.parse(b.dataset.open)
    if (ref.chore) choreSheet(id, ref.chore)
    else if (ref.item) itemSheet(id, ref.item)
  }))
  $app.querySelectorAll('[data-nudge]').forEach((b) => (b.onclick = async () => {
    const m = b.dataset.nudge
    const n = Number(b.dataset.n)
    const myName = identity.profile()?.nickname || ''
    busy(b, true)
    const ok = await act(() => Y.post(id, [{ t: 'nudge', to: m }], { go: '#/today', body: `👋 ${myName}: ${n === 1 ? 'יש דבר אחד שמחכה לך' : `יש ${n} דברים שמחכים לך`} בחצר`, to: [m] }))
    busy(b, false)
    if (ok !== undefined) toast(`נשלחה תזכורת ל${who(st, rec, m).name}`)
  }))
}

// ---------- My duckling ----------

function meScreen() {
  const p = identity.profile() || {}
  const st = push.status()
  const pushRow = {
    'needs-install': `<p class="muted">באייפון, התראות עובדות אחרי שמוסיפים את החצר למסך הבית.</p><button class="btn btn-soft" id="install" type="button">איך מוסיפים?</button>`,
    unsupported: '<p class="muted">הדפדפן הזה לא תומך בהתראות.</p>',
    'needs-duck': '',
    denied: '<p class="muted">ההתראות חסומות בהגדרות הטלפון. אפשר לאפשר אותן שם ולחזור לכאן.</p>',
    on: '<p class="muted">ההתראות פועלות. אפשר להשתיק חצר מסוימת מהתפריט שלה.</p><div class="stack"><button class="btn btn-soft" id="pushtest" type="button">🔔 לשלוח לי התראת ניסיון</button><button class="btn btn-ghost" id="pushoff" type="button">לכבות התראות</button></div>',
    off: '<button class="btn btn-soft" id="pushon" type="button">להפעיל התראות</button>',
  }[st]
  $app.innerHTML = `<main class="screen">
    <header class="top"><a class="icon-btn" href="#/" aria-label="חזרה">${ICON.back}</a><h1>הברווזון שלי</h1></header>
    <div class="preview-wrap" id="preview">${duck(p, 150)}</div>
    <div id="save">${saveCard()}</div>
    <form id="f" novalidate>${duckForm(p, { pets: true })}<p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">שמירה</button></form>
    <h2 class="section">התראות</h2>${pushRow}
    <label class="toggle-row"><input type="checkbox" id="morning" ${settings.morning === false ? '' : 'checked'}><span><b>☀️ סיכום בוקר</b><br><span class="small muted">ב־8:00, בחצרות של הבית: מה מחכה לך היום. רק אם יש משהו.</span></span></label>
    <h2 class="section">יש לי קישור</h2>
    <button class="btn btn-ghost" id="paste" type="button">הדבקת קישור הזמנה</button>
    <h2 class="section">פרטיות</h2>
    <button class="link-btn" type="button" data-privacy style="padding:0">מדיניות הפרטיות המלאה</button>
    <p class="muted">אין חשבון, אין מספר טלפון. השמות, הרשימות, ההודעות והתמונות מוצפנים בטלפון לפני שהם יוצאים ממנו, והשרת לא יכול לקרוא אותם.</p>
    <p class="small muted" style="margin-top:24px">החצר ${APP_VERSION}</p>
  </main>`
  const read = bindDuckForm($app, (s) => ($app.querySelector('#preview').innerHTML = duck(s, 150)), p)
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const v = read()
    if (!identity.validName(v.nickname)) return ($app.querySelector('#err').textContent = 'שם באורך 2–20 תווים, בבקשה')
    await act(async () => {
      await identity.saveProfile(v)
      toast('נשמר 🐥')
      Y.refreshAll().catch(() => undefined) // tells the yards about the new look
      V.refreshSaved() // and the saved copy
    })
  }
  const bindSave = () => bindSaveCard($app.querySelector('#save'), () => {
    $app.querySelector('#save').innerHTML = saveCard()
    bindSave()
  })
  bindSave()
  $app.querySelector('#install')?.addEventListener('click', installSheet)
  $app.querySelector('#morning').onchange = (e) => {
    settings = { ...settings, morning: e.target.checked }
    db.saveSettings(settings)
    Y.refreshAll().catch(() => undefined) // the yards learn it with the profile, and the reminders follow
    toast(e.target.checked ? 'סיכום בוקר: פועל ☀️' : 'סיכום בוקר: כבוי')
  }
  bindPrivacyLinks($app)
  $app.querySelector('#paste').onclick = quickPaste
  $app.querySelector('#pushon')?.addEventListener('click', async () => {
    if (await turnPushOn()) meScreen()
  })
  $app.querySelector('#pushtest')?.addEventListener('click', (e) => act(async () => {
    busy(e.currentTarget, true, 'שולחת…')
    const r = await push.test().finally(() => busy(e.currentTarget, false))
    toast(r?.ok ? 'נשלחה! אם לא הגיעה תוך דקה, בודקים בהגדרות הטלפון ← החצר ← התראות' : 'לא הצלחתי לשלוח. אפשר לכבות ולהפעיל שוב')
  }))
  $app.querySelector('#pushoff')?.addEventListener('click', () => act(async () => {
    await push.disable()
    meScreen()
  }))
}

// ---------- Start ----------

window.addEventListener('hashchange', () => {
  if (sheet && !history.state?.sheet) closeSheetNow()
  render()
})
window.addEventListener('online', () => {
  if (identity.load()?.keys) Y.refreshAll().then(() => render(true)).catch(() => undefined)
  render(true)
})
window.addEventListener('offline', () => render(true))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pollIdle = 0
  if (document.visibilityState === 'visible' && identity.load()?.keys && view.name !== 'join') {
    ;(view.id ? Y.refresh(view.id) : Y.refreshAll()).then((n) => n && render(true)).catch(() => undefined)
  }
})

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register('sw.js').catch(() => undefined)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.nav) location.hash = e.data.nav
    // A notification arrived while the app is open: fetch that yard now, instead of waiting for the next check.
    if (e.data?.news && identity.load()?.keys) {
      pollIdle = 0
      const yid = /^[\w-]+$/.test(e.data.news) ? e.data.news : null
      ;(yid ? Y.refresh(yid) : Y.refreshAll()).then((n) => n && render(true)).catch(() => undefined)
    }
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('גרסה חדשה של החצר מוכנה', { label: 'רענון', run: () => location.reload() })
  })
}

;(async () => {
  await render()
  document.getElementById('splash')?.classList.add('out')
  setTimeout(() => document.getElementById('splash')?.remove(), 200)
  if (identity.load()?.keys) {
    push.refresh().catch(() => undefined)
    if (view.name === 'home') Y.refreshAll().then((n) => n && render(true)).catch(() => undefined)
    setTimeout(askVoice, 900)
  }
})()
