/**
 * Automatic classification of an uploaded document — the reason the add form
 * no longer asks for a type.
 *
 * A manual upload lands with the file name as title and the `other` kind, and
 * its text is read a few seconds later (`documentsExtract.run`). That reading
 * is what makes the question answerable by the machine: one model call over
 * the first pages returns the kind and, when the document says it, the period
 * it covers.
 *
 * Two rules keep it honest:
 *   - the vocabulary is restricted to what the ANCHOR can carry (a loan deed
 *     is never a "pacte"), so a wrong answer is at worst a neighbouring kind;
 *   - the patch only lands on a row that is still exactly as the upload left
 *     it (`other`, no period, `source: 'upload'`). A kind chosen by a human
 *     in the meantime is never overwritten — same cardinal rule as the deal
 *     backfill: nothing existing is overwritten in silence.
 *
 * `reporting` is deliberately NOT in any vocabulary. That kind is an
 * AIGUILLAGE, not a label: a report reaches the timeline through
 * `reportInbox.createFromUpload` (the "Ajouter un rapport" door) and nowhere
 * else. Letting the classifier emit it would file a document that looks like
 * a report but was never analysed.
 *
 * A failed or empty reading means no call at all, and a model failure is
 * logged and dropped: the document simply stays "Autre", editable by hand.
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

import type { Doc, Id } from './_generated/dataModel'

type DocKind = Doc<'documents'>['kind']

/** Enough to recognise a document: the first pages carry the nature. */
const TEXT_WINDOW = 12_000

/** Kinds offered per anchor, mirroring what each surface used to propose. */
const VOCABULARIES = {
  company: [
    'bp',
    'legal',
    'term_sheet',
    'pacte',
    'subscription',
    'attestation',
    'other',
  ],
  loan: ['acte_pret', 'legal', 'other'],
  guarantee: ['acte_garantie', 'legal', 'other'],
  property: ['legal', 'other'],
} as const

type Anchor = keyof typeof VOCABULARIES

/** One line per kind, in the model's language — the label alone is ambiguous. */
const KIND_HINTS: Record<string, string> = {
  bp: 'business plan, prévisionnel, modèle financier, budget',
  legal:
    "statuts, procès-verbal d'assemblée, contrat, convention, courrier juridique, document administratif",
  term_sheet: "term sheet, lettre d'intention, LOI, offre indicative",
  pacte: "pacte d'associés ou d'actionnaires, avenant au pacte",
  subscription:
    "bulletin de souscription, contrat d'émission d'obligations, engagement de souscription",
  attestation:
    "KBIS, extrait d'immatriculation, attestation (URSSAF, assurance, dépôt de fonds)",
  acte_pret:
    "offre de prêt, contrat de prêt bancaire, tableau d'amortissement, avenant de prêt",
  acte_garantie:
    'acte de nantissement, hypothèque, caution, garantie autonome, mainlevée',
  other:
    'aucune des catégories ci-dessus ne correspond, ou le texte ne permet pas de trancher',
}

const SYSTEM_PROMPT = `Tu classes un document déposé dans un outil de gestion de participations et de dette.
Tu ne disposes que du texte extrait du document (OCR), parfois partiel.

Règles :
- Choisis le type dans la liste fournie, jamais en dehors.
- En cas de doute, réponds "other" : un mauvais type coûte plus cher qu'un type absent.
- La période est celle que le document COUVRE ou porte comme date d'effet (mois ou jour). Ne la déduis jamais d'une intuition : si le document ne la dit pas, réponds null.`

const classificationSchema = z.object({
  kind: z
    .string()
    .describe('Le type retenu, repris littéralement dans la liste fournie'),
  period: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Date ou période du document au format AAAA-MM-JJ ou AAAA-MM. null si absente',
    ),
})

// ─── Reads & writes ──────────────────────────────────────────────────────────

interface ClassifyTarget {
  title: string
  anchor: Anchor
  text: string
}

