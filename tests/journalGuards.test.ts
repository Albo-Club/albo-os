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
 * source file that writes a journaled table directly (`db.insert` /
 * `db.patch` / `db.replace` on it) must also call the journal's logger, or
 * be listed in EXEMPT with the reason it legitimately writes without one.
 * Adding a table to the journal (reports, vault, identity…) is one entry in
 * JOURNALED; the guard then names every writer that needs wiring.
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
}

/**
 * Files that write a journaled table WITHOUT logging, each with the reason.
 * A new entry is a deliberate call, not a way to silence the test: it means
 * the write has no author and no reader in the journal (a one-shot import,
 * a seed) — never a feature a user drives.
 */
const EXEMPT: Record<string, string> = {
  'airtableImport.ts': 'one-shot historical import, no user gesture behind it',
  'seed.ts': 'seeds a fresh deployment, nothing to journal',
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

      it(`${name}: writes \`${table}\`, so it journals (or is exempt)`, () => {
        if (name in EXEMPT) {
          assert.ok(EXEMPT[name].length > 0)
          return
        }
        assert.ok(
          loggers.some((call) => source.includes(call)),
          `${name} writes \`${table}\` without calling ${loggers.join(' / ')} — ` +
            'wire the journal (convex/lib/companyEvents.ts) or add the file ' +
            'to EXEMPT with its reason',
        )
      })
    }
  }
})
