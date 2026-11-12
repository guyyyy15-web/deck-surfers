// A sheet of every duckling look, to check by eye that accessories sit right: node scripts/chatzer-ducks.cjs
// → screenshots/chatzer-ducks.png (big ducks on light and dark, plus the small 26px size used in lists).
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
;(async () => {
  const { duck, ACCESSORIES, DUCK_COLORS } = await import(path.join(__dirname, '..', 'chatzer', 'js', 'duck.js'))
  const out = path.join(__dirname, '..', 'screenshots')
  fs.mkdirSync(out, { recursive: true })
  const colors = DUCK_COLORS.map((c) => c.id)
  const big = ACCESSORIES.map((a, i) => `<figure>${duck({ color: colors[i % colors.length], accessory: a.id }, 140)}<figcaption>${a.label}</figcaption></figure>`).join('')
    + `<figure>${duck({ color: 'sun' }, 140, { crown: true })}<figcaption>כתר (מנהלת)</figcaption></figure>`
  const dark = ACCESSORIES.slice(0, 6).map((a, i) => duck({ color: colors[(i + 2) % colors.length], accessory: a.id }, 70)).join('')
  const small = ACCESSORIES.map((a, i) => duck({ color: colors[i % colors.length], accessory: a.id }, 26)).join('')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 980, height: 900 }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0;font-family:sans-serif;background:#FFF8EC;direction:rtl">
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px">${big}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;margin:0 10px;background:#2A261D;border-radius:12px">${dark}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;align-items:center">${small}<span style="font-size:13px">← בגודל של רשימה</span></div>
    <style>figure{margin:0;width:156px;padding:6px;text-align:center;border:1px solid #E6D9BF;border-radius:12px;background:#fff}figcaption{font-size:14px}</style></body>`)
  await page.screenshot({ path: path.join(out, 'chatzer-ducks.png'), fullPage: true })
  await browser.close()
  console.log('screenshots/chatzer-ducks.png')
})()
