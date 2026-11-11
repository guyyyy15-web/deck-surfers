// נקמות שלי — the app. Hash routes, plain DOM, all data on the phone (see db.js).
import { icon, cat, catHead, deco } from './icons.js'
import {
  TYPES, typeOf, newId, initialOf, colorFor, dayMonth, fullDate, weekdayDate, monthShort, dueLabel, sortOpen, groupByMonth, matches,
  stats, reminderIcs, CIRCLE, cropBase, clampPos, zoomAt, cropRect, BACKUP_KIND, readBackup, mergeRevenges, esc, toDay,
} from './logic.js'
import * as db from './db.js'
import { loadImage, toBlob, shrinkFile, photoUrl, rememberUrl, forgetUrl, blobToDataUrl, dataUrlToBlob, FACE_SIDE } from './images.js'
import { IDEAS } from './ideas.js'
import * as sync from './sync.js'
import * as identity from './identity.js'
import * as GU from './groups-ui.js'

export const APP_VERSION = '1.4.0'

const S = {
  list: [],
  settings: db.loadSettings(),
  q: '',
  ideaFilter: 'all',
  lucky: null,
  draft: null,
}
const app = document.getElementById('app')

/** Gendered wording: the design speaks to a woman; settings can switch to masculine. */
const g = (f, m) => (S.settings.voice === 'm' ? m : f)

// ---------- Helpers ----------

const byId = (id) => S.list.find((r) => r.id === id)
const openList = () => sortOpen(S.list.filter((r) => r.status === 'open'))
const doneList = () => S.list.filter((r) => r.status === 'done')
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
const isAndroid = () => /Android/i.test(navigator.userAgent)
/** A short buzz on Android (iPhone browsers ignore vibration). */
const buzz = (ms = 25) => navigator.vibrate?.(ms)

// Android/Chrome offers its own install dialog; keep the event to show it from our button.
let installPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installPrompt = e
  if (['home', 'settings'].includes(route().name)) render()
})
window.addEventListener('appinstalled', () => {
  installPrompt = null
  toast('הותקנה! אפשר לפתוח מהאייקון במסך הבית 🎉')
})

// The last few errors, kept on the phone only, for "report a problem".
const ERR_KEY = 'nk.errors'
function logError(msg) {
  try {
    const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]')
    list.push({ at: new Date().toISOString(), msg: String(msg).slice(0, 200) })
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-5)))
  } catch {
    /* storage unavailable */
  }
}
window.addEventListener('error', (e) => logError(e.message))
window.addEventListener('unhandledrejection', (e) => logError(e.reason?.message || e.reason))

// ---------- Back button ----------
// Each overlay (sheet, photo cropper) adds a history entry, so Android's Back button and the browser's
// back gesture close the overlay instead of leaving the screen or the app.
const layers = []
let popWaiter = null
window.addEventListener('popstate', () => {
  if (popWaiter) {
    const done = popWaiter
    popWaiter = null
    done()
    return
  }
  layers.pop()?.()
})
/** Registers an overlay; returns `release`, to call when it closes itself (resolves once Back is undone). */
function pushLayer(onBack) {
  history.pushState({ nkLayer: true }, '')
  layers.push(onBack)
  return () => {
    const i = layers.lastIndexOf(onBack)
    if (i < 0) return Promise.resolve()
    layers.splice(i, 1)
    return new Promise((resolve) => {
      popWaiter = resolve
      history.back()
      setTimeout(() => {
        if (popWaiter === resolve) {
          popWaiter = null
          resolve()
        }
      }, 600)
    })
  }
}

function go(hash, replace = false) {
  if (replace) location.replace(hash)
  else location.hash = hash
}

async function save(r) {
  r.updatedAt = new Date().toISOString()
  const i = S.list.findIndex((x) => x.id === r.id)
  if (i >= 0) S.list[i] = r
  else S.list.push(r)
  await db.putRevenge(r)
  sync.touched(r.id)
  sync.soon()
}

async function storePhoto(blob, kind) {
  const id = newId()
  await db.putPhoto({ id, kind, blob, createdAt: new Date().toISOString() })
  rememberUrl(id, blob)
  db.persist()
  return id
}
async function dropPhoto(id) {
  if (!id) return
  forgetUrl(id)
  await db.deletePhoto(id).catch(() => undefined)
  sync.deleted(id, 'photo')
  sync.soon()
}

function avatar(r, { size = 56, badge = 'type', lg = false } = {}) {
  const t = typeOf(r.type)
  const face = r.photoId
    ? `<img data-photo="${esc(r.photoId)}" alt="">`
    : esc(initialOf(r.name))
  const b =
    badge === 'ok'
      ? `<span class="avatar-badge ok">${icon('check', lg ? 18 : 14)}</span>`
      : badge === 'type'
        ? `<span class="avatar-badge">${icon(t.icon, lg ? 24 : 20, t.fill)}</span>`
        : ''
  return `<span class="avatar${lg ? ' lg' : ''}"><span class="avatar-face" style="--s:${size}px;--bg:${colorFor(r.name)}">${face}</span>${b}</span>`
}

/** Fills in <img data-photo> after a render. */
function hydrate(root = document) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    if (img.getAttribute('src')) continue
    // A group photo may still be downloading: hide it for now and fill it in on the next hydrate.
    photoUrl(img.dataset.photo).then((u) => {
      img.hidden = !u
      if (u) img.src = u
    })
  }
}

function topbar({ title, start = '', end = '', center = true }) {
  return `<header class="topbar${center ? ' center' : ''}">${start || '<span></span>'}<h1>${title}</h1>${end || '<span></span>'}</header>`
}
const backBtn = (href, label = 'חזרה', raised = false) =>
  `<a class="icon-btn${raised ? ' raised' : ''}" href="${href}" aria-label="${label}">${icon('arrow-right', raised ? 24 : 28)}</a>`

function nav(active) {
  const unread = GU.unreadTotal()
  const items = [
    ['stats', '#/stats', 'סטטיסטיקות', 'chart'],
    ['home', '#/', 'בית', 'home'],
    ['groups', '#/groups', 'קבוצות', 'heart'],
    ['ideas', '#/ideas', 'השראה', 'bulb'],
  ]
  return `<nav class="nk-nav" aria-label="ניווט">${items
    .map(([id, href, label, ic]) => {
      const on = id === active
      const dot = id === 'groups' && unread ? `<span class="nav-dot" aria-label="${unread} חדשים בקבוצות"></span>` : ''
      return `<a class="nk-nav-item${on ? ' is-on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>${icon(ic, 28, on ? 'lilac-300' : undefined)}${dot}<span>${label}</span></a>`
    })
    .join('')}</nav>`
}

// ---------- Toast ----------

let toastTimer, toastAt = 0
function toast(text, action) {
  toastAt = Date.now()
  document.querySelector('.toast')?.remove()
  clearTimeout(toastTimer)
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`
  if (action) el.querySelector('button').onclick = () => {
    el.remove()
    action.run()
  }
  document.body.append(el)
  toastTimer = setTimeout(() => {
    el.remove()
    action?.expire?.()
  }, action ? 6000 : 2800)
}

// ---------- Confetti ----------

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const box = document.createElement('div')
  box.className = 'confetti'
  const colors = ['var(--lilac-300)', 'var(--sun)', 'var(--blush)', 'var(--plum)']
  let html = ''
  for (let i = 0; i < 34; i++) {
    const kind = i % 3 ? 'sparkle' : 'heart'
    const size = 12 + Math.random() * 16
    html += `<i style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;--x:${(Math.random() - 0.5) * 160}px;--r:${(Math.random() - 0.5) * 720}deg;--d:${1.4 + Math.random() * 1.2}s;animation-delay:${Math.random() * 0.25}s">${deco(kind, size, '', colors[i % 4]).replace('class="deco" ', '')}</i>`
  }
  box.innerHTML = html
  document.body.append(box)
  setTimeout(() => box.remove(), 3200)
}

// ---------- Sheets ----------

function sheet(html, { label, onClose } = {}) {
  const wrap = document.createElement('div')
  wrap.className = 'sheet-wrap'
  wrap.innerHTML = `<div class="sheet-scrim" data-close></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label || '')}"><span class="grabber" aria-hidden="true"></span>${html}</section>`
  let open = true
  const hide = () => {
    if (!open) return
    open = false
    wrap.remove()
    document.removeEventListener('keydown', onKey)
    onClose?.()
  }
  const release = pushLayer(hide)
  /** Closes the sheet; resolves when it is safe to navigate. */
  const close = () => {
    hide()
    return release()
  }
  const onKey = (e) => e.key === 'Escape' && close()
  wrap.querySelector('[data-close]').onclick = close
  document.addEventListener('keydown', onKey)
  document.body.append(wrap)
  // Swipe the grabber area down to close.
  const sh = wrap.querySelector('.sheet')
  let y0 = null
  sh.addEventListener('touchstart', (e) => (y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null), { passive: true })
  sh.addEventListener('touchmove', (e) => {
    if (y0 === null) return
    const dy = e.touches[0].clientY - y0
    if (dy > 0) sh.style.transform = `translateY(${dy}px)`
  }, { passive: true })
  sh.addEventListener('touchend', (e) => {
    if (y0 === null) return
    const dy = e.changedTouches[0].clientY - y0
    sh.style.transform = ''
    if (dy > 110) close()
    y0 = null
  })
  return { el: wrap.querySelector('.sheet'), close }
}

function confirmSheet({ title, text, ok, danger = true }) {
  return new Promise((resolve) => {
    let answered = false
    const s = sheet(
      `<div class="sheet-head"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>
       <div class="actions" style="padding-top:4px">
         <button type="button" class="nk-btn nk-btn-primary" data-ok style="${danger ? 'background:var(--danger);color:#fffaf5' : ''}">${esc(ok)}</button>
         <button type="button" class="nk-btn nk-btn-quiet" data-no>ביטול</button></div>`,
      { label: title, onClose: () => !answered && resolve(false) },
    )
    s.el.querySelector('[data-ok]').onclick = async () => {
      answered = true
      await s.close()
      resolve(true)
    }
    s.el.querySelector('[data-no]').onclick = () => s.close()
  })
}

