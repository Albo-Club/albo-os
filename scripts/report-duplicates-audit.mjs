#!/usr/bin/env node
/**
 * Calibration of the duplicate detector, over everything already filed.
 *
 * Replays `convex/lib/reportDuplicate.ts` on the history: each report against
 * the ones the entity already carried when it arrived. What comes back says
 * what the pipeline WOULD do today — how many documents it would merge in
 * silence, and how many mails it would park in the review queue.
 *
 * How to read it: on a base whose fiches are right, the only expected
 * certainties are the documents that really were filed twice (QOMON and WARO,
 * 09/2026). Any other `certain` line is a false positive, and the threshold
 * has to move before this ships. A long list of `doute` is not a bug but a
 * chore — that is the queue a human would have to sort.
 *
 * Read-only: one internal query (`migrations/duplicateAudit`), no mutation.
 * Running it twice changes nothing.
 *
 * Prerequisite: the Convex prod deploy key already configured for
 * `convex run --prod` (same as the other scripts here).
 *
 * Usage:
 *   node scripts/report-duplicates-audit.mjs
 *   node scripts/report-duplicates-audit.mjs --page 10
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const args = process.argv.slice(2)
const pageSize = Number(args[args.indexOf('--page') + 1]) || 15

async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 32 * 1024 * 1024 },
    )
    const candidates = [stdout.indexOf('['), stdout.indexOf('{')].filter((i) => i !== -1)
    return JSON.parse(stdout.slice(Math.min(...candidates)))
  } catch (err) {
    if (attempt >= 3) throw err
    const wait = attempt * 4000
    console.log(`    réseau instable, nouvelle tentative dans ${wait / 1000}s…`)
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const fmtSim = (s) => (s === null || s === undefined ? '—' : `${Math.round(s * 100)} %`)

const findings = []
let companies = 0
let reports = 0
let cursor = null

console.log('Rejeu du détecteur de doublons sur tout l’historique…\n')
for (;;) {
  const page = await convex('migrations/duplicateAudit:scanPage', {
    cursor,
    numItems: pageSize,
  })
  findings.push(...page.findings)
  companies += page.companies
  reports += page.reports
  process.stdout.write(`  ${companies} participations, ${reports} reports lus\r`)
  if (page.isDone) break
  cursor = page.cursor
}

const certain = findings.filter((f) => f.kind === 'duplicate')
const doubt = findings.filter((f) => f.kind === 'doubt')

console.log(`\n\n── Périmètre ──`)
console.log(`  ${companies} participations, ${reports} reports comparés`)

for (const [label, list] of [
  ['Doublons certains (rangés en silence)', certain],
  ['Doutes (mis en attente d’un humain)', doubt],
]) {
  console.log(`\n── ${label} : ${list.length} ──`)
  for (const f of list) {
    console.log(
      `  ${f.company} — ${fmtSim(f.similarity)} (${f.reason})\n` +
        `      reçu   : « ${f.incoming.title ?? 'sans titre'} » ${f.incoming.period ?? 'sans période'} · ${fmtDate(f.incoming.emailDate)}\n` +
        `      jumeau : « ${f.twin.title ?? 'sans titre'} » ${f.twin.period ?? 'sans période'} · ${fmtDate(f.twin.emailDate)}`,
    )
  }
}

console.log(
  `\nRappel : hors QOMON et WARO (09/2026), toute ligne « certaine » est un faux positif — remonter le seuil avant de merger.`,
)
