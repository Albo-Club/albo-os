/**
 * Guards the activity journal of the company sheet (`companyEvents`).
 *
 * The journal derives nothing: a write that does not call the logger is
 * simply invisible, with no error anywhere. So the risk is not a bug, it is
 * a silent gap the next feature opens — a new mutation on `deals` (a bridge,
 * an import, a dialog) that nobody thought to journal. The Parallel/VASCO
 * bridge was exactly that gap the day this guard was written.
 *
 * The rule is mechanical, so it is tested rather than documented: every
 * top-level block of the backend (a mutation, a helper) that writes a
 * journaled table directly (`db.insert` / `db.patch` / `db.replace` on it)
 * must call the journal's logger in that same block, or be listed in EXEMPT
 * with the reason it legitimately writes without one. The check is per
 * BLOCK, not per file: a file that journals in one mutation says nothing
 * about the next mutation added to it. Adding a table to the journal
 * (reports, vault, identity…) is one entry in JOURNALED; the guard then
 * names every block that needs wiring.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'

const CONVEX_DIR = join(dirname(fileURLToPath(import.meta.url)), '../convex')

/**
 * Tables whose writes must land in the journal, with the logger calls that
 * prove a file journals them. `diffDealPatch` counts: a file that diffs a
 * patch only does so to log it.
 */
const JOURNALED: Record<string, Array<string>> = {
  deals: ['logDealEvent(', 'diffDealPatch('],
  companyReports: ['logCompanyEvent('],
  documents: ['logDealEvent(', 'logCompanyEvent('],
  companies: ['logCompanyEvent(', 'diffCompanyPatch('],
  kpiSnapshots: ['logCompanyEvent('],
  dealProjections: ['logDealEvent('],
}

/**
 * Blocks (`file#name`) or whole files that write a journaled table WITHOUT
 * logging, each with the reason. A new entry is a deliberate call, not a way
 * to silence the test: it means the write has no author and no reader in the
 * journal (a one-shot import, a seed) — never a feature a user drives.
 */
const EXEMPT: Record<string, string> = {
  'airtableImport.ts': 'one-shot historical import, no user gesture behind it',
  'seed.ts': 'seeds a fresh deployment, nothing to journal',
  'regression.setup.ts': 'test fixtures, never run against prod data',
  // Derived or automatic writes on the company row — the sheet shows them,
  // but nobody made them: journaling them would bury the human gestures
  // under « Albo OS edited the summary » on every sync.
  'lib/reportFreshness.ts': 'last report dates, derived from companyReports',
  'lib/pitch.ts#applyPitchToDomainGroup':
    'pitch propagated to same-domain siblings — journaled on the edited one',
  'companyEnrichment.ts#applyEnrichment':
    'pitch auto-filled from the website, no gesture behind it',
  'companyEnrichment.ts#applyVascoPitch':
    'pitch generated from the Parallel communications',
  // Pipeline bookkeeping on rows the journal already covers at filing time:
  // reading / indexing / classification state, never what the sheet shows.
  'vectorize.ts#setReportState': 'semantic-index state of a report',
  'vectorize.ts#setDocumentState': 'semantic-index state of a document',
  'documents.ts#reextract': 'resets the OCR state before a re-read',
  'documents.ts#reindex': 'resets the index state before a re-index',
  'documentsExtract.ts#setState': 'OCR outcome of a read',
  'documentsExtract.ts#sweepStalePending':
    'expires OCR reads that never came back',
  'documentsClassify.ts#apply':
    'automatic kind on a fresh upload — the add event already names the filing',
}

/** Directories whose files never run against prod data on a user's behalf. */
const SKIPPED_DIRS = new Set(['_generated', 'migrations', 'mcp'])

function sourceFiles(dir: string): Array<string> {
  const out: Array<string> = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) out.push(...sourceFiles(path))
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(path)
    }
  }
  return out
}

function writesTable(source: string, table: string): boolean {
  return new RegExp(`db\\.(insert|patch|replace)\\(\\s*['"]${table}['"]`).test(
    source,
  )
}

/**
 * Top-level declarations of a prettier-formatted module: every `const`,
 * `function` or `async function` that starts at column 0 opens a block that
 * runs to the next one. Imports and comments before the first form the
 * unnamed preamble, which never writes anything.
 */
function topLevelBlocks(source: string): Array<{ name: string; body: string }> {
  const starts = [
    ...source.matchAll(
      /^(?:export )?(?:const|async function|function) (\w+)/gm,
    ),
  ]
  return starts.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index, starts[i + 1]?.index ?? source.length),
  }))
}

describe('company journal — every writer of a journaled table logs to it', () => {
  const files = sourceFiles(CONVEX_DIR)

  it('finds the backend to check (guards against a moved directory)', () => {
    assert.ok(
      files.some((f) => f.endsWith('/deals.ts')),
      'convex/deals.ts not found',
    )
    assert.ok(files.length > 50, `only ${files.length} files found`)
  })

  for (const [table, loggers] of Object.entries(JOURNALED)) {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!writesTable(source, table)) continue
      const name = relative(CONVEX_DIR, file)

      for (const block of topLevelBlocks(source)) {
        if (!writesTable(block.body, table)) continue
        const key = `${name}#${block.name}`

        it(`${key}: writes \`${table}\`, so it journals (or is exempt)`, () => {
          const exempt = name in EXEMPT ? name : key in EXEMPT ? key : null
          if (exempt) {
            assert.ok(EXEMPT[exempt].length > 0)
            return
          }
          assert.ok(
            loggers.some((call) => block.body.includes(call)),
            `${key} writes \`${table}\` without calling ${loggers.join(' / ')} — ` +
              'wire the journal (convex/lib/companyEvents.ts) or add the block ' +
              'to EXEMPT with its reason',
          )
        })
      }
    }
  }
})