/** Picked documentation photo inside a sheet or form: two tiles, or a preview with a remove button. */
function docPicker(container, state) {
  const draw = () => {
    if (state.docUrl) {
      container.innerHTML = `<div class="doc-preview"><img src="${state.docUrl}" alt="תמונת התיעוד"><button type="button" class="icon-btn" aria-label="הסרת התמונה">${icon('x', 22)}</button></div>`
      container.querySelector('button').onclick = () => {
        state.docBlob = null
        state.docUrl = null
        state.removeDoc = true
        draw()
      }
      return
    }
    container.innerHTML = `<div class="pick2">
      <label class="pick-tile">${icon('camera', 30, 'lilac-200')}${g('צלמי', 'צלם')}<input type="file" accept="image/*" capture="environment" aria-label="${g('צלמי', 'צלם')} תמונה"></label>
      <label class="pick-tile">${icon('image', 30, 'lilac-200')}${g('העלי מהגלריה', 'העלה מהגלריה')}<input type="file" accept="image/*" aria-label="${g('העלי', 'העלה')} תמונה מהגלריה"></label></div>`
    for (const input of container.querySelectorAll('input')) {
      input.onchange = async () => {
        const f = input.files?.[0]
        if (!f) return
        try {
          state.docBlob = await shrinkFile(f)
          state.docUrl = URL.createObjectURL(state.docBlob)
          draw()
        } catch {
          toast('לא הצלחתי לפתוח את התמונה')
        }
      }
    }
  }
  draw()
}

function completeSheet(r, from) {
  const state = { docBlob: null, docUrl: null }
  const s = sheet(
    `<div class="sheet-head">
       ${deco('sparkle', 26, 'top:4px;right:56px;position:absolute')}${deco('heart', 28, 'top:18px;left:60px;position:absolute;transform:rotate(-12deg)')}
       <span class="ok-circle">${icon('check', 34)}</span>
       <h2>נקמה בוצעה!</h2><p>${esc(r.name)} · וזה היה מגיע</p></div>
     <div class="nk-field"><label class="nk-field-label" for="c-notes">הערות <span class="nk-opt">(אופציונלי)</span></label>
       <div class="nk-input is-multi">${icon('note', 24, 'lilac-200')}<textarea id="c-notes" rows="3" placeholder="איך זה הלך? מה אמרו?"></textarea></div></div>
     <div class="nk-field"><span class="nk-field-label">תיעוד <span class="nk-opt">(אופציונלי)</span></span><div data-doc></div></div>
     <div class="actions" style="padding-top:0">
       <button type="button" class="nk-btn nk-btn-primary" data-save><span>${g('שמרי בהיסטוריה', 'שמור בהיסטוריה')}</span>${icon('check', 22)}</button>
       <button type="button" class="nk-btn nk-btn-quiet" data-skip>${g('דלגי, רק לסמן', 'דלג, רק לסמן')}</button></div>`,
    { label: 'השלמת נקמה' },
  )
  docPicker(s.el.querySelector('[data-doc]'), state)
  const finish = async (withExtras) => {
    const before = { ...r }
    const next = { ...r, status: 'done', doneAt: new Date().toISOString() }
    if (withExtras) {
      const notes = s.el.querySelector('#c-notes').value.trim()
      if (notes) next.notes = notes
      if (state.docBlob) next.docPhotoId = await storePhoto(state.docBlob, 'doc')
    }
    await save(next)
    await s.close()
    confetti()
    buzz(40)
    const undo = {
      label: 'ביטול',
      run: async () => {
        if (next.docPhotoId && next.docPhotoId !== before.docPhotoId) await dropPhoto(next.docPhotoId)
        await save(before)
        render()
      },
    }
    if (from === 'home') {
      const card = app.querySelector(`.nk-card[data-id="${CSS.escape(r.id)}"]`)
      card?.classList.add('anim-out')
      setTimeout(render, card ? 330 : 0)
      toast('הועברה להיסטוריה 🎉', undo)
    } else {
      go(`#/r/${r.id}`, true)
      render()
      toast('כל הכבוד! נשמר בהיסטוריה 🎉', undo)
    }
  }
  s.el.querySelector('[data-save]').onclick = () => finish(true)
  s.el.querySelector('[data-skip]').onclick = () => finish(false)
}

async function removeRevenge(r) {
  S.list = S.list.filter((x) => x.id !== r.id)
  await db.deleteRevenge(r.id)
  sync.deleted(r.id, 'revenge')
  sync.soon(7000)
  go(r.status === 'done' ? '#/done' : '#/')
  let undone = false
  toast('הנקמה נמחקה', {
    label: 'ביטול',
    run: async () => {
      undone = true
      await save(r)
      render()
    },
    // Photos go only once the undo is no longer possible.
    expire: () => {
      if (undone) return
      dropPhoto(r.photoId)
      dropPhoto(r.docPhotoId)
    },
  })
}

function downloadOrShare(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type })
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title }).catch(() => undefined)
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

// ---------- Screens ----------

function cardOpen(r) {
  const due = dueLabel(r.remindOn)
  return `<div class="nk-card" data-id="${esc(r.id)}">
    <a class="card-main" href="#/r/${esc(r.id)}">
      ${avatar(r)}
      <span class="card-text"><span class="nk-card-title">${esc(r.name)}</span><span class="nk-card-desc">${esc(r.why)}</span>
        ${due ? `<span class="due${due.late ? ' is-late' : ''}">${icon('calendar', 14)}${esc(due.text)}</span>` : ''}</span>
      <span style="display:grid">${icon('chevron-left', 20)}</span></a>
    <button type="button" class="nk-check" data-act="complete" data-id="${esc(r.id)}" aria-label="${g('סמני', 'סמן')} את ${esc(r.name)} כבוצעה"></button></div>`
}

function cardDone(r) {
  const t = typeOf(r.type)
  return `<a class="nk-card" href="#/r/${esc(r.id)}" style="padding:12px 14px 12px 10px">
    ${avatar(r, { size: 50, badge: 'ok' })}
    <span class="card-text"><span class="nk-card-title" style="font-size:17px;line-height:24px">${esc(r.name)}</span>
      <span class="nk-card-desc" style="font-size:13px;line-height:18px">${t.label} · בוצעה ב-${dayMonth(r.doneAt)}</span></span>
    ${r.docPhotoId ? `<span class="thumb" role="img" aria-label="יש תיעוד"><img data-photo="${esc(r.docPhotoId)}" alt=""></span>` : ''}
    ${icon('chevron-left', 20)}</a>`
}

function installBanner() {
  if (isStandalone() || S.settings.hideInstall) return ''
  let body
  if (installPrompt) {
    body = `<b>להתקין כאפליקציה?</b><br>נפתחת מהאייקון, במסך מלא, וגם בלי אינטרנט.
      <br><button type="button" class="small-btn primary" data-act="install" style="margin-top:10px">${icon('download', 18)}התקנה</button>`
  } else if (isIOS()) {
    body = `<b>להתקנה על האייפון</b><br>בספארי: ${icon('share', 16)} שיתוף ← "הוספה למסך הבית". ככה היא נפתחת כמו אפליקציה ועובדת גם בלי אינטרנט.`
  } else if (isAndroid()) {
    body = `<b>להתקנה על הטלפון</b><br>בכרום: תפריט ⋮ ← "הוספה למסך הבית" או "התקנת אפליקציה". ככה היא נפתחת כמו אפליקציה ועובדת גם בלי אינטרנט.`
  } else return ''
  return `<div class="banner">${icon('phone', 26, 'lilac-200')}<div>${body}</div>
    <button type="button" class="icon-btn x" data-act="hide-install" aria-label="סגירה">${icon('x', 20)}</button></div>`
}

function installSteps() {
  if (isStandalone()) return `<span class="grow">${icon('check', 20)} האפליקציה מותקנת במסך הבית.</span>`
  if (installPrompt) {
    return `<span class="grow">אפשר להתקין אותה כאפליקציה: אייקון במסך הבית, מסך מלא, עובדת בלי אינטרנט.</span>
      <button type="button" class="small-btn primary" data-act="install">${icon('download', 18)}התקנה</button>`
  }
  if (isAndroid()) {
    return `<ol class="steps"><li>לפתוח את הקישור ב<b>כרום</b>.</li><li>ללחוץ על <b>⋮</b> בפינה למעלה.</li><li>לבחור <b>"הוספה למסך הבית"</b> או <b>"התקנת אפליקציה"</b>.</li><li>מעכשיו היא נפתחת מהאייקון, במסך מלא, וגם בלי אינטרנט.</li></ol>`
  }
  return `<ol class="steps"><li>לפתוח את הקישור ב<b>ספארי</b>.</li><li>ללחוץ על ${icon('share', 18)} <b>שיתוף</b> בתחתית המסך.</li><li>לבחור <b>"הוספה למסך הבית"</b> ואז <b>"הוספה"</b>.</li><li>מעכשיו היא נפתחת מהאייקון, במסך מלא, וגם בלי אינטרנט.</li></ol>`
}