export const getTarget = internalQuery({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }): Promise<ClassifyTarget | null> => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    // Only an untouched manual upload is classifiable: an email attachment
    // was named by the report pipeline, and any other kind or a filled period
    // is a human's answer to the same question.
    if (
      doc.source !== 'upload' ||
      doc.kind !== 'other' ||
      doc.period !== undefined
    )
      return null

    const anchor: Anchor | null = doc.companyId
      ? 'company'
      : doc.loanId
        ? 'loan'
        : doc.guaranteeId
          ? 'guarantee'
          : doc.propertyId
            ? 'property'
            : null
    if (!anchor) return null

    const stored = await ctx.db
      .query('documentTexts')
      .withIndex('by_storage', (q) => q.eq('storageId', doc.storageId))
      .first()
    const text = stored?.text.trim() ?? ''
    if (!text) return null

    return { title: doc.title, anchor, text: text.slice(0, TEXT_WINDOW) }
  },
})

/**
 * Write the classification — but only onto a row still in its upload state.
 * The re-check is not belt and braces: the model call takes seconds, and the
 * document is already visible and editable while it runs.
 */
export const apply = internalMutation({
  args: {
    documentId: v.id('documents'),
    kind: v.string(),
    period: v.optional(v.number()),
  },
  handler: async (ctx, { documentId, kind, period }) => {
    const doc = await ctx.db.get('documents', documentId)
    if (!doc) return null
    if (
      doc.source !== 'upload' ||
      doc.kind !== 'other' ||
      doc.period !== undefined
    )
      return null

    const anchor: Anchor | null = doc.companyId
      ? 'company'
      : doc.loanId
        ? 'loan'
        : doc.guaranteeId
          ? 'guarantee'
          : doc.propertyId
            ? 'property'
            : null
    if (!anchor) return null

    // The vocabulary is re-checked here, not merely prompted: the kind lands
    // in a schema union, and a value invented by the model must never reach
    // the write. Outside the list, the row keeps the 'other' it carries.
    const vocabulary = VOCABULARIES[anchor] as ReadonlyArray<string>
    const classified = vocabulary.includes(kind) && kind !== 'other'
    if (!classified && period === undefined) return null

    await ctx.db.patch('documents', documentId, {
      kind: classified ? (kind as DocKind) : doc.kind,
      period,
    })

    // The kind is a filter value of the semantic index — a document left
    // indexed under its former one would keep answering the wrong question.
    if (classified) {
      await ctx.scheduler.runAfter(0, internal.vectorize.indexDocument, {
        documentId,
      })
    }
    return null
  },
})

// ─── The run ─────────────────────────────────────────────────────────────────

/** "AAAA-MM-JJ" / "AAAA-MM" → ms epoch UTC. Anything else is dropped. */
export function parsePeriod(value: string | null): number | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day] = match
  const monthIndex = Number(month) - 1
  if (monthIndex < 0 || monthIndex > 11) return undefined
  const dayNumber = day ? Number(day) : 1
  if (dayNumber < 1 || dayNumber > 31) return undefined
  return Date.UTC(Number(year), monthIndex, dayNumber)
}

export const run = internalAction({
  args: { documentId: v.id('documents') },
  handler: async (ctx, { documentId }: { documentId: Id<'documents'> }) => {
    const target: ClassifyTarget | null = await ctx.runQuery(
      internal.documentsClassify.getTarget,
      {
        documentId,
      },
    )
    if (!target) return null

    const vocabulary = VOCABULARIES[target.anchor] as ReadonlyArray<string>
    const list = vocabulary
      .map((kind) => `- ${kind} : ${KIND_HINTS[kind]}`)
      .join('\n')

    let kind: string
    let period: string | null
    try {
      const { object } = await generateObject({
        model: getModel(),
        schema: classificationSchema,
        system: SYSTEM_PROMPT,
        prompt: `TYPES POSSIBLES :
${list}

NOM DU FICHIER : ${target.title}

TEXTE DU DOCUMENT :
${target.text}`,
      })
      kind = object.kind
      period = object.period
    } catch (err) {
      // A classification is a comfort, not a guarantee: the document stays
      // "Autre" and one edit fixes it. Nothing to retry, nothing to alert.
      console.warn(
        `[documentsClassify] ${documentId} left unclassified:`,
        err instanceof Error ? err.message : String(err),
      )
      return null
    }

    await ctx.runMutation(internal.documentsClassify.apply, {
      documentId,
      kind,
      period: parsePeriod(period),
    })
    console.log(
      `[documentsClassify] ${target.title}: ${kind}${period ? ` (${period})` : ''}`,
    )
    return null
  },
})
