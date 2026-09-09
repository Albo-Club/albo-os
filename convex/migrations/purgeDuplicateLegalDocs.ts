/**
 * Deletes the fifteen duplicate documents arbitrated by hand on the `calte`
 * legal-docs lot, in the exact pairs that were validated (09/09/2026).
 *
 * Context. `legalDocsImport:verify` reports same-company/same-normalized-title
 * collisions, and PR #452 added the text excerpt that makes them arbitrable.
 * Reading the excerpts, the reported groups split into three families:
 *
 *   - identical bytes AND identical text — a plain double deposit (the two
 *     Eben Home pairs even share their Docusign envelope id);
 *   - identical text, sizes a few dozen kilobytes apart — the same signed
 *     document re-exported, the heavier one carrying the full signature
 *     layer: the heavier is kept;
 *   - identical title, one side with no readable text at all — a scan that
 *     never yielded anything: the readable one is kept.
 *
 * The list is frozen below as prod `_id` pairs, NOT as a rule. Deleting « the
 * smaller of two » would have destroyed CALTE's own filled-in BELLEVILLES
 * subscription form (318 Ko) in favour of the issuer's blank template
 * (1,5 Mo) — the one group of the report that turned out to hold two genuinely
 * different documents. BELLEVILLES is deliberately absent from this list, and
 * so are the three JEEN exports, which were left untouched.
 *
 * Guarded. Each pair is anchored on both ids, and a pair only proceeds when
 * the survivor is still there, both rows sit in `calte`, both hang off the
 * SAME company, and their titles still share the normalized key that grouped
 * them. A mistyped id therefore refuses rather than deleting a stranger.
 *
 * Idempotent. A row already gone is reported as such, not as a failure — the
 * survivor guard still runs, so a second pass re-proves the arbitration held.
 *
 * The blob is never deleted on sight: `releaseStorage` frees it only once no
 * `documents` row points at it any more (one upload can back several rows).
 *
 * ⚠️ MERGE FIRST — `convex run --prod` calls the code DEPLOYED in prod, and
 * prod is deployed by the Vercel build on `main`.
 *
 * Execution (prod, manual — cf. MIGRATIONS.md), AFTER the merge has deployed:
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/purgeDuplicateLegalDocs:dryRun
 *   # STOP: check the fifteen named rows, then and only then:
 *   pnpm exec convex run --prod migrations/purgeDuplicateLegalDocs:apply
 */
import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'
import { releaseStorage } from '../lib/documentBlobs'
import { normalizeDocumentTitle } from '../lib/duplicates'

import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

type Pair = {
  /** Human label of the pair, as published in the arbitration table. */
  label: string
  /** The row to delete. */
  remove: string
  /** The row that stays. */
  keep: string
  /** Why this side was the one to go. */
  reason: string
}

const PAIRS: Array<Pair> = [
  {
    label: 'Eben Home — Avenant n°3',
    remove: 'mn7bh9bttzdfaf1f5xp8mb0py98e0s3t',
    keep: 'mn74395x3h85a2mhjam1sw51ad8drnwk',
    reason: 'identical bytes and text, same Docusign envelope id',
  },
  {
    label: 'Eben Home — PV CS',
    remove: 'mn7avamt25yghfnfejex83ch2h8e1bp2',
    keep: 'mn77b0f7zwatd4yx3092g2624h8drsh3',
    reason: 'identical bytes and text, same Docusign envelope id',
  },
  {
    label: 'SIDE AGILITEST — Rapport janvier 2026',
    remove: 'mn76jf3k9evn8srv5vmwd7m61h8dy7v2',
    keep: 'mn7ev8zzeecmh4rxdevp81a0cd8dzrv7',
    reason: 'identical bytes and text',
  },
  {
    label: 'BS Projet ONIMA',
    remove: 'mn74q09d9zr9ewr9as9wb1dq398e0cq2',
    keep: 'mn736ba11dp36ec37wb29fb00s8e1hqv',
    reason: 'same text, lighter re-export (194 631 vs 242 559 bytes)',
  },
  {
    label: 'BS Lyon Vaise',
    remove: 'mn7crmwp752emqc7r0tne5nsj98e1m12',
    keep: 'mn71mv09fs87qd8j1825ecrn3n8e137x',
    reason: 'same text, lighter re-export (197 638 vs 245 729 bytes)',
  },
  {
    label: 'Rewatt — BS AK Calte',
    remove: 'mn75cgjf9jaj4astsrhrtks0x98e0jat',
    keep: 'mn7bn6gp4vg6wk7mavfj70xsv98e1bvj',
    reason: 'same text, lighter re-export (211 480 vs 259 752 bytes)',
  },
  {
    label: 'BS empruntemontoutou',
    remove: 'mn7dvbg4btgkwzjc9gajg312vs8e0kjq',
    keep: 'mn7fprahnmmqy29fx0c1aymkyn8e0x1k',
    reason: 'same text, lighter re-export (218 359 vs 266 438 bytes)',
  },
  {
    label: 'BS CALTE EUTOPIA CO INVEST DYNAMO',
    remove: 'mn72xx0vvgrm9be5f85hpayyss8e16ks',
    keep: 'mn72xjb3hjxw85es2b0gkrg9kn8e1pma',
    reason: 'no readable text on this side',
  },
  {
    label: '260511 NOTA CLIMAT — vote',
    remove: 'mn7b66fezdyn0gksbqafx0mjjs8e0e8f',
    keep: 'mn7bgpsh47rr26c8ns579p7xr58e17de',
    reason: 'no readable text on this side',
  },
  {
    label: 'SIDE Axyn Robotique — BS',
    remove: 'mn78knk534gyvzstqa3cvvkdxx8e17jq',
    keep: 'mn78sqyb2zphha9hvkkas6q9j18e1m2x',
    reason: 'no readable text on this side',
  },
  {
    label: 'SIDE KAZADEN — BS Actions A',
    remove: 'mn7cr1f40xsq0610v8sy5mh5c58e0gdw',
    keep: 'mn70sz9j11th1mxj356tmva5v18e02j7',
    reason: 'no readable text on this side',
  },
  {
    label: 'Tiny home invoice 1 2023',
    remove: 'mn7a606ggtq58fgja7qkdtteax8e0x51',
    keep: 'mn71g8y0k6bfzy1vjmbwe67fjs8e13y3',
    reason: 'no readable text on this side',
  },
  {
    label: 'Tiny home invoice 1 2024',
    remove: 'mn7fdhrwrhamevg87mwxgfzeqs8e02ry',
    keep: 'mn7a7red9dcrmxrrm42j7hcay58e0egn',
    reason: 'no readable text on this side',
  },
  {
    label: 'Tiny home invoice 2 2023',
    remove: 'mn7d53d5xh7jxmd0jjf9e4t41d8e0b1h',
    keep: 'mn736bvsc5mfnmnnj4j9xzynn98e06br',
    reason: 'no readable text on this side',
  },
  {
    label: 'Tiny home invoice 2022',
    remove: 'mn77d63abmygj2s4jnceemwp018e0akq',
    keep: 'mn7eybr53ymedq5dqck5qdaf9n8e02fh',
    reason: 'no readable text on this side',
  },
]

