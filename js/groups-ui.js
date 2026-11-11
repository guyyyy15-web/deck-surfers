// Groups: screens (docs/groups-spec.md §5). Data lives in js/groups.js; shared UI helpers come from app.js
// through `ctx`, so this file only knows how the group screens look and behave.

import * as G from './groups.js'
import * as identity from './identity.js'

let ctx
const cache = new Map() // gid → local record
let lastPoll = 0
let polling = null

export async function init(c) {
  ctx = c
  await reload()
}

async function reload() {
  cache.clear()
  for (const rec of await G.localGroups()) cache.set(rec.id, rec)
}

const myId = () => identity.load()?.keys?.memberId
const nick = () => identity.profile()?.nickname || 'מישהו'
const clip = (t, n = 80) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const hasCat = () => !!identity.profile()

export function unreadTotal() {
  const me = myId()
  let n = 0
  for (const rec of cache.values()) n += G.unread(rec, me)
  return n
}

/** Background refresh while a group screen is open (and once on app start / return). */
export async function poll(gid, force = false) {
  if (!hasCat() || polling) return
  const now = Date.now()
  if (!force && now - lastPoll < (gid ? 12e3 : 45e3)) return
  lastPoll = now
  polling = (async () => {
    let added = 0
    try {
      added = gid ? await G.refresh(gid) : await G.refreshAll()
    } catch (e) {
      if (e.code === 'removed') {
        await reload()
        if (ctx.route().gid === gid) {
          ctx.toast('כבר לא חלק מהקבוצה הזו')
          ctx.go('#/groups', true)
        }
        return
      }
    }
    if (added) {
      await reload()
      ctx.softRender()
    }
  })().finally(() => (polling = null))
}
setInterval(() => {
  if (document.visibilityState !== 'visible') return
  const r = ctx?.route()
  if (r?.name?.startsWith('group')) poll(r.gid || null)
}, 4000)

// ---------- Small pieces ----------

const prof = (st, id) => st.profiles.get(id) || { nickname: 'חבר/ה', color: 'cream', accessory: 'none' }
const mini = (st, id, size = 28) => identity.catAvatar(prof(st, id), size, prof(st, id).nickname)
const youMark = (id) => (id === myId() ? ' (את/ה)' : '')

function catsRow(rec, st, size = 34, max = 8) {
  const ids = (rec.members || []).map((m) => m.id)
  const extra = ids.length > max ? `<span class="cats-more">+${ids.length - max}</span>` : ''
  return `<div class="cats-row" aria-label="${ids.length} חברים">${ids.slice(0, max).map((id) => `<span class="cats-cat">${mini(st, id, size)}</span>`).join('')}${extra}</div>`
}

function face(r, size = 50) {
  const inner = r.photoId ? `<img data-photo="${ctx.esc(r.photoId)}" alt="">` : ctx.esc(ctx.initialOf(r.name))
  return `<span class="avatar"><span class="avatar-face" style="--s:${size}px;--bg:${ctx.colorFor(r.name)}">${inner}</span></span>`
}

async function ensurePhotos(gid, ids) {
  let got = false
  for (const id of ids.filter(Boolean)) {
    if (await G.ensurePhoto(gid, id).then(() => true).catch(() => false)) got = true
  }
  if (got) ctx.hydrate(document)
}

async function act(fn, okText) {
  try {
    const r = await fn()
    await reload()
    ctx.softRender()
    if (okText) ctx.toast(r?.queued ? 'אין חיבור כרגע. יישלח כשיחזור ⏳' : okText)
    return r
  } catch (e) {
    ctx.toast(e.status === 403 ? 'אין לך הרשאה לזה' : e.message || 'משהו השתבש, נסו שוב')
    throw e
  }
}

const needCat = (next) => `<div class="empty">${identity.catAvatar({ color: 'lilac', accessory: 'crown' }, 140)}
  <h2>קודם, החתול שלך</h2><p>בקבוצות כולם מופיעים עם כינוי וחתול. בלי הרשמה ובלי סיסמה, זה לוקח עשר שניות.</p>
  <a class="nk-btn nk-btn-primary" href="#/me" data-after="${ctx.esc(next)}" style="margin-top:18px">${ctx.icon('user', 22)}<span>יצירת החתול שלי</span></a></div>`

const RULES = `<div class="rules"><b>כללי הקבוצה</b><ul>
  <li>נקמות מצחיקות בלבד: לא פוגעות, לא מביכות ולא עולות כסף.</li>
  <li>מה שקורה בקבוצה נשאר בקבוצה.</li>
  <li>האפליקציה למבוגרים (18+).</li></ul></div>`

// ---------- Screens ----------

/** Routes this module handles. Returns a screen, or null. */
export function screen(rt) {
  if (rt.name === 'groups') return groupsHome()
  if (rt.name === 'group-new') return newGroup()
  if (rt.name === 'join') return joinScreen(rt.code)
  const rec = cache.get(rt.gid)
  if (rt.name.startsWith('group') && !rec) return missingGroup(rt.gid)
  if (rt.name === 'group') return boardScreen(rec, rt.query.get('tab') || 'proposals')
  if (rt.name === 'group-info') return infoScreen(rec)
  if (rt.name === 'group-form') return formScreen(rec, rt.rid)
  if (rt.name === 'group-revenge') return revengeScreen(rec, rt.rid)
  return null
}

