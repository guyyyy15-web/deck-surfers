// החצר: screens, router and sheets. Data lives in yard.js (encrypted yards) and identity.js (your duckling).
import * as Y from './yard.js'
import * as identity from './identity.js'
import * as db from './db.js'
import * as push from './push.js'
import * as V from './vault.js'
import { duck, DUCK_COLORS, ACCESSORIES } from './duck.js'
import { shrinkFile, photoUrl } from './images.js'

export const APP_VERSION = '0.4.0'

// The same files are also on GitHub Pages (this repo); the real home is hechatzer.pages.dev.
if (/github\.io$/.test(location.hostname)) location.replace(`https://hechatzer.pages.dev/${location.hash}`)

const $app = document.getElementById('app')
let settings = db.loadSettings()
const g = (f, m) => (settings.voice === 'm' ? m : f)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const me = () => identity.myId()

const ICON = {
  back: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  plus: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>',
  camera: '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
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
const count = (n, one, many) => (n === 1 ? one : `${n} ${many}`)

/** A member's display: their duckling and name, from the yard's profiles. `w.g(f, m)` speaks about them. */
function who(st, rec, id) {
  const p = st.profiles.get(id) || {}
  const role = (rec?.members || []).find((m) => m.id === id)?.role
  const voice = id === me() ? settings.voice : p.voice
  return {
    name: id === me() ? g('את', 'אתה') : p.nickname || 'ברווזון', look: p, admin: role === 'admin',
    g: (f, m) => (voice === 'm' ? m : voice === 'f' ? f : `${m}/${f.slice(-1)}`),
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
  const h = decodeURIComponent(location.hash.slice(1)) || '/'
  let m
  if ((m = /^\/join\/(.+)$/.exec(h))) return { name: 'join', id: m[1] }
  if ((m = /^\/y\/([\w-]+)\/chat$/.exec(h))) return { name: 'chat', id: m[1] }
  if ((m = /^\/y\/([\w-]+)$/.exec(h))) return { name: 'yard', id: m[1] }
  if (h === '/me') return { name: 'me' }
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
  if (soft && active?.matches?.('input, textarea') && $app.contains(active)) return // never yank the keyboard away
  if (!identity.load()?.keys && view.name !== 'join') return welcome()
  if (view.name === 'join') await joinScreen(view.id)
  else if (view.name === 'yard') await yardScreen(view.id)
  else if (view.name === 'chat') await chatScreen(view.id)
  else if (view.name === 'me') meScreen()
  else await homeScreen()
  if (same) scrollTo(0, y)
  else scrollTo(0, 0)
  schedulePoll()
}

function schedulePoll() {
  clearTimeout(pollTimer)
  const ms = view.name === 'yard' || view.name === 'chat' ? 12e3 : 45e3
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && navigator.onLine && identity.load()?.keys) {
      try {
        const added = view.id && view.name !== 'join' ? await Y.refresh(view.id) : await Y.refreshAll()
        if (added) await render(true)
      } catch (e) {
        if (e.code === 'removed' && view.id) {
          toast('הוצאת מהחצר הזאת')
          return go('#/')
        }
      }
    }
    schedulePoll()
  }, ms)
}

// ---------- Welcome (first launch) ----------

function parade(ducks) {
  return `<div class="parade" role="img" aria-label="ברווזונים הולכים אחרי אמא ברווזה">${ducks.join('')}</div>`
}
const demoParade = () => parade([
  duck({ color: 'sun' }, 90, { crown: true }), duck({ color: 'mint', accessory: 'cap' }, 60), duck({ color: 'pink', accessory: 'shades' }, 56), duck({ color: 'sky' }, 52),
])

/** The duckling form: name, color, accessory, and how the app speaks to you. */
const PETS = [
  { id: 'none', label: 'אין' },
  { id: 'dog', label: 'כלב 🐕' },
  { id: 'cat', label: 'חתול 🐈' },
  { id: 'other', label: 'אחר 🐾' },
]
const hasPet = () => !!settings.pet && settings.pet !== 'none'

function duckForm(p = {}, { compact = false, pets = false } = {}) {
  const color = p.color || 'sun'
  const acc = p.accessory || 'none'
  return `
    <label class="lbl" for="nick">איך קוראים לך?</label>
    <input class="input" id="nick" maxlength="20" autocomplete="nickname" value="${esc(p.nickname || '')}" placeholder="השם שיראו בחצר">
    <span class="lbl" id="clr-l">הצבע של הברווזון</span>
    <div class="swatches" role="group" aria-labelledby="clr-l">${DUCK_COLORS.map((c) => `<button type="button" class="swatch" data-color="${c.id}" aria-label="${c.label}" aria-pressed="${c.id === color}" style="background:${c.fill}"></button>`).join('')}</div>
    ${compact ? `<input type="hidden" id="acc" value="${esc(acc)}">` : `
    <span class="lbl" id="acc-l">ואיזה אביזר?</span>
    <div class="choices" role="group" aria-labelledby="acc-l">${ACCESSORIES.map((a) => `<button type="button" class="choice" data-acc="${a.id}" aria-pressed="${a.id === acc}">${duck({ color, accessory: a.id }, 30)}${a.label}</button>`).join('')}</div>`}
    <span class="lbl" id="voice-l">איך לפנות אלייך? אני…</span>
    <div class="choices" role="group" aria-labelledby="voice-l">
      <button type="button" class="choice" data-voice="f" aria-pressed="${settings.voice !== 'm'}">אישה</button>
      <button type="button" class="choice" data-voice="m" aria-pressed="${settings.voice === 'm'}">גבר</button>
    </div>
    ${pets ? `<span class="lbl" id="pet-l">יש בעל חיים בבית?</span>
    <div class="choices" role="group" aria-labelledby="pet-l">${PETS.map((x) => `<button type="button" class="choice" data-pet="${x.id}" aria-pressed="${(settings.pet || 'none') === x.id}">${x.label}</button>`).join('')}</div>
    <p class="small muted" style="margin:4px 0 0">ככה נציע גם מטלות כמו טיול עם הכלב.</p>` : ''}`
}
function bindDuckForm(root, onChange = () => undefined) {
  const state = {
    color: root.querySelector('.swatch[aria-pressed="true"]')?.dataset.color || 'sun',
    accessory: root.querySelector('.choice[data-acc][aria-pressed="true"]')?.dataset.acc || root.querySelector('#acc')?.value || 'none',
  }
  const press = (sel, el) => root.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b === el)))
  root.querySelectorAll('.swatch').forEach((b) => (b.onclick = () => {
    press('.swatch', b)
    state.color = b.dataset.color
    onChange(state)
  }))
  root.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => {
    press('[data-acc]', b)
    state.accessory = b.dataset.acc
    onChange(state)
  }))
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
  return () => ({ nickname: root.querySelector('#nick').value, color: state.color, accessory: state.accessory })
}

