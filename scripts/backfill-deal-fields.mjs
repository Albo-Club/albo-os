#!/usr/bin/env node
/**
 * Backfill of the `companies` / `deals` fields from the Albo legal
 * documentation. Two modes, one file.
 *
 *   node scripts/backfill-deal-fields.mjs
 *       DRY-RUN (default). Walks the org's participations, has each source
 *       document read by the model, and writes a markdown report + a CSV of
 *       proposals. ZERO write — this mode never calls a mutation.
 *
 *   node scripts/backfill-deal-fields.mjs --apply <fichier.csv>
 *       Applies ONLY the lines carrying `1` in the `ok` column. The CSV of
 *       the dry-run IS the input file: open it in a spreadsheet, tick what
 *       you validate, save, pass it back.
 *
 * Replayable on the delta: extractions are cached in
 * `scripts/data/.backfill-cache.json`, keyed by document id + text hash, so a
 * re-run only pays for documents whose text changed (new upload, re-OCR).
 * Applying twice is a no-op — a line whose column no longer holds what the
 * dry-run saw is refused by `applyRows`.
 *
 * Options:
 *   --limit N        stop after N participations (smoke test)
 *   --company NAME   restrict to the participations whose name contains NAME
 *   --out DIR        where the report lands (default: ./backfill-out)
 *   --no-cache       ignore the cache and re-read every document
 *
 * Prerequisite: the Convex prod deploy key already configured for
 * `convex run --prod` (the model key lives in the Convex env — nothing to
 * export locally).
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const CACHE = new URL('./data/.backfill-cache.json', import.meta.url)

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const applyCsv = flag('--apply')
const limit = flag('--limit') ? Number(flag('--limit')) : Infinity
const companyFilter = flag('--company')
const outDir = flag('--out') ?? './backfill-out'
const useCache = !args.includes('--no-cache')

/** Mirrors MAX_EXTRACT_CHARS in convex/migrations/alboDocBackfill.ts. */
const MAX_EXTRACT_CHARS = 220_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** `convex run --prod <fn> <json>` → parsed stdout, retried on network faults. */
async function convex(fn, payload, attempt = 1) {
  try {
    const { stdout } = await run(
      'pnpm',
      ['exec', 'convex', 'run', '--prod', fn, JSON.stringify(payload)],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    const candidates = [stdout.indexOf('['), stdout.indexOf('{')].filter(
      (i) => i !== -1,
    )
    if (candidates.length === 0) return null
    return JSON.parse(stdout.slice(Math.min(...candidates)))
  } catch (err) {
    if (attempt >= 3) throw err
    const wait = attempt * 4000
    console.log(
      `    réseau instable (${fn}), nouvelle tentative dans ${wait / 1000}s…`,
    )
    await sleep(wait)
    return convex(fn, payload, attempt + 1)
  }
}

/**
 * FNV-1a over the document text. Not a security hash — a cache key: it only
 * has to change when the text changes, so a re-upload or a re-OCR re-triggers
 * the model call, and an untouched document is never paid for twice.
 */
function textHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}-${text.length}`
}

/**
 * Walks a document's text through the 40 000-char windows of `getDocText` and
 * glues it back together. Stops at MAX_EXTRACT_CHARS and says so — a document
 * silently cut in half would produce a cap table read from its first page.
 */
async function readText(documentId) {
  let text = ''
  let offset = 0
  while (offset !== null && text.length < MAX_EXTRACT_CHARS) {
    const page = await convex('migrations/alboDocBackfill:getDocText', {
      documentId,
      offset,
    })
    text += page.text
    offset = page.nextOffset
  }
  return { text, truncated: offset !== null }
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const COLUMNS = [
  'ok',
  'section',
  'entite',
  'entityType',
  'entityId',
  'champ',
  'valeur_actuelle',
  'valeur_proposee',
  'doc_source',
  'doc_id',
  'extrait',
  'derive',
  'flag',
]

const csvCell = (value) => {
  const s = String(value ?? '')
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (rows) =>
  [
    COLUMNS.join(','),
    ...rows.map((r) =>
      [
        '',
        r.section,
        r.entityLabel,
        r.entityType,
        r.entityId,
        r.field,
        r.currentValue,
        r.proposedValue,
        r.docTitle,
        r.docId,
        r.quote.replace(/\s+/g, ' ').slice(0, 400),
        r.derived ? 'oui' : 'non',
        r.flags.join(' | '),
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n')

/**
 * Minimal RFC-4180 parser — the file comes back from a spreadsheet, so it can
 * carry quoted cells containing commas, newlines and doubled quotes.
 */
function parseCsv(raw) {
  // A spreadsheet may re-save the file with a UTF-8 BOM; unstripped it would
  // turn the first header into `\ufeffok` and silently lose every tick.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (c === '"') quoted = false
      else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''))
  return body.map((r) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])),
  )
}

// ─── Markdown report ─────────────────────────────────────────────────────────

const SECTION_TITLES = {
  PROPOSITION: 'PROPOSITIONS — champ vide, valeur trouvée dans un document',
  ECART:
    'ÉCARTS — le document contredit une valeur déjà en base (jamais écrit automatiquement)',
  NON_TRAITE: 'NON TRAITÉ — avec motif',
}

const mdCell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')

function toMarkdown(rows, stats) {
  const lines = [
    '# Backfill deals & sociétés depuis la documentation juridique — org `albo`',
    '',
    `Généré le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    '## Résumé',
    '',
    `- participations parcourues : **${stats.companies}**`,
    `- documents lus par le modèle : **${stats.extracted}** (dont **${stats.cached}** repris du cache, **${stats.failed}** en échec)`,
    `- documents ignorés (nature non probante : bp, reporting, attestation, other) : **${stats.skippedKind}**`,
    `- documents ignorés (texte non extrait) : **${stats.skippedOcr}**`,
    `- valeurs extraites rejetées faute d'extrait verbatim : **${stats.droppedQuotes}**`,
    `- champs déjà conformes au document (rien à faire) : **${stats.confirmed}**`,
    '',
    `- propositions : **${rows.filter((r) => r.section === 'PROPOSITION').length}**`,
    `- écarts : **${rows.filter((r) => r.section === 'ECART').length}**`,
    `- non traités : **${rows.filter((r) => r.section === 'NON_TRAITE').length}**`,
    '',
    "> `companies.notes` n'est alimenté par aucune règle : les conventions arrêtées ne définissent pas ce qui doit y figurer. Le champ est donc laissé de côté (la note de base FD va, elle, dans les notes du **deal**).",
    '',
  ]
  for (const section of ['PROPOSITION', 'ECART', 'NON_TRAITE']) {
    const subset = rows.filter((r) => r.section === section)
    lines.push(`## ${SECTION_TITLES[section]}`, '')
    if (subset.length === 0) {
      lines.push('_Aucune ligne._', '')
      continue
    }
    lines.push(
      '| entité | champ | valeur actuelle | valeur proposée | doc source | extrait justificatif | dérivé | flag |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const r of subset) {
      lines.push(
        `| ${mdCell(r.entityLabel)} | ${mdCell(r.field)} | ${mdCell(r.currentValue) || '—'} | ${mdCell(r.proposedValue) || '—'} | ${mdCell(r.docTitle) || '—'} | ${mdCell(r.quote.replace(/\s+/g, ' ').slice(0, 220)) || '—'} | ${r.derived ? 'oui' : 'non'} | ${mdCell(r.flags.join(' | ')) || '—'} |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

// ─── Dry-run ─────────────────────────────────────────────────────────────────

async function loadCache() {
  if (!useCache) return {}
  try {
    return JSON.parse(await readFile(CACHE, 'utf8'))
  } catch {
    return {}
  }
}

async function dryRun() {
  const cache = await loadCache()
  const { companies } = await convex(
    'migrations/alboDocBackfill:listTargets',
    {},
  )
  const selected = companies
    .filter(
      (c) =>
        !companyFilter ||
        c.companyName.toLowerCase().includes(companyFilter.toLowerCase()),
    )
    .slice(0, limit)

  const rows = []
  const stats = {
    companies: selected.length,
    extracted: 0,
    cached: 0,
    failed: 0,
    skippedKind: 0,
    skippedOcr: 0,
    droppedQuotes: 0,
    confirmed: 0,
  }

  for (const company of selected) {
    console.log(
      `\n▸ ${company.companyName} (${company.deals.length} deal(s), ${company.documents.length} doc(s))`,
    )

    if (company.deals.length === 0) {
      rows.push(notTreated(company, '*', 'aucun_deal_sur_cette_participation'))
      continue
    }

    // Read every source document once, whatever deal it ends up feeding.
    const byDocId = new Map()
    for (const doc of company.documents) {
      if (!doc.isSource) {
        stats.skippedKind += 1
        continue
      }
      if (doc.ocrState !== 'extracted') {
        stats.skippedOcr += 1
        rows.push(
          notTreated(
            company,
            '*',
            `texte_non_extrait:${doc.ocrState ?? 'jamais_analyse'}${doc.ocrDetail ? `:${doc.ocrDetail}` : ''}`,
            doc,
          ),
        )
        continue
      }
      const { text, truncated } = await readText(doc.documentId)
      const hash = textHash(text)
      const known = cache[doc.documentId]

      // The cache short-circuits BEFORE the model, not after: an unchanged
      // document costs one cheap text read and nothing else.
      if (useCache && known?.hash === hash) {
        stats.cached += 1
        console.log(`  · ${doc.title} — cache`)
        byDocId.set(doc.documentId, {
          ...known.extraction,
          documentId: doc.documentId,
          documentTitle: doc.title,
          documentKind: doc.kind,
        })
        continue
      }

      const res = await convex('migrations/alboDocBackfill:extractDocument', {
        text,
      })
      if (res.error || !res.extraction) {
        stats.failed += 1
        console.log(
          `  · ${doc.title} — ÉCHEC (${res.error ?? 'sans extraction'})`,
        )
        rows.push(
          notTreated(
            company,
            '*',
            `lecture_impossible:${res.error ?? 'sans_extraction'}`,
            doc,
          ),
        )
        continue
      }
      stats.extracted += 1
      stats.droppedQuotes += res.dropped.length
      console.log(
        `  · ${doc.title} — lu${res.dropped.length ? ` (${res.dropped.length} valeur(s) sans extrait rejetée(s))` : ''}${truncated ? ' [texte tronqué]' : ''}`,
      )
      cache[doc.documentId] = { hash, extraction: res.extraction }
      byDocId.set(doc.documentId, {
        ...res.extraction,
        documentId: doc.documentId,
        documentTitle: doc.title,
        documentKind: doc.kind,
      })
    }

    const single = company.deals.length === 1
    for (const deal of company.deals) {
      // A document tied to a deal feeds that deal; an unattached one feeds the
      // deal only when there is exactly one — never guess which round a pacte
      // belongs to.
      const extractions = company.documents
        .filter(
          (d) =>
            byDocId.has(d.documentId) &&
            (d.dealId === deal.dealId || (d.dealId === null && single)),
        )
        .map((d) => byDocId.get(d.documentId))

      if (extractions.length === 0) {
        rows.push(
          notTreated(
            company,
            '*',
            single
              ? 'aucun_document_source_exploitable'
              : 'plusieurs_deals_documents_non_rattaches',
            null,
            deal,
          ),
        )
        continue
      }
      const planned = await convex('migrations/alboDocBackfill:planForDeal', {
        companyId: company.companyId,
        dealId: deal.dealId,
        extractions,
      })
      rows.push(...planned.rows)
      stats.confirmed += planned.confirmed.length
    }
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(CACHE, JSON.stringify(cache, null, 1))
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
  const base = `${outDir}/backfill-albo-${stamp}`
  await writeFile(`${base}.csv`, toCsv(rows))
  await writeFile(`${base}.md`, toMarkdown(rows, stats))

  console.log(`\n${'─'.repeat(60)}`)
  console.log(
    `Propositions : ${rows.filter((r) => r.section === 'PROPOSITION').length}`,
  )
  console.log(
    `Écarts       : ${rows.filter((r) => r.section === 'ECART').length}`,
  )
  console.log(
    `Non traités  : ${rows.filter((r) => r.section === 'NON_TRAITE').length}`,
  )
  console.log(`\nRapport : ${base}.md`)
  console.log(`CSV     : ${base}.csv`)
  console.log(`\nMets 1 dans la colonne « ok » sur les lignes validées, puis :`)
  console.log(`  node scripts/backfill-deal-fields.mjs --apply ${base}.csv`)
}

function notTreated(company, field, reason, doc = null, deal = null) {
  return {
    section: 'NON_TRAITE',
    entityType: deal ? 'deal' : 'company',
    entityId: deal ? deal.dealId : company.companyId,
    entityLabel: deal ? deal.label : company.companyName,
    field,
    currentValue: '',
    proposedValue: '',
    docId: doc?.documentId ?? '',
    docTitle: doc?.title ?? '',
    quote: '',
    derived: false,
    flags: [reason],
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

async function apply() {
  const rows = parseCsv(await readFile(applyCsv, 'utf8'))
  const validated = rows.filter((r) => String(r.ok).trim() === '1')
  if (validated.length === 0) {
    console.log('Aucune ligne cochée `ok=1` — rien à appliquer.')
    return
  }
  const unusable = validated.filter(
    (r) => r.section === 'NON_TRAITE' || r.valeur_proposee === '',
  )
  if (unusable.length > 0) {
    console.log(
      `⚠️  ${unusable.length} ligne(s) cochée(s) sans valeur proposée — ignorée(s).`,
    )
  }
  const writable = validated.filter(
    (r) => r.section !== 'NON_TRAITE' && r.valeur_proposee !== '',
  )
  const ecarts = writable.filter((r) => r.section === 'ECART')
  if (ecarts.length > 0) {
    console.log(
      `⚠️  ${ecarts.length} ligne(s) en ÉCART cochée(s) : elles ÉCRASENT une valeur existante. Elles ne passeront que si la base porte toujours exactement la valeur vue au dry-run.`,
    )
  }

  const mapRow = (r) => ({
    entityId: r.entityId,
    field: r.champ,
    value: r.valeur_proposee,
    expectedCurrent: r.valeur_actuelle,
  })
  const companyRows = writable
    .filter((r) => r.entityType === 'company')
    .map(mapRow)
  const dealRows = writable.filter((r) => r.entityType === 'deal').map(mapRow)

  console.log(
    `Application de ${companyRows.length} champ(s) société et ${dealRows.length} champ(s) deal…\n`,
  )
  const res = await convex('migrations/alboDocBackfill:applyRows', {
    companyRows,
    dealRows,
  })
  for (const line of res.results) console.log(line)
  console.log(`\n✅ appliqué : ${res.applied} — ⏭️  ignoré : ${res.skipped}`)
}

await (applyCsv ? apply() : dryRun())