function feedbackSheet() {
  const s = sheet(
    `<div class="sheet-head">${icon('note', 40, 'lilac-200')}<h2>משוב ודיווח על בעיה</h2>
       <p>זו גרסת בטא לחברים. כל הערה עוזרת: מה לא עבד, מה מבלבל, מה היה כיף.</p></div>
     <div class="nk-field"><label class="nk-field-label" for="fb-text">מה קרה?</label>
       <div class="nk-input is-multi">${icon('note', 24, 'lilac-200')}<textarea id="fb-text" rows="4" placeholder="למשל: לחצתי על… וקרה…"></textarea></div></div>
     <label class="row" style="border:0;padding:0;min-height:40px"><input type="checkbox" id="fb-tech" checked style="width:22px;height:22px;accent-color:var(--plum)">
       <span class="grow">לצרף פרטים טכניים<small>גרסה, סוג מכשיר ודפדפן, ושגיאות אחרונות. בלי נקמות ובלי תמונות.</small></span></label>
     <div class="actions" style="padding-top:0"><button type="button" class="nk-btn nk-btn-primary" data-send>${icon('share', 22)}<span>שליחה</span></button></div>`,
    { label: 'משוב' },
  )
  s.el.querySelector('[data-send]').onclick = async () => {
    const text = s.el.querySelector('#fb-text').value.trim()
    let body = `משוב על "נקמות שלי"\n\n${text || '(בלי טקסט)'}`
    if (s.el.querySelector('#fb-tech').checked) body += `\n\n---\n${techInfo()}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'משוב: נקמות שלי', text: body })
        await s.close()
        toast('תודה! 💜')
        return
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    await copy(body)
    await s.close()
    toast('הועתק. אפשר להדביק בוואטסאפ למי שהזמין אותך 💜')
  }
}

function techInfo() {
  const ua = navigator.userAgent
  const device = isIOS() ? `iOS ${(/OS (\d+[_\d]*)/.exec(ua)?.[1] || '?').replace(/_/g, '.')}` : isAndroid() ? `Android ${/Android ([\d.]+)/.exec(ua)?.[1] || '?'}` : 'אחר'
  const browser = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Safari/.test(ua) ? 'Safari' : 'אחר'
  let errors = []
  try {
    errors = JSON.parse(localStorage.getItem(ERR_KEY) || '[]')
  } catch { /* none */ }
  return [
    `גרסה: ${APP_VERSION}`,
    `מכשיר: ${device} · ${browser} · ${isStandalone() ? 'מותקנת' : 'בדפדפן'} · ${innerWidth}×${innerHeight}`,
    `גיבוי בענן: ${sync.isOn() ? 'פעיל' : 'כבוי'} · נקמות: ${S.list.length}`,
    errors.length ? `שגיאות אחרונות:\n${errors.map((e) => `${e.at.slice(5, 16)} ${e.msg}`).join('\n')}` : 'שגיאות אחרונות: אין',
  ].join('\n')
}

function homeScreen(tab) {
  const open = openList()
  const done = doneList()
  const items = tab === 'done' ? done : open
  const showSearch = items.length >= 6
  const listHtml = () => {
    const shown = items.filter((r) => matches(r, S.q))
    if (!items.length) {
      return tab === 'done'
        ? `<div class="empty">${cat(150)}<h2>עוד אין נקמות שהושלמו</h2><p>כשתסמנ${g('י', '')} נקמה כבוצעה, היא תחכה כאן עם ההערות והתמונות.</p></div>`
        : `<div class="empty"><span class="cat-bob">${cat(128)}</span><h2>שקט פה. חשוד.</h2><p>אין נקמות פתוחות. אולי מישהו בכל זאת מגיע לו?</p><a class="nk-btn nk-btn-primary" href="#/new" style="margin-top:18px">${icon('plus', 22)}<span>נקמה ראשונה</span></a></div>`
    }
    if (!shown.length) return `<p class="empty muted">לא מצאתי נקמה כזו</p>`
    if (tab === 'done') {
      return groupByMonth(shown)
        .map((grp) => `<h2 class="month">${esc(grp.title)}</h2>${grp.items.map(cardDone).join('')}`)
        .join('')
    }
    return shown.map(cardOpen).join('')
  }
  return {
    nav: 'home',
    html: `
      ${tab === 'open' ? deco('heart', 40, 'bottom:calc(var(--nav-h) + 120px);left:64px;position:fixed;transform:rotate(-12deg)') + deco('sparkle', 22, 'bottom:calc(var(--nav-h) + 150px);right:70px;position:fixed') : ''}
      <header class="topbar"><a class="icon-btn" href="#/settings" aria-label="הגדרות">${icon('settings', 30)}</a><h1>נקמות שלי</h1>${meBadge()}</header>
      <div style="padding:8px 24px 0"><div class="nk-tabs" role="tablist">
        <a class="nk-tab${tab === 'open' ? ' is-on' : ''}" href="#/" role="tab" aria-selected="${tab === 'open'}">נקמות פתוחות (${open.length})</a>
        <a class="nk-tab${tab === 'done' ? ' is-on' : ''}" href="#/done" role="tab" aria-selected="${tab === 'done'}">נקמות שהושלמו (${done.length})</a></div></div>
      ${installBanner()}
      ${showSearch ? `<div style="padding:16px 24px 0"><label class="nk-input" style="min-height:48px">${icon('user', 22, 'lilac-200')}<span class="sr-only">חיפוש</span><input type="search" id="q" placeholder="חיפוש לפי שם או סיבה" value="${esc(S.q)}" enterkeyhint="search"></label></div>` : ''}
      <div class="list" id="list">${listHtml()}</div>
      ${tab === 'open' && !open.length ? '' : `<a class="nk-fab" href="#/new" aria-label="נקמה חדשה">${icon('plus', 34)}</a>`}`,
    mount(root) {
      root.querySelector('#q')?.addEventListener('input', (e) => {
        S.q = e.target.value
        const list = root.querySelector('#list')
        list.innerHTML = listHtml()
        hydrate(list)
      })
    },
  }
}

function detailsScreen(r) {
  if (!r) return notFound()
  const t = typeOf(r.type)
  if (r.status === 'done') {
    const took = Math.max(0, Math.round((new Date(r.doneAt) - new Date(r.createdAt)) / 86400000))
    return {
      html: `
        <div class="deco checker" aria-hidden="true" style="top:-30px;right:-30px;width:220px;height:140px;border-radius:0 0 40% 60% / 0 0 50% 70%"></div>
        <header class="topbar">${backBtn('#/done', 'חזרה להיסטוריה', true)}<a class="icon-btn raised" href="#/r/${esc(r.id)}/edit" aria-label="עריכה">${icon('pencil', 22, 'lilac-200')}</a></header>
        <div class="hero" style="margin-top:-8px">${avatar(r, { size: 104, badge: 'ok', lg: true })}
          <h1 style="font-size:28px;line-height:36px;margin-top:10px">${esc(r.name)}</h1>
          <span class="chip ok">${icon('check', 14)}בוצעה ב-${fullDate(r.doneAt)}</span></div>
        <div class="info">
          <div class="info-row col"><span class="info-k">למה?</span><span class="info-v">${esc(r.why)}</span></div>
          ${r.plan ? `<div class="info-row col"><span class="info-k">התוכנית</span><span class="info-v">${esc(r.plan)}</span></div>` : ''}
          <div class="info-row"><span class="info-k">סוג נקמה</span><span class="info-v">${icon(t.icon, 20, t.fill)}${t.label}</span></div>
          <div class="info-row"><span class="info-k">זמן עד הביצוע</span><span class="info-v">${took === 0 ? 'באותו יום ⚡' : took === 1 ? 'יום אחד' : `${took} ימים`}</span></div>
          ${r.notes ? `<div class="info-row col"><span class="info-k">הערות</span><span class="info-v">${esc(r.notes)}</span></div>` : ''}
        </div>
        ${r.docPhotoId ? `<div class="doc"><span class="info-k">תיעוד</span><div class="doc-img"><img data-photo="${esc(r.docPhotoId)}" alt="תמונת התיעוד"><span class="doc-tag">התמונה שצולמה</span></div></div>` : ''}
        <div class="actions">
          <button type="button" class="nk-btn nk-btn-soft" data-act="reopen">${icon('undo', 22)}<span>${g('החזירי לפתוחות', 'החזר לפתוחות')}</span></button>
          <button type="button" class="nk-btn nk-btn-quiet danger" data-act="delete">מחיקת הנקמה</button></div>`,
    }
  }
  return {
    html: `
      <div class="deco checker" aria-hidden="true" style="top:-30px;left:-30px;width:230px;height:150px;border-radius:0 0 60% 40% / 0 0 70% 50%"></div>
      <header class="topbar">${backBtn('#/', 'חזרה', true)}<a class="icon-btn raised" href="#/r/${esc(r.id)}/edit" aria-label="עריכה">${icon('pencil', 22, 'lilac-200')}</a></header>
      <div class="hero" style="margin-top:4px">${avatar(r, { size: 128, lg: true })}
        <h1>${esc(r.name)}</h1><span class="chip">פתוחה · נפתחה ב-${dayMonth(r.createdAt)}</span></div>
      <div class="info">
        <div class="info-row col"><span class="info-k">למה?</span><span class="info-v">${esc(r.why)}</span></div>
        ${r.plan ? `<div class="info-row col"><span class="info-k">התוכנית</span><span class="info-v">${esc(r.plan)}</span></div>` : ''}
        <div class="info-row"><span class="info-k">סוג נקמה</span><span class="info-v">${icon(t.icon, 20, t.fill)}${t.label}</span></div>
        <div class="info-row"><span class="info-k">תזכורת</span>
          ${r.remindOn
            ? `<span class="info-v" style="flex-direction:column;align-items:flex-end;gap:0"><span style="display:flex;gap:6px;align-items:center">${icon('calendar', 20, 'lilac-200')}${weekdayDate(r.remindOn)}</span>
               <button type="button" class="mini-link" data-act="ics">${g('הוסיפי', 'הוסף')} ליומן של האייפון</button></span>`
            : `<a class="mini-link" href="#/r/${esc(r.id)}/edit">${g('הוסיפי', 'הוסף')} תזכורת</a>`}</div>
      </div>
      <div class="actions">
        <button type="button" class="nk-btn nk-btn-primary" data-act="complete"><span>${g('סמני כבוצעה', 'סמן כבוצעה')}</span>${icon('check', 22)}</button>
        ${GU.hasGroups() ? `<button type="button" class="nk-btn nk-btn-quiet" data-act="to-group">${icon('heart', 20)}העברה לקבוצה</button>` : ''}
        <button type="button" class="nk-btn nk-btn-quiet danger" data-act="delete">מחיקת הנקמה</button></div>`,
  }
}

function field({ id, label, req, opt, ic, ph, multi, value = '', type = 'text', extra = '' }) {
  const control = multi
    ? `<textarea id="${id}" rows="3" placeholder="${esc(ph)}"${req ? ' required' : ''}>${esc(value)}</textarea>`
    : `<input id="${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(value)}"${req ? ' required' : ''}${extra}>`
  return `<div class="nk-field" data-field="${id}"><label class="nk-field-label" for="${id}">${label}${req ? ' *' : ''}${opt ? ` <span class="nk-opt">(אופציונלי)</span>` : ''}</label>
    <div class="nk-input${multi ? ' is-multi' : ''}">${icon(ic, 24, 'lilac-200')}${control}</div><div class="nk-field-error" hidden></div></div>`
}

function formScreen(existing, query) {
  const editing = !!existing
  if (!S.draft || S.draft.forId !== (existing?.id || 'new')) {
    const idea = IDEAS.find((i) => i.id === query.get('idea'))
    S.draft = existing
      ? { forId: existing.id, ...existing, faceBlob: null, faceUrl: null, removeFace: false, docBlob: null, docUrl: null, removeDoc: false }
      : { forId: 'new', name: '', why: '', type: idea?.type || 'creative', plan: idea ? `${idea.title}: ${idea.text}` : '', remindOn: '', faceBlob: null, faceUrl: null }
  }
  const d = S.draft
  const done = existing?.status === 'done'
  const back = editing ? `#/r/${existing.id}` : '#/'
  return {
    html: `
      <div class="deco checker" aria-hidden="true" style="position:fixed;bottom:-40px;left:-30px;right:-30px;height:110px;border-radius:50% 50% 0 0 / 80% 60% 0 0"></div>
      ${deco('sparkle', 30, 'top:calc(var(--safe-top) + 74px);left:28px')}
      ${topbar({ title: editing ? 'עריכת נקמה' : 'נקמה חדשה', start: backBtn(back) })}
      <form class="form" novalidate>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <label class="photo-pick"><span class="photo-ring" data-ring></span><span data-ring-label></span>
            <input type="file" accept="image/*" class="sr-only" data-face aria-label="${g('בחרי', 'בחר')} תמונה"></label>
          <button type="button" class="nk-btn nk-btn-quiet" data-act="remove-face" style="min-height:32px;font-size:15px" hidden>הסרת התמונה</button>
        </div>
        ${field({ id: 'f-name', label: 'במי נוקמים?', req: true, ic: 'user', ph: 'למי מגיע?', value: d.name, extra: ' autocomplete="off" enterkeyhint="next" maxlength="60"' })}
        ${field({ id: 'f-why', label: 'למה?', req: true, ic: 'note', ph: 'מה הוא/היא עשה/תה?', multi: true, value: d.why })}
        <div class="nk-field"><span class="nk-field-label" id="types-l">סוג נקמה</span>
          <div class="nk-types" role="radiogroup" aria-labelledby="types-l">${TYPES.map(
            (t) => `<button type="button" role="radio" class="nk-type${t.id === d.type ? ' is-on' : ''}" aria-checked="${t.id === d.type}" data-type="${t.id}">${icon(t.icon, 34, t.fill)}<span>${t.label}</span></button>`,
          ).join('')}</div></div>
        ${field({ id: 'f-plan', label: 'התוכנית', opt: true, ic: 'bulb', ph: 'איך עושים את זה?', multi: true, value: d.plan || '' })}
        ${done
          ? field({ id: 'f-notes', label: 'הערות', opt: true, ic: 'note', ph: 'איך זה הלך?', multi: true, value: d.notes || '' }) +
            `<div class="nk-field"><span class="nk-field-label">תיעוד <span class="nk-opt">(אופציונלי)</span></span><div data-doc></div></div>`
          : `<div class="nk-field"><label class="nk-field-label" for="f-date">תזכורת <span class="nk-opt">(אופציונלי)</span></label>
              <div class="nk-input">${icon('calendar', 24, 'lilac-200')}<input id="f-date" type="date" value="${esc(d.remindOn || '')}" min="${toDay(new Date())}">
                <span class="date-ph"${d.remindOn ? ' hidden' : ''}>${g('בחרי', 'בחר')} תאריך</span>
                <button type="button" class="clear" data-act="clear-date" aria-label="ניקוי התאריך"${d.remindOn ? '' : ' hidden'}>${icon('x', 20)}</button></div></div>`}
        <div class="actions" style="padding:6px 0 0"><button type="submit" class="nk-btn nk-btn-primary"><span>${editing ? g('שמרי שינויים', 'שמור שינויים') : g('שמרי נקמה', 'שמור נקמה')}</span>${icon('check', 22)}</button></div>
      </form>`,
    mount(root) {
      const form = root.querySelector('form')
      const ring = () => {
        const url = d.faceUrl
        const el = root.querySelector('[data-ring]')
        const hasStored = !d.removeFace && d.photoId && !d.faceUrl
        if (url || hasStored) {
          el.className = 'photo-ring has-img'
          el.innerHTML = `<img ${url ? `src="${url}"` : `data-photo="${esc(d.photoId)}"`} alt="התמונה שנבחרה"><span class="cam-badge">${icon('camera', 20)}</span>`
          root.querySelector('[data-ring-label]').textContent = g('החליפי תמונה', 'החלף תמונה')
          root.querySelector('[data-act="remove-face"]').hidden = false
          hydrate(el)
        } else {
          el.className = 'photo-ring'
          el.innerHTML = `${icon('user', 44, 'lilac-200')}<span class="cam-badge">${icon('camera', 20)}</span>`
          root.querySelector('[data-ring-label]').textContent = `${g('הוסיפי', 'הוסף')} תמונה (אופציונלי)`
          root.querySelector('[data-act="remove-face"]').hidden = true
        }
      }
      ring()
      root.querySelector('[data-face]').onchange = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        const blob = await cropFace(f)
        if (!blob) return
        if (d.faceUrl) URL.revokeObjectURL(d.faceUrl)
        d.faceBlob = blob
        d.faceUrl = URL.createObjectURL(blob)
        ring()
      }
      root.querySelector('[data-act="remove-face"]').onclick = () => {
        d.faceBlob = null
        d.faceUrl = null
        d.removeFace = true
        ring()
      }
      const bind = (id, key) => root.querySelector(id)?.addEventListener('input', (e) => {
        d[key] = e.target.value
        e.target.closest('.nk-field').classList.remove('has-error')
        e.target.closest('.nk-field').querySelector('.nk-field-error').hidden = true
      })
      bind('#f-name', 'name')
      bind('#f-why', 'why')
      bind('#f-plan', 'plan')
      bind('#f-notes', 'notes')
      root.querySelector('#f-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          root.querySelector('#f-why').focus()
        }
      })
      for (const b of root.querySelectorAll('[data-type]')) {
        b.onclick = () => {
          d.type = b.dataset.type
          for (const o of root.querySelectorAll('[data-type]')) {
            o.classList.toggle('is-on', o === b)
            o.setAttribute('aria-checked', o === b)
          }
        }
      }
      const date = root.querySelector('#f-date')
      if (date) {
        const sync = () => {
          d.remindOn = date.value
          root.querySelector('.date-ph').hidden = !!date.value
          root.querySelector('[data-act="clear-date"]').hidden = !date.value
        }
        date.addEventListener('input', sync)
        date.addEventListener('change', sync)
        root.querySelector('[data-act="clear-date"]').onclick = () => {
          date.value = ''
          sync()
        }
      }
      const docBox = root.querySelector('[data-doc]')
      if (docBox) {
        if (!d.docUrl && !d.removeDoc && d.docPhotoId) photoUrl(d.docPhotoId).then((u) => {
          if (u && !d.docUrl) {
            d.docUrl = u
            docPicker(docBox, d)
          }
        })
        docPicker(docBox, d)
      }
      form.onsubmit = async (e) => {
        e.preventDefault()
        const errs = []
        if (!d.name.trim()) errs.push(['f-name', 'צריך שם. או לפחות כינוי.'])
        if (!d.why.trim()) errs.push(['f-why', 'בלי סיבה זו סתם רשעות 😼'])
        for (const [id, msg] of errs) {
          const f = root.querySelector(`[data-field="${id}"]`)
          f.classList.add('has-error')
          const m = f.querySelector('.nk-field-error')
          m.textContent = msg
          m.hidden = false
        }
        if (errs.length) {
          root.querySelector(`#${errs[0][0]}`).focus()
          return
        }
        form.querySelector('[type=submit]').disabled = true
        const now = new Date().toISOString()
        const r = existing
          ? { ...existing }
          : { id: newId(), status: 'open', createdAt: now }
        Object.assign(r, { name: d.name.trim(), why: d.why.trim(), type: d.type, plan: (d.plan || '').trim() || undefined })
        if (!done) r.remindOn = d.remindOn || undefined
        if (done) r.notes = (d.notes || '').trim() || undefined
        if (d.faceBlob) {
          await dropPhoto(existing?.photoId)
          r.photoId = await storePhoto(d.faceBlob, 'face')
        } else if (d.removeFace && r.photoId) {
          await dropPhoto(r.photoId)
          delete r.photoId
        }
        if (d.docBlob) {
          await dropPhoto(existing?.docPhotoId)
          r.docPhotoId = await storePhoto(d.docBlob, 'doc')
        } else if (d.removeDoc && r.docPhotoId) {
          await dropPhoto(r.docPhotoId)
          delete r.docPhotoId
        }
        for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k]
        await save(r)
        S.draft = null
        if (editing) {
          go(`#/r/${r.id}`)
          toast('נשמר')
        } else {
          go('#/')
          toast('הנקמה נרשמה. היא בידיים טובות 😼')
        }
      }
    },
  }
}

