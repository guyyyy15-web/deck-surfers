// Three phones in one group against the real Worker running locally (wrangler dev, local D1 + R2).
//   node scripts/groups-smoke.cjs        (needs `npm ci` in server/ once)
const { chromium, devices } = require('playwright')
const { spawn, execFileSync } = require('child_process')
const http = require('http')
const nodeCrypto = require('crypto')
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
  // Push: test VAPID keys, no cooldown, and a pretend push service that records what the Worker sends.
  const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const VAPID_PUBLIC = Buffer.from(await crypto.subtle.exportKey('raw', vk.publicKey)).toString('base64url')
  const VAPID_PRIVATE = JSON.stringify(await crypto.subtle.exportKey('jwk', vk.privateKey))
  const PUSH_PORT = 8797
  const pushes = []
  const pushService = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      pushes.push({ path: req.url, body: Buffer.concat(chunks) })
      res.writeHead(201)
      res.end()
    })
  }).listen(PUSH_PORT, '127.0.0.1')
  const api = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(API_PORT), '--persist-to', persist, '--var', 'ALLOW_LOCALHOST:1',
    '--var', `VAPID_PUBLIC:${VAPID_PUBLIC}`, '--var', `VAPID_PRIVATE_JWK:${VAPID_PRIVATE}`, '--var', 'PUSH_COOLDOWN_MS:0'], { cwd: SERVER, env, detached: true, stdio: 'ignore' })
  const web = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(APP_PORT)], { stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/v1/health`)).ok) break
    } catch { /* starting */ }
    await wait(500)
  }
  // Full headless Chromium: unlike the stripped-down headless shell, it can show notifications.
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    const maker = await browser.newPage()
    await maker.setViewportSize({ width: 500, height: 500 })
    await maker.setContent('<div style="width:500px;height:500px;background:radial-gradient(#f2c14e 40%,#46334f 41%)"></div>')
    const FACE = await maker.screenshot()
    await maker.setContent('<div style="width:500px;height:500px;background:linear-gradient(#9fd8c8,#7f4fa0)"></div>')
    const DOC = await maker.screenshot()
    await maker.close()
    const img = (name, buffer) => ({ name, mimeType: 'image/png', buffer })

    // A browser subscription that delivers to the pretend push service; the keys stay here so the test can
    // decrypt the transport layer (RFC 8291) the way the real push service + browser would.
    const fakeSub = (name) => {
      const ecdh = nodeCrypto.createECDH('prime256v1')
      ecdh.generateKeys()
      const auth = nodeCrypto.randomBytes(16)
      return { ecdh, auth, endpoint: `http://127.0.0.1:${PUSH_PORT}/push/${name}`, p256dh: ecdh.getPublicKey().toString('base64url'), authB64: auth.toString('base64url') }
    }
    const openPush = async (sub, body) => {
      const hk = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8))
      const salt = body.subarray(0, 16), asPub = body.subarray(21, 21 + body[20]), ct = body.subarray(21 + body[20])
      const ikm = await hk(sub.auth, sub.ecdh.computeSecret(asPub), Buffer.concat([Buffer.from('WebPush: info\0'), sub.ecdh.getPublicKey(), asPub]), 32)
      const key = await crypto.subtle.importKey('raw', await hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt'])
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12) }, key, ct))
      return JSON.parse(Buffer.from(plain.subarray(0, -1)).toString())
    }
    const pushesTo = (sub) => pushes.filter((x) => sub.endpoint.endsWith(x.path))
    /** Hands a push to the phone's service worker exactly as the browser would when one arrives. */
    const deliver = async (p, payload) => {
      const cdp = await p.ctx.newCDPSession(p.page)
      const reg = new Promise((resolve) => cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
        const r = e.registrations.find((x) => !x.isDeleted)
        if (r) resolve(r.registrationId)
      }))
      await cdp.send('ServiceWorker.enable')
      await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(APP).origin, registrationId: await reg, data: JSON.stringify(payload) })
      await wait(800)
      return p.page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag })))
    }

    const phone = async (name, device, { installed = false } = {}) => {
      const ctx = await browser.newContext({ ...devices[device], locale: 'he-IL' })
      await ctx.grantPermissions(['notifications', 'clipboard-read', 'clipboard-write'], { origin: new URL(APP).origin })
      // "installed": opened from the home-screen icon (iOS sets navigator.standalone).
      if (installed) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
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

    // C (iPhone): the link opens in Safari, which is separate from the home-screen app. Safari offers to carry
    // the invite into the app instead of joining there.
    const safari = await phone('C-safari', 'iPhone 15')
    await safari.page.goto(link)
    await safari.page.waitForSelector('[data-copy-invite]')
    check(!(await safari.page.isVisible('[data-oath]')), 'iPhone Safari: no joining by default, a handoff instead')
    await safari.page.click('[data-copy-invite]')
    await safari.page.waitForSelector('.toast:has-text("הועתקה")')
    const copied = await safari.page.evaluate(() => navigator.clipboard.readText())
    check(copied === link, 'iPhone Safari: the invite is copied')
    await shot(safari, '02b-handoff')
    await safari.ctx.close()
    // C's installed app pastes it and joins there.
    const C = await phone('C', 'iPhone 15', { installed: true })
    await makeCat(C, 'דוקטור סרקזם', 'shades')
    await C.page.goto(`${APP}#/groups`)
    await C.page.evaluate((t) => navigator.clipboard.writeText(t), `הוזמנת! ${copied}`)
    await C.page.click('[data-paste-invite]')
    await C.page.click('[data-from-clipboard]')
    await C.page.waitForSelector('[data-oath]')
    check(true, 'C (installed app): pasted the invite and got the oath')
    await C.page.locator('[data-oath]').focus()
    await C.page.keyboard.press('Enter')
    await C.page.waitForURL(/#\/g\//)
    check(true, 'C: joined (keyboard path for the oath)')

    // B (Android) turns on notifications from settings. Headless Chromium has no real push service, so the
    // subscription is pointed at the pretend one; everything else (permission, server, SW) is real.
    const subB = fakeSub('b')
    await B.ctx.addInitScript(({ endpoint, p256dh, auth, key }) => {
      if (typeof PushManager === 'undefined') return
      const make = () => ({ endpoint, options: { applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)).buffer },
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => { localStorage.removeItem('__sub'); return true } })
      PushManager.prototype.subscribe = async () => (localStorage.setItem('__sub', '1'), make())
      PushManager.prototype.getSubscription = async () => (localStorage.getItem('__sub') ? make() : null)
    }, { endpoint: subB.endpoint, p256dh: subB.p256dh, auth: subB.authB64, key: VAPID_PUBLIC })
    await B.page.goto(`${APP}#/settings`)
    await B.page.reload() // a new document, so the subscription stub above is installed
    await B.page.waitForSelector('#splash', { state: 'detached' })
    await B.page.click('[data-act="push-on"]')
    await B.page.waitForSelector('.toast:has-text("ההתראות פעילות")')
    check(await B.page.isVisible('[data-act="push-test"]'), 'B: notifications on (settings show test and off)')
    check(await A.page.evaluate(() => !document.querySelector('[data-act="push-on"]')), 'A (iPhone in Safari): no push button outside the home-screen app')
    await B.page.click('[data-act="push-test"]')
    await B.page.waitForSelector('.toast:has-text("נשלחה")')
    await wait(800)
    const testPayload = await openPush(subB, pushesTo(subB).at(-1).body)
    check(testPayload.test === true, 'server: the test notification went to B')
    const shownTest = await deliver(B, testPayload)
    check(shownTest.some((n) => n.body === 'ההתראות עובדות! 🎉'), "B's phone shows the test notification")

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
    await wait(1200)
    const note = await openPush(subB, pushesTo(subB).at(-1).body)
    check(note.g === gid && typeof note.d === 'string' && !JSON.stringify(note).includes('המקדחה'), 'server → B: the notification arrives, and the server only saw ciphertext')
    const shown = await deliver(B, note)
    const mine = shown.find((n) => n.tag === gid)
    check(mine && mine.title === '🔥 השותפים מהדירה' && mine.body.includes('הציע/ה: השכן עם המקדחה'), `B's phone decrypts and shows it: "${mine?.title} · ${mine?.body}"`)
    check(pushes.length > 0 && pushes.every((x) => x.path === '/push/b'), 'only subscribed phones get pushes (the author, A, has none)')

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
    await C.page.waitForSelector('.msg.mine:has-text("פופקורן")', { timeout: 3000 })
    check(true, 'C: my message shows right away (no waiting for the next poll)')
    // C's installed app (notifications off) asks once after the first action; "later" closes it.
    await C.page.waitForSelector('.sheet:has-text("לדעת כשקורה משהו")')
    await C.page.click('.sheet [data-no]')
    await C.page.waitForSelector('.sheet', { state: 'detached' })
    check(await C.page.isVisible('.msg.mine:has-text("פופקורן")'), 'C: offered notifications once; the chat is intact after closing it')
    await open(A, `#/g/${gid}?tab=chat`)
    await A.page.waitForSelector('.msg:has-text("פופקורן")', { timeout: 15000 })
    check(true, "A: reads C's chat message")
    // B mutes the group: C's next message does not reach B.
    await B.page.goto(`${APP}#/g/${gid}/info`)
    await B.page.click('[data-mute="1"]')
    await B.page.waitForSelector('.toast:has-text("מושתקת")')
    const before = pushesTo(subB).length
    await C.page.fill('#chat-text', 'הודעה בשקט')
    await C.page.press('#chat-text', 'Enter')
    await C.page.waitForSelector('.msg.mine:has-text("בשקט")')
    await wait(1500)
    check(pushesTo(subB).length === before, 'muted: no push to B')

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
    pushService.close()
    try { process.kill(-api.pid) } catch { /* gone */ }
    web.kill()
    fs.rmSync(persist, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
