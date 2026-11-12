// החצר live check: two phones against the REAL site and API (hechatzer.pages.dev). Run after every release:
//   node scripts/chatzer-live.cjs
// It deletes its yard and its saves at the end. It leaves two test identities (no yard, no save) on the server:
// remove them with the query printed at the end (scripts/chatzer-stats.sh shows recent identities).
const { chromium, devices } = require('playwright')
const APP = 'https://hechatzer.pages.dev/'
const ok = (m) => console.log('ok  ' + m)
;(async () => {
  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {})
  const errors = []
  const phone = async (name) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    page.on('dialog', (d) => d.accept())
    return { ctx, page }
  }
  const a = await phone('a')
  const b = await phone('b')
  const t0 = Date.now()
  try {
    await a.page.goto(APP)
    await a.page.waitForSelector('#nick')
    ok(`welcome screen loaded (${Date.now() - t0} ms)`)
    await a.page.fill('#nick', 'בדיקה א')
    await a.page.click('[data-voice="f"]')
    await a.page.click('button[type="submit"]')
    await a.page.waitForSelector('text=החצרות שלי')
    await a.page.click('[data-new="event"]')
    await a.page.waitForSelector('#yname')
    await a.page.fill('#yname', 'בדיקה חיה (נמחק)')
    await a.page.click('button:has-text("פותחים חצר")')
    await a.page.waitForFunction(() => /join/.test(document.querySelector('#link')?.textContent || ''), null, { timeout: 30000 })
    const link = (await a.page.textContent('#link')).trim()
    ok('yard opened on the real server, invite link made')
    const t1 = Date.now()
    await b.page.goto(link)
    await b.page.waitForSelector('#nick', { timeout: 45000 })
    await b.page.fill('#nick', 'בדיקה ב')
    await b.page.click('[data-voice="m"]')
    await b.page.click('button:has-text("אני בחצר")')
    await b.page.waitForSelector('.row [data-claim]', { timeout: 20000 })
    ok(`joined from the link in ${((Date.now() - t1) / 1000).toFixed(1)} s (incl. typing a name)`)
    if (await b.page.waitForSelector('.sheet', { timeout: 4000 }).catch(() => null)) await b.page.click('.sheet-x')
    ok('the guided install step showed and closed')
    await b.page.click('.row:has-text("פיתות") [data-claim]')
    await b.page.waitForSelector('.row.mine:has-text("פיתות")', { timeout: 15000 })
    await a.page.goBack()
    await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await a.page.waitForSelector('.row:has-text("פיתות") >> text=בדיקה ב', { timeout: 20000 })
    ok('the other phone sees who brings the pitas')
    // Reopening the app (served by the service worker): what failed before 0.2.3.
    for (let i = 0; i < 2; i++) {
      await b.page.goto(APP)
      await b.page.waitForSelector('.yard-card', { timeout: 15000 })
    }
    ok('reopening the app twice works (service worker serves it)')

    await a.page.goto(APP + '#/me')
    await a.page.click('#save-pk')
    await a.page.waitForSelector('#save >> text=✓', { timeout: 20000 })
    ok('saved with a passkey (PRF) on the real server')
    await a.page.click('#save-code')
    await a.page.waitForSelector('.sheet .invite-box')
    await a.page.click('#ok')
    await a.page.evaluate(async () => {
      localStorage.clear()
      await new Promise((r) => {
        const q = indexedDB.deleteDatabase('chatzer')
        q.onsuccess = q.onerror = q.onblocked = () => r()
      })
    })
    await a.page.goto(APP)
    await a.page.reload()
    await a.page.click('#signin')
    await a.page.click('#pk')
    await a.page.waitForSelector('.yard-card:has-text("בדיקה חיה")', { timeout: 20000 })
    ok('emptied app + Face ID → the duckling and the yard are back')
  } finally {
    try {
      await a.page.goto(APP + '#/me')
      await a.page.waitForSelector('[data-unsave]', { timeout: 10000 }).catch(() => null)
      for (let i = 0; i < 2; i++) {
        const btn = await a.page.$('[data-unsave]')
        if (!btn) break
        await btn.click()
        await a.page.waitForTimeout(1500)
      }
      console.log('cleanup: saves left on this phone ' + (await a.page.evaluate(() => JSON.parse(localStorage.getItem('cz.vault') || '[]').length)))
      await a.page.goto(APP)
      await a.page.click('.yard-card:has-text("בדיקה חיה")')
      await a.page.click('#menu')
      await a.page.click('[data-a="delete"]')
      await a.page.waitForSelector('text=החצרות שלי', { timeout: 15000 })
      await a.page.waitForTimeout(1000)
      console.log('cleanup: yard deleted, cards left ' + (await a.page.$$('.yard-card')).length)
    } catch (e) {
      console.log('CLEANUP PROBLEM: ' + e.message.split('\n')[0])
    }
    console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors')
    console.log(`test identities to remove (created in this run, never in a yard, no save):
  cd server && npx wrangler d1 execute chatzer --remote --env chatzer --command "DELETE FROM identities WHERE created_at > ${t0 - 60000} AND id NOT IN (SELECT member_id FROM members) AND id NOT IN (SELECT member_id FROM vaults) AND id NOT IN (SELECT member_id FROM push_subs)"`)
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + e.message.split('\n')[0])
  process.exit(1)
})