function missingGroup(gid) {
  if (hasCat()) poll(gid, true)
  return {
    nav: 'groups',
    html: `${ctx.topbar({ title: 'קבוצה', start: ctx.backBtn('#/groups') })}
      <div class="empty">${ctx.cat(140)}<h2>טוען את הקבוצה…</h2><p>אם זה לוקח זמן, אולי כבר לא חלק ממנה.</p></div>`,
  }
}

function groupsHome() {
  if (hasCat()) poll(null)
  const me = myId()
  const list = [...cache.values()].sort((a, b) => (b.since || 0) - (a.since || 0))
  const body = !hasCat()
    ? needCat('#/groups')
    : !list.length
      ? `<div class="empty"><span class="cat-bob">${ctx.cat(150)}</span><h2>נוקמים ביחד</h2>
          <p>${ctx.g('צרי', 'צור')} קבוצה, ${ctx.g('הזמיני', 'הזמן')} חברים בקישור, ותציעו, תצביעו ותחלקו נקמות.</p>
          <a class="nk-btn nk-btn-primary" href="#/groups/new" style="margin-top:18px">${ctx.icon('plus', 22)}<span>קבוצה חדשה</span></a></div>`
      : `<div class="list">${list.map((rec) => {
          const st = G.stateOf(rec)
          const b = G.board(st)
          const n = G.unread(rec, me)
          return `<a class="nk-card group-card" href="#/g/${ctx.esc(rec.id)}">
            <span class="group-emoji">${ctx.esc(st.meta.emoji)}</span>
            <span class="card-text"><span class="nk-card-title">${ctx.esc(st.meta.name)}</span>
              <span class="nk-card-desc">${G.membersText((rec.members || []).length)} · ${b.proposals.length + b.doing.length} פתוחות · ${b.done.length} בוצעו</span>
              ${catsRow(rec, st, 24, 6)}</span>
            ${n ? `<span class="badge" aria-label="${n} חדשים">${n > 99 ? '99+' : n}</span>` : ''}${ctx.icon('chevron-left', 20)}</a>`
        }).join('')}</div>
        <a class="nk-fab" href="#/groups/new" aria-label="קבוצה חדשה">${ctx.icon('plus', 34)}</a>`
  return { nav: 'groups', html: `<header class="topbar"><a class="icon-btn" href="#/settings" aria-label="הגדרות">${ctx.icon('settings', 30)}</a><h1>קבוצות</h1>${ctx.meBadge()}</header>${body}` }
}

function emojiPicker(current) {
  return `<div class="emoji-pick" role="radiogroup" aria-label="אימוג׳י">${G.EMOJIS.map(
    (e) => `<button type="button" role="radio" class="emoji-opt${e === current ? ' is-on' : ''}" aria-checked="${e === current}" data-emoji="${e}">${e}</button>`,
  ).join('')}</div>`
}
function bindEmoji(root, onPick) {
  for (const b of root.querySelectorAll('[data-emoji]')) {
    b.onclick = () => {
      for (const o of root.querySelectorAll('[data-emoji]')) {
        o.classList.toggle('is-on', o === b)
        o.setAttribute('aria-checked', o === b)
      }
      onPick(b.dataset.emoji)
    }
  }
}

function newGroup() {
  if (!hasCat()) return { nav: 'groups', html: `${ctx.topbar({ title: 'קבוצה חדשה', start: ctx.backBtn('#/groups') })}${needCat('#/groups/new')}` }
  let emoji = G.EMOJIS[0]
  return {
    html: `${ctx.topbar({ title: 'קבוצה חדשה', start: ctx.backBtn('#/groups') })}
      <form class="form" novalidate>
        ${ctx.field({ id: 'gn-name', label: 'שם הקבוצה', req: true, ic: 'heart', ph: 'למשל: השותפים מהדירה', extra: ' maxlength="30" autocomplete="off"' })}
        <div class="nk-field"><span class="nk-field-label">אימוג׳י</span>${emojiPicker(emoji)}</div>
        ${RULES}
        <div class="actions" style="padding:4px 0 0"><button type="submit" class="nk-btn nk-btn-primary"><span>יצירת הקבוצה</span>${ctx.icon('check', 22)}</button></div>
      </form>`,
    mount(root) {
      bindEmoji(root, (e) => (emoji = e))
      const form = root.querySelector('form')
      form.onsubmit = async (e) => {
        e.preventDefault()
        const name = root.querySelector('#gn-name').value.trim()
        if (!name) {
          const f = root.querySelector('[data-field="gn-name"]')
          f.classList.add('has-error')
          f.querySelector('.nk-field-error').textContent = 'צריך שם לקבוצה'
          f.querySelector('.nk-field-error').hidden = false
          return
        }
        form.querySelector('[type=submit]').disabled = true
        try {
          const gid = await G.createGroup({ name, emoji })
          await reload()
          ctx.confetti()
          ctx.go(`#/g/${gid}`, true)
          inviteSheet(gid)
        } catch (x) {
          ctx.toast(x.status ? 'אין חיבור לשרת. נסו שוב.' : x.message)
          form.querySelector('[type=submit]').disabled = false
        }
      }
    },
  }
}

