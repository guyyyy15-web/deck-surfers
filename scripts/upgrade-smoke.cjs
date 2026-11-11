// Existing users: a phone running the released version (OLD_REF, default origin/main) updates to the working
// copy, keeps its data, and from then on announces further updates. Run before every release:
//   node scripts/upgrade-smoke.cjs            (OLD_REF=<git ref> to start from another version)
const { chromium, devices } = require('playwright')
const { execFileSync, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PORT = 8779
const OLD_REF = process.env.OLD_REF || 'origin/main'
const APP_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'docs']
const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const versionOf = (dir) => fs.readFileSync(path.join(dir, 'js/app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1]

/** Copies the app files and stamps them with a distinct time (the test server revalidates by mtime). */
function stage(from, to, hoursAhead) {
  fs.mkdirSync(to, { recursive: true })
  for (const f of APP_FILES) if (fs.existsSync(path.join(from, f))) fs.cpSync(path.join(from, f), path.join(to, f), { recursive: true })
  const t = new Date(Date.now() + hoursAhead * 3600e3)
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else fs.utimesSync(p, t, t)
    }
  }
  walk(to)
}

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nk-upgrade-'))
  const site = path.join(tmp, 'site')
  const link = path.join(site, 'app')
  const oldTree = path.join(tmp, 'old-tree')
  execFileSync('git', ['worktree', 'add', '-q', '--detach', oldTree, OLD_REF], { cwd: ROOT })
  stage(oldTree, path.join(tmp, 'old'), 0)
  stage(ROOT, path.join(tmp, 'new'), 1)
  stage(ROOT, path.join(tmp, 'next'), 2)
  const nextSw = path.join(tmp, 'next/sw.js')
  fs.writeFileSync(nextSw, fs.readFileSync(nextSw, 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'"))
  fs.utimesSync(nextSw, new Date(Date.now() + 3 * 3600e3), new Date(Date.now() + 3 * 3600e3))
  fs.mkdirSync(site)
  const point = (to) => {
    try { fs.unlinkSync(link) } catch { /* first time */ }
    fs.symlinkSync(path.join(tmp, to), link)
  }
  point('old')
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: site, stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 700))
  const browser = await chromium.launch()
  try {
    const oldV = versionOf(path.join(tmp, 'old'))
    const newV = versionOf(path.join(tmp, 'new'))
    console.log(`from ${oldV} (${OLD_REF}) to ${newV}`)
    const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'he-IL' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript(() => localStorage.setItem('nk.syncUrl', JSON.stringify('http://127.0.0.1:9')))
    const U = `http://localhost:${PORT}/app/`
    const ready = () => page.waitForSelector('#splash', { state: 'detached' })
    const shownVersion = async () => {
      await page.goto(`${U}#/settings`)
      await page.waitForSelector('.foot')
      return (await page.textContent('.foot')).match(/גרסה ([\w.-]+)/)[1]
    }

    // A phone on the released version, with a revenge and a cat.
    await page.goto(U)
    await ready()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.click('.empty .nk-btn')
    await page.fill('#f-name', 'נקמה ותיקה')
    await page.fill('#f-why', 'מהגרסה הקודמת')
    await page.click('[type=submit]')
    await page.waitForSelector('.nk-card')
    if (fs.existsSync(path.join(tmp, 'old/js/identity.js'))) {
      await page.goto(`${U}#/me`)
      await page.fill('#me-nick', 'משתמש ותיק')
      await page.click('[data-save-me]')
      await page.click('.sheet [data-no]')
    }
    check((await shownVersion()) === oldV, `running ${oldV}`)

    // The new version is published: the old code runs once more while it installs; the next launch is new.
    point('new')
    await page.reload()
    await ready()
    await page.waitForTimeout(2500)
    await page.reload()
    await ready()
    check((await shownVersion()) === newV, `updated to ${newV} by the second launch`)
    await page.goto(U)
    await page.waitForSelector('.nk-card')
    check((await page.textContent('.nk-card-title')) === 'נקמה ותיקה', 'the revenge survived the update')
    if (fs.existsSync(path.join(tmp, 'old/js/identity.js'))) check((await page.getAttribute('.me-badge', 'aria-label')).includes('משתמש ותיק'), 'the cat survived the update')

    // From here on, an update announces itself and a tap refreshes into it.
    point('next')
    await page.reload()
    await ready()
    await page.waitForSelector('.toast:has-text("גרסה חדשה")', { timeout: 20000 })
    check(true, 'the next update shows "גרסה חדשה מוכנה"')
    await page.click('.toast button')
    await ready()
    await page.waitForSelector('.nk-card')
    check((await page.locator('.nk-card').count()) === 1, 'still the same data after refreshing into it')
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
    console.log('\nall good')
  } finally {
    await browser.close()
    server.kill()
    execFileSync('git', ['worktree', 'remove', '--force', oldTree], { cwd: ROOT })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