// ---------- Crop (full-screen overlay; resolves with a square JPEG or null) ----------

async function cropFace(file) {
  let loaded
  try {
    loaded = await loadImage(file)
  } catch {
    toast('לא הצלחתי לפתוח את התמונה')
    return null
  }
  const { img, url } = loaded
  return new Promise((resolve) => {
    const ov = document.createElement('div')
    ov.className = 'screen enter'
    ov.style.cssText = 'position:fixed;inset:0;z-index:60;background:var(--surface);overflow-y:auto'
    ov.setAttribute('role', 'dialog')
    ov.setAttribute('aria-modal', 'true')
    ov.setAttribute('aria-label', 'מיקום התמונה בעיגול')
    ov.innerHTML = `
      ${topbar({ title: g('מקמי את הפנים', 'מקם את הפנים'), start: `<button type="button" class="icon-btn" data-cancel aria-label="ביטול">${icon('arrow-right', 28)}</button>` }).replace('<h1>', '<h1 style="font-size:26px;line-height:34px">')}
      <p class="lead">${g('גררי את התמונה וצבטי כדי להגדיל, עד שהפנים בתוך העיגול', 'גרור את התמונה וצבוט כדי להגדיל, עד שהפנים בתוך העיגול')}</p>
      <div class="crop-stage" data-stage><img src="${url}" alt=""><div class="crop-mask"></div></div>
      <div class="zoom-row"><label for="zoom"><span>זום</span><span class="muted" data-zl>100%</span></label>
        <input id="zoom" class="nk-range" type="range" min="100" max="400" step="1" value="100"></div>
      <div class="preview-face"><canvas width="128" height="128" data-prev></canvas><span>כך זה ייראה</span></div>
      <div class="actions" style="padding-top:20px">
        <button type="button" class="nk-btn nk-btn-primary" data-ok><span>${g('שמרי תמונה', 'שמור תמונה')}</span>${icon('check', 22)}</button>
        <label class="nk-btn nk-btn-quiet">${g('בחרי תמונה אחרת', 'בחר תמונה אחרת')}<input type="file" accept="image/*" class="sr-only" data-other></label></div>`
    document.body.append(ov)
    document.body.style.overflow = 'hidden'
    let shown = true
    const hide = () => {
      if (!shown) return false
      shown = false
      window.removeEventListener('resize', layout)
      document.body.style.overflow = ''
      URL.revokeObjectURL(url)
      ov.remove()
      return true
    }
    const release = pushLayer(() => hide() && resolve(null))

    const stage = ov.querySelector('[data-stage]')
    const pic = stage.querySelector('img')
    const range = ov.querySelector('#zoom')
    const prev = ov.querySelector('[data-prev]').getContext('2d')
    const w = img.naturalWidth, h = img.naturalHeight
    let S0, D, base, st
    const layout = () => {
      S0 = stage.clientWidth
      D = S0 * CIRCLE
      base = cropBase(w, h, D)
      const scale = base * (st ? st.scale / st.base : 1)
      st = { base, scale, x: (S0 - w * scale) / 2, y: (S0 - h * scale) / 2 }
      apply()
    }
    let raf = 0
    const apply = () => {
      const p = clampPos(st.x, st.y, w, h, st.scale, S0, D)
      st.x = p.x
      st.y = p.y
      pic.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.scale})`
      pic.style.width = `${w}px`
      pic.style.height = `${h}px`
      const z = Math.round((st.scale / base) * 100)
      range.value = z
      ov.querySelector('[data-zl]').textContent = `${z}%`
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const c = cropRect(st.x, st.y, st.scale, S0, D)
        prev.clearRect(0, 0, 128, 128)
        prev.drawImage(img, c.sx, c.sy, c.size, c.size, 0, 0, 128, 128)
      })
    }
    const zoomTo = (pct, px = S0 / 2, py = S0 / 2) => {
      const next = base * Math.min(4, Math.max(1, pct / 100))
      Object.assign(st, zoomAt(st, next, px, py))
      apply()
    }
    requestAnimationFrame(layout)
    window.addEventListener('resize', layout)
    range.oninput = () => zoomTo(Number(range.value))

    // Drag with one finger, pinch with two.
    const pts = new Map()
    let last = null
    const local = (e) => {
      const b = stage.getBoundingClientRect()
      return { x: e.clientX - b.left, y: e.clientY - b.top }
    }
    const snapshot = () => {
      const v = [...pts.values()]
      if (v.length >= 2) {
        const [a, b] = v
        return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) }
      }
      return v.length ? { mx: v[0].x, my: v[0].y, dist: 0 } : null
    }
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, local(e))
      last = snapshot()
    })
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, local(e))
      const now = snapshot()
      if (last && now) {
        st.x += now.mx - last.mx
        st.y += now.my - last.my
        if (now.dist && last.dist) {
          const next = Math.min(base * 4, Math.max(base, st.scale * (now.dist / last.dist)))
          Object.assign(st, zoomAt(st, next, now.mx, now.my))
        }
        apply()
      }
      last = now
    })
    const up = (e) => {
      pts.delete(e.pointerId)
      last = snapshot()
    }
    stage.addEventListener('pointerup', up)
    stage.addEventListener('pointercancel', up)
    stage.addEventListener('wheel', (e) => {
      e.preventDefault()
      const p = local(e)
      zoomTo((st.scale / base) * 100 * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y)
    }, { passive: false })

    const close = async (result, settle = true) => {
      hide()
      await release()
      if (settle) resolve(result)
    }
    ov.querySelector('[data-cancel]').onclick = () => close(null)
    ov.querySelector('[data-other]').onchange = async (e) => {
      const f = e.target.files?.[0]
      if (!f) return
      await close(null, false)
      resolve(await cropFace(f))
    }
    ov.querySelector('[data-ok]').onclick = async () => {
      const c = cropRect(st.x, st.y, st.scale, S0, D)
      const out = document.createElement('canvas')
      const side = Math.min(FACE_SIDE, Math.round(c.size))
      out.width = out.height = Math.max(64, side)
      out.getContext('2d').drawImage(img, c.sx, c.sy, c.size, c.size, 0, 0, out.width, out.height)
      close(await toBlob(out, 0.86))
    }
  })
}

function statsScreen() {
  const s = stats(S.list)
  const header = `<header class="topbar"><a class="icon-btn" href="#/settings" aria-label="הגדרות">${icon('settings', 30)}</a><h1>סטטיסטיקות</h1>${meBadge()}</header>`
  if (!s.total) {
    return { nav: 'stats', html: `${header}<div class="empty">${cat(150)}<h2>עוד אין מה לספור</h2><p>אחרי כמה נקמות יופיעו כאן גרפים מרשימים ומדאיגים.</p></div>` }
  }
  const maxT = Math.max(1, ...s.byType.map((t) => t.count))
  const maxM = Math.max(1, ...s.months.map((m) => m.count))
  return {
    nav: 'stats',
    html: `${header}
      <div class="stat-grid">
        <div class="stat"><div class="stat-n">${s.open}</div><div class="stat-l">פתוחות</div></div>
        <div class="stat"><div class="stat-n">${s.done}</div><div class="stat-l">הושלמו</div></div>
        <div class="stat"><div class="stat-n">${s.thisMonth}</div><div class="stat-l">בוצעו החודש</div></div>
        <div class="stat"><div class="stat-n">${s.rate}%</div><div class="stat-l">אחוז ביצוע</div></div></div>
      <section class="panel"><h2>לפי סוג</h2>${s.byType
        .map((t) => `<div class="bar-row"><span class="lbl">${icon(t.icon, 20, t.fill)}${t.label}</span><span class="bar"><i style="width:${(t.count / maxT) * 100}%"></i></span><span class="n">${t.count}</span></div>`)
        .join('')}</section>
      <section class="panel"><h2>בוצעו בחצי השנה האחרונה</h2><div class="cols">${s.months
        .map((m) => `<div class="col"><b>${m.count || ''}</b><i style="height:${(m.count / maxM) * 100}%"></i><span>${monthShort(m.date)}</span></div>`)
        .join('')}</div></section>
      <section class="panel"><h2>עובדות מעניינות</h2>
        <p style="margin:0 0 8px">${s.avgDays === null ? 'עוד לא בוצעה אף נקמה. הסבלנות שלך מעוררת השראה.' : s.avgDays === 0 ? 'את הנקמות שלך מבצעים באותו יום. מהיר ועצבני ⚡' : `בממוצע עוברים ${s.avgDays} ימים מהרישום עד הביצוע. נקמה היא מנה שמוגשת קרה.`}</p>
        ${s.regular ? `<p style="margin:0">הקבוע/ה של החודש: <b>${esc(s.regular.name)}</b>, עם ${s.regular.count} נקמות.</p>` : ''}</section>`,
  }
}

function ideasScreen() {
  const list = IDEAS.filter((i) => S.ideaFilter === 'all' || i.type === S.ideaFilter)
  if (!S.lucky || !list.includes(S.lucky)) S.lucky = list[Math.floor(Math.random() * list.length)]
  const L = S.lucky
  const chips = [{ id: 'all', label: 'הכל' }, ...TYPES]
  return {
    nav: 'ideas',
    html: `
      <header class="topbar"><a class="icon-btn" href="#/settings" aria-label="הגדרות">${icon('settings', 30)}</a><h1>השראה לנקמה</h1>${meBadge()}</header>
      <p class="lead" style="margin-bottom:0">רק נקמות מצחיקות שלא מזיקות לאף אחד 💜</p>
      <div class="chips" role="group" aria-label="סינון לפי סוג">${chips
        .map((c) => `<button type="button" class="fchip${S.ideaFilter === c.id ? ' is-on' : ''}" data-filter="${c.id}" aria-pressed="${S.ideaFilter === c.id}">${c.icon ? icon(c.icon, 18, c.fill) : ''}${c.label}</button>`)
        .join('')}</div>
      <section class="idea-lucky" aria-live="polite">
        <div class="muted" style="font-size:14px">${icon(typeOf(L.type).icon, 16, typeOf(L.type).fill)} ${typeOf(L.type).label}</div>
        <div class="t">${esc(L.title)}</div><div class="d">${esc(L.text)}</div>
        <div class="row"><button type="button" class="small-btn" data-act="lucky">${icon('dice', 20, 'lilac-200')}עוד רעיון</button>
          <a class="small-btn primary" href="#/new?idea=${L.id}">${icon('plus', 20)}${g('קחי את זה', 'קח את זה')}</a></div></section>
      <div class="list">${list
        .map((i) => `<div class="idea">${icon(typeOf(i.type).icon, 30, typeOf(i.type).fill)}<p><span class="t">${esc(i.title)}</span><span class="d">${esc(i.text)}</span></p>
          <a class="icon-btn raised" href="#/new?idea=${i.id}" aria-label="נקמה חדשה עם הרעיון ${esc(i.title)}">${icon('plus', 22)}</a></div>`)
        .join('')}</div>`,
    mount(root) {
      for (const b of root.querySelectorAll('[data-filter]')) {
        b.onclick = () => {
          S.ideaFilter = b.dataset.filter
          S.lucky = null
          render()
        }
      }
    },
  }
}

function settingsScreen() {
  const seg = (key, opts) =>
    `<div class="seg" role="group">${opts
      .map(([v, l]) => `<button type="button" data-set="${key}" data-val="${v}" class="${S.settings[key] === v ? 'is-on' : ''}" aria-pressed="${S.settings[key] === v}">${l}</button>`)
      .join('')}</div>`
  return {
    html: `
      ${topbar({ title: 'הגדרות', start: backBtn('#/') })}
      ${profileSection()}
      ${syncSection()}
      <section class="group"><h2>איך לפנות אליך?</h2><div class="rows">
        <div class="row"><span class="grow">לשון פנייה<small>${g('"שמרי נקמה"', '"שמור נקמה"')}</small></span>${seg('voice', [['f', 'נקבה'], ['m', 'זכר']])}</div></div></section>
      <section class="group"><h2>מראה</h2><div class="rows">
        <div class="row"><span class="grow">ערכת צבעים</span>${seg('theme', [['auto', 'אוטומטי'], ['light', 'בהיר'], ['dark', 'כהה']])}</div></div></section>
      <section class="group"><h2>התקנה על הטלפון</h2><div class="rows"><div class="row" style="align-items:flex-start;padding:14px 16px">
        ${installSteps()}</div></div></section>
      <section class="group"><h2>גרסת בטא</h2><div class="rows">
        <button type="button" class="row" data-act="feedback">${icon('note', 24)}<span class="grow">משוב ודיווח על בעיה<small>נשלח למי שהזמין אותך, דרך וואטסאפ או כל אפליקציה אחרת.</small></span></button></div></section>
      <section class="group"><h2>הנתונים שלך</h2><div class="rows">
        <div class="row">${icon('lock', 24, 'lilac-200')}<span class="grow">${sync.isOn() ? 'הכל שמור בטלפון, ובענן רק עותק מוצפן' : 'הכל נשמר רק בטלפון הזה'}<small>${sync.isOn() ? 'רק טלפון עם קוד הסנכרון יכול לפתוח אותו.' : 'אין שרת, אין חשבון ואף אחד אחר לא רואה.'} <span data-used></span></small></span></div>
        <button type="button" class="row" data-act="export">${icon('download', 24)}<span class="grow">ייצוא גיבוי<small>קובץ אחד עם כל הנקמות והתמונות. ${g('שמרי', 'שמור')} אותו בקבצים או ב־iCloud.</small></span></button>
        <label class="row">${icon('share', 24)}<span class="grow">ייבוא גיבוי<small>מאחד עם מה שכבר יש כאן. גם להעברה לטלפון חדש.</small></span><input type="file" accept="application/json,.json" data-import aria-label="קובץ גיבוי"></label>
        <button type="button" class="row danger" data-act="wipe">${icon('trash', 24)}<span class="grow">מחיקת כל הנתונים</span></button></div></section>
      <p class="foot">נקמות שלי · גרסה ${APP_VERSION} · בטא לחברים<br>נקמה היא מנה שמוגשת עם חתול 🐱</p>`,
    mount(root) {
      for (const b of root.querySelectorAll('[data-set]')) {
        b.onclick = () => {
          S.settings[b.dataset.set] = b.dataset.val
          db.saveSettings(S.settings)
          applyTheme()
          render()
        }
      }
      db.storageUsed().then((n) => {
        if (n) root.querySelector('[data-used]').textContent = `בשימוש: ${(n / 1048576).toFixed(1)} מ״ב.`
      })
      root.querySelector('[data-import]').onchange = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) await importBackup(f)
      }
    },
  }
}

// ---------- Your cat (identity for groups) ----------

/** The header's cat: your avatar once you made one, the app's cat otherwise. */
function meBadge() {
  const p = identity.profile()
  return p
    ? `<a class="icon-btn me-badge" href="#/me" aria-label="החתול שלי: ${esc(p.nickname)}">${identity.catAvatar(p, 42)}</a>`
    : catHead()
}

function profileSection() {
  const p = identity.profile()
  return `<section class="group"><h2>החתול שלך</h2><div class="rows">
    <a class="row" href="#/me">${p ? identity.catAvatar(p, 44) : icon('user', 26, 'lilac-200')}
      <span class="grow">${p ? `<b>${esc(p.nickname)}</b><small>ככה החברים יראו אותך בקבוצות. נגיעה לעריכה.</small>` : `<b>${g('צרי', 'צור')} את החתול שלך</b><small>כינוי ודמות לקבוצות שבדרך. בלי הרשמה ובלי סיסמה.</small>`}</span>
      ${icon('chevron-left', 20)}</a></div></section>`
}

function profileScreen() {
  const cur = identity.profile()
  if (!S.me) S.me = cur ? { ...cur } : { nickname: identity.suggestNickname(), color: 'lilac', accessory: 'crown' }
  const d = S.me
  return {
    html: `
      <div class="deco checker" aria-hidden="true" style="top:-30px;left:-30px;width:230px;height:150px;border-radius:0 0 60% 40% / 0 0 70% 50%"></div>
      ${topbar({ title: 'החתול שלך', start: backBtn(cur ? '#/settings' : '#/settings') })}
      <div class="me-stage"><div class="me-blob" data-preview>${identity.catAvatar(d, 168, 'התצוגה של החתול שלך')}</div>
        <div class="me-name" data-name>${esc(d.nickname)}</div></div>
      <div class="form" style="gap:20px">
        <div class="nk-field" data-field="me-nick"><label class="nk-field-label" for="me-nick">כינוי</label>
          <div class="nk-input">${icon('user', 24, 'lilac-200')}<input id="me-nick" maxlength="20" autocomplete="off" value="${esc(d.nickname)}">
            <button type="button" class="clear" data-dice aria-label="כינוי אחר">${icon('dice', 24, 'lilac-200')}</button></div>
          <div class="nk-field-error" hidden></div></div>
        <div class="nk-field"><span class="nk-field-label" id="me-col-l">צבע</span>
          <div class="swatches" role="radiogroup" aria-labelledby="me-col-l">${identity.CAT_COLORS.map(
            (c) => `<button type="button" role="radio" class="swatch${c.id === d.color ? ' is-on' : ''}" aria-checked="${c.id === d.color}" aria-label="${c.label}" data-color="${c.id}" style="--c:${c.fill}"></button>`,
          ).join('')}</div></div>
        <div class="nk-field"><span class="nk-field-label" id="me-acc-l">אביזר</span>
          <div class="acc-grid" role="radiogroup" aria-labelledby="me-acc-l">${identity.ACCESSORIES.map(
            (a) => `<button type="button" role="radio" class="acc${a.id === d.accessory ? ' is-on' : ''}" aria-checked="${a.id === d.accessory}" data-acc="${a.id}">${identity.catAvatar({ color: d.color, accessory: a.id }, 52)}<span>${a.label}</span></button>`,
          ).join('')}</div></div>
        <div class="actions" style="padding:4px 0 0"><button type="button" class="nk-btn nk-btn-primary" data-save-me><span>זה אני!</span>${icon('check', 22)}</button></div>
      </div>`,
    mount(root) {
      const preview = () => {
        root.querySelector('[data-preview]').innerHTML = identity.catAvatar(d, 168, 'התצוגה של החתול שלך')
        root.querySelector('[data-name]').textContent = d.nickname || ' '
      }
      const nick = root.querySelector('#me-nick')
      nick.addEventListener('input', () => {
        d.nickname = nick.value
        root.querySelector('[data-field="me-nick"]').classList.remove('has-error')
        preview()
      })
      root.querySelector('[data-dice]').onclick = () => {
        d.nickname = identity.suggestNickname(d.nickname)
        nick.value = d.nickname
        buzz(15)
        preview()
      }
      for (const b of root.querySelectorAll('[data-color]')) {
        b.onclick = () => {
          d.color = b.dataset.color
          for (const o of root.querySelectorAll('[data-color]')) {
            o.classList.toggle('is-on', o === b)
            o.setAttribute('aria-checked', o === b)
          }
          for (const a of root.querySelectorAll('[data-acc]')) a.querySelector('svg').outerHTML = identity.catAvatar({ color: d.color, accessory: a.dataset.acc }, 52)
          preview()
        }
      }
      for (const b of root.querySelectorAll('[data-acc]')) {
        b.onclick = () => {
          d.accessory = b.dataset.acc
          for (const o of root.querySelectorAll('[data-acc]')) {
            o.classList.toggle('is-on', o === b)
            o.setAttribute('aria-checked', o === b)
          }
          preview()
        }
      }
      root.querySelector('[data-save-me]').onclick = async () => {
        if (!identity.validNickname(d.nickname)) {
          const f = root.querySelector('[data-field="me-nick"]')
          f.classList.add('has-error')
          f.querySelector('.nk-field-error').textContent = 'כינוי באורך 2 עד 20 תווים'
          f.querySelector('.nk-field-error').hidden = false
          nick.focus()
          return
        }
        const first = !identity.profile()
        await identity.saveProfile(d)
        S.me = null
        sync.soon()
        confetti()
        buzz(40)
        let after = null
        try {
          after = sessionStorage.getItem('nk.after')
          sessionStorage.removeItem('nk.after')
        } catch { /* ignore */ }
        go(after || '#/settings')
        if (first && !sync.isOn()) {
          const ok = await confirmSheet({
            title: 'לשמור את החתול בענן?',
            text: 'בלי גיבוי, החתול והקבוצות שלך נשארים רק בטלפון הזה. עם גיבוי, הם עוברים איתך לכל טלפון.',
            ok: 'הפעלת גיבוי בענן',
            danger: false,
          })
          if (ok) syncAction('sync-on')
        } else toast(first ? 'נעים להכיר 🐾' : 'נשמר')
      }
    },
  }
}

// ---------- Cloud backup and sync ----------

const RTF = new Intl.RelativeTimeFormat('he', { numeric: 'auto' })
function ago(iso) {
  const sec = Math.round((new Date(iso) - Date.now()) / 1000)
  if (sec > -45) return 'עכשיו'
  const min = Math.round(sec / 60)
  if (min > -60) return RTF.format(min, 'minute')
  const h = Math.round(min / 60)
  if (h > -24) return RTF.format(h, 'hour')
  return RTF.format(Math.round(h / 24), 'day')
}

function syncSection() {
  const st = sync.status()
  if (!st.on) {
    return `<section class="group"><h2>גיבוי וסנכרון בענן</h2><div class="rows">
      <div class="row">${icon('cloud', 26, 'lilac-200')}<span class="grow">כבוי<small>עותק מוצפן בענן, וסנכרון בין כל הטלפונים שלך. בלי הרשמה ובלי סיסמה.</small></span></div>
      <button type="button" class="row" data-act="sync-on">${icon('cloud', 24)}<span class="grow"><b>הפעלת גיבוי בענן</b><small>הטלפון הזה מקבל קוד סנכרון.</small></span></button>
      <button type="button" class="row" data-act="sync-join">${icon('link', 24)}<span class="grow">יש לי קוד מטלפון אחר</span></button></div></section>`
  }
  const line = st.error
    ? `<small style="color:var(--danger)">${st.error === 'offline' ? 'אין אינטרנט כרגע. הסנכרון ימשיך כשיחזור.' : 'הסנכרון האחרון לא הצליח. ננסה שוב.'}</small>`
    : `<small>${st.lastOk ? `סונכרן ${ago(st.lastOk)}` : 'מסתנכרן…'}</small>`
  return `<section class="group"><h2>גיבוי וסנכרון בענן</h2><div class="rows">
    <div class="row">${icon('cloud', 26, 'lilac-300')}<span class="grow"><b>פעיל</b> · מוצפן${line}</span></div>
    <button type="button" class="row" data-act="sync-now">${icon('refresh', 24)}<span class="grow">סנכרון עכשיו</span></button>
    <button type="button" class="row" data-act="sync-share">${icon('link', 24)}<span class="grow">חיבור טלפון נוסף<small>קישור או קוד, ושם הכל מופיע.</small></span></button>
    <button type="button" class="row" data-act="sync-off">${icon('x', 24)}<span class="grow">ניתוק הטלפון הזה<small>הנקמות נשארות בטלפון ובגיבוי.</small></span></button>
    <button type="button" class="row danger" data-act="sync-delete">${icon('trash', 24)}<span class="grow">מחיקת הגיבוי מהענן</span></button></div></section>`
}

function codeSheet() {
  const st = sync.status()
  const link = sync.pairLink(st.code)
  const s = sheet(
    `<div class="sheet-head">${icon('cloud', 44, 'lilac-200')}<h2>חיבור טלפון נוסף</h2>
       <p>${g('פתחי', 'פתח')} את הקישור בטלפון השני (בספארי), או ${g('הקלידי', 'הקלד')} שם את הקוד בהגדרות.</p></div>
     <div class="panel" style="margin:0;text-align:center"><div class="muted" style="font-size:13px">קוד הסנכרון</div>
       <div dir="ltr" data-code style="font-family:ui-monospace,Menlo,monospace;font-size:19px;line-height:30px;font-weight:600;letter-spacing:.04em;user-select:all">${esc(sync.formatCode(st.code))}</div></div>
     <p class="muted" style="margin:0;font-size:14px;line-height:20px">${icon('lock', 16)} מי שיש לו את הקוד רואה את כל הנקמות. ${g('שמרי', 'שמור')} אותו במקום בטוח: בלי הקוד אין דרך לשחזר את הגיבוי.</p>
     <div class="actions" style="padding-top:0">
       <button type="button" class="nk-btn nk-btn-primary" data-share>${icon('share', 22)}<span>שיתוף הקישור</span></button>
       <button type="button" class="nk-btn nk-btn-quiet" data-copy>העתקת הקוד</button>
       <button type="button" class="nk-btn nk-btn-quiet" data-done style="color:var(--ink-muted)">סיום</button></div>`,
    { label: 'חיבור טלפון נוסף' },
  )
  s.el.querySelector('[data-share]').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'נקמות שלי · סנכרון', url: link })
        return
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    await copy(link)
    toast('הקישור הועתק')
  }
  s.el.querySelector('[data-done]').onclick = () => s.close()
  s.el.querySelector('[data-copy]').onclick = async () => {
    await copy(sync.formatCode(st.code))
    toast('הקוד הועתק')
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

function joinSheet() {
  const s = sheet(
    `<div class="sheet-head">${icon('link', 40, 'lilac-200')}<h2>חיבור לגיבוי קיים</h2>
       <p>${g('הדביקי', 'הדבק')} את הקישור או ${g('הקלידי', 'הקלד')} את הקוד מהטלפון השני. הנקמות שכבר יש כאן יתאחדו עם הגיבוי.</p></div>
     <div class="nk-field"><label class="nk-field-label" for="j-code">קוד סנכרון</label>
       <div class="nk-input">${icon('lock', 24, 'lilac-200')}<input id="j-code" dir="ltr" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…"></div>
       <div class="nk-field-error" hidden></div></div>
     <div class="actions" style="padding-top:0"><button type="button" class="nk-btn nk-btn-primary" data-go><span>חיבור</span>${icon('check', 22)}</button></div>`,
    { label: 'חיבור לגיבוי קיים' },
  )
  const input = s.el.querySelector('#j-code')
  const err = s.el.querySelector('.nk-field-error')
  s.el.querySelector('[data-go]').onclick = async (e) => {
    e.currentTarget.disabled = true
    try {
      await joinWith(input.value)
      await s.close()
    } catch (x) {
      err.textContent = x.message
      err.hidden = false
      e.currentTarget.disabled = false
    }
  }
}

async function joinWith(code) {
  const before = S.list.length
  await sync.join(code)
  S.list = await db.allRevenges()
  const got = S.list.length - before
  toast(got > 0 ? `מחובר! ${got} נקמות הגיעו מהענן ☁️` : 'מחובר לגיבוי בענן ☁️')
  render()
}

function pairScreen(raw) {
  const code = sync.normalizeCode(`#/pair/${raw}`)
  const st = sync.status()
  const same = st.on && st.code === code
  return {
    html: `${topbar({ title: 'חיבור טלפון', start: backBtn('#/') })}
      <div class="empty">${cat(140)}
        ${!code
          ? `<h2>הקישור לא תקין</h2><p>אולי חסר בו חלק. ${g('נסי', 'נסה')} להעתיק אותו שוב, או ${g('הקלידי', 'הקלד')} את הקוד בהגדרות.</p>`
          : same
            ? `<h2>הטלפון כבר מחובר</h2><p>הוא כבר מסתנכרן עם הגיבוי הזה.</p><a class="nk-btn nk-btn-soft" href="#/" style="margin-top:16px">לנקמות</a>`
            : `<h2>לחבר את הטלפון הזה?</h2><p>הנקמות מהגיבוי בענן יופיעו כאן, ומה שכבר יש בטלפון יתווסף לגיבוי.${st.on ? ' הטלפון מחובר עכשיו לגיבוי אחר, והחיבור יחליף אותו.' : ''}</p>
               <button type="button" class="nk-btn nk-btn-primary" data-pair style="margin-top:20px">${icon('cloud', 22)}<span>חיבור</span></button>
               <p class="nk-field-error" data-err hidden style="margin-top:12px"></p>`}
      </div>`,
    mount(root) {
      const b = root.querySelector('[data-pair]')
      if (!b) return
      b.onclick = async () => {
        b.disabled = true
        try {
          await joinWith(code)
          go('#/', true) // also drops the code from the history
        } catch (x) {
          const e = root.querySelector('[data-err]')
          e.textContent = x.message
          e.hidden = false
          b.disabled = false
        }
      }
    },
  }
}

async function syncAction(act) {
  if (act === 'sync-on') {
    try {
      await sync.enable()
      render()
      codeSheet()
    } catch (e) {
      toast(e.message)
    }
  } else if (act === 'sync-join') joinSheet()
  else if (act === 'sync-share') codeSheet()
  else if (act === 'sync-now') {
    toast('מסנכרן…')
    try {
      const r = await sync.sync()
      S.list = await db.allRevenges()
      toast(r.pulled ? `סונכרן. ${r.pulled} עדכונים הגיעו` : 'הכל מסונכרן ✓')
    } catch {
      toast('הסנכרון לא הצליח. בדקו את האינטרנט.')
    }
    render()
  } else if (act === 'sync-off') {
    if (await confirmSheet({ title: 'לנתק את הטלפון הזה?', text: 'הנקמות נשארות כאן ובגיבוי. אפשר להתחבר שוב עם הקוד.', ok: 'ניתוק', danger: false })) {
      sync.disconnect()
      render()
      toast('הטלפון נותק מהגיבוי')
    }
  } else if (act === 'sync-delete') {
    if (await confirmSheet({ title: 'למחוק את הגיבוי מהענן?', text: 'הגיבוי יימחק מהענן לכל הטלפונים. מה ששמור בכל טלפון נשאר בו.', ok: 'מחיקה מהענן' })) {
      try {
        await sync.deleteCloud()
        render()
        toast('הגיבוי נמחק מהענן')
      } catch {
        toast('המחיקה לא הצליחה. בדקו את האינטרנט.')
      }
    }
  }
}

function notFound() {
  return { html: `${topbar({ title: 'לא נמצא', start: backBtn('#/') })}<div class="empty">${cat(150)}<h2>הנקמה הזו נעלמה</h2><p>אולי היא נמחקה. או שהחתול אכל אותה.</p><a class="nk-btn nk-btn-soft" href="#/" style="margin-top:16px">לרשימה</a></div>` }
}

// ---------- Backup ----------

async function exportBackup() {
  const photos = []
  for (const p of await db.allPhotos()) photos.push({ id: p.id, kind: p.kind, createdAt: p.createdAt, data: await blobToDataUrl(p.blob) })
  const data = { kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), revenges: S.list, photos }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  await downloadOrShare(blob, `nekamot-backup-${toDay(new Date())}.json`, 'גיבוי נקמות שלי')
}