async function inviteSheet(gid) {
  const s = ctx.sheet(
    `<div class="sheet-head"><span style="font-size:44px">💌</span><h2>הזמנת חברים</h2>
       <p>מי שפותח את הקישור מצטרף לקבוצה. הקישור תקף לשבוע ועד 20 הצטרפויות.</p></div>
     <div data-inv class="panel" style="margin:0;text-align:center"><span class="muted">יוצר קישור…</span></div>
     <p class="muted" style="margin:0;font-size:14px;line-height:20px">${ctx.icon('lock', 16)} מפתח הקבוצה נמצא בתוך הקישור עצמו. ${ctx.g('שלחי', 'שלח')} אותו רק למי שצריך להצטרף.</p>
     <div class="actions" style="padding-top:0">
       <button type="button" class="nk-btn nk-btn-primary" data-share disabled>${ctx.icon('share', 22)}<span>שיתוף הקישור</span></button>
       <button type="button" class="nk-btn nk-btn-quiet" data-done style="color:var(--ink-muted)">סיום</button></div>`,
    { label: 'הזמנת חברים' },
  )
  s.el.querySelector('[data-done]').onclick = () => s.close()
  try {
    const inv = await G.createInvite(gid)
    const link = G.inviteLink(inv.code)
    s.el.querySelector('[data-inv]').innerHTML = `<div class="muted" style="font-size:13px">הקישור</div><div dir="ltr" data-link style="font-size:13px;line-height:18px;overflow-wrap:anywhere;user-select:all">${ctx.esc(link)}</div>`
    const btn = s.el.querySelector('[data-share]')
    btn.disabled = false
    btn.onclick = async () => {
      const name = G.stateOf(cache.get(gid)).meta.name
      if (navigator.share) {
        try {
          await navigator.share({ title: `הוזמנת ל"${name}" 😼`, text: `הוזמנת לקבוצת נקמות "${name}" באפליקציה נקמות שלי 😼`, url: link })
          return
        } catch (e) {
          if (e.name === 'AbortError') return
        }
      }
      await ctx.copy(link)
      ctx.toast('הקישור הועתק')
    }
  } catch {
    s.el.querySelector('[data-inv]').innerHTML = '<span style="color:var(--danger)">לא הצלחתי ליצור קישור. בדקו את האינטרנט.</span>'
  }
}

function boardScreen(rec, tab) {
  poll(rec.id)
  G.markSeen(rec.id).then(() => {
    const r = cache.get(rec.id)
    if (r) r.seenSeq = r.since
  })
  const st = G.stateOf(rec)
  const b = G.board(st)
  const me = myId()
  const tabs = [
    ['proposals', `הצעות (${b.proposals.length})`],
    ['doing', `בביצוע (${b.doing.length})`],
    ['done', `בוצעו (${b.done.length})`],
    ['chat', `צ׳אט (${st.chat.length})`],
  ]
  const list = tab === 'chat' ? null : b[tab] || b.proposals
  const card = (r) => {
    const voted = r.votes.has(me)
    const comments = (st.comments.get(r.id) || []).length
    return `<div class="nk-card g-card" data-rid="${ctx.esc(r.id)}">
      <a class="card-main" href="#/g/${ctx.esc(rec.id)}/r/${ctx.esc(r.id)}">${face(r)}
        <span class="card-text"><span class="nk-card-title">${ctx.esc(r.name)}</span><span class="nk-card-desc">${ctx.esc(r.why)}</span>
          <span class="g-meta">${r.assignee ? `<span class="g-who">${mini(st, r.assignee, 20)}${ctx.esc(prof(st, r.assignee).nickname)}${r.status === 'done' ? ' ✓' : ''}</span>` : '<span>פנוי</span>'}
            ${comments ? `<span>💬 ${comments}</span>` : ''}</span></span></a>
      <button type="button" class="vote${voted ? ' is-on' : ''}" data-vote="${ctx.esc(r.id)}" aria-pressed="${voted}" aria-label="${voted ? 'ביטול הצבעה' : 'הצבעה'} (${r.votes.size})">😈<b>${r.votes.size}</b></button></div>`
  }
  const empty = {
    proposals: `${ctx.g('הציעי', 'הצע')} את הנקמה הראשונה ב־+`,
    doing: 'אף אחד עוד לא לקח נקמה. אולי את/ה?',
    done: 'עוד לא בוצעה אף נקמה. בקרוב.',
  }
  const chat = `<div class="chat">${st.chat.slice(-100).map((c) => `<div class="msg${c.author === me ? ' mine' : ''}">${mini(st, c.author, 30)}
      <div class="bubble"><b>${ctx.esc(prof(st, c.author).nickname)}</b><span>${ctx.esc(c.text)}</span><small>${ctx.ago(c.at)}</small></div></div>`).join('') || '<p class="empty muted">עוד אין הודעות. כתבו משהו!</p>'}
    <form class="chat-input" data-chat><input id="chat-text" maxlength="500" autocomplete="off" placeholder="הודעה לקבוצה…" enterkeyhint="send">
      <button type="submit" class="icon-btn raised" aria-label="שליחה">${ctx.icon('arrow-right', 22)}</button></form></div>`
  return {
    nav: 'groups',
    html: `<header class="topbar">${ctx.backBtn('#/groups')}<h1 class="g-title">${ctx.esc(st.meta.emoji)} ${ctx.esc(st.meta.name)}</h1>
        <a class="icon-btn" href="#/g/${ctx.esc(rec.id)}/info" aria-label="הגדרות קבוצה">${ctx.icon('settings', 28)}</a></header>
      <a href="#/g/${ctx.esc(rec.id)}/info" style="display:block;text-decoration:none">${catsRow(rec, st)}</a>
      <div class="chips" role="tablist">${tabs.map(([id, label]) => `<a class="fchip${tab === id ? ' is-on' : ''}" role="tab" aria-selected="${tab === id}" href="#/g/${ctx.esc(rec.id)}?tab=${id}">${label}</a>`).join('')}</div>
      ${tab === 'chat' ? chat : `<div class="list">${list.map(card).join('') || `<p class="empty muted">${empty[tab]}</p>`}</div>`}
      ${tab === 'chat' ? '' : `<a class="nk-fab" href="#/g/${ctx.esc(rec.id)}/new" aria-label="הצעת נקמה">${ctx.icon('plus', 34)}</a>`}`,
    mount(root) {
      ensurePhotos(rec.id, (list || []).map((r) => r.photoId))
      for (const b of root.querySelectorAll('[data-vote]')) {
        b.onclick = () => {
          const r = st.revenges.get(b.dataset.vote)
          ctx.buzz(15)
          act(() => G.post(rec.id, [{ t: 'vote.set', id: r.id, on: !r.votes.has(me) }]))
        }
      }
      const form = root.querySelector('[data-chat]')
      if (form) {
        root.querySelector('.chat .msg:last-of-type')?.scrollIntoView({ block: 'end' })
        form.onsubmit = async (e) => {
          e.preventDefault()
          const input = form.querySelector('input')
          const text = input.value.trim()
          if (!text) return
          input.value = ''
          await act(() => G.post(rec.id, [{ t: 'comment.put', cid: G.newId('c'), id: G.CHAT, text }], { body: `💬 ${nick()}: ${clip(text)}` }))
          ctx.maybeAskPush()
          document.querySelector('#chat-text')?.focus()
        }
      }
    },
  }
}

