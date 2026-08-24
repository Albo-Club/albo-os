#!/usr/bin/env node
/**
 * SessionStart hook — say what is waiting for a human, then get out of the way.
 *
 * Prints nothing when the repo is clean, and the silence is the point: an
 * alert that fires every single session turns into wallpaper. That is exactly
 * how a `prod-smoke` issue collected 24 unread comments over 25 days while the
 * daily production check sat red — the notification worked, the destination
 * did not.
 *
 * Never fails a session: a missing `gh`, no network or an expired login all
 * exit 0 with no output. Losing the report is acceptable; blocking the start
 * of a session over it is not.
 *
 * Called directly with `node` rather than through `pnpm run` so it skips
 * pnpm's pre-script dependency check — the hook should cost milliseconds, not
 * an install probe. `pnpm run session:status` runs the same thing by hand.
 */

import { execFileSync } from 'node:child_process'

const REPO = 'Albo-Club/albo-os'

const gh = (args) => {
  try {
    return JSON.parse(
      execFileSync('gh', args, {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return null
  }
}

const daysAgo = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)

const prs =
  gh([
    'pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '20',
    '--json', 'number,title,author,createdAt',
  ]) ?? []

// Only the most recent run of each workflow counts: an old failure that has
// since gone green is history, not a pending problem.
const runs =
  gh([
    'run', 'list', '--repo', REPO, '--branch', 'main', '--limit', '40',
    '--json', 'name,conclusion,createdAt,url',
  ]) ?? []

const latestPerWorkflow = new Map()
for (const run of runs) {
  if (!latestPerWorkflow.has(run.name)) latestPerWorkflow.set(run.name, run)
}
const red = [...latestPerWorkflow.values()].filter((r) => r.conclusion === 'failure')

if (red.length === 0 && prs.length === 0) process.exit(0)

const lines = []

if (red.length > 0) {
  lines.push(`${red.length} workflow(s) currently red on main:`)
  for (const r of red) {
    lines.push(`  x ${r.name} — last run ${daysAgo(r.createdAt)}d ago — ${r.url}`)
  }
}

if (prs.length > 0) {
  if (lines.length > 0) lines.push('')
  lines.push(`${prs.length} open pull request(s):`)
  for (const pr of prs) {
    lines.push(`  - #${pr.number} ${pr.title} (${pr.author.login}, ${daysAgo(pr.createdAt)}d)`)
  }
}

console.log(lines.join('\n'))