async function importBackup(file) {
  try {
    const { revenges, photos } = readBackup(JSON.parse(await file.text()))
    const { list, added, updated } = mergeRevenges(S.list, revenges)
    const have = new Set((await db.allPhotos()).map((p) => p.id))
    for (const p of photos) {
      if (!have.has(p.id)) await db.putPhoto({ id: p.id, kind: p.kind, createdAt: p.createdAt, blob: await dataUrlToBlob(p.data) })
    }
    for (const r of list) await db.putRevenge(r)
    S.list = list
    sync.pushAllNextTime()
    sync.soon()
    toast(added || updated ? `יובאו ${added} נקמות חדשות${updated ? `, ${updated} עודכנו` : ''}` : 'הכל כבר היה כאן')
    render()
  } catch (err) {
    toast(err instanceof SyntaxError ? 'הקובץ לא נפתח. זה קובץ הגיבוי?' : err.message)
  }
}

// ---------- Actions (event delegation) ----------

app.addEventListener('click', async (e) => {
  // Links that should come back here after creating your cat.
  const after = e.target.closest('a[data-after]')
  if (after) {
    try {
      sessionStorage.setItem('nk.after', after.dataset.after)
    } catch { /* ignore */ }
  }
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const r = byId(el.dataset.id || route().id)
  if (act === 'complete' && r) completeSheet(r, el.dataset.id ? 'home' : 'details')
  else if (act === 'delete' && r) {
    if (await confirmSheet({ title: `למחוק את ${r.name}?`, text: 'הנקמה והתמונות שלה יימחקו מהטלפון.', ok: 'מחיקה' })) removeRevenge(r)
  } else if (act === 'reopen' && r) {
    const next = { ...r, status: 'open' }
    delete next.doneAt
    await save(next)
    go('#/', true)
    toast('חזרה לרשימת הפתוחות. סיבוב שני 😈')
  } else if (act === 'ics' && r) {
    downloadOrShare(new Blob([reminderIcs(r)], { type: 'text/calendar' }), `nekama-${toDay(new Date())}.ics`, 'תזכורת')
  } else if (act === 'hide-install') {
    S.settings.hideInstall = true
    db.saveSettings(S.settings)
    el.closest('.banner').remove()
  } else if (act === 'lucky') {
    const list = IDEAS.filter((i) => (S.ideaFilter === 'all' || i.type === S.ideaFilter) && i !== S.lucky)
    S.lucky = list[Math.floor(Math.random() * list.length)] || S.lucky
    render()
  } else if (act === 'to-group' && r) {
    GU.moveSheet(r, async () => {
      S.list = S.list.filter((x) => x.id !== r.id)
      await db.deleteRevenge(r.id)
      sync.deleted(r.id, 'revenge')
      dropPhoto(r.photoId)
      dropPhoto(r.docPhotoId)
    })
  } else if (act === 'install' && installPrompt) {
    const p = installPrompt
    installPrompt = null
    await p.prompt()
    await p.userChoice.catch(() => undefined)
    render()
  } else if (act === 'feedback') {
    feedbackSheet()
  } else if (act.startsWith('sync-')) {
    syncAction(act)
  } else if (act === 'export') {
    exportBackup().catch(() => toast('הייצוא נכשל'))
  } else if (act === 'wipe') {
    const text = sync.isOn()
      ? 'כל הנקמות והתמונות יימחקו מהטלפון הזה, והוא יתנתק מהגיבוי בענן. הגיבוי עצמו והטלפונים האחרים לא ייפגעו.'
      : 'כל הנקמות והתמונות יימחקו מהטלפון ואין דרך לשחזר. כדאי לייצא גיבוי לפני.'
    if (await confirmSheet({ title: 'למחוק הכל?', text, ok: 'מחיקת הכל' })) {
      sync.disconnect()
      await db.clearAll()
      S.list = []
      toast('הכל נמחק. דף חדש 🕊️')
      go('#/')
    }
  }
})

