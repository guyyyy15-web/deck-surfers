// החצר end to end: three iPhones against the real Worker running locally (wrangler dev, local D1 + R2).
//   node scripts/chatzer-smoke.cjs        (needs `npm ci` in server/ once). Screenshots: screenshots/chatzer-*.png
const { chromium, devices } = require('playwright')
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SERVER = path.join(ROOT, 'server')
const OUT = path.join(ROOT, 'screenshots')
const APP_PORT = 8769
const API_PORT = 8794
const APP = `http://localhost:${APP_PORT}/chatzer/`
const API = `http://127.0.0.1:${API_PORT}`
fs.mkdirSync(OUT, { recursive: true })

const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-e2e-'))
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: 'local', CI: '1' }
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'nekamot-sync', '--local', '--persist-to', persist], { cwd: SERVER, env, stdio: 'pipe' })
  const api = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(API_PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1', '--var', 'PUSH_COOLDOWN_MS:0'],
    { cwd: SERVER, env, detached: true, stdio: 'ignore' })
  const web = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(APP_PORT)], { stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/v1/health`)).ok) break
    } catch { /* starting */ }
    await wait(500)
  }
  const browser = await chromium.launch()
  const errors = []
  const phone = async (name) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL', deviceScaleFactor: 2 })
    await ctx.addInitScript((api) => localStorage.setItem('cz.api', api), API)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(`${name}: ${m.text()}`))
    page.on('dialog', (d) => d.accept())
    return { ctx, page, name }
  }
  const shot = async (p, n) => {
    await wait(450) // let the splash and sheets finish their entrance
    await p.page.screenshot({ path: path.join(OUT, `chatzer-${n}.png`) })
  }
  const sync = async (p) => {
    await p.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await wait(1500)
  }
  const welcome = async (p, nick, color, voice = 'f') => {
    await p.page.goto(APP)
    await p.page.waitForSelector('#nick')
    await p.page.fill('#nick', nick)
    await p.page.click(`.swatch[data-color="${color}"]`)
    await p.page.click(`[data-voice="${voice}"]`)
    await p.page.click('button[type="submit"]')
    await p.page.waitForSelector('text=החצרות שלי')
  }

  try {
    const noa = await phone('noa')
    const maya = await phone('maya')
    const dani = await phone('dani')

    // 1. First launch: welcome → duckling → empty home.
    await noa.page.goto(APP)
    await noa.page.waitForSelector('#nick')
    await shot(noa, '01-welcome')
    await welcome(noa, 'נועה', 'pink')
    check(await noa.page.isVisible('text=עוד אין חצרות'), 'new user lands on an empty home with a way forward')
    await shot(noa, '02-home-empty')

    // 2. Open an event yard with the BBQ template; the invite sheet opens right away.
    await noa.page.click('#new')
    await noa.page.click('[data-kind="event"]')
    await noa.page.fill('#yname', 'מנגל שישי אצל הילה')
    await noa.page.fill('#where', 'רמת גן')
    await noa.page.fill('#when', '2026-11-20T14:00')
    await shot(noa, '03-new-yard')
    await noa.page.click('button:has-text("פותחים חצר")')
    await noa.page.waitForFunction(() => /join/.test(document.querySelector('#link')?.textContent || ''), null, { timeout: 15000 })
    const link = (await noa.page.textContent('#link')).trim().replace(`http://localhost:${APP_PORT}/chatzer/`, APP)
    check(link.includes('#/join/'), 'creating a yard opens the invite sheet with a link')
    await shot(noa, '04-invite')
    await noa.page.goBack()
    await noa.page.waitForSelector('.row')
    check((await noa.page.$$('.row')).length === 10, 'the BBQ template filled 10 items')
    await shot(noa, '05-event')

    // 3. Maya joins from the link with no account, and takes something.
    await maya.page.goto(link)
    await maya.page.waitForSelector('text=מנגל שישי אצל הילה')
    check(await maya.page.isVisible('text=נועה מזמינה אותך לחצר'), 'the invite shows who invites, in her own form of address')
    check(await maya.page.isVisible('text=עוד 10 דברים שאף אחד לא לקח'), 'the invite shows what is still free')
    await shot(maya, '06-join')
    await maya.page.fill('#nick', 'מאיה')
    await maya.page.click('.swatch[data-color="mint"]')
    const t0 = Date.now()
    await maya.page.click('button:has-text("אני בחצר")')
    await maya.page.waitForSelector('.row [data-claim]')
    check(Date.now() - t0 < 5000, `joined in ${((Date.now() - t0) / 1000).toFixed(1)}s (under 5s on a local server)`)
    await maya.page.click('.row:has-text("פיתות") [data-claim]')
    await maya.page.waitForSelector('.row.mine:has-text("פיתות")')
    check(true, 'Maya took the pitas (shown as hers)')
    await shot(maya, '07-claimed')

    // 4. Noa sees it; Dani joins; Maya and Dani grab the same item at once: one wins, the other is told.
    await sync(noa)
    check(await noa.page.isVisible('.row:has-text("פיתות") >> text=מאיה'), 'Noa sees that Maya brings the pitas')
    await welcome(dani, 'דני', 'sky', 'm')
    await dani.page.goto(link)
    await dani.page.click('button:has-text("אני בחצר")')
    await dani.page.waitForSelector('.row [data-claim]')
    await sync(maya)
    await Promise.all([
      maya.page.click('.row:has-text("חומוס") [data-claim]'),
      dani.page.click('.row:has-text("חומוס") [data-claim]'),
    ])
    await wait(1500)
    await sync(maya)
    await sync(dani)
    const mayaHas = await maya.page.isVisible('.row.mine:has-text("חומוס")')
    const daniHas = await dani.page.isVisible('.row.mine:has-text("חומוס")')
    check(mayaHas !== daniHas, `a race for the hummus has exactly one winner (${mayaHas ? 'Maya' : 'Dani'})`)
    if (mayaHas) {
      await dani.page.click('.row:has-text("חומוס") .what')
      check(await dani.page.waitForSelector('.sheet >> text=מאיה מביאה', { timeout: 5000 }).catch(() => null), 'Dani reads "מאיה מביאה" (her form of address)')
    } else {
      await maya.page.click('.row:has-text("חומוס") .what')
      check(await maya.page.waitForSelector('.sheet >> text=דני מביא', { timeout: 5000 }).catch(() => null), 'Maya reads "דני מביא" (his form of address)')
    }
    await (mayaHas ? dani : maya).page.goBack()

    // 5. Adding an item, a poll, chat.
    await noa.page.fill('#addin', 'מלח גס')
    await noa.page.click('#add button[type="submit"]')
    await noa.page.waitForSelector('.row:has-text("מלח גס")')
    await noa.page.click('#poll')
    await noa.page.fill('#q', 'מתי מתחילים?')
    const opts = await noa.page.$$('#opts input')
    await opts[0].fill('13:00')
    await opts[1].fill('14:00')
    await noa.page.click('button:has-text("שליחה לחצר")')
    await noa.page.waitForSelector('.poll')
    await sync(maya)
    await maya.page.click('.opt:has-text("14:00")')
    await maya.page.waitForSelector('.opt[aria-pressed="true"]:has-text("14:00")')
    check(true, 'Maya voted in Noa’s poll')
    await maya.page.click('a:has-text("צ׳אט")')
    await maya.page.fill('#msg', 'מישהו מביא מחצלות?')
    await maya.page.click('#f button[type="submit"]')
    await maya.page.waitForSelector('.bubble:has-text("מחצלות")')
    await noa.page.goto(`${APP}#/y/${link ? (await noa.page.evaluate(() => location.hash.split('/')[2])) : ''}/chat`)
    await noa.page.waitForSelector('.bubble:has-text("מחצלות")', { timeout: 15000 })
    check(true, 'Noa reads Maya’s chat message')
    await shot(noa, '08-chat')
    await noa.page.goBack()
    await noa.page.waitForSelector('.poll')
    await shot(noa, '09-event-full')

    // 6. A home yard: chores in turns, done passes the turn on.
    await noa.page.goto(APP)
    await noa.page.click('#new')
    await noa.page.click('[data-kind="home"]')
    await noa.page.fill('#yname', 'הדירה')
    await noa.page.click('button:has-text("פותחים חצר")')
    await noa.page.waitForFunction(() => /join/.test(document.querySelector('#link')?.textContent || ''), null, { timeout: 15000 })
    const homeLink = (await noa.page.textContent('#link')).trim()
    await noa.page.goBack()
    await noa.page.waitForSelector('.turn-card')
    check((await noa.page.$$('.turn-card')).length === 3, 'the one who opened the home yard starts all 3 chores')
    await shot(noa, '10-home-yard')
    await maya.page.goto(homeLink)
    await maya.page.click('button:has-text("אני בחצר")')
    await maya.page.waitForSelector('text=מטלות בתורות')
    await sync(noa)
    await noa.page.click('.turn-card:has-text("שטיפת כלים") [data-cdone]')
    await noa.page.waitForSelector('text=תמונת הוכחה זה לא חובה')
    await shot(noa, '11-done-sheet')
    await noa.page.click('#ok')
    await noa.page.waitForSelector('text=כל הכבוד')
    check((await noa.page.$$('.turn-card')).length === 2, 'after "done", the dishes are no longer Noa’s turn')
    await sync(maya)
    // Done today, daily: Maya's turn is tomorrow (the big card shows on the day it is due).
    check(await maya.page.isVisible('.row.mine:has-text("שטיפת כלים") >> text=תורך · מחר'), 'and now it is Maya’s turn, tomorrow')
    await shot(maya, '12-maya-turn')

    // 7. Offline: an added task waits, then goes out when the phone is back online.
    await maya.ctx.setOffline(true)
    await maya.page.fill('#addin', 'לקנות נייר טואלט')
    await maya.page.click('#add button[type="submit"]')
    await maya.page.waitForSelector('.row:has-text("נייר טואלט")')
    check(await maya.page.isVisible('text=אין רשת כרגע'), 'offline: the yard says so, and the task is shown')
    await maya.ctx.setOffline(false)
    await maya.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await wait(2500)
    await sync(noa)
    check(await noa.page.isVisible('.row:has-text("נייר טואלט")'), 'back online: the task reached Noa')
    await shot(noa, '13-task')

    // 8. Home with two yards; my duckling screen.
    await noa.page.goto(APP)
    await noa.page.waitForSelector('.yard-card')
    check((await noa.page.$$('.yard-card')).length === 2, 'Noa’s home lists both yards')
    await shot(noa, '14-home')
    await noa.page.click('.me-btn')
    await noa.page.waitForSelector('text=הברווזון שלי')
    await shot(noa, '15-me')

    check(errors.length === 0, `no errors in the pages${errors.length ? `: ${errors.join(' | ')}` : ''}`)
    console.log('\nall good')
  } finally {
    await browser.close()
    web.kill()
    try {
      process.kill(-api.pid)
    } catch { /* gone */ }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
