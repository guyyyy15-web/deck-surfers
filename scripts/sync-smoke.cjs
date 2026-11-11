// Two-phone sync test against the real Worker running locally (wrangler dev, local D1 + R2).
//   node scripts/sync-smoke.cjs        (needs `npm install` in server/ once)
const { chromium, devices } = require('playwright')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SERVER = path.join(ROOT, 'server')
const OUT = path.join(ROOT, 'screenshots')
const APP_PORT = 8767
const API_PORT = 8791
const APP = `http://localhost:${APP_PORT}/`
const API = `http://127.0.0.1:${API_PORT}`
fs.mkdirSync(OUT, { recursive: true })

const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-sync-e2e-'))
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' }
  const d1 = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'nekamot-sync', '--local', '--persist-to', persist, ...args], { cwd: SERVER, env, stdio: 'pipe' }).toString()
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nekamot-sync', '--local', '--persist-to', persist], { cwd: SERVER, env, stdio: 'pipe' })
  const api = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(API_PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1'], { cwd: SERVER, env, detached: true, stdio: process.env.API_LOG ? ['ignore', fs.openSync(process.env.API_LOG, 'w'), fs.openSync(process.env.API_LOG, 'a')] : 'ignore' })
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
    await maker.setViewportSize({ width: 600, height: 600 })
    await maker.setContent('<div style="width:600px;height:600px;background:radial-gradient(#f4a9c4 40%,#7f4fa0 41%)"></div>')
    const FACE = await maker.screenshot()
    await maker.setContent('<div style="width:600px;height:600px;background:linear-gradient(#f2c14e,#46334f)"></div>')
    const DOC = await maker.screenshot()
    await maker.close()
    const img = (name, buffer) => ({ name, mimeType: 'image/png', buffer })

    // installed: opened from the home-screen icon (iOS sets navigator.standalone). Links in plain Safari get
    // a handoff screen instead (iPhone Safari and the home-screen app don't share storage).
    const phone = async (name, { installed = true } = {}) => {
      const ctx = await browser.newContext({ ...devices['iPhone 15'], locale: 'he-IL' })
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(APP).origin })
      if (installed) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
      await ctx.addInitScript((url) => localStorage.setItem('nk.syncUrl', JSON.stringify(url)), API)
      const page = await ctx.newPage()
      page.errors = []
      page.on('pageerror', (e) => page.errors.push(`${name}: ${e}`))
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && page.errors.push(`${name}: ${m.text()}`))
      return { ctx, page }
    }
    const ready = async (page, url = APP) => {
      await page.goto(url)
      await page.waitForSelector('#splash', { state: 'detached' })
    }
    const syncNow = async (page) => {
      await page.goto(`${APP}#/settings`)
      await page.click('[data-act="sync-now"]')
      await page.waitForSelector('.toast:has-text("סונכרן"), .toast:has-text("מסונכרן")')
    }

    // Phone A: one revenge with a face photo, then turn on backup.
    const A = await phone('A')
    await ready(A.page)
    await A.page.click('.empty .nk-btn')
    await A.page.setInputFiles('[data-face]', img('face.png', FACE))
    await A.page.click('[data-ok]')
    await A.page.fill('#f-name', 'רונית מהחשבות')
    await A.page.fill('#f-why', 'מייל לכל המחלקה')
    await A.page.click('[type=submit]')
    await A.page.waitForSelector('.nk-card')
    await A.page.goto(`${APP}#/me`)
    await A.page.fill('#me-nick', 'מלכת הקונוסים')
    await A.page.click('[data-acc="crown"]')
    await A.page.click('[data-save-me]')
    await A.page.click('.sheet [data-no]')
    await A.page.goto(`${APP}#/settings`)
    check(await A.page.isVisible('[data-act="sync-on"]'), 'A: backup is off by default')
    await A.page.screenshot({ path: path.join(OUT, 'sync-01-off.png') })
    await A.page.click('[data-act="sync-on"]')
    await A.page.waitForSelector('[data-code]')
    const code = (await A.page.textContent('[data-code]')).trim()
    check(/^([0-9A-Z]{4}-){6}[0-9A-Z]{2}$/.test(code), `A: got a sync code (${code.slice(0, 4)}-…)`)
    await A.page.screenshot({ path: path.join(OUT, 'sync-02-code.png') })
    await A.page.click('[data-done]')
    await A.page.waitForSelector('.row:has-text("סונכרן")')
    check(true, 'A: first sync done')
    await A.page.screenshot({ path: path.join(OUT, 'sync-03-on.png') })

    // The server holds only ciphertext.
    const dump = d1(['--json', '--command', 'SELECT kind, data FROM items'])
    const rows = JSON.parse(dump)[0].results
    check(rows.length === 3 && rows.some((r) => r.kind === 'photo') && rows.some((r) => r.kind === 'meta'), 'server: one revenge + one photo + the cat')
    check(!dump.includes('רונית') && !dump.includes('מייל') && !dump.includes('הקונוסים'), 'server: names, reasons and nickname are encrypted')

    // Phone B opens the pairing link.
    // In plain Safari the pairing link offers to copy the code for the app.
    const S = await phone('S', { installed: false })
    await S.page.goto(`${APP}#/pair/${code.replace(/-/g, '')}`)
    await S.page.waitForSelector('#splash', { state: 'detached' })
    await S.page.click('[data-copy-pair]')
    await S.page.waitForSelector('.toast:has-text("הועתק")')
    check((await S.page.evaluate(() => navigator.clipboard.readText())) === code, 'iPhone Safari: pairing link copies the code for the app')
    await S.ctx.close()

    const B = await phone('B')
    await ready(B.page, `${APP}#/pair/${code.replace(/-/g, '')}`)
    check((await B.page.textContent('h2')).includes('לחבר'), 'B: pairing link asks to connect')
    await B.page.screenshot({ path: path.join(OUT, 'sync-04-pair.png') })
    await B.page.click('[data-pair]')
    await B.page.waitForSelector('.nk-card')
    check(!B.page.url().includes(code.replace(/-/g, '')), 'B: the code is dropped from the address bar')
    check((await B.page.textContent('.nk-card-title')) === 'רונית מהחשבות', 'B: the revenge arrived')
    await B.page.waitForSelector('.avatar-face img[src]')
    check(true, 'B: with its photo')
    await B.page.screenshot({ path: path.join(OUT, 'sync-05-b-home.png') })
    await B.page.waitForSelector('.me-badge')
    check((await B.page.getAttribute('.me-badge', 'aria-label')).includes('מלכת הקונוסים'), "B: A's cat arrived through the backup")
    const ids = await Promise.all([A, B].map((x) => x.page.evaluate(() => JSON.parse(localStorage.getItem('nk.identity')).keys.memberId)))
    check(ids[0] === ids[1], 'A and B are the same member (same keys)')

    // B completes it with a documentation photo; A sees it.
    await B.page.click('.nk-card .nk-check')
    await B.page.fill('#c-notes', 'בוצע מהטלפון השני')
    await B.page.setInputFiles('.pick-tile:nth-child(2) input', img('doc.png', DOC))
    await B.page.waitForSelector('.doc-preview img')
    await B.page.click('[data-save]')
    await wait(2500) // background sync after the save
    await syncNow(A.page)
    await A.page.goto(`${APP}#/done`)
    await A.page.waitForSelector('.nk-card')
    check((await A.page.textContent('.nk-tab.is-on')).includes('(1)'), 'A: completion from B arrived')
    await A.page.waitForSelector('.thumb img[src]')
    check(true, "A: B's documentation photo arrived")

    // A adds one, B gets it without touching anything but opening the app.
    await A.page.goto(`${APP}#/new`)
    await A.page.fill('#f-name', 'דני החניה')
    await A.page.fill('#f-why', 'תופס את המקום')
    await A.page.click('[type=submit]')
    await A.page.waitForSelector('.nk-card-title:text("דני החניה")')
    await wait(2500)
    await B.page.reload()
    await B.page.waitForSelector('.nk-card-title:text("דני החניה")', { timeout: 10000 })
    check(true, 'B: a new revenge from A shows up on launch')

    // Deletion travels too.
    await B.page.click('.nk-card-title:text("דני החניה")')
    await B.page.click('[data-act="delete"]')
    await B.page.click('[data-ok]')
    await wait(8500) // past the undo window and the delayed sync
    await syncNow(A.page)
    await A.page.goto(APP)
    await A.page.waitForSelector('.empty')
    check((await A.page.locator('.nk-card').count()) === 0, 'A: deletion from B arrived')

    // Phone C joins by typing the code, messily.
    const C = await phone('C')
    await ready(C.page)
    await C.page.goto(`${APP}#/settings`)
    await C.page.click('[data-act="sync-join"]')
    await C.page.fill('#j-code', 'NOT A CODE')
    await C.page.click('[data-go]')
    check(await C.page.isVisible('.sheet .nk-field-error:not([hidden])'), 'C: a bad code shows an error')
    await C.page.fill('#j-code', ` ${code.toLowerCase().replace(/-/g, ' ')} `)
    await C.page.click('[data-go]')
    await C.page.waitForSelector('.toast:has-text("מחובר")')
    await C.page.goto(`${APP}#/done`)
    await C.page.waitForSelector('.nk-card')
    check(true, 'C: joined by typing the code and got the history')

    // A wrong (but well-formed) code is refused.
    const D = await phone('D')
    await ready(D.page, `${APP}#/pair/${'7'.repeat(26)}`)
    await D.page.click('[data-pair]')
    await D.page.waitForSelector('[data-err]:not([hidden])')
    check((await D.page.textContent('[data-err]')).includes('לא מצאתי'), 'D: an unknown code is refused')

    // Offline: the app keeps working and settings say so.
    await A.ctx.setOffline(true)
    await A.page.click('[data-act="sync-now"]').catch(() => undefined)
    await A.page.goto(`${APP}#/settings`).catch(() => undefined)
    await A.page.click('[data-act="sync-now"]')
    await A.page.waitForSelector('.toast:has-text("לא הצליח")')
    check(true, 'A offline: sync fails gracefully')
    await A.ctx.setOffline(false)

    // Disconnect keeps the data; deleting the cloud backup removes it for everyone.
    await C.page.goto(`${APP}#/settings`)
    await C.page.click('[data-act="sync-off"]')
    await C.page.click('[data-ok]')
    await C.page.waitForSelector('[data-act="sync-on"]')
    await C.page.goto(`${APP}#/done`)
    check((await C.page.locator('.nk-card').count()) === 1, 'C: disconnecting keeps the revenges')
    await A.page.goto(`${APP}#/settings`)
    await A.page.click('[data-act="sync-delete"]')
    await A.page.click('[data-ok]')
    await A.page.waitForSelector('.toast:has-text("נמחק מהענן")')
    const left = JSON.parse(d1(['--json', '--command', 'SELECT COUNT(*) AS n FROM items']))[0].results[0].n
    check(left === 0, 'cloud backup deleted from the server')

    const errors = [...A.page.errors, ...B.page.errors, ...C.page.errors, ...D.page.errors]
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
