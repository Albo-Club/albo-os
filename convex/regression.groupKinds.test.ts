/// <reference types="vite/client" />
/**
 * Regression: `migrations/collapseGroupKinds` (ALB-128 follow-up).
 *
 * The two values that carry behaviour — `group_root` (how an org finds its own
 * company) and `portfolio` — must survive untouched, and every group company
 * must stay a group company: the `startsWith('group_')` test is what lets it
 * invest and own a bank account.
 */
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import { createOrg, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

// Addressed by path: `_generated/api.d.ts` only learns about a new module
// when a Convex deployment regenerates it (CLAUDE.md § Anti-patterns).
const dryRunRef = makeFunctionReference<
  'query',
  Record<string, never>,
  {
    toRewrite: number
    byKind: Record<string, number>
    sample: Array<{ name: string; kind: string }>
  }
>('migrations/collapseGroupKinds:dryRun')

const applyRef = makeFunctionReference<
  'mutation',
  Record<string, never>,
  { rewritten: number; byKind: Record<string, number> }
>('migrations/collapseGroupKinds:apply')

const verifyRef = makeFunctionReference<
  'query',
  Record<string, never>,
  { remaining: number; clean: boolean }
>('migrations/collapseGroupKinds:verify')

/** One org holding the four deprecated kinds, plus a root and a portfolio. */
async function setup() {
  const t = setupHarness()
  const user = await createUser(t, 'owner@test.dev')
  const org = await createOrg(t, 'calte', [
    { userId: user.userId, role: 'owner' },
  ])
  const ids = new Map<string, Id<'companies'>>()
  await t.run(async (ctx) => {
    for (const kind of [
      'group_operating',
      'group_sci',
      'group_spv',
      'group_manco',
      'portfolio',
    ] as const) {
      ids.set(
        kind,
        await ctx.db.insert('companies', {
          orgId: org.orgId,
          name: `société ${kind}`,
          kind,
        }),
      )
    }
  })
  return { t, org, ids }
}

const kindOf = (t: Harness, id: Id<'companies'>) =>
  t.run(async (ctx) => (await ctx.db.get('companies', id))?.kind)

describe('collapseGroupKinds', () => {
  test('dryRun counts the deprecated rows without touching them', async () => {
    const { t, ids } = await setup()

    const report = await t.query(dryRunRef, {})
    expect(report.toRewrite).toBe(4)
    expect(report.byKind).toEqual({
      group_operating: 1,
      group_sci: 1,
      group_spv: 1,
      group_manco: 1,
    })

    expect(await kindOf(t, ids.get('group_sci')!)).toBe('group_sci')
  })

  test('apply rewrites the four sub-types and spares root and portfolio', async () => {
    const { t, org, ids } = await setup()

    const result = await t.mutation(applyRef, {})
    expect(result.rewritten).toBe(4)

    for (const kind of [
      'group_operating',
      'group_sci',
      'group_spv',
      'group_manco',
    ]) {
      expect(await kindOf(t, ids.get(kind)!)).toBe('group_entity')
    }
    // Untouched: both are read on their own, not through startsWith.
    expect(await kindOf(t, ids.get('portfolio')!)).toBe('portfolio')
    expect(await kindOf(t, org.rootCompanyId)).toBe('group_root')

    // A rewritten company is still a group company — it can still invest and
    // own a bank account.
    expect('group_entity'.startsWith('group_')).toBe(true)
  })

  test('is idempotent, and verify gates the narrowing', async () => {
    const { t } = await setup()
    expect((await t.query(verifyRef, {})).clean).toBe(false)

    await t.mutation(applyRef, {})
    const second = await t.mutation(applyRef, {})
    expect(second.rewritten).toBe(0)

    const check = await t.query(verifyRef, {})
    expect(check).toMatchObject({ remaining: 0, clean: true })
  })
})
