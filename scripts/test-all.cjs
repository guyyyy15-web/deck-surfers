// Runs every suite one after another and prints one labelled line each, so a missing result can't hide.
//   npm run test:all
const { spawnSync } = require('child_process')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const suites = [
  ['unit', 'npm', ['test'], ROOT],
  ['server', 'npm', ['test'], path.join(ROOT, 'server')],
  ['smoke iPhone', 'node', ['scripts/smoke.cjs'], ROOT],
  ['smoke Android', 'node', ['scripts/smoke.cjs'], ROOT, { DEVICE: 'Pixel 7' }],
  ['sync (2–4 phones)', 'node', ['scripts/sync-smoke.cjs'], ROOT],
  ['groups (3 phones + push)', 'node', ['scripts/groups-smoke.cjs'], ROOT],
  ['upgrade (existing users)', 'node', ['scripts/upgrade-smoke.cjs'], ROOT],
  ['החצר (3 phones)', 'node', ['scripts/chatzer-smoke.cjs'], ROOT],
]
let failed = 0
for (const [name, cmd, args, cwd, env] of suites) {
  const t0 = Date.now()
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15 * 60e3 })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const ok = r.status === 0 && (/all good/.test(out) || /# fail 0/.test(out))
  console.log(`${ok ? '✅' : '❌'} ${name} (${Math.round((Date.now() - t0) / 1000)} s)`)
  if (!ok) {
    failed++
    console.log(out.split('\n').filter((l) => /FAIL|not ok|Error|Timeout/.test(l)).slice(0, 5).map((l) => `   ${l}`).join('\n'))
  }
}
process.exit(failed ? 1 : 0)
