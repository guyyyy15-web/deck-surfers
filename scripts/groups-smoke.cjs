// Three phones in one group against the real Worker running locally (wrangler dev, local D1 + R2).
//   node scripts/groups-smoke.cjs        (needs `npm ci` in server/ once)
const { chromium, devices } = require('playwright')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SERVER = path.join(ROOT, 'server')
const OUT = path.join(ROOT, 'screenshots')
const APP_PORT = 8768
const API_PORT = 8792
const APP = `http://localhost:${APP_PORT}/`
const API = `http://127.0.0.1:${API_PORT}`
fs.mkdirSync(OUT, { recursive: true })

const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-groups-e2e-'))
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' }
  const d1 = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'nekamot-sync', '--local', '--persist-to', persist, '--json', '--command', sql], { cwd: SERVER, env, stdio: 'pipe' }).toString())[0].results
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nekamot-sync', '--local', '--persist-to', persist], { cwd: SERVER, env, stdio: 'pipe' })
  const api = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(API_PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1'], { cwd: SERVER, env, detached: true, stdio: 'ignore' })
  const web = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(APP_PORT)], { stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/v1/health`)).ok) break
    } catch { /* starting */ }
    await wait(500)
  }
  const browser = await chromium.launch()
  try {
    const maker = await browser.newPage()
    await maker.setViewportSize({ width: 500, height: 500 })
    await maker.setContent('<div style="width:500px;height:500px;background:radial-gradient(#f2c14e 40%,#46334f 41%)"></div>')
    const FACE = await maker.screenshot()
    await maker.setContent('<div style="width:500px;height:500px;background:linear-gradient(#9fd8c8,#7f4fa0)"></div>')
    const DOC = await maker.screenshot()
    await maker.close()
    const img = (name, buffer) => ({ name, mimeType: 'image/png', buffer })

    const phone = async (name, device) => {
      const ctx = await browser.newContext({ ...devices[device], locale: 'he-IL' })
      await ctx.addInitScript((url) => localStorage.setItem('nk.syncUrl', JSON.stringify(url)), API)
      const page = await ctx.newPage()
      page.errors = []
      page.on('pageerror', (e) => page.errors.push(`${name}: ${e}`))
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && page.errors.push(`${name}: ${m.text()}`))
      await page.goto(APP)
      await page.waitForSelector('#splash', { state: 'detached' })
      return { name, ctx, page }
    }
    const makeCat = async (p, nickname, acc) => {
      await p.page.goto(`${APP}#/me`)
      await p.page.fill('#me-nick', nickname)
      await p.page.click(`[data-acc="${acc}"]`)
      await p.page.click('[data-save-me]')
      await p.page.click('.sheet [data-no]')
    }
    const open = async (p, hash) => {
      await p.page.goto(`${APP}${hash}`)
      await p.page.reload() // a fresh start polls the server for every group
      await p.page.waitForSelector('#splash', { state: 'detached' })
    }
    const shot = (p, name) => p.page.screenshot({ path: path.join(OUT, `groups-${name}.png`) })

    // A (iPhone) creates a cat and a group.
    const A = await phone('A', 'iPhone 15')
    await A.page.goto(`${APP}#/groups`)
    check(await A.page.isVisible('a[href="#/me"][data-after]'), 'A: groups ask for a cat first')
    await makeCat(A, 'מלכת הקונוסים', 'crown')
    await A.page.goto(`${APP}#/groups`)
    await A.page.click('.empty .nk-btn')
    await A.page.fill('#gn-name', 'השותפים מהדירה')
    await A.page.click('[data-emoji="🔥"]')
    await A.page.click('[type=submit]')
    await A.page.waitForSelector('[data-link]')
    const link = (await A.page.textContent('[data-link]')).trim()
    check(/#\/join\/i[\w-]+\.[\w-]+$/.test(link), 'A: group created, invite link ready')
    await shot(A, '01-invite')
    await A.page.click('[data-done]')
    const gid = (await A.page.url()).match(/#\/g\/([\w-]+)/)[1]

    // B (Android) opens the link without a cat: makes one, comes back, swears, joins.
    const B = await phone('B', 'Pixel 7')
    await B.page.goto(link)
    await B.page.waitForSelector('.empty h2:has-text("השותפים מהדירה")')
    check(true, 'B: the invite shows the group name (decrypted on the phone)')
    await B.page.click('a[href="#/me"][data-after]')
    await B.page.fill('#me-nick', 'נינג׳ה של חניות')
    await B.page.click('[data-acc="ninja"]')
    await B.page.click('[data-save-me]')
    await B.page.click('.sheet [data-no]')
    await B.page.waitForSelector('[data-oath]')
    check(true, 'B: back on the invite after creating the cat')
    await shot(B, '02-oath')
    // A short press does nothing; a long press joins.
    const paw = await B.page.locator('[data-oath]').boundingBox()
    await B.page.mouse.move(paw.x + paw.width / 2, paw.y + paw.height / 2)
    await B.page.mouse.down()
    await wait(500)
    await B.page.mouse.up()
    await wait(300)
    check(B.page.url().includes('#/join/'), 'B: a short press does not join')
    await B.page.mouse.down()
    await wait(1800)
    await B.page.mouse.up()
    await B.page.waitForURL(/#\/g\//)
    check(!B.page.url().includes('.'), 'B: joined; the invite secret left the address bar')

    // C (iPhone) has a cat already and joins.
    const C = await phone('C', 'iPhone 15')
    await makeCat(C, 'דוקטור סרקזם', 'shades')
    await C.page.goto(link)
    await C.page.waitForSelector('[data-oath]')
    await C.page.locator('[data-oath]').focus()
    await C.page.keyboard.press('Enter')
    await C.page.waitForURL(/#\/g\//)
    check(true, 'C: joined (keyboard path for the oath)')

    // A sees three cats; proposes a revenge with a photo.
    await open(A, `#/g/${gid}/info`)
    await A.page.waitForSelector('.rows .row:has-text("דוקטור סרקזם")')
    check((await A.page.locator('.rows .row:has-text("חבר/ה")').count()) >= 2, 'A: sees B and C with their nicknames')
    await A.page.goto(`${APP}#/g/${gid}/new`)
    await A.page.setInputFiles('[data-face]', img('face.png', FACE))
    await A.page.click('[data-ok]')
    await A.page.fill('#g-name', 'השכן עם המקדחה')
    await A.page.fill('#g-why', 'קודח בשבת בשמונה בבוקר')
    await A.page.click('[data-type="big"]')
    await A.page.click('[type=submit]')
    await A.page.waitForSelector('.g-card:has-text("השכן עם המקדחה")')
    check(true, 'A: proposal on the board')

    // B and C see it (with the photo) and vote.
    for (const p of [B, C]) {
      await open(p, `#/g/${gid}`)
      await p.page.waitForSelector('.g-card:has-text("השכן עם המקדחה")', { timeout: 15000 })
      await p.page.click('.g-card [data-vote]')
      await p.page.waitForSelector('.g-card .vote.is-on')
    }
    await B.page.waitForSelector('.g-card .avatar-face img[src]', { timeout: 15000 })
    check(true, "B: sees A's proposal with its photo, and votes")
    await shot(B, '03-board')
    await open(A, `#/g/${gid}`)
    await A.page.waitForSelector('.g-card .vote b:text("2")', { timeout: 15000 })
    check(true, 'A: sees 2 votes')

    // B takes it and completes it with a photo; A sees it done.
    await B.page.click('.g-card .card-main')
    await B.page.click('[data-take]')
    await B.page.waitForSelector('[data-done]')
    await B.page.click('[data-done]')
    await B.page.fill('#gd-notes', 'פלייליסט ילדים מהמרפסת')
    await B.page.setInputFiles('.pick-tile:nth-child(2) input', img('doc.png', DOC))
    await B.page.waitForSelector('.doc-preview img')
    await B.page.click('[data-save]')
    await B.page.waitForSelector('.chip.ok')
    check(true, 'B: took it and marked it done with a photo')
    await open(A, `#/g/${gid}?tab=done`)
    await A.page.waitForSelector('.g-card:has-text("השכן עם המקדחה")', { timeout: 15000 })
    await A.page.click('.g-card .card-main')
    await A.page.waitForSelector('.doc-img img[src]', { timeout: 15000 })
    check((await A.page.textContent('.info')).includes('פלייליסט ילדים'), "A: sees it done, with B's notes and photo")

    // Chat.
    await open(C, `#/g/${gid}?tab=chat`)
    await C.page.fill('#chat-text', 'מי מביא פופקורן?')
    await C.page.press('#chat-text', 'Enter')
    await C.page.waitForSelector('.msg.mine:has-text("פופקורן")')
    await open(A, `#/g/${gid}?tab=chat`)
    await A.page.waitForSelector('.msg:has-text("פופקורן")', { timeout: 15000 })
    check(true, "A: reads C's chat message")

    // A removes C: C is out, the key rotates, and new messages are unreadable to C.
    await A.page.goto(`${APP}#/g/${gid}/info`)
    await A.page.click('.row:has-text("דוקטור סרקזם") [data-remove]')
    await A.page.click('[data-ok]')
    await A.page.waitForSelector('.toast:has-text("הוצא")')
    await open(B, `#/g/${gid}?tab=chat`) // B's phone notices and rotates the key
    await wait(1500)
    const kv = d1(`SELECT key_version, needs_rotation FROM groups WHERE id='${gid}'`)[0]
    check(kv.key_version === 2 && kv.needs_rotation === 0, 'key rotated to version 2 after the removal')
    await open(A, `#/g/${gid}?tab=chat`)
    await A.page.fill('#chat-text', 'סוד אחרי ההוצאה')
    await A.page.press('#chat-text', 'Enter')
    await A.page.waitForSelector('.msg.mine:has-text("סוד אחרי")')
    const after = d1(`SELECT key_version FROM events WHERE group_id='${gid}' ORDER BY seq DESC LIMIT 1`)[0]
    check(after.key_version === 2, 'new events use the new key')
    await open(C, '#/groups')
    await C.page.waitForSelector('.empty', { timeout: 15000 })
    check((await C.page.locator('.group-card').count()) === 0, 'C: the group is gone from their list')

    // Move a personal revenge into the group.
    await A.page.goto(`${APP}#/new`)
    await A.page.fill('#f-name', 'דני החניה')
    await A.page.fill('#f-why', 'תופס את המקום')
    await A.page.click('[type=submit]')
    await A.page.click('.nk-card-title:text("דני החניה")')
    await A.page.click('[data-act="to-group"]')
    await A.page.click('[data-to]')
    await A.page.waitForSelector('.g-card:has-text("דני החניה")')
    await A.page.goto(APP)
    await A.page.waitForSelector('.empty')
    check(true, 'A: a personal revenge moved into the group and left the personal list')

    // The server holds only ciphertext.
    const dump = JSON.stringify(d1(`SELECT data FROM events WHERE group_id='${gid}'`))
    check(!['השותפים', 'המקדחה', 'פופקורן', 'דני החניה', 'קונוסים'].some((w) => dump.includes(w)), 'server: names, messages and nicknames are encrypted')

    const errors = [A, B, C].flatMap((p) => p.page.errors)
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
    console.log('\nall good')
  } finally {
    await browser.close()
    try { process.kill(-api.pid) } catch { /* gone */ }
    web.kill()
    fs.rmSync(persist, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
