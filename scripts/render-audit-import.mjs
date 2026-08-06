#!/usr/bin/env node
// Turn the Airtable-import audit into a page you can read while you correct.
//
// The audit itself lives in Convex (`migrations/auditAirtableImport:report`)
// and returns JSON — fine for a machine, unreadable when the queue is forty
// deals long and each one has to be judged on its movements. This renders it
// as a single self-contained HTML file: the queue top-down by amount, each
// deal with its disbursement clusters, its movements, and a link straight to
// its sheet in the app.
//
// Usage:
//   pnpm exec convex run --prod migrations/auditAirtableImport:report > audit-import.json
//   node scripts/render-audit-import.mjs audit-import.json
//   node scripts/render-audit-import.mjs audit-import.json --base=http://localhost:3000
//
// Writes <input>.html next to the input file and prints its path.
//
// Exit codes:
//   0   page written
//   1   missing / unreadable / non-JSON input

import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_BASE = 'https://alboteam.com'

const args = process.argv.slice(2)
const inputPath = args.find((a) => !a.startsWith('--'))
const base = (
  args.find((a) => a.startsWith('--base='))?.slice(7) ?? DEFAULT_BASE
).replace(/\/$/, '')

if (!inputPath) {
  console.error(
    'usage: node scripts/render-audit-import.mjs <audit.json> [--base=URL]',
  )
  process.exit(1)
}

let audit
try {
  const raw = readFileSync(inputPath, 'utf8')
  // `convex run` may print a log line before the payload — start at the JSON.
  const start = raw.indexOf('{')
  if (start === -1) throw new Error('no JSON object found')
  audit = JSON.parse(raw.slice(start))
} catch (err) {
  console.error(`[audit] cannot read ${inputPath}: ${err.message}`)
  process.exit(1)
}

const FLAG_LABELS = {
  to_split: 'À découper',
  intragroup: 'Intragroupe',
  duplicate_target: 'Cible en double',
  pointing_gap: 'Écart de pointage',
  no_movement: 'Sans mouvement',
}

const FLAG_HELP = {
  to_split:
    'Les décaissements forment plusieurs grappes espacées, ou les libellés parlent de choses différentes : ce deal en agrège probablement plusieurs.',
  intragroup:
    "La cible porte le nom d'une entité du groupe : c'est du compte courant intragroupe, pas un investissement.",
  duplicate_target: 'Plusieurs fiches société portent ce nom.',
  pointing_gap:
    'Le montant du deal ne correspond pas à la somme de ses mouvements pointés : la différence flotte dans la file de pointage.',
  no_movement: "Aucun mouvement n'est rattaché à ce deal.",
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )

const eur = (cents) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format((cents ?? 0) / 100)

const day = (ms) =>
  ms == null ? '—' : new Intl.DateTimeFormat('fr-FR').format(new Date(ms))

const { summary, deals, duplicateCompanies, thresholds } = audit
const orgSlug = audit.org.slug
const dealUrl = (id) => `${base}/app/${orgSlug}/deals/${id}`
const companyUrl = (id) => `${base}/app/${orgSlug}/participations/${id}`

const flagged = deals.filter((d) => d.flags.length > 0)
const clean = deals.filter((d) => d.flags.length === 0)

const movementRows = (movements, clusters) =>
  movements
    .map((m) => {
      // Mark the first movement of each cluster after the first — that's the
      // line where a split would cut.
      const boundary =
        m.direction === 'out' &&
        clusters.slice(1).some((c) => c.from === m.date) &&
        clusters.length > 1
      return `<tr class="${boundary ? 'boundary' : ''}">
        <td class="date">${day(m.date)}</td>
        <td class="dir ${m.direction}">${m.direction === 'out' ? '↑ sortie' : '↓ entrée'}</td>
        <td class="num">${eur(m.amount)}</td>
        <td>${esc(m.label)}</td>
      </tr>`
    })
    .join('')