// ---------- Router ----------

function route() {
  const raw = location.hash.slice(1) || '/'
  const [path, qs] = raw.split('?')
  const query = new URLSearchParams(qs || '')
  const parts = path.split('/').filter(Boolean)
  if (!parts.length) return { name: 'home', tab: 'open', query }
  if (parts[0] === 'done') return { name: 'home', tab: 'done', query }
  if (parts[0] === 'new') return { name: 'form', query }
  if (parts[0] === 'r' && parts[2] === 'edit') return { name: 'form', id: parts[1], query }
  if (parts[0] === 'r') return { name: 'details', id: parts[1], query }
  if (parts[0] === 'stats') return { name: 'stats', query }
  if (parts[0] === 'ideas') return { name: 'ideas', query }
  if (parts[0] === 'settings') return { name: 'settings', query }
  if (parts[0] === 'pair') return { name: 'pair', code: parts[1] || '', query }
  if (parts[0] === 'me') return { name: 'me', query }
  if (parts[0] === 'groups') return { name: parts[1] === 'new' ? 'group-new' : 'groups', query }
  if (parts[0] === 'join') return { name: 'join', code: parts[1] || '', query }
  if (parts[0] === 'g' && parts[1]) {
    const gid = parts[1]
    if (parts[2] === 'info') return { name: 'group-info', gid, query }
    if (parts[2] === 'new') return { name: 'group-form', gid, query }
    if (parts[2] === 'r' && parts[4] === 'edit') return { name: 'group-form', gid, rid: parts[3], query }
    if (parts[2] === 'r') return { name: 'group-revenge', gid, rid: parts[3], query }
    return { name: 'group', gid, query }
  }
  return { name: 'missing', query }
}