function revengeScreen(rec, rid) {
  poll(rec.id)
  const st = G.stateOf(rec)
  const r = st.revenges.get(rid)
  const back = `#/g/${rec.id}`
  if (!r) return { nav: 'groups', html: `${ctx.topbar({ title: 'לא נמצא', start: ctx.backBtn(back) })}<div class="empty">${ctx.cat(140)}<h2>הנקמה הזו נמחקה</h2></div>` }
  const me = myId()
  const admin = rec.role === 'admin'
  const mine = r.createdBy === me
  const t = ctx.typeOf(r.type)
  const comments = st.comments.get(r.id) || []
  const actions = r.status === 'done'
    ? r.doneBy === me || admin ? `<button type="button" class="nk-btn nk-btn-soft" data-reopen>${ctx.icon('undo', 22)}<span>החזרה לפתוחות</span></button>` : ''
    : !r.assignee
      ? `<button type="button" class="nk-btn nk-btn-primary" data-take><span>${ctx.g('אני לוקחת!', 'אני לוקח!')}</span>${ctx.icon('check', 22)}</button>`
      : r.assignee === me
        ? `<button type="button" class="nk-btn nk-btn-primary" data-done><span>${ctx.g('סמני כבוצעה', 'סמן כבוצעה')}</span>${ctx.icon('check', 22)}</button>
           <button type="button" class="nk-btn nk-btn-quiet" data-untake>${ctx.g('ויתרתי', 'ויתרתי')}, שמישהו אחר ייקח</button>`
        : admin ? '<button type="button" class="nk-btn nk-btn-quiet" data-untake>שחרור המשימה</button>' : ''
  return {
    nav: 'groups',
    html: `<header class="topbar">${ctx.backBtn(back, 'חזרה', true)}${mine || admin ? `<a class="icon-btn raised" href="#/g/${ctx.esc(rec.id)}/r/${ctx.esc(r.id)}/edit" aria-label="עריכה">${ctx.icon('pencil', 22, 'lilac-200')}</a>` : '<span></span>'}</header>
      <div class="hero">${face(r, 112)}<h1>${ctx.esc(r.name)}</h1>
        <span class="chip${r.status === 'done' ? ' ok' : ''}">${r.status === 'done' ? `${ctx.icon('check', 14)}בוצעה ${ctx.dayMonth(r.doneAt)} ע״י ${ctx.esc(prof(st, r.doneBy).nickname)}` : r.assignee ? `בביצוע אצל ${ctx.esc(prof(st, r.assignee).nickname)}` : 'הצעה פתוחה'}</span></div>
      <div class="info">
        <div class="info-row col"><span class="info-k">למה?</span><span class="info-v">${ctx.esc(r.why)}</span></div>
        ${r.plan ? `<div class="info-row col"><span class="info-k">התוכנית</span><span class="info-v">${ctx.esc(r.plan)}</span></div>` : ''}
        <div class="info-row"><span class="info-k">סוג נקמה</span><span class="info-v">${ctx.icon(t.icon, 20, t.fill)}${t.label}</span></div>
        <div class="info-row"><span class="info-k">הציע/ה</span><span class="info-v">${mini(st, r.createdBy, 24)}${ctx.esc(prof(st, r.createdBy).nickname)}${youMark(r.createdBy)}</span></div>
        <div class="info-row"><span class="info-k">קולות</span><button type="button" class="vote${r.votes.has(me) ? ' is-on' : ''}" data-vote aria-pressed="${r.votes.has(me)}">😈<b>${r.votes.size}</b></button></div>
        ${r.status === 'done' && r.notes ? `<div class="info-row col"><span class="info-k">הערות</span><span class="info-v">${ctx.esc(r.notes)}</span></div>` : ''}
      </div>
      ${r.docPhotoId ? `<div class="doc"><span class="info-k">תיעוד</span><div class="doc-img"><img data-photo="${ctx.esc(r.docPhotoId)}" alt="תמונת התיעוד"></div></div>` : ''}
      <div class="actions">${actions}${mine || admin ? '<button type="button" class="nk-btn nk-btn-quiet danger" data-del>מחיקת ההצעה</button>' : ''}</div>
      <section class="group"><h2>תגובות (${comments.length})</h2><div class="chat" style="padding:0">${comments.map((c) => `<div class="msg${c.author === me ? ' mine' : ''}">${mini(st, c.author, 30)}
        <div class="bubble"><b>${ctx.esc(prof(st, c.author).nickname)}</b><span>${ctx.esc(c.text)}</span><small>${ctx.ago(c.at)}</small></div>
        ${c.author === me || admin ? `<button type="button" class="icon-btn" data-delc="${ctx.esc(c.cid)}" aria-label="מחיקת התגובה">${ctx.icon('x', 16)}</button>` : ''}</div>`).join('')}
        <form class="chat-input" data-comment><input id="c-text" maxlength="500" autocomplete="off" placeholder="תגובה…" enterkeyhint="send">
          <button type="submit" class="icon-btn raised" aria-label="שליחה">${ctx.icon('arrow-right', 22)}</button></form></div></section>`,
    mount(root) {
      ensurePhotos(rec.id, [r.photoId, r.docPhotoId])
      const post = (evs, ok, notify) => act(() => G.post(rec.id, evs, notify), ok)
      root.querySelector('[data-vote]').onclick = () => post([{ t: 'vote.set', id: r.id, on: !r.votes.has(me) }])
      root.querySelector('[data-take]')?.addEventListener('click', () => {
        ctx.buzz(30)
        post([{ t: 'assign.set', id: r.id, to: me }], 'שלך! 😈', { body: `😈 ${nick()} לקח/ה את "${clip(r.name, 40)}"` }).then(() => ctx.maybeAskPush())
      })
      root.querySelector('[data-untake]')?.addEventListener('click', () => post([{ t: 'assign.set', id: r.id, to: null }], 'שוחרר'))
      root.querySelector('[data-reopen]')?.addEventListener('click', () => post([{ t: 'revenge.reopen', id: r.id }], 'חזרה לפתוחות'))
      root.querySelector('[data-done]')?.addEventListener('click', () => doneSheet(rec.id, r))
      root.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await ctx.confirmSheet({ title: `למחוק את "${r.name}"?`, text: 'ההצעה תימחק לכל הקבוצה.', ok: 'מחיקה' })) {
          await post([{ t: 'revenge.delete', id: r.id }], 'נמחקה')
          ctx.go(back, true)
        }
      })
      for (const b of root.querySelectorAll('[data-delc]')) b.onclick = () => post([{ t: 'comment.delete', cid: b.dataset.delc }])
      root.querySelector('[data-comment]').onsubmit = async (e) => {
        e.preventDefault()
        const input = root.querySelector('#c-text')
        const text = input.value.trim()
        if (!text) return
        input.value = ''
        await post([{ t: 'comment.put', cid: G.newId('c'), id: r.id, text }], undefined, { body: `💬 ${nick()} על "${clip(r.name, 30)}": ${clip(text, 60)}` })
        ctx.maybeAskPush()
      }
    },
  }
}

