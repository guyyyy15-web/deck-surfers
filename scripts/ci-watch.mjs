#!/usr/bin/env node
// Watches the latest CI run for a commit and never waits forever.
//   node scripts/ci-watch.mjs [sha] [--stall=6] [--deadline=25]
// Prints each step as it starts and finishes. Exits:
//   0  all jobs succeeded
//   1  a job failed or was cancelled (prints the failing steps)
//   2  a step ran longer than --stall minutes (likely stuck: investigate / cancel)
//   3  the whole run took longer than --deadline minutes, or no run appeared
// Uses the public GitHub API through curl (curl honours HTTPS_PROXY; Node's fetch does not), every 30 s.
import { execSync, execFileSync } from 'node:child_process'

const REPO = 'guyyyy15-web/deck-surfers'
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')))
// The API matches only full hashes, so resolve short ones (and default to HEAD).
const sha = execSync(`git rev-parse ${process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD'}`).toString().trim()
const STALL = Number(args.stall || 6) * 60e3
const DEADLINE = Number(args.deadline || 25) * 60e3
const API = `https://api.github.com/repos/${REPO}/actions`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// Transient network or API errors are retried; only a run that stays unreachable ends the watch.
let failures = 0
const get = async (url) => {
  for (;;) {
    try {
      const out = execFileSync('curl', ['-sS', '--fail-with-body', '--max-time', '20', '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: ci-watch', url])
      failures = 0
      return JSON.parse(out.toString())
    } catch (e) {
      if (++failures >= 6) {
        console.log(`GitHub API unreachable 6 times in a row: ${String(e.stdout || e.message).slice(0, 200)}`)
        process.exit(3)
      }
      await wait(10e3)
    }
  }
}
const t0 = Date.now()
const mins = (ms) => `${(ms / 60e3).toFixed(1)}m`

let run
while (!run) {
  const { workflow_runs } = await get(`${API}/runs?head_sha=${sha}&per_page=5`)
  run = workflow_runs.find((r) => r.name === 'CI')
  if (!run) {
    if (Date.now() - t0 > 3 * 60e3) {
      console.log(`no CI run for ${sha.slice(0, 7)} after 3 minutes`)
      process.exit(3)
    }
    await wait(15e3)
  }
}
console.log(`CI run ${run.id} for ${sha.slice(0, 7)}: ${run.html_url}`)

const seen = new Map()
for (;;) {
  const { jobs } = await get(`${API}/runs/${run.id}/jobs`)
  for (const j of jobs) {
    for (const s of j.steps || []) {
      const key = `${j.name}/${s.number}`
      const state = `${s.status}:${s.conclusion}`
      if (seen.get(key) !== state && s.status !== 'queued' && s.status !== 'pending') {
        seen.set(key, state)
        console.log(`  ${j.name} › ${s.name.slice(0, 70)} … ${s.conclusion || s.status}`)
      }
      if (s.status === 'in_progress' && s.started_at && Date.now() - Date.parse(s.started_at) > STALL) {
        console.log(`\nSTALLED: "${j.name} › ${s.name}" running for ${mins(Date.now() - Date.parse(s.started_at))}`)
        console.log(`job ${j.id}: ${j.html_url}`)
        process.exit(2)
      }
    }
  }
  const done = jobs.length && jobs.every((j) => j.status === 'completed')
  if (done) {
    const bad = jobs.filter((j) => !['success', 'skipped'].includes(j.conclusion))
    if (!bad.length) {
      console.log(`\nCI green in ${mins(Date.now() - t0)}`)
      process.exit(0)
    }
    for (const j of bad) {
      console.log(`\nFAILED job ${j.name} (${j.conclusion}) id=${j.id}: ${j.html_url}`)
      for (const s of j.steps || []) if (s.conclusion === 'failure') console.log(`  failing step: ${s.name}`)
    }
    process.exit(1)
  }
  if (Date.now() - t0 > DEADLINE) {
    console.log(`\nDEADLINE: CI still running after ${mins(Date.now() - t0)}`)
    process.exit(3)
  }
  await wait(30e3)
}
