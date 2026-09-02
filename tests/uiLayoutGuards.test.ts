/**
 * Guards the fix for the overflow class of bug documented in KNOWN_ISSUES.md
 * § « `truncate` ne retient rien dans une boîte en `grid` ».
 *
 * A grid item has `min-width: auto` — its min-content size. Inside a
 * width-capped box (a dialog, a card header, an alert), one unbreakable token
 * therefore inflates the track past the cap and pushes EVERY child out of the
 * padding, footer buttons included. `truncate` on the text does not help: its
 * `overflow: hidden` zeroes the automatic minimum size of a flex/grid item,
 * not the min-content contribution that sizes the track.
 *
 * Two reasons this needs a test rather than a line of documentation:
 *
 * 1. `src/components/ui/*` is generated code. `pnpm dlx shadcn@latest add
 *    dialog` overwrites the file and silently drops the guard — the symptom
 *    comes back with nothing in the diff to explain it.
 * 2. Any NEW grid primitive pulled from the registry arrives with the same
 *    trap. Failing here forces the decision to be made once, in the open,
 *    instead of being rediscovered from a screenshot.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

const UI_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/components/ui',
)
const STYLES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/styles/app.css',
)

/** The guard a grid container must carry on its own class list. */
const GUARD = '[&>*]:min-w-0'

/**
 * Grid containers that do NOT need the guard, each with the reason it is
 * exempt. A new entry here is a deliberate call, not a way to silence the
 * test: it means the container's width is free (nothing to overflow) or its
 * children are fixed-size.
 */
const EXEMPT: Record<string, string> = {
  'checkbox.tsx': 'one fixed-size icon slot, no text',
  'chart.tsx': 'floating tooltip / legend, width is free — nothing caps it',
}

/** `grid` as a standalone class, not `grid-cols-*` / `grid-rows-*`. */
const IS_GRID = /(^|[\s'"`])grid([\s'"`]|$)/

/** String literals of a file, where Tailwind class lists live. */
function classLists(source: string): Array<string> {
  return source.match(/'[^'\n]{10,}'|"[^"\n]{10,}"/g) ?? []
}

describe('ui primitives — grid containers cannot be inflated by their content', () => {
  const files = readdirSync(UI_DIR).filter((f) => f.endsWith('.tsx'))

  it('finds the primitives to check (guards against a moved directory)', () => {
    assert.ok(
      files.includes('dialog.tsx'),
      'dialog.tsx not found in src/components/ui',
    )
    assert.ok(files.length > 20, `only ${files.length} primitives found`)
  })

  for (const file of files) {
    const source = readFileSync(join(UI_DIR, file), 'utf8')
    const grids = classLists(source).filter((list) => IS_GRID.test(list))
    if (grids.length === 0) continue

    it(`${file}: every grid container carries ${GUARD}`, () => {
      if (file in EXEMPT) {
        assert.ok(EXEMPT[file].length > 0)
        return
      }
      for (const list of grids) {
        assert.ok(
          list.includes(GUARD),
          `${file}: this grid container can be inflated by an unbreakable ` +
            `token, pushing its content (and the footer buttons) out of the ` +
            `padding. Add \`${GUARD}\` to it, or add ${file} to EXEMPT with ` +
            `the reason it cannot overflow.\n  ${list.slice(0, 160)}…`,
        )
      }
    })
  }

  it('the three boxes the bug was reported on are covered', () => {
    for (const file of ['dialog.tsx', 'alert-dialog.tsx', 'card.tsx']) {
      assert.ok(
        readFileSync(join(UI_DIR, file), 'utf8').includes(GUARD),
        `${file} lost its ${GUARD} guard`,
      )
    }
  })
})

describe('global overflow safety net', () => {
  it('an unbreakable token wraps instead of spilling out of its box', () => {
    // Second failure mode, independent of the grid one: once the track is
    // capped, a token with no break opportunity (snake_case file name,
    // mailbox, URL) is still wider than the box that holds it.
    assert.match(readFileSync(STYLES, 'utf8'), /overflow-wrap:\s*break-word/)
  })
})
