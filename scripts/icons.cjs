// Renders icons/icon.svg to the PNG sizes iOS and the manifest need: node scripts/icons.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
;(async () => {
  const dir = path.join(__dirname, '..', 'icons')
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  // iOS rounds the corners itself, and maskable icons need a full bleed, so those two are square.
  for (const [name, size, square] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
    const body = square ? svg.replace('rx="112"', 'rx="0"') : svg
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${body}`)
    await page.screenshot({ path: path.join(dir, name), omitBackground: true })
  }
  await browser.close()
})()
