/**
 * Proposes capital operations from a legal document (ALB-248, lot 2).
 *
 * Third step of the upload pipeline, after OCR (documentsExtract) and the
 * automatic kind (documentsClassify): when a pacte, a bulletin or a PV lands
 * on a company we hold through a share deal, one model call reads the
 * operations it describes — a round, a BSA exercise, a conversion — and each
 * one becomes a PROPOSED row of `capitalEvents`, with the verbatim quotes
 * that back it. A human confirms or refuses on the sheet; nothing here is
 * ever a confirmed figure (CLAUDE.md: the AI proposes, the user validates).
 *
 * The model reads, `convex/lib/capitalExtraction.ts` decides: a value whose
 * quote is not in the text is dropped, our entry round is never proposed,
 * an operation already known (any status) is never proposed twice. The
 * write re-checks the same dedup — the read takes seconds and the sheet is
 * live meanwhile.
 *
 * Also the replay on the albo history (`backfillAlbo`): same reading, one
 * document at a time, paced; a document already cited by a row is skipped,
 * so a rerun is free. Runbook in MIGRATIONS.md.
 */
import { generateObject } from 'ai'
import { v } from 'convex/values'
import { z } from 'zod/v3'
import { internal } from './_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { getModel } from './agent'
import {
  CAPITAL_SOURCE_KINDS,
  DUPLICATE_TOLERANCE_DAYS,
  planProposals,
} from './lib/capitalExtraction'
import {
  CAPITAL_EVENT_KINDS,
  capitalEventKindValidator,
} from './lib/capitalPosition'

import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import type { KnownPoint } from './lib/capitalExtraction'

/** A PV or a pacte runs long, but the operation sits in the first pages. */
const TEXT_WINDOW = 60_000

/** Spacing between two model calls of the replay (rate limits upstream). */
const REPLAY_PACE_MS = 4_000

const DAY_MS = 24 * 60 * 60 * 1000

const cited = <T extends z.ZodTypeAny>(inner: T, what: string) =>
  z
    .object({
      value: inner,
      quote: z
        .string()
        .describe('Extrait VERBATIM du document qui porte cette valeur'),
    })
    .nullable()
    .describe(what)

const extractionSchema = z.object({
  operations: z.array(
    z.object({
      kind: z
        .enum(CAPITAL_EVENT_KINDS)
        .describe(
          "Nature de l'opération : round (augmentation de capital / tour), bsa_exercise (exercice de BSA ou BSPCE), conversion (OC, BSA Air, SAFE convertis en actions), secondary (cession d'actions existantes), reduction (réduction de capital), other",
        ),
      dateISO: cited(
        z.string(),
        "Date de l'opération (décision, constatation ou réalisation) au format AAAA-MM-JJ",
      ),
      pricePerShareEur: cited(
        z.number(),
        "Prix d'émission ou de cession par action en euros, prime incluse",
      ),
      sharesIssued: cited(
        z.number(),
        "Nombre d'actions nouvelles émises (ou cédées pour un secondaire)",
      ),
      totalSharesAfter: cited(
        z.number(),
        "Nombre total d'actions composant le capital APRÈS l'opération",
      ),
      roundSizeEur: cited(
        z.number(),
        "Montant total levé sur l'opération en euros, prime incluse",
      ),
    }),
  ),
})

const SYSTEM_PROMPT = `Tu es juriste corporate. Tu lis UN document juridique français (procès-verbal, rapport du Président, décisions d'associés, statuts, pacte, bulletin de souscription) et tu en extrais les OPÉRATIONS SUR LE CAPITAL qu'il décrit : augmentations de capital (tours), exercices de BSA/BSPCE, conversions d'instruments en actions, cessions d'actions (secondaire), réductions de capital.

RÈGLES ABSOLUES :
1. Tu n'extrais QUE ce qui est ÉCRIT. Un champ non trouvé = null. Jamais d'approximation, jamais de déduction. Un champ vide est BIEN MEILLEUR qu'une valeur inventée.
2. Chaque valeur est accompagnée d'un extrait VERBATIM du document, copié mot pour mot. Sans extrait littéral, mets null.
3. Tu ne calcules rien : ni total, ni prix moyen, ni valorisation. Si le document ne l'affiche pas, c'est null.
4. Une opération = une décision ou une constatation datée. Un document qui décrit un tour PASSÉ (dans un préambule, un historique) et un tour NOUVEAU donne deux opérations distinctes, chacune avec sa date.
5. Un document qui ne décrit aucune opération sur le capital (statuts sans mouvement, pacte sans tour, KBIS) renvoie une liste vide.

PIÈGE PRINCIPAL — LES NOMBRES D'ACTIONS. Un même document contient souvent plusieurs totaux, tous exacts dans leur contexte : le capital AVANT l'opération, le capital APRÈS la seule augmentation, le capital APRÈS les opérations concomitantes (exercice de BSA, conversion), la base pleinement diluée (pool BSPCE voté non attribué). 'totalSharesAfter' est le nombre d'actions ÉMISES après l'opération — jamais une base diluée, jamais un maximum autorisé si le document constate un nombre réalisé. Pour une délégation ("jusqu'à 2 500 actions maximum"), utilise le maximum et cite-le.`

