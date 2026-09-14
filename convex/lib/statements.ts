/**
 * Bank-statement reading — the pure half (no ctx, no network, no model call).
 *
 * `convex/statements.ts` OCRs a PDF, hands the text to a model and gets back
 * the loose shape declared here; everything that turns that answer into
 * something writable lives in this file, so it can be tested without a
 * deployment: unit conversion, the "is this line quoted in %" branch, and the
 * coherence check that decides whether a parsed account is trustworthy.
 *
 * Conventions on the way in: the model answers in the statement's own units
 * (euros as floats, percentages as percentages, dates as "AAAA-MM-JJ").
 * Conventions on the way out: this repo's — integer cents, basis points, ms
 * epoch UTC. Nothing downstream ever sees a float euro.
 */

import { z } from 'zod/v3'

/** How far into the OCR text the reader looks. A statement's account tables
 * live in its first pages; past that come the regulatory boilerplate and the
 * per-account charts, which cost tokens and teach the model nothing. */
export const STATEMENT_TEXT_WINDOW = 60_000

/** A euro amount is worth reading as "the same figure" within a cent. */
const CENT = 1

/** Below this, the sum of an account's lines is considered to match the total
 * the statement prints for it. One cent per line of rounding is normal; a real
 * misread is off by euros. */
export const COHERENCE_TOLERANCE_CENTS = 100

// ─── What the model is asked for ─────────────────────────────────────────────

export const STATEMENT_SYSTEM_PROMPT = `Tu lis un relevé de situation bancaire (banque privée française) et tu en extrais la donnée chiffrée.

Règles absolues :
- Tu ne recopies que ce qui est ÉCRIT. Tu ne calcules rien, tu ne complètes rien, tu ne devines rien.
- Un chiffre que tu ne trouves pas est null. Un null est toujours préférable à une valeur plausible.
- Les montants sont rendus en euros, en nombre (1 234,56 € → 1234.56). Jamais de séparateur de milliers, jamais de symbole.
- Les dates sont au format AAAA-MM-JJ.
- Tu rends TOUS les comptes du relevé, y compris les comptes courants et les comptes à zéro.
- Pour chaque compte, tu rends TOUTES les lignes de son portefeuille, y compris la ligne de liquidités (isCash = true), qui n'a ni ISIN ni quantité.

Sur le cours d'une ligne :
- s'il est libellé en euros (un fonds à 112 533,89 EUR), remplis unitValue et laisse unitValuePercent à null ;
- s'il est libellé en pourcentage (un produit structuré coté 99,13 %), remplis unitValuePercent avec 99.13 et laisse unitValue à null.
Ne convertis jamais l'un en l'autre.`

/** The loose shape the model answers in — the statement's own units. */
export const statementSchema = z.object({
  statementDate: z
    .string()
    .nullable()
    .describe('Date du relevé au format AAAA-MM-JJ'),
  bankName: z.string().nullable().describe("Nom de l'établissement"),
  accounts: z.array(
    z.object({
      accountNumber: z.string().describe('Numéro du compte, tel qu’imprimé'),
      label: z.string().describe('Intitulé du compte'),
      nature: z
        .string()
        .nullable()
        .describe('Nature du compte : "Compte titres", "Compte courant"…'),
      totalValuation: z
        .number()
        .nullable()
        .describe(
          'Valorisation totale du compte à la date du relevé, en euros',
        ),
      positions: z.array(
        z.object({
          label: z.string().describe('Libellé du support'),
          isin: z.string().nullable().describe('Code ISIN, null si absent'),
          category: z
            .string()
            .nullable()
            .describe('Catégorie d’actif telle qu’écrite sur le relevé'),
          quantity: z.number().nullable(),
          unitValue: z.number().nullable().describe('Cours en euros'),
          unitValuePercent: z
            .number()
            .nullable()
            .describe('Cours en pourcentage du nominal (99.13 pour 99,13 %)'),
          avgPrice: z.number().nullable().describe("Prix moyen d'achat, euros"),
          valuation: z.number().nullable().describe('Évaluation en euros'),
          unrealizedGain: z
            .number()
            .nullable()
            .describe('Plus ou moins-value latente en euros'),
          isCash: z
            .boolean()
            .describe('true pour la ligne de liquidités du compte'),
        }),
      ),
    }),
  ),
})

export type RawStatement = z.infer<typeof statementSchema>

// ─── Unit conversion ─────────────────────────────────────────────────────────

/** Euro float → integer cents. Non-finite values are dropped, not zeroed: a
 * missing amount and an amount of zero are different answers. */
export function eurosToCents(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.round(value * 100)
}

/** Percentage → basis points (99.13 → 9913). */
export function percentToBps(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.round(value * 100)
}

/** "AAAA-MM-JJ" → ms epoch UTC. Anything else is undefined — a statement with
 * an unreadable date is a statement the user has to date by hand, never one
 * we silently file at today. */
