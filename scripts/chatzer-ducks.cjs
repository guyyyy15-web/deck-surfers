// A sheet of duckling looks, to check by eye that everything sits right: node scripts/chatzer-ducks.cjs
// → screenshots/chatzer-ducks.png: moods, every item of every slot, full outfits, a dark row, and list size.
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
;(async () => {
  const { duck, SLOTS, MOODS, DUCK_COLORS } = await import(path.join(__dirname, '..', 'chatzer', 'js', 'duck.js'))
  const out = path.join(__dirname, '..', 'screenshots')
  fs.mkdirSync(out, { recursive: true })
  const colors = DUCK_COLORS.map((c) => c.id)
  const cell = (look, caption, size = 104, opts) => `<figure>${duck(look, size, opts)}<figcaption>${caption}</figcaption></figure>`
  const row = (title, cells) => `<h3>${title}</h3><div class="row">${cells}</div>`
  let html = row('הבעות וצבעים', MOODS.map((m, i) => cell({ color: colors[i], mood: m.id }, m.label)).join('') + cell({ color: 'white' }, 'לבן') + cell({ color: 'cocoa' }, 'שוקו'))
  for (const [slot, def] of Object.entries(SLOTS)) {
    html += row(def.label, def.items.slice(1).map((it, i) => cell({ color: colors[i % colors.length], [slot]: it.id, bodyColor: ['red', 'blue', 'green', 'purple', 'pink', 'denim'][i % 6] }, it.label)).join(''))
  }
  const outfits = [
    [{ color: 'sun', hat: 'chef', body: 'apron', bodyColor: 'red', held: 'spatula', mood: 'happy' }, 'שף'],
    [{ color: 'pink', hat: 'bow', face: 'hearts', neck: 'pearls', body: 'dress', bodyColor: 'purple', held: 'balloon' }, 'מסיבה'],
    [{ color: 'sky', hat: 'beanie', neck: 'scarf', body: 'raincoat', mood: 'shy' }, 'חורף'],
    [{ color: 'mint', face: 'shades', body: 'hoodie', bodyColor: 'black', held: 'phone', mood: 'cool' }, 'קול'],
    [{ color: 'lilac', hat: 'tophat', face: 'round', neck: 'bowtie', body: 'tshirt', bodyColor: 'blue', held: 'coffee' }, 'ג׳נטלמן'],
    [{ color: 'peach', hat: 'phones', body: 'cape', bodyColor: 'red', mood: 'wow', held: 'broom' }, 'גיבורת ניקיון'],
    [{ color: 'cocoa', hat: 'ears', body: 'overalls', held: 'flowers', mood: 'wink' }, 'סרבל'],
    [{ color: 'sun', face: 'stars', neck: 'tie', body: 'sweater', bodyColor: 'green', mood: 'sleepy' }, 'עייף'],
  ]
  html += row('שילובים (כמה אביזרים יחד)', outfits.map(([l, c]) => cell(l, c, 120)).join('') + cell({ color: 'sun', face: 'shades', neck: 'scarf' }, 'כתר + אביזרים', 120, { crown: true }))
  const dark = outfits.slice(0, 6).map(([l]) => duck(l, 64)).join('')
  const small = outfits.map(([l]) => duck(l, 26)).join('') + duck({}, 26) + duck({ color: 'pink' }, 22)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0;font-family:sans-serif;background:#FFF8EC;direction:rtl;padding:6px 10px">${html}
    <h3>רקע כהה</h3><div class="row" style="background:#2A261D;border-radius:12px;padding:8px">${dark}</div>
    <h3>בגודל של רשימה (26px)</h3><div class="row" style="align-items:center">${small}</div>
    <style>h3{margin:10px 0 4px;font-size:15px}.row{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:${120}px;padding:4px;text-align:center;border:1px solid #E6D9BF;border-radius:12px;background:#fff}figcaption{font-size:13px}</style></body>`)
  await page.screenshot({ path: path.join(out, 'chatzer-ducks.png'), fullPage: true })
  await browser.close()
  console.log('screenshots/chatzer-ducks.png')
})()