// ─── Reads ───────────────────────────────────────────────────────────────────

interface ExtractTarget {
  orgId: Id<'organizations'>
  companyId: Id<'companies'>
  title: string
  text: string
  entryPoints: Array<KnownPoint>
  existingPoints: Array<KnownPoint>
}

/** The company a document is filed under: directly, or through its deal. */
async function companyOfDocument(
  ctx: QueryCtx,
  doc: Doc<'documents'>,
): Promise<Doc<'companies'> | null> {
  if (doc.companyId) return await ctx.db.get('companies', doc.companyId)
  if (!doc.dealId) return null
  const deal = await ctx.db.get('deals', doc.dealId)
  return deal ? await ctx.db.get('companies', deal.targetCompanyId) : null
}

/** Our share deals in the company — the entry round(s), never proposed. */
async function entryPointsOf(
  ctx: QueryCtx,
  company: Doc<'companies'>,
): Promise<Array<KnownPoint>> {
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_org_target', (q) =>
      q.eq('orgId', company.orgId).eq('targetCompanyId', company._id),
    )
    .collect()
  return deals
    .filter((d) => d.instrumentKind === 'share' && d.status !== 'cancelled')
    .flatMap((d) => {
      const asOf = d.closingDate ?? d.signedDate
      return asOf != null && d.pricePerShare != null
        ? [{ asOf, pricePerShareCents: d.pricePerShare }]
        : []
    })
}

async function existingPointsOf(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
): Promise<Array<KnownPoint>> {
  const rows = await ctx.db
    .query('capitalEvents')
    .withIndex('by_company_asof', (q) => q.eq('companyId', companyId))
    .collect()
  return rows.map((r) => ({
    asOf: r.asOf,
    pricePerShareCents: r.pricePerShare,
  }))
}

/** Whether the company holds a share deal at all (lot 1 scope). */
async function hasShareDeal(ctx: QueryCtx, company: Doc<'companies'>) {
  return (await entryPointsOf(ctx, company)).length > 0
}

export const getTarget = internalQuery({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<ExtractTarget | null> => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc || !CAPITAL_SOURCE_KINDS.has(doc.kind)) return null
    const company = await companyOfDocument(ctx, doc)
    if (!company || company.kind !== 'portfolio' || company.archivedAt) {
      return null
    }
    // A document already read once (any status of the rows it produced)
    // is never read again: the rows ARE the memory of that reading.
    const alreadyCited = await ctx.db
      .query('capitalEvents')
      .withIndex('by_document', (q) => q.eq('documentId', documentId))
      .first()
    if (alreadyCited) return null
    if (!(await hasShareDeal(ctx, company))) return null

    const stored = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    const text = stored?.text.trim() ?? ''
    if (!text) return null

    return {
      orgId: company.orgId,
      companyId: company._id,
      title: doc.title,
      text: text.slice(0, TEXT_WINDOW),
      entryPoints: await entryPointsOf(ctx, company),
      existingPoints: await existingPointsOf(ctx, company._id),
    }
  },
})

// ─── Write ───────────────────────────────────────────────────────────────────

const proposalValidator = v.object({
  asOf: v.number(),
  kind: capitalEventKindValidator,
  pricePerShare: v.number(),
  sharesIssued: v.optional(v.number()),
  totalSharesAfter: v.number(),
  roundSize: v.optional(v.number()),
  evidence: v.string(),
})

/**
 * Inserts the proposals of one document. Re-checks the dedup against the
 * rows written since the read (another document of the same round may have
 * landed meanwhile). No journal line: a proposal is not a gesture, its
 * confirmation is (tests/journalGuards EXEMPT).
 */
