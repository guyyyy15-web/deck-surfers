// Offline only works if the service worker caches every file the app loads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const sw = readFileSync(new URL('sw.js', root), 'utf8')
const listed = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\])/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'))

test('every app file is precached, and every precached file exists', () => {
  const files = ['index.html', 'manifest.webmanifest']
  for (const dir of ['css', 'js', 'fonts', 'icons']) for (const f of readdirSync(new URL(`${dir}/`, root))) files.push(`${dir}/${f}`)
  for (const f of files) assert.ok(listed.includes(f), `sw.js is missing ${f}`)
  for (const f of listed) if (f !== './') assert.ok(existsSync(new URL(f, root)), `sw.js lists a missing file ${f}`)
})

test('no absolute URLs (the app lives under /<repo>/ on GitHub Pages)', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8')
  assert.ok(!/(href|src)="\//.test(html))
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'))
  assert.equal(manifest.start_url, '.')
  for (const i of manifest.icons) assert.ok(existsSync(new URL(i.src, root)), i.src)
  for (const i of [...(manifest.screenshots || []), ...(manifest.shortcuts || []).flatMap((x) => x.icons)]) assert.ok(existsSync(new URL(i.src, root)), i.src)
  for (const sc of manifest.shortcuts || []) assert.ok(sc.url.startsWith('./#/'), `shortcut ${sc.url} stays inside the app`)
})

test('cache version matches the app version', () => {
  const app = readFileSync(new URL('js/app.js', root), 'utf8')
  const v = app.match(/APP_VERSION = '([^']+)'/)[1]
  assert.ok(sw.includes(`'nekamot-v${v}'`), 'bump VERSION in sw.js together with APP_VERSION')
})

test('the service worker leaves other pages under the same path alone (game/)', () => {
  assert.match(sw, /if \(rel !== '' && rel !== 'index.html' && !FILES.includes\(rel\)\) return/)
  assert.match(sw, /nekamot:\$\{SCOPE\}/)
})

test('the Content Security Policy allows the inline theme script (update the hash if it changes)', async () => {
  const html = readFileSync(new URL('index.html', root), 'utf8')
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(inline).digest('base64')
  assert.ok(csp.includes(`'sha256-${hash}'`), `CSP must include 'sha256-${hash}'`)
  assert.ok(csp.includes("connect-src 'self' https://nekamot-sync.guyyyy15-web.workers.dev"))
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'no unsafe-inline scripts')
})
