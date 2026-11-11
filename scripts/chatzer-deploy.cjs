// Publishes החצר to Cloudflare Pages (hechatzer.pages.dev): exactly the files sw.js caches, plus _headers.
//   npm run deploy:chatzer        (needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN, see CLAUDE.md)
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const SRC = path.join(__dirname, '..', 'chatzer')
const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8')
const files = JSON.parse(/const FILES = (\[[\s\S]*?\])/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*\]/, ']')).filter((f) => f !== './')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chatzer-site-'))
for (const f of [...files, 'sw.js', '_headers', 'fonts/FONTS-LICENSE.txt']) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true })
  fs.copyFileSync(path.join(SRC, f), path.join(out, f))
}
console.log(`${files.length + 3} files → ${out}`)
execFileSync('npx', ['wrangler', 'pages', 'deploy', out, '--project-name', 'hechatzer', '--branch', 'main', '--commit-dirty=true'],
  { cwd: path.join(__dirname, '..', 'server'), stdio: 'inherit' })