export function parseStatementDate(value: string | null | undefined) {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day] = match
  const monthIndex = Number(month) - 1
  const dayNumber = Number(day)
  if (monthIndex < 0 || monthIndex > 11) return undefined
  if (dayNumber < 1 || dayNumber > 31) return undefined
  const ms = Date.UTC(Number(year), monthIndex, dayNumber)
  // Round-trip guard: Date.UTC happily rolls 31/02 over into March.
  const back = new Date(ms)
  if (back.getUTCMonth() !== monthIndex || back.getUTCDate() !== dayNumber) {
    return undefined
  }
  return ms
}

// ─── The normalized draft ────────────────────────────────────────────────────

export interface DraftPosition {
  label: string
  isinCode?: string
  assetCategory?: string
  quantity?: number
  unitValue?: number // cents
  unitValueBps?: number // basis points, % quote
  avgPrice?: number // cents
  valuation?: number // cents
  diff?: number // cents
  isCash: boolean
}

export interface DraftAccount {
  accountNumber: string
  label: string
  nature?: string
  /** What the statement prints as the account's total, in cents. */
  totalValuation?: number
  /** What its own lines add up to, in cents. */
  positionsTotal: number
  /** Signed gap (lines − printed total), in cents. `undefined` when the
   * statement prints no total to compare against. */
  gap?: number
  /** Whether the two agree within tolerance. A `false` here is the whole
   * point of the verification screen: it names the account the reader got
   * wrong instead of writing a plausible number. */
  coherent: boolean
  /** A securities account is a placement; a current account is not (it is
   * already fed by the bank connection). */
  isSecurities: boolean
  positions: Array<DraftPosition>
}

export interface StatementDraft {
  statementDate?: number
  bankName?: string
  accounts: Array<DraftAccount>
}

/** Natures that make an account a securities account. Matched loosely: the
 * wording is the bank's, and "Compte titres" / "Compte-titres ordinaire" /
 * "CTO" all mean the same thing. */
function isSecuritiesNature(nature: string | null, label: string): boolean {
  const haystack = `${nature ?? ''} ${label}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (haystack.includes('compte courant')) return false
  return (
    haystack.includes('titre') ||
    haystack.includes('cto') ||
    haystack.includes('pea')
  )
}

/**
 * Model answer → writable draft. Never throws: a statement the model read
 * badly must reach the verification screen looking wrong, not blow up on the
 * way there.
 */
export function normalizeStatement(raw: RawStatement): StatementDraft {
  const accounts = raw.accounts.map((account): DraftAccount => {
    const positions = account.positions.map((p): DraftPosition => {
      const unitValue = eurosToCents(p.unitValue)
      const unitValueBps = percentToBps(p.unitValuePercent)
      return {
        label: p.label.trim() || '—',
        isinCode: p.isin?.trim() || undefined,
        assetCategory: p.category?.trim() || undefined,
        quantity:
          p.quantity != null && Number.isFinite(p.quantity)
            ? p.quantity
            : undefined,
        // A line quoted in % has no euro unit value, and vice versa. When the
        // model fills both, the percentage wins: it is the answer it could
        // only have given by reading a "%" on the page.
        unitValue: unitValueBps === undefined ? unitValue : undefined,
        unitValueBps,
        avgPrice: eurosToCents(p.avgPrice),
        valuation: eurosToCents(p.valuation),
        diff: eurosToCents(p.unrealizedGain),
        isCash: p.isCash === true,
      }
    })
    const positionsTotal = positions.reduce(
      (sum, p) => sum + (p.valuation ?? 0),
      0,
    )
    const totalValuation = eurosToCents(account.totalValuation)
    const gap =
      totalValuation === undefined ? undefined : positionsTotal - totalValuation
    return {
      accountNumber: account.accountNumber.trim(),
      label: account.label.trim() || account.accountNumber.trim(),
      nature: account.nature?.trim() || undefined,
      totalValuation,
      positionsTotal,
      gap,
      // No printed total to check against: nothing contradicts the lines, so
      // nothing is flagged. The screen still shows the figure.
      coherent: gap === undefined || Math.abs(gap) <= COHERENCE_TOLERANCE_CENTS,
      isSecurities: isSecuritiesNature(account.nature, account.label),
      positions,
    }
  })
  return {
    statementDate: parseStatementDate(raw.statementDate),
    bankName: raw.bankName?.trim() || undefined,
    accounts,
  }
}

/** The value an account is worth to a placement: what the statement prints
 * when it prints one, its lines otherwise. Exported because the mutation and
 * the screen must agree to the cent on the figure being written. */
export function accountValuationCents(account: {
  totalValuation?: number
  positionsTotal: number
}): number {
  return account.totalValuation ?? account.positionsTotal
}

/** True when two euro figures are the same to the cent. */
export function sameCents(a: number, b: number): boolean {
  return Math.abs(a - b) < CENT
}