const dealCard = (d) => `
<article class="deal" id="${esc(d.id)}">
  <header>
    <h3><a href="${dealUrl(d.id)}" target="_blank" rel="noreferrer">${esc(d.target ?? '(cible inconnue)')}</a>
      <span class="instrument">${esc(d.instrument)}</span>
      <span class="status">${esc(d.status)}</span>
    </h3>
    <div class="flags">${d.flags
      .map(
        (f) =>
          `<span class="flag ${f}" title="${esc(FLAG_HELP[f] ?? '')}">${esc(FLAG_LABELS[f] ?? f)}</span>`,
      )
      .join('')}</div>
  </header>
  <dl class="figures">
    <div><dt>Montant du deal</dt><dd>${eur(d.paidAmount)}</dd></div>
    <div><dt>Somme des mouvements pointés</dt><dd>${eur(d.paidActual)}</dd></div>
    ${d.pointingGap !== 0 ? `<div class="gap"><dt>Écart</dt><dd>${eur(d.pointingGap)}</dd></div>` : ''}
    <div><dt>Reçu</dt><dd>${eur(d.received)}</dd></div>
    <div><dt>Mouvements</dt><dd>${d.counts.movements} (${d.counts.out} sorties / ${d.counts.in} entrées)</dd></div>
  </dl>
  ${
    d.clusters.length
      ? `<p class="clusters">${d.clusters
          .map(
            (c) =>
              `<span class="cluster">${day(c.from)}${c.from === c.to ? '' : ` → ${day(c.to)}`} · ${c.count} mvt · ${eur(c.total)}</span>`,
          )
          .join('')}</p>`
      : ''
  }
  ${
    d.movements.length
      ? `<table class="movements">
          <thead><tr><th>Date</th><th>Sens</th><th>Montant</th><th>Libellé</th></tr></thead>
          <tbody>${movementRows(d.movements, d.clusters)}</tbody>
        </table>
        ${d.movementsOmitted ? `<p class="muted">… ${d.movementsOmitted} mouvement(s) de plus, non listés.</p>` : ''}`
      : '<p class="muted">Aucun mouvement rattaché.</p>'
  }
  ${
    d.orphanCandidates.length
      ? `<details class="orphans">
          <summary>${d.orphanCandidates.length} mouvement(s) non pointé(s) au nom de cette société — candidats à rattacher</summary>
          <table class="movements">
            <thead><tr><th>Date</th><th>Sens</th><th>Montant</th><th>Libellé</th></tr></thead>
            <tbody>${movementRows(d.orphanCandidates, [])}</tbody>
          </table>
          ${d.orphanCandidatesOmitted ? `<p class="muted">… ${d.orphanCandidatesOmitted} de plus.</p>` : ''}
        </details>`
      : ''
  }
</article>`

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit de l'import Airtable — ${esc(orgSlug)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.5rem 6rem; font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif; color: #18181b; background: #fafafa; }
  main { max-width: 60rem; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 3rem 0 1rem; padding-bottom: .5rem; border-bottom: 1px solid #e4e4e7; }
  h3 { font-size: 1rem; margin: 0; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  a { color: #18181b; }
  .muted { color: #71717a; font-size: .85rem; }
  .lede { color: #52525b; margin: 0 0 2rem; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
  .tile { background: #fff; border: 1px solid #e4e4e7; border-radius: .5rem; padding: .75rem .9rem; }
  .tile .v { font-size: 1.4rem; font-weight: 600; }
  .tile .k { font-size: .75rem; color: #71717a; text-transform: uppercase; letter-spacing: .04em; }
  .deal { background: #fff; border: 1px solid #e4e4e7; border-radius: .5rem; padding: 1rem 1.1rem; margin-bottom: 1rem; }
  .deal header { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  .instrument, .status { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #71717a; border: 1px solid #e4e4e7; border-radius: .25rem; padding: .1rem .35rem; font-weight: 500; }
  .flags { display: flex; gap: .35rem; flex-wrap: wrap; }
  .flag { font-size: .72rem; font-weight: 600; border-radius: .25rem; padding: .15rem .45rem; cursor: help; }
  .flag.to_split { background: #fef3c7; color: #92400e; }
  .flag.intragroup { background: #dbeafe; color: #1e40af; }
  .flag.duplicate_target { background: #ede9fe; color: #5b21b6; }
  .flag.pointing_gap { background: #fee2e2; color: #991b1b; }
  .flag.no_movement { background: #f4f4f5; color: #52525b; }
  .figures { display: flex; flex-wrap: wrap; gap: 0 1.75rem; margin: .9rem 0 .5rem; }
  .figures div { margin: 0; }
  .figures dt { font-size: .7rem; color: #71717a; text-transform: uppercase; letter-spacing: .04em; }
  .figures dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 500; }
  .figures .gap dd { color: #b91c1c; }
  .clusters { display: flex; gap: .4rem; flex-wrap: wrap; margin: .25rem 0 .75rem; }
  .cluster { font-size: .75rem; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: .25rem; padding: .1rem .4rem; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th { text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #71717a; font-weight: 500; padding: .3rem .5rem; }
  td { padding: .3rem .5rem; border-top: 1px solid #f4f4f5; }
  td.num, td.date { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.num { text-align: right; }
  td.dir.out { color: #b91c1c; } td.dir.in { color: #15803d; }
  tr.boundary td { border-top: 2px solid #fbbf24; }
  .orphans { margin-top: .9rem; }
  .orphans summary { cursor: pointer; font-size: .85rem; color: #b91c1c; }
  .dups li { margin-bottom: .5rem; }
  details.clean summary { cursor: pointer; font-weight: 500; }
  .scroll { overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>Audit de l'import Airtable — org ${esc(orgSlug)}</h1>
  <p class="lede">Les deals issus de l'import, triés par montant. Ceux qui portent un
  drapeau demandent une décision ; les autres sont propres et peuvent être ignorés.
  Une grappe de décaissement = des versements espacés de moins de ${thresholds.clusterGapDays} jours.</p>

  <div class="tiles">
    <div class="tile"><div class="v">${summary.dealsFromImport}</div><div class="k">deals importés</div></div>
    <div class="tile"><div class="v">${summary.flagged}</div><div class="k">à regarder</div></div>
    <div class="tile"><div class="v">${summary.clean}</div><div class="k">propres</div></div>
    <div class="tile"><div class="v">${eur(summary.flaggedPaidTotal)}</div><div class="k">montant concerné</div></div>
    <div class="tile"><div class="v">${eur(summary.importedPaidTotal)}</div><div class="k">montant importé</div></div>
  </div>

  <h2>File de travail — ${flagged.length} deal(s)</h2>
  <p class="muted">${Object.entries(summary.byFlag)
    .map(([f, n]) => `${esc(FLAG_LABELS[f] ?? f)} : ${n}`)
    .join(' · ')}</p>
  ${flagged.map(dealCard).join('')}

  <h2>Fiches société en double — ${duplicateCompanies.length}</h2>
  ${
    duplicateCompanies.length
      ? `<ul class="dups">${duplicateCompanies
          .map(
            (g) =>
              `<li><strong>${esc(g.rows[0].name)}</strong><br>${g.rows
                .map(
                  (r) =>
                    `<a href="${companyUrl(r.id)}" target="_blank" rel="noreferrer">${esc(r.kind)}</a> — ${r.deals} deal(s)${r.fromImport ? " — issue de l'import" : ''}`,
                )
                .join('<br>')}</li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">Aucune.</p>'
  }

  <h2>Deals propres — ${clean.length}</h2>
  <details class="clean">
    <summary>Afficher (aucune action attendue)</summary>
    <div class="scroll">
      <table>
        <thead><tr><th>Société</th><th>Instrument</th><th>Montant</th><th>Mouvements</th></tr></thead>
        <tbody>${clean
          .map(
            (d) =>
              `<tr><td><a href="${dealUrl(d.id)}" target="_blank" rel="noreferrer">${esc(d.target ?? '—')}</a></td><td>${esc(d.instrument)}</td><td class="num">${eur(d.paidAmount)}</td><td class="num">${d.counts.movements}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>
  </details>
</main>
</body>
</html>`

const outPath = inputPath.replace(/\.json$/, '') + '.html'
writeFileSync(outPath, html, 'utf8')
console.log(outPath)