function doneSheet(gid, r) {
  const state = { docBlob: null, docUrl: null }
  const s = ctx.sheet(
    `<div class="sheet-head"><span class="ok-circle">${ctx.icon('check', 34)}</span><h2>נקמה בוצעה!</h2><p>${ctx.esc(r.name)} · כל הקבוצה תדע</p></div>
     <div class="nk-field"><label class="nk-field-label" for="gd-notes">איך זה הלך? <span class="nk-opt">(אופציונלי)</span></label>
       <div class="nk-input is-multi">${ctx.icon('note', 24, 'lilac-200')}<textarea id="gd-notes" rows="3"></textarea></div></div>
     <div class="nk-field"><span class="nk-field-label">תיעוד <span class="nk-opt">(אופציונלי)</span></span><div data-doc></div></div>
     <div class="actions" style="padding-top:0"><button type="button" class="nk-btn nk-btn-primary" data-save><span>שליחה לקבוצה</span>${ctx.icon('check', 22)}</button></div>`,
    { label: 'נקמה בוצעה' },
  )
  ctx.docPicker(s.el.querySelector('[data-doc]'), state)
  s.el.querySelector('[data-save]').onclick = async (e) => {
    e.currentTarget.disabled = true
    try {
      const docPhotoId = state.docBlob ? await G.uploadPhoto(gid, state.docBlob) : null
      await act(() => G.post(gid, [{ t: 'revenge.done', id: r.id, notes: s.el.querySelector('#gd-notes').value.trim(), docPhotoId }], { body: `🎉 ${nick()} ביצע/ה: ${clip(r.name, 60)}` }))
      await s.close()
      ctx.confetti()
      ctx.buzz(40)
      ctx.toast('כל הכבוד! 🎉')
    } catch {
      e.currentTarget.disabled = false
    }
  }
}

