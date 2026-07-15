/**
 * One-shot import of instrument detail fields for the Parallel SPV bond deals
 * of the `calte` org, extracted from the emission contracts / subscription
 * bulletins stored in the Google Drive folder « PARALLEL » (one sub-folder per
 * SPV, each holding the « Contrat d'émission de titres » + BS + coupon
 * attestations). Calte counterpart of migrations/alboInstrumentImport.ts.
 *
 * Scope = the obligations lot validated with the team: SPV 4, 5, 6, 7, 11, 13
 * (each has its emission contract in the Drive, single documented instrument).
 * Deliberately OUT of scope, pending a decision (see PR / CHANGELOG):
 *   - SPV 9  : OCA (convertible), not a plain bond → instrumentKind os→oc first.
 *   - SPV 18 : Vanves/Le Bozec operation cancelled + fully repaid 06/10/2025.
 *   - SPV 14 / 17 : emission contract absent from the Drive (terms only known
 *     from coupon attestations) → durée / remboursement not firm.
 *   - SPV 2  : contract missing (terms via BS + attestations, variable rate).
 *   - SPV 8 / 16 : equity (ordinary shares), not bonds → `share` is correct.
 *
 * Conventions (same as convex/schema.ts): amounts in CENTS, rates in BASIS
 * POINTS. `closingDate` / `spvName` / `paidAmount` are intentionally NOT written
 * here — they are already populated by the Vasco bridge (vasco:
 * backfillSpvInstruments); this migration only adds the deep bond terms.
 *
 * Idempotent & non-destructive: `apply` only fills fields currently `undefined`
 * on the deal. Deals are anchored by their prod `_id`, cross-checked against org
 * slug + target company name — any mismatch skips the deal and is reported.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/calteInstrumentImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/calteInstrumentImport:apply
 *   pnpm exec convex run --prod migrations/calteInstrumentImport:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

type DealPatch = {
  dealId: string
  /** Exact prod target company name — safety cross-check before patching. */
  expectedTarget: string
  /** Fields written only if currently undefined on the deal. */
  fields: Record<string, number | string>
}