function welcome() {
  $app.innerHTML = `<main class="hero">
    <div class="hill hill-a" aria-hidden="true"></div><div class="hill hill-b" aria-hidden="true"></div>
    <span class="tag">מי מביא מה, תור מי</span>
    <h1>${g('ברוכה הבאה', 'ברוך הבא')} לחצר</h1>
    <p class="lead">מנגל, ארוחת שישי, יום הולדת או מטלות הבית: כולם רואים מה חסר, לוקחים בלחיצה, ואף אחד לא שוכח.</p>
    ${demoParade()}
    <form class="panel" id="f" novalidate>${duckForm({}, { compact: true, pets: true })}<p class="err" id="err" role="alert"></p>
<label class="choice" style="margin-top:12px;width:100%;justify-content:flex-start;gap:10px;padding:10px 14px;border-radius:16px;min-height:52px">
        <input type="checkbox" id="age" style="width:22px;height:22px;flex:none;accent-color:var(--green)">
        <span style="font-size:14px;line-height:20px">${g('אני בת 13 ומעלה ומסכימה', 'אני בן 13 ומעלה ומסכים')} ל<button type="button" class="link-btn" data-privacy style="min-height:auto;padding:0;font-size:14px">מדיניות הפרטיות</button></span></label>
      <button class="btn btn-primary btn-wide" type="submit" style="margin-top:12px">יאללה, לחצר! 🦆</button></form>
    <button type="button" class="link-btn" id="signin" style="font-weight:700">כבר יש לי ברווזון</button>
    <button type="button" class="link-btn" id="paste">יש לי קישור הזמנה</button>
    <p class="fine">בלי הרשמה, בלי מספר טלפון. הכל מוצפן בטלפון שלך.</p>
  </main>`
  const read = bindDuckForm($app)
  bindPrivacyLinks($app)
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const v = read()
    if (!identity.validName(v.nickname)) return ($app.querySelector('#err').textContent = 'שם באורך 2–20 תווים, בבקשה')
    if (!agreed()) return ($app.querySelector('#err').textContent = 'צריך לאשר גיל 13 ומעלה ואת מדיניות הפרטיות')
    await act(async () => {
      await identity.saveProfile(v)
      db.persist()
      location.hash = '#/'
      await render()
    })
  }
  $app.querySelector('#paste').onclick = pasteSheet
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