function formScreen(rec, rid) {
  const st = G.stateOf(rec)
  const ex = rid ? st.revenges.get(rid) : null
  const d = (ctx.S.gdraft && ctx.S.gdraft.key === `${rec.id}/${rid || 'new'}`)
    ? ctx.S.gdraft
    : (ctx.S.gdraft = { key: `${rec.id}/${rid || 'new'}`, name: ex?.name || '', why: ex?.why || '', type: ex?.type || 'creative', plan: ex?.plan || '', photoId: ex?.photoId || null, faceBlob: null, faceUrl: null })
  const back = ex ? `#/g/${rec.id}/r/${rid}` : `#/g/${rec.id}`
  return {
    html: `${ctx.topbar({ title: ex ? 'עריכת הצעה' : 'הצעת נקמה', start: ctx.backBtn(back) })}
      <form class="form" novalidate>
        <div style="display:flex;flex-direction:column;align-items:center"><label class="photo-pick"><span class="photo-ring" data-ring></span><span>${ctx.g('תמונה', 'תמונה')} (אופציונלי)</span>
          <input type="file" accept="image/*" class="sr-only" data-face></label></div>
        ${ctx.field({ id: 'g-name', label: 'במי נוקמים?', req: true, ic: 'user', ph: 'למי מגיע?', value: d.name, extra: ' maxlength="60" autocomplete="off"' })}
        ${ctx.field({ id: 'g-why', label: 'למה?', req: true, ic: 'note', ph: 'מה קרה?', multi: true, value: d.why })}
        <div class="nk-field"><span class="nk-field-label">סוג נקמה</span><div class="nk-types" role="radiogroup">${ctx.TYPES.map(
          (t) => `<button type="button" role="radio" class="nk-type${t.id === d.type ? ' is-on' : ''}" aria-checked="${t.id === d.type}" data-type="${t.id}">${ctx.icon(t.icon, 34, t.fill)}<span>${t.label}</span></button>`,
        ).join('')}</div></div>
        ${ctx.field({ id: 'g-plan', label: 'התוכנית', opt: true, ic: 'bulb', ph: 'איך עושים את זה?', multi: true, value: d.plan })}
        <div class="actions" style="padding:6px 0 0"><button type="submit" class="nk-btn nk-btn-primary"><span>${ex ? 'שמירה' : 'שליחה לקבוצה'}</span>${ctx.icon('check', 22)}</button></div>
      </form>`,
    mount(root) {
      const ring = () => {
        const el = root.querySelector('[data-ring]')
        if (d.faceUrl || d.photoId) {
          el.className = 'photo-ring has-img'
          el.innerHTML = `<img ${d.faceUrl ? `src="${d.faceUrl}"` : `data-photo="${ctx.esc(d.photoId)}"`} alt=""><span class="cam-badge">${ctx.icon('camera', 20)}</span>`
          ctx.hydrate(el)
        } else {
          el.className = 'photo-ring'
          el.innerHTML = `${ctx.icon('user', 44, 'lilac-200')}<span class="cam-badge">${ctx.icon('camera', 20)}</span>`
        }
      }
      ring()
      root.querySelector('[data-face]').onchange = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        const blob = await ctx.cropFace(f)
        if (!blob) return
        d.faceBlob = blob
        d.faceUrl = URL.createObjectURL(blob)
        ring()
      }
      for (const [id, key] of [['g-name', 'name'], ['g-why', 'why'], ['g-plan', 'plan']]) root.querySelector(`#${id}`).addEventListener('input', (e) => (d[key] = e.target.value))
      for (const b of root.querySelectorAll('[data-type]')) {
        b.onclick = () => {
          d.type = b.dataset.type
          for (const o of root.querySelectorAll('[data-type]')) {
            o.classList.toggle('is-on', o === b)
            o.setAttribute('aria-checked', o === b)
          }
        }
      }
      const form = root.querySelector('form')
      form.onsubmit = async (e) => {
        e.preventDefault()
        let bad = false
        for (const [id, val, msg] of [['g-name', d.name, 'צריך שם'], ['g-why', d.why, 'צריך סיבה']]) {
          const f = root.querySelector(`[data-field="${id}"]`)
          const err = !val.trim()
          f.classList.toggle('has-error', err)
          f.querySelector('.nk-field-error').textContent = msg
          f.querySelector('.nk-field-error').hidden = !err
          bad ||= err
        }
        if (bad) return
        form.querySelector('[type=submit]').disabled = true
        try {
          const photoId = d.faceBlob ? await G.uploadPhoto(rec.id, d.faceBlob) : d.photoId
          const id = ex?.id || G.newId('r')
          await act(() => G.post(rec.id, [{ t: 'revenge.put', id, name: d.name.trim(), why: d.why.trim(), type: d.type, plan: d.plan.trim(), photoId }], ex ? null : { body: `💡 ${nick()} הציע/ה: ${clip(d.name.trim(), 60)}` }), ex ? 'נשמר' : 'ההצעה נשלחה לקבוצה 😈')
          if (!ex) ctx.maybeAskPush()
          ctx.S.gdraft = null
          ctx.go(ex ? `#/g/${rec.id}/r/${id}` : `#/g/${rec.id}`, true)
        } catch {
          form.querySelector('[type=submit]').disabled = false
        }
      }
    },
  }
}