let lastKey = ''
function render() {
  const rt = route()
  if (rt.name !== 'form') S.draft = null
  if (rt.name !== 'me') S.me = null
  if (rt.name !== 'group-form') S.gdraft = null
  let scr
  if (rt.name === 'home') scr = homeScreen(rt.tab)
  else if (rt.name === 'details') scr = detailsScreen(byId(rt.id))
  else if (rt.name === 'form') scr = rt.id && !byId(rt.id) ? notFound() : formScreen(rt.id ? byId(rt.id) : null, rt.query)
  else if (rt.name === 'stats') scr = statsScreen()
  else if (rt.name === 'ideas') scr = ideasScreen()
  else if (rt.name === 'settings') scr = settingsScreen()
  else if (rt.name === 'pair') scr = pairScreen(rt.code)
  else if (rt.name === 'me') scr = profileScreen()
  else if (['groups', 'group-new', 'join'].includes(rt.name) || rt.name.startsWith('group')) scr = GU.screen(rt) || notFound()
  else scr = notFound()
  const key = location.hash
  const changed = key !== lastKey
  lastKey = key
  if (changed && Date.now() - toastAt > 1500) document.querySelector('.toast')?.remove()
  document.body.classList.toggle('has-nav', !!scr.nav)
  app.innerHTML = `<main class="screen${scr.nav ? ' has-nav' : ''}${changed ? ' enter' : ''}">${scr.html}</main>${scr.nav ? nav(scr.nav) : ''}`
  scr.mount?.(app)
  hydrate(app)
  if (changed) window.scrollTo(0, 0)
  const h1 = app.querySelector('h1')
  document.title = h1 && h1.textContent !== 'נקמות שלי' ? `${h1.textContent} · נקמות שלי` : 'נקמות שלי'
}