async function getOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError(`org_not_found:${ORG_SLUG}`)
  return org
}

/**
 * Loads a pair and re-proves the arbitration still describes reality.
 * Returns `null` for `remove` when that row is already gone (second run).
 */
async function resolve(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  pair: Pair,
): Promise<{ remove: Doc<'documents'> | null; keep: Doc<'documents'> }> {
  if (pair.remove === pair.keep) {
    throw new ConvexError(`pair_points_at_one_row:${pair.label}`)
  }
  const keep = await ctx.db.get('documents', pair.keep as Id<'documents'>)
  // The survivor is what makes the deletion safe: no survivor, no deletion.
  if (!keep || keep.orgId !== orgId) {
    throw new ConvexError(`survivor_absent:${pair.label}`)
  }

  const remove = await ctx.db.get('documents', pair.remove as Id<'documents'>)
  if (!remove) return { remove: null, keep }
  if (remove.orgId !== orgId) throw new ConvexError(`wrong_org:${pair.label}`)
  // The lot was arbitrated on `verify`, which only lists uploaded documents.
  // A row deposited by the reporting pipeline would also hold an inbound
  // email's attachment — out of this migration's scope.
  if (remove.source !== 'upload') {
    throw new ConvexError(`not_an_upload:${pair.label}`)
  }
  if (remove.companyId !== keep.companyId) {
    throw new ConvexError(`not_the_same_company:${pair.label}`)
  }
  if (
    normalizeDocumentTitle(remove.title) !== normalizeDocumentTitle(keep.title)
  ) {
    throw new ConvexError(`title_mismatch:${pair.label}`)
  }
  return { remove, keep }
}

// ─── dryRun ──────────────────────────────────────────────────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const rows = []
    for (const pair of PAIRS) {
      const { remove, keep } = await resolve(ctx, org._id, pair)
      rows.push({
        label: pair.label,
        reason: pair.reason,
        willDelete: remove
          ? { title: remove.title, size: remove.size ?? 0 }
          : null,
        keep: { title: keep.title, size: keep.size ?? 0 },
      })
    }
    return {
      org: ORG_SLUG,
      toDelete: rows.filter((r) => r.willDelete).length,
      alreadyGone: rows.filter((r) => !r.willDelete).length,
      rows,
    }
  },
})

// ─── apply ───────────────────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const deleted: Array<string> = []
    const alreadyGone: Array<string> = []
    let blobsFreed = 0

    for (const pair of PAIRS) {
      const { remove } = await resolve(ctx, org._id, pair)
      if (!remove) {
        alreadyGone.push(pair.label)
        continue
      }
      // Same order as `documents:remove` — the row goes first, the blob is
      // then freed only if nothing else points at it.
      await ctx.db.delete('documents', remove._id)
      if (await releaseStorage(ctx, remove.storageId)) blobsFreed++
      await ctx.scheduler.runAfter(0, internal.vectorize.removeEntry, {
        orgId: remove.orgId,
        key: `doc:${remove._id}`,
      })
      deleted.push(pair.label)
    }

    return {
      org: ORG_SLUG,
      deleted: deleted.length,
      blobsFreed,
      alreadyGone: alreadyGone.length,
      details: { deleted, alreadyGone },
    }
  },
})