function infoScreen(rec) {
  poll(rec.id)
  const st = G.stateOf(rec)
  const me = myId()
  const admin = rec.role === 'admin'
  let emoji = st.meta.emoji
  return {
    nav: 'groups',
    html: `${ctx.topbar({ title: 'הגדרות הקבוצה', start: ctx.backBtn(`#/g/${rec.id}`) })}
      <div class="hero"><span style="font-size:56px">${ctx.esc(st.meta.emoji)}</span><h1>${ctx.esc(st.meta.name)}</h1>
        <span class="chip">${(rec.members || []).length} מתוך ${G.MAX_MEMBERS} חברים${admin ? ' · את/ה מנהל/ת' : ''}</span></div>
      <div class="actions" style="padding-top:18px"><button type="button" class="nk-btn nk-btn-primary" data-invite>${ctx.icon('share', 22)}<span>הזמנת חברים</span></button></div>
      ${admin ? `<section class="group"><h2>שם ואימוג׳י</h2><div class="rows" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
        <div class="nk-input" style="min-height:48px"><input id="gi-name" maxlength="30" value="${ctx.esc(st.meta.name)}" aria-label="שם הקבוצה"></div>
        ${emojiPicker(emoji)}<button type="button" class="small-btn primary" data-rename style="align-self:flex-start">שמירה</button></div></section>` : ''}
      <section class="group"><h2>התראות</h2><div class="rows"><div class="row"><span class="grow">התראות מהקבוצה הזו<small>${ctx.pushOn() ? 'כשמישהו מציע, לוקח, מבצע או כותב.' : 'קודם צריך להפעיל התראות בהגדרות.'}</small></span>
        <div class="seg" role="group"><button type="button" data-mute="0" class="${rec.muted ? '' : 'is-on'}" aria-pressed="${!rec.muted}">פעילות</button><button type="button" data-mute="1" class="${rec.muted ? 'is-on' : ''}" aria-pressed="${!!rec.muted}">מושתקות</button></div></div></div></section>
      <section class="group"><h2>חברים</h2><div class="rows">${(rec.members || []).map((m) => `<div class="row">${mini(st, m.id, 40)}
        <span class="grow"><b>${ctx.esc(prof(st, m.id).nickname)}</b>${youMark(m.id)}<small>${m.role === 'admin' ? 'מנהל/ת' : 'חבר/ה'}</small></span>
        ${admin && m.id !== me ? `${m.role !== 'admin' ? `<button type="button" class="small-btn" data-admin="${m.id}">למנהל/ת</button>` : ''}<button type="button" class="icon-btn" data-remove="${m.id}" aria-label="הוצאה מהקבוצה">${ctx.icon('x', 20)}</button>` : ''}</div>`).join('')}</div></section>
      ${RULES.replace('class="rules"', 'class="rules group"')}
      <section class="group"><div class="rows">
        <button type="button" class="row danger" data-leave>${ctx.icon('arrow-right', 22)}<span class="grow">עזיבת הקבוצה</span></button>
        ${admin ? `<button type="button" class="row danger" data-delete>${ctx.icon('trash', 22)}<span class="grow">מחיקת הקבוצה לכולם</span></button>` : ''}</div></section>`,
    mount(root) {
      root.querySelector('[data-invite]').onclick = () => inviteSheet(rec.id)
      if (admin) {
        bindEmoji(root, (e) => (emoji = e))
        root.querySelector('[data-rename]').onclick = () => {
          const name = root.querySelector('#gi-name').value.trim()
          if (name) act(() => G.post(rec.id, [{ t: 'group.meta', name, emoji }]), 'נשמר')
        }
      }
      for (const b of root.querySelectorAll('[data-mute]')) {
        b.onclick = () => act(() => G.setMute(rec.id, b.dataset.mute === '1'), b.dataset.mute === '1' ? 'הקבוצה מושתקת 🔕' : 'ההתראות פעילות 🔔')
      }
      for (const b of root.querySelectorAll('[data-admin]')) b.onclick = () => act(() => G.makeAdmin(rec.id, b.dataset.admin), 'עכשיו גם מנהל/ת')
      for (const b of root.querySelectorAll('[data-remove]')) {
        b.onclick = async () => {
          const name = prof(st, b.dataset.remove).nickname
          if (await ctx.confirmSheet({ title: `להוציא את ${name}?`, text: 'הוא/היא לא יראו יותר שום דבר חדש בקבוצה. מה שכבר הגיע לטלפון שלהם נשאר שם; אין דרך למחוק את זה מרחוק.', ok: 'הוצאה' })) {
            act(() => G.removeMember(rec.id, b.dataset.remove), `${name} הוצא/ה מהקבוצה`)
          }
        }
      }
      root.querySelector('[data-leave]').onclick = async () => {
        if (await ctx.confirmSheet({ title: 'לעזוב את הקבוצה?', text: 'אפשר לחזור רק עם קישור הזמנה חדש.', ok: 'עזיבה' })) {
          await act(() => G.leave(rec.id), 'עזבת את הקבוצה')
          ctx.go('#/groups', true)
        }
      }
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await ctx.confirmSheet({ title: 'למחוק את הקבוצה לכולם?', text: 'כל ההצעות, התגובות והתמונות יימחקו מהשרת לכל החברים.', ok: 'מחיקה לכולם' })) {
          await act(() => G.deleteGroup(rec.id), 'הקבוצה נמחקה')
          ctx.go('#/groups', true)
        }
      })
    },
  }
}

// ---------- Joining ----------

let peekCache = { code: null, data: null, error: null }

function joinScreen(code) {
  const top = ctx.topbar({ title: 'הזמנה לקבוצה', start: ctx.backBtn('#/groups') })
  if (!G.parseInvite(code)) return { html: `${top}<div class="empty">${ctx.cat(140)}<h2>הקישור לא תקין</h2><p>אולי חסר בו חלק. בקשו שישלחו שוב.</p></div>` }
  if (peekCache.code !== code) {
    peekCache = { code, data: null, error: null }
    G.peekInvite(code).then((d) => (peekCache.data = d)).catch((e) => (peekCache.error = e)).finally(() => peekCache.code === code && ctx.softRender())
  }
  const { data, error } = peekCache
  if (error) return { html: `${top}<div class="empty">${ctx.cat(140)}<h2>אי אפשר להצטרף</h2><p>${ctx.esc(error.message)}</p></div>` }
  if (!data) return { html: `${top}<div class="empty">${ctx.cat(140)}<h2>פותח את ההזמנה…</h2></div>` }
  const already = cache.has(data.groupId)
  const cats = [...data.profiles.values()].slice(0, 8).map((p) => `<span class="cats-cat">${identity.catAvatar(p, 40, p.nickname)}</span>`).join('')
  const body = already
    ? `<a class="nk-btn nk-btn-soft" href="#/g/${ctx.esc(data.groupId)}" style="margin-top:18px">כבר בקבוצה. לכניסה</a>`
    : data.full
      ? '<p style="color:var(--danger)">הקבוצה מלאה (20 חברים).</p>'
      : !hasCat()
        ? `<p>כדי להצטרף, ${ctx.g('בחרי', 'בחר')} קודם כינוי וחתול.</p><a class="nk-btn nk-btn-primary" href="#/me" data-after="#/join/${ctx.esc(code)}" style="margin-top:12px">${ctx.icon('user', 22)}<span>יצירת החתול שלי</span></a>`
        : `${RULES}<p style="margin-top:10px">${ctx.g('לחצי לחיצה ארוכה', 'לחץ לחיצה ארוכה')} על הכפה כדי להישבע ולהצטרף:</p>
           <button type="button" class="oath" data-oath aria-label="לחיצה ארוכה להצטרפות"><span class="oath-ring"></span><span class="oath-paw">🐾</span></button>
           <p class="muted" data-oath-text style="font-size:14px">${ctx.g('נשבעת', 'נשבע')} לנקום רק בצחוק</p>`
  return {
    html: `${top}<div class="empty"><span style="font-size:64px;line-height:72px">${ctx.esc(data.meta.emoji)}</span>
      <h2>${ctx.esc(data.meta.name)}</h2><p>${data.members === 1 ? 'חבר אחד כבר בפנים' : `${data.members} חברים כבר בפנים`}</p><div class="cats-row" style="justify-content:center">${cats}</div>${body}</div>`,
    mount(root) {
      const paw = root.querySelector('[data-oath]')
      if (!paw) return
      let timer = null
      const start = (e) => {
        e.preventDefault()
        paw.classList.add('holding')
        ctx.buzz(10)
        timer = setTimeout(join, 1500)
      }
      const stop = () => {
        clearTimeout(timer)
        paw.classList.remove('holding')
      }
      const join = async () => {
        paw.classList.remove('holding')
        paw.classList.add('done')
        ctx.buzz(60)
        try {
          const gid = await G.joinInvite(code)
          await reload()
          peekCache = { code: null }
          ctx.confetti()
          ctx.toast('ברוכים הבאים לקבוצה 🐾')
          ctx.go(`#/g/${gid}`, true)
        } catch (x) {
          paw.classList.remove('done')
          ctx.toast(x.message)
        }
      }
      paw.addEventListener('pointerdown', start)
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) paw.addEventListener(ev, stop)
      paw.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), join()))
      paw.addEventListener('contextmenu', (e) => e.preventDefault())
    },
  }
}