export const applyProposals = internalMutation({
  args: {
    documentId: v.id('documents'),
    proposals: v.array(proposalValidator),
  },
  handler: async (ctx, { documentId, proposals }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return { inserted: 0 }
    const company = await companyOfDocument(ctx, doc)
    if (!company) return { inserted: 0 }
    const known = await existingPointsOf(ctx, company._id)
    let inserted = 0
    for (const p of proposals) {
      const duplicate = known.some(
        (k) =>
          k.pricePerShareCents === p.pricePerShare &&
          Math.abs(k.asOf - p.asOf) <= DUPLICATE_TOLERANCE_DAYS * DAY_MS,
      )
      if (duplicate) continue
      await ctx.db.insert('capitalEvents', {
        orgId: company.orgId,
        companyId: company._id,
        asOf: p.asOf,
        kind: p.kind,
        pricePerShare: p.pricePerShare,
        sharesIssued: p.sharesIssued,
        totalSharesAfter: p.totalSharesAfter,
        roundSize: p.roundSize,
        documentId,
        status: 'proposed',
        evidence: p.evidence,
      })
      known.push({ asOf: p.asOf, pricePerShareCents: p.pricePerShare })
      inserted += 1
    }
    return { inserted }
  },
})

// ─── The run ─────────────────────────────────────────────────────────────────

export const run = internalAction({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<null> => {
    const target: ExtractTarget | null = await ctx.runQuery(
      internal.capitalEventsExtract.getTarget,
      { documentId },
    )
    if (!target) return null

    let operations
    try {
      const { object } = await generateObject({
        model: getModel(),
        schema: extractionSchema,
        system: SYSTEM_PROMPT,
        prompt: `NOM DU FICHIER : ${target.title}\n\nDOCUMENT À LIRE :\n\n${target.text}`,
      })
      operations = object.operations
    } catch (err) {
      // A proposal is a comfort, not a guarantee: the document stays
      // readable and the operation can be entered by hand.
      console.warn(
        `[capitalEventsExtract] ${documentId} not read:`,
        err instanceof Error ? err.message : String(err),
      )
      return null
    }

    const plan = planProposals({
      text: target.text,
      operations,
      entryPoints: target.entryPoints,
      existingPoints: target.existingPoints,
    })
    // Annotated: a same-module call infers its own type otherwise (Convex
    // guideline on circular function references).
    const { inserted }: { inserted: number } = await ctx.runMutation(
      internal.capitalEventsExtract.applyProposals,
      { documentId, proposals: plan.proposals },
    )
    console.log(
      `[capitalEventsExtract] ${target.title}: ${operations.length} read, ${inserted} proposed` +
        (plan.skipped.length
          ? ` (skipped: ${plan.skipped.map((s) => s.reason).join(', ')})`
          : ''),
    )
    return null
  },
})

// ─── Replay on the albo history ──────────────────────────────────────────────

/** The legal documents of the albo share participations not read yet. */
export const listReplayTargets = internalQuery({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) return []
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'portfolio'),
      )
      .collect()
    const out: Array<{ documentId: Id<'documents'>; title: string }> = []
    for (const company of companies) {
      if (company.archivedAt || !(await hasShareDeal(ctx, company))) continue
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_company', (q) => q.eq('companyId', company._id))
        .collect()
      for (const doc of docs) {
        if (!CAPITAL_SOURCE_KINDS.has(doc.kind)) continue
        const alreadyCited = await ctx.db
          .query('capitalEvents')
          .withIndex('by_document', (q) => q.eq('documentId', doc._id))
          .first()
        if (alreadyCited) continue
        out.push({ documentId: doc._id, title: doc.title })
      }
    }
    return out
  },
})

/**
 * Reads every legal document of the org's share participations that no
 * row cites yet, one model call each, paced. Idempotent: a rerun only reads
 * what the previous one left. Creates PROPOSALS only — the validation is the
 * sheet, not a CSV.
 *
 *   pnpm exec convex run --prod capitalEventsExtract:backfillAlbo '{"orgSlug":"albo"}'
 */
export const backfillAlbo = internalAction({
  args: { orgSlug: v.string() },
  handler: async (
    ctx,
    { orgSlug },
  ): Promise<{ scheduled: number; titles: Array<string> }> => {
    const targets: Array<{ documentId: Id<'documents'>; title: string }> =
      await ctx.runQuery(internal.capitalEventsExtract.listReplayTargets, {
        orgSlug,
      })
    targets.forEach((t, i) => {
      void ctx.scheduler.runAfter(
        i * REPLAY_PACE_MS,
        internal.capitalEventsExtract.run,
        { documentId: t.documentId },
      )
    })
    console.log(
      `[capitalEventsExtract] replay ${orgSlug}: ${targets.length} document(s) scheduled`,
    )
    return { scheduled: targets.length, titles: targets.map((t) => t.title) }
  },
})