/** Re-render after background data changes, without the enter animation, never under a form, sheet or dialog. */
function softRender() {
  if (['form', 'me', 'group-form', 'group-new'].includes(route().name)) return
  if (document.querySelector('.sheet-wrap, [role="dialog"]')) return
  const active = document.activeElement
  if (active && /INPUT|TEXTAREA/.test(active.tagName) && active.value) return
  lastKey = location.hash
  const y = window.scrollY
  render()
  window.scrollTo(0, y)
}

async function getPhotoBlob(id) {
  return (await db.getPhoto(id).catch(() => null))?.blob || null
}

/** What groups-ui.js needs from here. */
function groupsCtx() {
  return { icon, cat, esc, g, topbar, backBtn, sheet, confirmSheet, toast, confetti, buzz, hydrate, cropFace, go, S, typeOf, TYPES,
    dayMonth, ago, copy, field, docPicker, initialOf, colorFor, meBadge, softRender, route, getPhotoBlob }
}

// ---------- Theme ----------

const darkMq = matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const t = S.settings.theme
  const dark = t === 'dark' || (t === 'auto' && darkMq.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1d1521' : '#fcf1e7'
}
darkMq.addEventListener?.('change', applyTheme)

// ---------- Start ----------

async function start() {
  applyTheme()
  const splash = document.getElementById('splash')
  splash?.querySelector('[data-loading]')?.replaceChildren(g('טוענת את הנקמות שלך…', 'טוען את הנקמות שלך…'))
  const t0 = performance.now()
  try {
    S.list = await db.allRevenges()
  } catch {
    S.list = []
    toast('לא הצלחתי לפתוח את המאגר בטלפון. מצב גלישה פרטית?')
  }
  await GU.init(groupsCtx()).catch(() => undefined)
  window.addEventListener('hashchange', render)
  render()
  sync.onRemoteChange(async () => {
    S.list = await db.allRevenges()
    softRender()
  })
  GU.poll(null, true)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && GU.poll(route().gid || null, true))
  sync.soon(400)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync.soon(300))
  window.addEventListener('online', () => sync.soon(300))
  // The splash is part of the design; keep it up long enough to be seen, never long enough to annoy.
  const wait = Math.max(0, (sessionStorage.getItem('nk.seen') ? 250 : 1100) - (performance.now() - t0))
  setTimeout(() => {
    try { sessionStorage.setItem('nk.seen', '1') } catch { /* ignore */ }
    splash?.classList.add('out')
    setTimeout(() => splash?.remove(), 400)
  }, wait)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  }
}
start()