// ---------- Moving a personal revenge into a group ----------

export async function moveSheet(r, onMoved) {
  const groups = [...cache.values()]
  if (!navigator.onLine && r.photoId) {
    ctx.toast('צריך אינטרנט כדי להעביר נקמה עם תמונה')
    return
  }
  if (!groups.length) {
    ctx.toast('עוד אין לך קבוצות')
    return
  }
  const s = ctx.sheet(
    `<div class="sheet-head"><h2>העברה לקבוצה</h2><p>"${ctx.esc(r.name)}" תעבור ללוח של הקבוצה ותצא מהרשימה האישית.</p></div>
     <div class="rows">${groups.map((rec) => {
       const st = G.stateOf(rec)
       return `<button type="button" class="row" data-to="${ctx.esc(rec.id)}"><span style="font-size:28px">${ctx.esc(st.meta.emoji)}</span><span class="grow"><b>${ctx.esc(st.meta.name)}</b><small>${G.membersText((rec.members || []).length)}</small></span>${ctx.icon('chevron-left', 20)}</button>`
     }).join('')}</div>`,
    { label: 'העברה לקבוצה' },
  )
  for (const b of s.el.querySelectorAll('[data-to]')) {
    b.onclick = async () => {
      for (const x of s.el.querySelectorAll('[data-to]')) x.disabled = true
      try {
        const gid = b.dataset.to
        const blob = r.photoId ? (await ctx.getPhotoBlob(r.photoId)) : null
        const photoId = blob ? await G.uploadPhoto(gid, blob) : null
        // Offline, the event waits in the group's outbox and goes out later, so this still counts as moved.
        await G.post(gid, [{ t: 'revenge.put', id: G.newId('r'), name: r.name, why: r.why, type: r.type, plan: r.plan || '', photoId }], { body: `💡 ${nick()} הציע/ה: ${clip(r.name, 60)}` })
        await s.close()
        await onMoved()
        await reload()
        ctx.toast('עברה לקבוצה 😈')
        ctx.go(`#/g/${gid}`)
      } catch (e) {
        for (const x of s.el.querySelectorAll('[data-to]')) x.disabled = false
        ctx.toast(e.message || 'ההעברה לא הצליחה')
      }
    }
  }
}

export const hasGroups = () => cache.size > 0