// Amounts in CENTS, rates in BASIS POINTS — same conventions as the schema.
// closingDate / spvName / paidAmount are NOT set here (Vasco bridge owns them).
// maturityDate is omitted on purpose: the contractual term runs N months after
// the (undated) « Date de Jouissance », so there is no firm calendar date —
// same choice as alboInstrumentImport for the Parallel SPVs.
const PATCHES: Array<DealPatch> = [
  {
    // Contrat d'émission (SPV 4). Cible Youse — co-promo « People Connect »,
    // Grenoble. Seule ligne amortissable (5 %/semestre) et encore vivante.
    dealId: 'k570qn7wmqf529swhzvzzvrj9587s56q',
    expectedTarget: 'PARALLEL INVEST SPV4',
    fields: {
      principalAmount: 500_000_00,
      interestRate: 1100,
      couponPeriodicity: 'semestriel',
      repaymentModality: 'amortissable',
    },
  },
  {
    // Contrat d'émission de base (SPV 5). Cible Oline / Fonds de Commerce Nord.
    // ⚠ Taux de base contractuel = 10,5 %/trimestriel ; un avenant (24/02/2025,
    // absent du dossier, connu via les attestations de coupon) l'a porté à
    // 13 %/mensuel. On importe le taux CONTRACTUEL ; à arbitrer si tu veux la
    // valeur courante (13 %/mensuel) à la place.
    dealId: 'k5773pg1jnwz4m8503nzjhamxh87sfmt',
    expectedTarget: 'PARALLEL INVEST SPV5 (Oline)',
    fields: {
      principalAmount: 200_000_00,
      interestRate: 1050,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    // Contrat d'émission (SPV 6). Cible SCI BK — immeuble 3 699 m², Bordeaux.
    // Taux 11 % = 9 % versés trimestriellement + 2 % capitalisés in fine ; on
    // retient le taux nominal 11 % et la périodicité trimestrielle.
    dealId: 'k573czazgh4k80ygkgm46g5yv187rxg5',
    expectedTarget: 'PARALLEL INVEST SPV6 (Bordeaux)',
    fields: {
      principalAmount: 500_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    // Contrat d'émission + avenant n°1 (SPV 7). Cible GT Partners — IMEXAB,
    // 4 immeubles Ixelles/Bruxelles. L'avenant ne change que la cible, pas les
    // termes financiers (11 %/mensuel/24 mois inchangés).
    dealId: 'k576zdf15hf61f6dy8mdwn87bs87sqfh',
    expectedTarget: 'PARALLEL INVEST SPV7 (BX GT PARTNERS)',
    fields: {
      principalAmount: 100_000_00,
      interestRate: 1100,
      couponPeriodicity: 'mensuel',
      repaymentModality: 'in_fine',
    },
  },
  {
    // Contrat d'émission (SPV 11). Cible SAS Villiers-le-Sec — manoir 1 600 m²,
    // Normandie. Sûretés : fiducie 100 % titres + hypothèque 1er rang 2,1 M€.
    dealId: 'k575bhx0j94k612mm38m20rh3d87sdp9',
    expectedTarget: 'PARALLEL INVEST SPV11 (NG invest - Normandie)',
    fields: {
      principalAmount: 150_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
  {
    // Contrat d'émission (SPV 13). Cible SAS Amilcar — réhab. Bernay (27).
    // Même émission que la ligne Albo SPV13 (contrat identique, ticket différent).
    dealId: 'k575c4h03q0q9z6sjc24t8xzw987r2g7',
    expectedTarget: 'Parallel Invest SPV13',
    fields: {
      principalAmount: 150_000_00,
      interestRate: 1100,
      couponPeriodicity: 'trimestriel',
      repaymentModality: 'in_fine',
    },
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCalteOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('calte_org_not_found')
  return org
}

/**
 * Resolve a patch spec to its deal + the subset of fields that would be written.
 * Returns a skip reason instead when the safety checks fail. `alreadySet` lists
 * fields left untouched because they already carry a value; `mismatch` flags an
 * already-set field whose value DIFFERS from the document (never overwritten —
 * surfaced for manual arbitration).
 */
async function resolvePatch(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: DealPatch,
): Promise<
  | {
      deal: Doc<'deals'>
      toWrite: Record<string, number | string>
      alreadySet: Array<string>
      mismatch: Array<{ field: string; current: unknown; document: number | string }>
    }
  | { skip: string }
> {
  const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
  if (!deal) return { skip: 'deal_not_found' }
  if (deal.orgId !== orgId) return { skip: 'wrong_org' }
  const target = await ctx.db.get('companies', deal.targetCompanyId)
  if (!target || target.name !== spec.expectedTarget)
    return { skip: `target_mismatch (found: ${target?.name ?? 'none'})` }

  const record = deal as unknown as Record<string, unknown>
  const toWrite: Record<string, number | string> = {}
  const alreadySet: Array<string> = []
  const mismatch: Array<{ field: string; current: unknown; document: number | string }> = []
  for (const [key, value] of Object.entries(spec.fields)) {
    if (record[key] === undefined) toWrite[key] = value
    else {
      alreadySet.push(key)
      if (record[key] !== value)
        mismatch.push({ field: key, current: record[key], document: value })
    }
  }
  return { deal, toWrite, alreadySet, mismatch }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    const plan = []
    const skipped = []
    const mismatches = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ dealId: spec.dealId, target: spec.expectedTarget, reason: resolved.skip })
        continue
      }
      plan.push({
        target: spec.expectedTarget,
        dealId: spec.dealId,
        instrumentKind: resolved.deal.instrumentKind,
        willWrite: resolved.toWrite,
        alreadySet: resolved.alreadySet,
      })
      if (resolved.mismatch.length > 0)
        mismatches.push({ target: spec.expectedTarget, fields: resolved.mismatch })
    }
    return {
      org: org.slug,
      dealsPlanned: plan.length,
      fieldsToWrite: plan.reduce((n, p) => n + Object.keys(p.willWrite).length, 0),
      // Fields already filled whose value differs from the document — NOT
      // overwritten; validate these by hand before deciding what to do.
      mismatches,
      skipped,
      plan,
      note:
        'Lecture seule. Valider ce rapport (surtout `mismatches`) puis lancer ' +
        'migrations/calteInstrumentImport:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    let dealsPatched = 0
    let fieldsWritten = 0
    const untouched: Array<string> = []
    const skipped: Array<{ dealId: string; target: string; reason: string }> = []

    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ dealId: spec.dealId, target: spec.expectedTarget, reason: resolved.skip })
        continue
      }
      const keys = Object.keys(resolved.toWrite)
      if (keys.length === 0) {
        untouched.push(spec.expectedTarget)
        continue
      }
      await ctx.db.patch(
        'deals',
        resolved.deal._id,
        resolved.toWrite as Partial<Doc<'deals'>>,
      )
      dealsPatched++
      fieldsWritten += keys.length
    }

    return { dealsPatched, fieldsWritten, untouched, skipped }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    const issues = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        issues.push({ target: spec.expectedTarget, dealId: spec.dealId, issue: resolved.skip })
        continue
      }
      // After apply, every planned field must be set (toWrite empty).
      const missing = Object.keys(resolved.toWrite)
      if (missing.length > 0)
        issues.push({ target: spec.expectedTarget, dealId: spec.dealId, issue: `not_written: ${missing.join(', ')}` })
    }
    return { org: org.slug, allOk: issues.length === 0, dealsChecked: PATCHES.length, issues }
  },
})
