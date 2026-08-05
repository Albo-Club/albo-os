/**
 * One-shot repair of two SPV fiches whose pitch had leaked from the sponsor's
 * domain (`parallel-invest.com`), before the vehicle guard shipped
 * (`lib/pitch.ts:isVehicleEntity`).
 *
 *  - albo « Parallel Invest SPV 23 (STOA - Pessac) » carried the platform's own
 *    website copy ("Parallel Invest est une boutique d'investissement…"),
 *    generated from `parallel-invest.com` by `companyEnrichment.enrich`.
 *  - calte « PARALLEL INVEST SPV24 » carried, word for word, the pitch of
 *    « PARALLEL INVEST SPV11 (NG invest - Normandie) » — the same-domain group
 *    handed it the sibling with the longest summary
 *    (`pickCanonicalPitch`), so the fiche described a Normandy operation and
 *    even named SPV11.
 *
 * Replacement texts are derived from data we hold, not from the platform site:
 * SPV24 from the entity's own `notes` (SAS Mozaïk Investments 1, portfolio of
 * 13 assets, unit-by-unit resale) plus the deal instrument (`os`); SPV23 from
 * the Attio deal « SPV 23 STOA - Pessac (Dette Senior via Parallel) » (type
 * Obligation) plus the deal instrument (`os`). Same house style as the VASCO
 * pitches: what the operation IS, never its progress.
 *
 * Idempotent and non-destructive: each row is anchored by prod `_id`, guarded
 * by the entity name AND by the wrong text it must still carry, so a re-run is
 * a no-op and a hand-edit made in between is never clobbered. Once Albo/Calte
 * are linked to these SPVs on VASCO, `enrichFromVasco` becomes the source of
 * truth again and supersedes these texts.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/fixSpvPitches:dryRun
 *   # STOP: read the before→after, then:
 *   pnpm exec convex run --prod migrations/fixSpvPitches:apply
 */
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const FIXES: Array<{
  companyId: string
  expectedName: string
  /** Start of the wrong summary the row must still carry to be rewritten. */
  wrongSummaryStartsWith: string
  oneLiner: string
  summary: string
}> = [
  {
    companyId: 'jx7dqfnm4j150d7by280axae4x87x15z',
    expectedName: 'Parallel Invest SPV 23 (STOA - Pessac)',
    wrongSummaryStartsWith: 'Parallel Invest est une boutique',
    oneLiner: 'Dette obligataire — immobilier Pessac',
    summary:
      "Financement en dette senior souscrit sous forme obligataire via la plateforme Parallel Invest, sur une opération immobilière portée par l'opérateur STOA à Pessac, en Gironde. L'exposition est une créance obligataire sur le véhicule d'émission, sans participation au capital de l'opération.",
  },
  {
    companyId: 'jx71679qdp7k5qppdrkmadwxgh8b2re9',
    expectedName: 'PARALLEL INVEST SPV24',
    wrongSummaryStartsWith: 'Opération de financement obligataire structurée',
    oneLiner: 'Dette obligataire — portefeuille immobilier Mozaïk',
    summary:
      "Financement obligataire souscrit via la plateforme Parallel Invest, adossé à la SAS Mozaïk Investments 1. Le sous-jacent est un portefeuille de treize actifs immobiliers situés en France, dont la stratégie de sortie est la revente à la découpe. L'exposition est une créance obligataire, sans participation au capital.",
  },
]

type Resolved = {
  toFix: Array<{
    company: Doc<'companies'>
    fix: (typeof FIXES)[number]
  }>
  /** Anchor no longer matching: wrong name, or summary already rewritten. */
  skipped: Array<{ companyId: string; expected: string; reason: string }>
}

async function resolve(ctx: Ctx): Promise<Resolved> {
  const toFix: Resolved['toFix'] = []
  const skipped: Resolved['skipped'] = []
  for (const fix of FIXES) {
    const company = await ctx.db.get(
      'companies',
      fix.companyId as Id<'companies'>,
    )
    if (!company) {
      skipped.push({
        companyId: fix.companyId,
        expected: fix.expectedName,
        reason: 'not_found',
      })
      continue
    }
    if (company.name !== fix.expectedName) {
      skipped.push({
        companyId: fix.companyId,
        expected: fix.expectedName,
        reason: `name_mismatch:${company.name}`,
      })
      continue
    }
    if (!company.summary?.startsWith(fix.wrongSummaryStartsWith)) {
      skipped.push({
        companyId: fix.companyId,
        expected: fix.expectedName,
        reason: 'already_fixed_or_hand_edited',
      })
      continue
    }
    toFix.push({ company, fix })
  }
  return { toFix, skipped }
}

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toFix, skipped } = await resolve(ctx)
    return {
      willFix: toFix.map(({ company, fix }) => ({
        name: company.name,
        fromOneLiner: company.oneLiner ?? null,
        toOneLiner: fix.oneLiner,
        fromSummary: company.summary ?? null,
        toSummary: fix.summary,
      })),
      skipped,
    }
  },
})

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { toFix, skipped } = await resolve(ctx)
    for (const { company, fix } of toFix) {
      await ctx.db.patch('companies', company._id, {
        oneLiner: fix.oneLiner,
        summary: fix.summary,
      })
    }
    return { patched: toFix.length, skipped }
  },
})