/** The age/privacy box on the form: checked now, remembered for later. */
function agreed() {
  const box = $app.querySelector('#age')
  if (!box?.checked) return false
  settings = { ...settings, agreedAt: new Date().toISOString() }
  db.saveSettings(settings)
  return true
}
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
      <p style="margin:0"><b>מה השרת רואה:</b> מזהה אקראי לכל ברווזון (לא שם), לאילו חצרות הוא שייך, מתי נשלח משהו ובאיזה גודל, ואם הפעלת התראות, את הכתובת הטכנית לשליחה אליהן. הגנה מעומס שומרת מונה שעתי לפי תמצית מוצפנת של כתובת הרשת, שמתחלפת כל יום.</p>
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
    const unread = Y.unread(rec, myId)
    const last = rec.events.at(-1)?.at || ''
    return { last, alert, html: `<a class="yard-card" href="#/y/${rec.id}">
      <span class="tile ${st.meta.kind}" aria-hidden="true">${esc(st.meta.emoji)}</span>
      <span class="body"><span class="name">${esc(st.meta.name)}</span><span class="meta">${meta}</span>${bar}</span>
      ${unread ? `<span class="badge" aria-label="${unread} חדשים">${unread > 99 ? '99+' : unread}</span>` : ''}</a>` }
  }).sort((a, b) => (a.last < b.last ? 1 : -1))
  const waiting = cards.reduce((n, c) => n + c.alert, 0)
  push.setBadge(recs.reduce((n, r) => n + Y.unread(r, myId), 0))
  const p = identity.profile()
  const showSave = recs.length > 0 && !V.saved().length && !settings.hideSave
  const showInstall = !showSave && !push.standalone() && !settings.hideInstall && recs.length > 0
  $app.innerHTML = `<main class="screen">
    ${navigator.onLine ? '' : '<div class="offline">אין רשת כרגע. מה שתעשי יישלח כשתחזרי</div>'}
    <header class="top"><h1>החצרות שלי</h1><a class="me-btn" href="#/me" aria-label="הברווזון שלי">${duck(p, 48)}</a></header>
    <p class="lead">שלום ${esc(p?.nickname)} 🦆${waiting ? ` יש ${count(waiting, 'דבר אחד', 'דברים')} ${waiting === 1 ? 'שמחכה' : 'שמחכים'} לך` : ''}</p>
    ${cards.length ? `<div class="cards">${cards.map((c) => c.html).join('')}</div>` : `
      <div class="empty">${demoParade()}<b>עוד אין חצרות</b><span>${g('פתחי', 'פתח')} חצר ו${g('הזמיני', 'הזמן')} את החבר׳ה, או ${g('בקשי', 'בקש')} קישור ממי שמארגנ/ת.</span></div>`}
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:22px">
      <button class="btn btn-soft" id="new" type="button">${ICON.plus} חצר חדשה</button>
      <button class="link-btn" id="paste" type="button">יש לי קישור הזמנה</button>
    </div>
    ${showSave ? `<div class="nudge" style="margin-top:22px"><span style="flex:1"><b>${g('שמרי', 'שמור')} את הברווזון</b>, כדי לא לאבד את החצרות אם הטלפון מתחלף.</span><a class="pill soft" href="#/me" style="display:inline-flex;align-items:center;text-decoration:none">${g('לשמירה', 'לשמירה')}</a></div>` : ''}
    ${showInstall ? `<div class="nudge" style="margin-top:22px"><span style="flex:1">רוצה לדעת כשתורך? ${g('הוסיפי', 'הוסף')} את החצר למסך הבית.</span><button class="pill soft" id="install" type="button">איך?</button></div>` : ''}
  </main>`
  $app.querySelector('#new').onclick = newYardSheet
  $app.querySelector('#paste').onclick = pasteSheet
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
const everyOptions = (sel = 'week') => Object.entries(Y.EVERY).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v.label}</option>`).join('')
const EVENT_EMOJI = ['🔥', '🎂', '🍷', '🧺', '🎉', '🏖️', '🎄', '🥳']
const HOME_EMOJI = ['🏡', '🏠', '🛋️', '🧹', '🪴', '🐕']

function newYardSheet() {
  let kind = null
  openSheet(`<h2>חצר חדשה</h2><p class="lead">מה מארגנים?</p>
    <div class="kind-cards" style="margin-top:14px">
      <button type="button" class="kind" data-kind="event" aria-pressed="false"><span class="k-emo" aria-hidden="true">🔥</span><span class="k-t">אירוע</span><span class="k-s">מנגל, שישי, יום הולדת: מי מביא מה</span></button>
      <button type="button" class="kind" data-kind="home" aria-pressed="false"><span class="k-emo" aria-hidden="true">🏡</span><span class="k-t">הבית</span><span class="k-s">מטלות בתורות, משימות וקניות</span></button>
    </div>
    <form id="details" hidden novalidate></form>`, (root) => {
    const form = root.querySelector('#details')
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
        <span class="lbl" id="ch-l">מטלות בתורות (בוחרים כמה שרוצים, אפשר לשנות אחר כך)</span>
        <div class="choices" role="group" aria-labelledby="ch-l">${choreIdeas().map((c) => `<button type="button" class="choice" data-chore="${CHORE_STARTERS.indexOf(c)}" aria-pressed="${!!c.on}">${c.emoji} ${c.name}</button>`).join('')}</div>
        ${hasPet() ? '' : '<p class="small muted" style="margin:6px 0 0">יש בעל חיים? אפשר לציין במסך "הברווזון שלי", ונציע גם מטלות כמו טיול עם הכלב.</p>'}
        <label class="lbl" for="cchore">מטלה משלך</label>
        <div class="add-row" style="margin-top:0"><input class="input" id="cchore" maxlength="40" placeholder="למשל: להאכיל את הדגים" autocomplete="off" enterkeyhint="done">
          <label class="sr" for="cevery">כל כמה זמן</label><select class="input" id="cevery" style="flex:0 0 auto;width:auto;padding:0 10px">${everyOptions('week')}</select>
          <button class="add-btn" id="cchore-add" type="button" aria-label="הוספת מטלה">${ICON.plus}</button></div>
        <div class="choices" id="cchores" style="margin-top:8px"></div>
        <span class="lbl" id="emo-l">אימוג׳י</span>
        <div class="choices" role="group" aria-labelledby="emo-l">${HOME_EMOJI.map((e, i) => `<button type="button" class="choice" data-emo="${e}" aria-pressed="${i === 0}" aria-label="${e}">${e}</button>`).join('')}</div>`
      form.insertAdjacentHTML('beforeend', '<p class="err" id="err" role="alert"></p><button class="btn btn-primary btn-wide" type="submit">פותחים חצר! 🐥</button>')
      const single = (sel) => form.querySelectorAll(sel).forEach((x) => (x.onclick = () => form.querySelectorAll(sel).forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
      single('[data-tpl]')
      single('[data-emo]')
      form.querySelectorAll('[data-tpl]').forEach((x) => x.addEventListener('click', () => {
        const t = TEMPLATES[x.dataset.tpl]
        const em = form.querySelector(`[data-emo="${t.emoji}"]`)
        if (em) form.querySelectorAll('[data-emo]').forEach((y) => y.setAttribute('aria-pressed', String(y === em)))
      }))
      form.querySelectorAll('[data-chore]').forEach((x) => (x.onclick = () => x.setAttribute('aria-pressed', String(x.getAttribute('aria-pressed') !== 'true'))))
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
      addOwn('#cchore', '#cchores', (name) => {
        const every = form.querySelector('#cevery').value
        return { kind: 'chore', name, every, label: `✨ ${name} · ${Y.EVERY[every].label}` }
      })
      addOwn('#citem', '#citems', (name) => ({ kind: 'item', name, label: name }))
      form.querySelector('#yname').focus()
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
        starters = [...tpl.items, ...own].map((n) => ({ t: 'item.put', id: Y.newId('t'), name: n }))
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
  hero(`
    <span class="tag">${opener?.nickname ? `${esc(opener.nickname)} ${opener.voice === 'm' ? 'מזמין' : opener.voice === 'f' ? 'מזמינה' : 'מזמין/ה'} אותך לחצר` : 'הזמנה לחצר'}</span>
    <h1>${esc(st.meta.name)} ${esc(st.meta.emoji)}</h1>
    <p class="lead">${lead}</p>
    ${parade(ducks)}
    <form class="panel" id="f" novalidate>
      ${p ? `<div class="member">${duck(p, 48)}<span class="n">${g('תיכנסי', 'תיכנס')} בתור <b>${esc(p.nickname)}</b></span><a class="link-btn" href="#/me">שינוי</a></div>` : `${duckForm({}, { compact: true })}<label class="choice" style="margin-top:12px;width:100%;justify-content:flex-start;gap:10px;padding:10px 14px;border-radius:16px;min-height:52px">
        <input type="checkbox" id="age" style="width:22px;height:22px;flex:none;accent-color:var(--green)">
        <span style="font-size:14px;line-height:20px">${g('אני בת 13 ומעלה ומסכימה', 'אני בן 13 ומעלה ומסכים')} ל<button type="button" class="link-btn" data-privacy style="min-height:auto;padding:0;font-size:14px">מדיניות הפרטיות</button></span></label><button class="link-btn" type="button" id="signin" style="margin-top:6px">כבר יש לי ברווזון? כניסה</button>`}
      ${peek.full ? '<p class="err">החצר מלאה (20 ברווזונים). אי אפשר להצטרף כרגע.</p>' : '<p class="err" id="err" role="alert"></p>'}
      <button class="btn btn-primary btn-wide" type="submit" ${peek.full ? 'disabled' : ''}>אני בחצר! 🦆</button>
    </form>
    <p class="fine">בלי הרשמה ובלי להתקין. אפשר להוסיף למסך הבית אחר כך, בשביל התראות.</p>`)
  const read = p ? null : bindDuckForm($app)
  bindPrivacyLinks($app)
  $app.querySelector('#signin')?.addEventListener('click', () => signInSheet(() => joinScreen(code)))
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    if (read) {
      const v = read()
      if (!identity.validName(v.nickname)) return ($app.querySelector('#err').textContent = 'שם באורך 2–20 תווים, בבקשה')
      if (!agreed()) return ($app.querySelector('#err').textContent = 'צריך לאשר גיל 13 ומעלה ואת מדיניות הפרטיות')
      await identity.saveProfile(v)
      db.persist()
    }
    const btn = $app.querySelector('[type="submit"]')
    busy(btn, true, 'נכנסת…')
    const id = await act(() => Y.joinInvite(code))
    busy(btn, false)
    if (id) location.replace(`#/y/${id}`)
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
  const body = st.meta.kind === 'home' ? homeYardBody(rec, st, roles, myId) : eventYardBody(rec, st, myId)
  const polls = [...st.polls.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((p) => pollCard(rec, st, p, myId, isAdmin)).join('')
  const unreadChat = st.chat.filter((c) => c.author !== myId && rec.events.find((e) => e.ev?.cid === c.cid)?.seq > (rec.seenSeq || 0)).length
  $app.innerHTML = `<main class="screen">
    ${navigator.onLine ? pending : '<div class="offline">אין רשת כרגע. מה שתעשי יישלח כשתחזרי</div>'}
    <header class="top">
      <a class="icon-btn" href="#/" aria-label="חזרה לחצרות">${ICON.back}</a>
      <h1>${esc(st.meta.name)} ${esc(st.meta.emoji)}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>
      <button class="icon-btn" id="menu" type="button" aria-label="אפשרויות החצר">${ICON.dots}</button>
    </header>
    ${isAdmin && Y.openReports(st).length ? `<div class="nudge" style="background:var(--tile-orange)"><span style="flex:1">🚩 ${count(Y.openReports(st).length, 'דיווח פתוח', 'דיווחים פתוחים')} בחצר</span><button class="pill soft" id="reports" type="button">לטפל</button></div>` : ''}
    ${body}
    ${polls}
    <div class="actions-bar">
      <button class="chip-btn" id="invite" type="button">🐥 הזמנה</button>
      <button class="chip-btn" id="poll" type="button">📊 הצבעה</button>
      <a class="chip-btn" href="#/y/${id}/chat">💬 צ׳אט${unreadChat ? ` <span class="badge">${unreadChat}</span>` : ''}</a>
    </div>
  </main>`
  bindYard(rec, st, roles, myId)
  if (!st.chat.some((c) => c.author !== myId && rec.events.find((e) => e.ev?.cid === c.cid)?.seq > (rec.seenSeq || 0))) Y.markSeen(id)
}

function eventYardBody(rec, st, myId) {
  const b = Y.eventBoard(st, myId)
  const mother = duck(who(st, rec, (rec.members || []).find((m) => m.role === 'admin')?.id).look, 44, { crown: true })
  const nudge = !b.total
    ? `<div class="nudge">${mother}<span>הרשימה ריקה. מה צריך להביא?</span></div>`
    : b.free.length
      ? `<div class="nudge">${mother}<span><b>גאגא!</b> עוד ${count(b.free.length, 'דבר אחד', 'דברים')} שאף אחד לא לקח 👀</span></div>`
      : '<div class="nudge party"><span>🎉</span><span><b>הכל נלקח!</b> החצר מוכנה.</span></div>'
  const row = (it) => {
    const qty = it.qty ? ` (${esc(it.qty)})` : ''
    let side
    let cls = 'row'
    if (!it.claimedBy) side = `<button class="pill" type="button" data-claim="${it.id}">${g('אני מביאה!', 'אני מביא!')}</button>`
    else {
      const w = who(st, rec, it.claimedBy)
      if (it.claimedBy === myId) cls += ' mine'
      side = `<span class="who">${duckOf(st, rec, it.claimedBy)}${esc(w.name)}${it.claimedBy === myId ? '' : ' ✓'}</span>`
    }
    return `<li class="${cls}"><button class="what" type="button" data-item="${it.id}"><span class="t">${esc(it.name)}${qty}</span></button>${side}</li>`
  }
  return `${nudge}
    ${b.total ? `<div class="progress"><span class="bar" aria-hidden="true"><span style="width:${Math.round((b.taken / b.total) * 100)}%"></span></span><span style="font-size:14px;font-weight:700">${b.taken} מתוך ${b.total}</span></div>` : ''}
    <ul class="list">${[...b.free, ...b.mine, ...b.others].map(row).join('')}</ul>
    <form class="add-row" id="add" novalidate><label class="sr" for="addin">פריט חדש</label>
      <input class="input" id="addin" maxlength="60" placeholder="מה עוד צריך? למשל: קרח" autocomplete="off" enterkeyhint="done">
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
      <span class="what">${esc(c.name)} · ${dueText(c)}</span>
      ${note ? `<span class="note">${esc(note)}</span>` : ''}
      <div class="actions"><button class="done-btn" type="button" data-cdone="${c.id}">בוצע + הוכחה</button>${next && next !== myId ? `<button class="pass-btn" type="button" data-pass="${c.id}">להעביר ל${esc(who(st, rec, next).name)}</button>` : ''}</div>
    </section>`
  }).join('')
  const choreRow = (c) => {
    const mine = c.turn === myId
    const s = mine ? `<span class="s ${c.due === 'soon' ? '' : 'warn'}">תורך · ${dueText(c)}</span>` : `<span class="s">${esc(who(st, rec, c.turn).name)} · ${dueText(c)}</span>`
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

function pollCard(rec, st, p, myId, isAdmin) {
  const counts = Y.pollResults(p)
  const total = counts.reduce((a, b) => a + b, 0)
  const mine = p.votes.get(myId)
  const faces = (i) => [...p.votes].filter(([, o]) => o === i).slice(0, 4).map(([m]) => duckOf(st, rec, m, 22)).join('')
  return `<section class="poll" aria-label="הצבעה">
    <div class="q">📊 ${esc(p.q)}${p.closed ? ' <span class="small muted">(נסגרה)</span>' : ''}</div>
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
  $('#reports')?.addEventListener('click', () => reportsSheet(id))
  $('#invite').onclick = () => inviteSheet(id)
  $('#poll').onclick = () => pollSheet(id)
  $('#newchore')?.addEventListener('click', () => newChoreSheet(id))
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
  $('#add').onsubmit = async (e) => {
    e.preventDefault()
    const input = $('#addin')
    const name = input.value.trim()
    if (!name) return input.focus()
    const itemId = Y.newId('t')
    const p = identity.profile()
    input.value = ''
    await act(async () => {
      await Y.post(id, [{ t: 'item.put', id: itemId, name }], st.meta.kind === 'event' ? { body: `${p.nickname}: הוספתי לרשימה ${name}` } : { body: `${p.nickname}: משימה חדשה, ${name}` })
      await render(true)
      $app.querySelector('#addin')?.focus()
      toast(`נוסף: ${name}`, { label: st.meta.kind === 'event' ? g('ואני מביאה', 'ואני מביא') : 'ואני על זה', run: () => claim(id, itemId, true) })
    })
  }
}

async function claim(id, itemId, on, btn) {
  busy(btn, true)
  await act(async () => {
    await Y.post(id, [{ t: 'item.claim', id: itemId, on }])
    const st = Y.stateOf(await Y.localYard(id))
    const it = st.items.get(itemId)
    if (on && it && it.claimedBy !== me()) {
      const w = who(st, null, it.claimedBy)
      toast(`${w.name} ${w.g('הקדימה', 'הקדים')} אותך 🙈`)
    }
  })
  await closeSheet()
  await render(true)
  maybeAskPush()
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
  await act(() => Y.post(id, [{ t: 'chore.pass', id: choreId }], { body: `תורך! ${c.emoji} ${c.name} (העברה מ${identity.profile().nickname})`, to: [next] }))
  toast(`העברת ל${who(st, rec, next).name}`)
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
  const status = it.done
    ? `${who(st, rec, it.doneBy).name} · בוצע ${relDay(it.doneAt)} ✓`
    : it.claimedBy ? (() => {
      const w = who(st, rec, it.claimedBy)
      return `${w.name} ${event ? (it.claimedBy === myId ? g('מביאה', 'מביא') : w.g('מביאה', 'מביא')) : 'על זה'}`
    })() : 'אף אחד לא לקח עדיין'
  const btns = []
  if (!it.done && !it.claimedBy) btns.push(`<button class="btn btn-primary" data-a="claim">${event ? g('אני מביאה!', 'אני מביא!') : 'אני על זה!'}</button>`)
  if (!event && !it.done && (it.claimedBy === myId || !it.claimedBy)) btns.push('<button class="btn btn-soft" data-a="done">בוצע + הוכחה</button>')
  if (!it.done && it.claimedBy && (it.claimedBy === myId || isAdmin)) btns.push(`<button class="btn btn-ghost" data-a="unclaim">${it.claimedBy === myId ? 'בעצם לא אוכל' : 'לשחרר את הפריט'}</button>`)
  if (it.done && (it.doneBy === myId || isAdmin)) btns.push('<button class="btn btn-ghost" data-a="undone">לבטל את הסימון</button>')
  openSheet(`<h2>${esc(it.name)}${it.qty ? ` (${esc(it.qty)})` : ''}</h2>
    <p class="lead">${esc(status)}</p>
    ${it.photoId && !st.hidden.has(it.photoId) ? `<img data-photo="${it.photoId}" alt="תמונת הוכחה" style="width:100%;border-radius:18px;margin-top:12px"><button class="link-btn" type="button" data-photoact="${it.photoId}">${isAdmin ? 'הסתרת התמונה מכולם' : 'דיווח על התמונה'}</button>` : ''}
    <div class="stack">${btns.join('')}</div>
    ${canEdit ? `<form id="edit" novalidate><label class="lbl" for="iname">שם</label><input class="input" id="iname" maxlength="60" value="${esc(it.name)}">
      <label class="lbl" for="iqty">כמה? (לא חובה)</label><input class="input" id="iqty" maxlength="20" value="${esc(it.qty || '')}" placeholder="למשל: 20, 2 קילו">
      <div class="stack"><button class="btn btn-soft" type="submit">שמירה</button><button class="btn btn-danger" type="button" data-a="delete">למחוק מהרשימה</button></div></form>` : ''}`, (root) => {
    root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a
      if (a === 'claim') return claim(id, itemId, true, b)
      if (a === 'unclaim') return claim(id, itemId, false, b)
      if (a === 'done') return doneSheet(id, { item: itemId })
      if (a === 'undone') await act(() => Y.post(id, [{ t: 'item.done', id: itemId, on: false }]))
      if (a === 'delete') {
        if (!confirm(`למחוק את "${it.name}"?`)) return
        await act(() => Y.post(id, [{ t: 'item.delete', id: itemId }]))
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
      await act(() => Y.post(id, [{ t: 'item.put', id: itemId, name, qty: form.querySelector('#iqty').value.trim() }]))
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
  const hist = c.history.slice(0, 6).map((h) => `<li>${duckOf(st, rec, h.by, 22)}<span style="flex:1">${esc(who(st, rec, h.by).name)} · ${h.kind === 'pass' ? who(st, rec, h.by).g('העבירה את התור', 'העביר את התור') : 'בוצע'} ${relDay(h.at)}</span>${h.photoId && !st.hidden.has(h.photoId) ? `<img data-photo="${h.photoId}" alt="תמונת הוכחה"><button class="link-btn" type="button" data-photoact="${h.photoId}" style="padding:0 4px">${roles.get(myId) === 'admin' ? 'הסתרה' : 'דיווח'}</button>` : ''}</li>`).join('')
  openSheet(`<h2>${esc(c.emoji)} ${esc(c.name)}</h2>
    <p class="lead">${esc(Y.EVERY[c.every].label)} · ${c.everyone ? 'כל החצר בסבב' : count(order.length, 'ברווזון אחד בסבב', 'ברווזונים בסבב')}</p>
    <span class="lbl">התור</span>
    <div style="display:flex;flex-wrap:wrap;gap:10px">${order.map((m) => `<span style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:13px;${m === turn ? 'font-weight:700' : 'opacity:.75'}">${duckOf(st, rec, m, m === turn ? 44 : 34)}${esc(who(st, rec, m).name)}${m === turn ? ' ⬅' : ''}</span>`).join('')}</div>
    <div class="stack"><button class="btn btn-primary" data-a="done">בוצע + הוכחה</button>${turn === myId && order.length > 1 ? `<button class="btn btn-ghost" data-a="pass">להעביר ל${esc(who(st, rec, Y.nextInOrder(order, turn, roles)).name)}</button>` : ''}</div>
    ${hist ? `<span class="lbl">מה היה</span><ul class="history">${hist}</ul>` : ''}
    ${canEdit ? '<div class="stack"><button class="btn btn-danger" data-a="delete">למחוק את המטלה</button></div>' : ''}`, (root) => {
    root.querySelector('[data-a="done"]').onclick = () => doneSheet(id, { chore: choreId })
    root.querySelector('[data-a="pass"]')?.addEventListener('click', () => passTurn(id, choreId))
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
  const ok = await act(() => Y.post(id, [{ t: 'report.put', rid: Y.newId('r'), ...what, reason: reason.trim().slice(0, 200) }], { body: '🚩 יש דיווח חדש בחצר', to: adminsOf(rec).filter((m) => m !== me()) }))
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

const CHORE_EMOJI = ['✨', ...new Set(CHORE_STARTERS.map((c) => c.emoji))]

async function newChoreSheet(id) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const members = (rec.members || []).map((m) => m.id)
  let picked = []
  const have = new Set([...st.chores.values()].map((c) => c.name))
  const ideas = choreIdeas().filter((c) => !have.has(c.name))
  openSheet(`<h2>מטלה קבועה</h2>
    <form id="f" novalidate>
      ${ideas.length ? `<span class="lbl" id="idea-l">רעיונות (לוחצים וזה מתמלא)</span>
      <div class="choices" role="group" aria-labelledby="idea-l">${ideas.map((c) => `<button type="button" class="choice" data-idea="${CHORE_STARTERS.indexOf(c)}" aria-pressed="false">${c.emoji} ${c.name}</button>`).join('')}</div>` : ''}
      <label class="lbl" for="cname">מה צריך לעשות? (אפשר לכתוב כל דבר)</label>
      <input class="input" id="cname" maxlength="40" placeholder="למשל: להאכיל את הדגים">
      <span class="lbl" id="ce-l">אימוג׳י</span>
      <div class="choices" role="group" aria-labelledby="ce-l">${CHORE_EMOJI.map((e, i) => `<button type="button" class="choice" data-emo="${e}" aria-pressed="${i === 0}" aria-label="${e}">${e}</button>`).join('')}</div>
      <span class="lbl" id="ev-l">כל כמה זמן?</span>
      <div class="choices" role="group" aria-labelledby="ev-l">${Object.entries(Y.EVERY).map(([k, v]) => `<button type="button" class="choice" data-every="${k}" aria-pressed="${k === 'week'}">${v.label}</button>`).join('')}</div>
      <span class="lbl" id="who-l">מי בסבב?</span>
      <div class="choices" role="group" aria-labelledby="who-l"><button type="button" class="choice" id="all" aria-pressed="true">כל החצר (גם מי שיצטרף)</button></div>
      <div class="choices" id="pick" hidden style="margin-top:8px">${members.map((m) => `<button type="button" class="choice" data-m="${m}" aria-pressed="false">${duckOf(st, rec, m, 22)} ${esc(who(st, rec, m).name)} <span class="n"></span></button>`).join('')}</div>
      <p class="small muted" id="pick-hint" hidden>הסדר בסבב הוא הסדר שבו ${g('תבחרי', 'תבחר')}.</p>
      <p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">הוספה</button>
    </form>`, (root) => {
    const f = root.querySelector('#f')
    const single = (sel) => f.querySelectorAll(sel).forEach((x) => (x.onclick = () => f.querySelectorAll(sel).forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
    single('[data-emo]')
    single('[data-every]')
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
      const ev = { t: 'chore.put', id: Y.newId('c'), name, emoji: f.querySelector('[data-emo][aria-pressed="true"]').dataset.emo, every: f.querySelector('[data-every][aria-pressed="true"]').dataset.every, everyone, order: everyone ? [] : picked }
      await act(() => Y.post(id, [ev], { body: `מטלה חדשה בסבב: ${ev.emoji} ${name}` }))
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
          const notify = next && next !== me() ? { body: `תורך! ${c.emoji} ${c.name}`, to: [next] } : null
          await Y.post(id, [{ t: 'chore.done', id: target.chore, ...(photoId ? { photoId } : {}) }], notify)
        } else await Y.post(id, [{ t: 'item.done', id: target.item, on: true, ...(photoId ? { photoId } : {}) }])
        return true
      })
      busy(btn, false)
      if (!okDone) return
      await closeSheet()
      toast('כל הכבוד! 🐥')
      await render(true)
      maybeAskPush()
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
      await act(() => Y.post(id, [{ t: 'poll.put', id: Y.newId('p'), q, options }], { body: `הצבעה חדשה: ${q}` }))
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
  Y.markSeen(id)
  $app.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault()
    const text = ta.value.trim()
    if (!text) return
    ta.value = ''
    await act(() => Y.post(id, [{ t: 'comment.put', cid: Y.newId('m'), id: Y.CHAT, text }], { body: `${identity.profile().nickname}: ${text}`.slice(0, 160) }))
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

async function inviteSheet(id, fresh = false) {
  const rec = await Y.localYard(id)
  const st = Y.stateOf(rec)
  const myId = me()
  const isAdmin = Y.rolesOf(rec).get(myId) === 'admin'
  const members = (rec.members || []).slice().sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1))
  openSheet(`<h2>${fresh ? 'החצר פתוחה! עכשיו מזמינים 🐥' : 'הברווזונים בחצר'}</h2>
    <p class="lead">מי שיש לו את הקישור נכנס תוך 10 שניות, בלי הרשמה. הקישור תקף שבועיים.</p>
    <div class="invite-box" id="link">יוצרת קישור…</div>
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
    const text = `בואו לחצר "${st.meta.name}" ${st.meta.emoji}\n${st.meta.kind === 'event' ? 'מי מביא מה? לוחצים ולוקחים:' : 'מטלות הבית בתורות:'}\n${link}`
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
      ${isAdmin ? '<button class="btn btn-ghost" data-a="edit">✏️ עריכת פרטי החצר</button>' : ''}
      ${pushOn ? `<button class="btn btn-ghost" data-a="mute">${rec.muted ? '🔔 להחזיר התראות מהחצר' : '🔕 להשתיק את החצר'}</button>` : ''}
      <button class="btn btn-danger" data-a="leave">🚪 לעזוב את החצר</button>
      ${isAdmin ? '<button class="btn btn-danger" data-a="delete">🗑️ למחוק את החצר לכולם</button>' : ''}
    </div>`, (root) => {
    root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a
      if (a === 'invite') return inviteSheet(id)
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
    <div class="stack"><button class="btn btn-primary" type="submit">שמירה</button></div></form>`, (root) => {
    const f = root.querySelector('#f')
    f.querySelectorAll('[data-emo]').forEach((x) => (x.onclick = () => f.querySelectorAll('[data-emo]').forEach((y) => y.setAttribute('aria-pressed', String(y === x)))))
    f.onsubmit = async (e) => {
      e.preventDefault()
      const name = f.querySelector('#yname').value.trim()
      if (name.length < 2) return
      await act(() => Y.post(id, [{ t: 'yard.meta', name, emoji: f.querySelector('[data-emo][aria-pressed="true"]').dataset.emo, kind: m.kind, when: f.querySelector('#when')?.value || null, where: f.querySelector('#where')?.value.trim() || '' }]))
      await closeSheet()
      await render(true)
    }
  })
}

// ---------- Paste a link (or move from Safari) ----------

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

function installSheet() {
  const ios = push.isIOS()
  openSheet(`<h2>החצר על מסך הבית</h2>
    <p class="lead">ככה מקבלים התראות כשתורך או כשמוסיפים משהו, ופותחים בלחיצה.</p>
    ${ios ? `
      <ol style="padding-inline-start:20px;line-height:1.8;margin:14px 0 0">
        <li><b>קודם, ${g('שמרי', 'שמור')} את הברווזון</b>, כי האפליקציה שעל מסך הבית לא רואה את מה שבספארי.</li>
        <li>לוחצים על כפתור השיתוף <span aria-hidden="true">⬆️</span> בתחתית ספארי.</li>
        <li>"הוספה למסך הבית", ואז "הוספה".</li>
        <li>פותחים מהאייקון ובוחרים "כבר יש לי ברווזון".</li>
      </ol>
      <div class="stack">${V.saved().some((v) => v.kind === 'passkey') ? `<p class="lead">✓ הברווזון שמור עם ${V.passkeyName()}. אפשר להמשיך לשלב 2.</p>` : V.passkeysAvailable() ? `<button class="btn btn-primary" id="savepk" type="button">שמירה עם ${V.passkeyName()}</button>` : ''}
        <button class="link-btn" id="copy" type="button">אין ${V.passkeyName()}? העתקת קוד העברה במקום</button></div>
      <p class="fine">קוד ההעברה הוא המפתח שלך לחצרות. אל ${g('תשלחי', 'תשלח')} אותו לאף אחד.</p>`
      : `<p class="lead" style="margin-top:12px">בכרום: תפריט ⋮ ← "התקנת אפליקציה" או "הוספה למסך הבית".</p>${deferredInstall ? '<div class="stack"><button class="btn btn-primary" id="inst" type="button">התקנה</button></div>' : ''}`}
    <div class="stack"><button class="link-btn" id="hide" type="button">לא עכשיו</button></div>`, (root) => {
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

function maybeAskPush() {
  if (!push.shouldAsk()) return
  push.markAsked()
  setTimeout(() => openSheet(`<h2>רוצה לדעת כשתורך? 🔔</h2>
    <p class="lead">נשלח התראה רק כשמשהו נוגע בך: תורך, משהו חדש ברשימה, הצבעה או הודעה. אפשר להשתיק כל חצר.</p>
    <div class="stack"><button class="btn btn-primary" id="yes" type="button">כן, ${g('תודיעו', 'תודיעו')} לי</button><button class="link-btn" id="no" type="button">אולי אחר כך</button></div>`, (root) => {
    root.querySelector('#yes').onclick = async () => {
      await act(async () => {
        await push.enable()
        toast('ההתראות פועלות 🐥')
      })
      await closeSheet()
    }
    root.querySelector('#no').onclick = closeSheet
  }), 600)
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
    on: '<p class="muted">ההתראות פועלות. אפשר להשתיק חצר מסוימת מהתפריט שלה.</p><button class="btn btn-ghost" id="pushoff" type="button">לכבות התראות</button>',
    off: '<button class="btn btn-soft" id="pushon" type="button">להפעיל התראות</button>',
  }[st]
  $app.innerHTML = `<main class="screen">
    <header class="top"><a class="icon-btn" href="#/" aria-label="חזרה">${ICON.back}</a><h1>הברווזון שלי</h1></header>
    <div style="display:flex;justify-content:center;margin-top:8px" id="preview">${duck(p, 120)}</div>
    <div id="save">${saveCard()}</div>
    <form id="f" novalidate>${duckForm(p, { pets: true })}<p class="err" id="err" role="alert"></p>
      <button class="btn btn-primary btn-wide" type="submit">שמירה</button></form>
    <h2 class="section">התראות</h2>${pushRow}
    <h2 class="section">יש לי קישור</h2>
    <button class="btn btn-ghost" id="paste" type="button">הדבקת קישור הזמנה</button>
    <h2 class="section">פרטיות</h2>
    <button class="link-btn" type="button" data-privacy style="padding:0">מדיניות הפרטיות המלאה</button>
    <p class="muted">אין חשבון, אין מספר טלפון. השמות, הרשימות, ההודעות והתמונות מוצפנים בטלפון לפני שהם יוצאים ממנו, והשרת לא יכול לקרוא אותם.</p>
    <p class="small muted" style="margin-top:24px">החצר ${APP_VERSION}</p>
  </main>`
  const read = bindDuckForm($app, (s) => ($app.querySelector('#preview').innerHTML = duck({ ...p, ...s }, 120)))
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
  bindPrivacyLinks($app)
  $app.querySelector('#paste').onclick = pasteSheet
  $app.querySelector('#pushon')?.addEventListener('click', () => act(async () => {
    await push.enable()
    toast('ההתראות פועלות 🐥')
    meScreen()
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
  if (document.visibilityState === 'visible' && identity.load()?.keys && view.name !== 'join') {
    ;(view.id ? Y.refresh(view.id) : Y.refreshAll()).then((n) => n && render(true)).catch(() => undefined)
  }
})

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register('sw.js').catch(() => undefined)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.nav) location.hash = e.data.nav
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
  }
})()
