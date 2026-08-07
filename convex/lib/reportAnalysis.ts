/**
 * The contract with the extraction model (brick 5) — schema + tolerant read.
 *
 * Two ways in, one shape out:
 *
 * - `analysisSchema` is the STRICT contract handed to `generateObject`. It is
 *   what constrains the model in the nominal path, so it stays precise:
 *   a closed enum of rhythms, a closed enum of units. Do not loosen it — the
 *   JSON Schema derived from it is the only guidance the provider gets.
 * - `parseLenient` reads the FALLBACK path, where the model answers in free
 *   JSON and nothing constrains it. There, an écart is the normal case, not
 *   the exception: it writes "half-year" for `semi-annual`, "k€" for `kEUR`,
 *   `"1 200"` for `1200`, and omits whatever it has nothing to say about.
 *
 * The rule the whole file follows: **a report sheet must survive anything the
 * model says.** Reformulations are normalized (same spirit as
 * `normalizePeriodDisplay`, which accepts French month names rather than
 * rejecting them); what cannot be normalized is DROPPED ALONE — one
 * unreadable metric never takes down the fifteen valid ones next to it, nor
 * the sheet itself. The only unusable answer is one with neither title nor
 * headline, and that is the single case that fails.
 *
 * Leniency never invents a value: an unrecognized unit becomes 'other', which
 * `toCanonical` refuses for every catalog key — the metric stays on the raw
 * snapshot instead of entering a time series under a guessed unit.
 */

import { z } from 'zod/v3'
import type { RawMetric, SeenUnit } from './metricCatalog'

/**
 * Every optional field is `.nullable().default(null)`, never a bare
 * `.nullable()`: in Zod the latter allows the VALUE null but still requires
 * the KEY, and a model omits a key rather than writing `"x": null`.
 */
export const analysisSchema = z.object({
  title: z.string().describe('Titre court du report'),
  headline: z.string().describe('Résumé en une phrase'),
  key_highlights: z.array(z.string()).describe('3 à 6 points clés'),
  report_period: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Période couverte, en anglais : "January 2026" | "Q4 2025" | "S1 2026" | "2025". null si le document ne couvre aucune période',
    ),
  report_type: z
    .enum(['monthly', 'bimonthly', 'quarterly', 'semi-annual', 'annual'])
    .nullable()
    .default(null)
    .describe("null si le document n'a aucun rythme périodique"),
  metrics: z.array(
    z.object({
      catalog_key: z
        .string()
        .nullable()
        .default(null)
        .describe('Clé du catalogue si la métrique y correspond, sinon null'),
      raw_label: z.string().describe("Libellé d'origine tel qu'écrit dans le report"),
      value: z.number().describe("Valeur numérique TELLE QU'ÉCRITE (aucune conversion)"),
      unit: z.enum(['EUR', 'kEUR', 'MEUR', 'percent', 'count', 'months', 'other']),
      period: z
        .string()
        .nullable()
        .default(null)
        .describe('Période spécifique si différente de la période principale, sinon null'),
    }),
  ),
})

export type Analysis = z.infer<typeof analysisSchema>
type ReportType = NonNullable<Analysis['report_type']>

/** Lowercase and drop everything that is not a letter or a digit, so that
 *  hyphen / space / underscore variants collapse onto one key. */
function fold(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Rhythms the model actually writes, folded. `biannual` is ambiguous in
 * English (twice a year vs every two years) — models use it for the former,
 * which is also the only one of the two this catalog knows.
 */
const REPORT_TYPES: Record<string, ReportType> = {
  monthly: 'monthly',
  month: 'monthly',
  mensuel: 'monthly',
  bimonthly: 'bimonthly',
  twomonth: 'bimonthly',
  twomonthly: 'bimonthly',
  bimestriel: 'bimonthly',
  quarterly: 'quarterly',
  quarter: 'quarterly',
  trimestriel: 'quarterly',
  semiannual: 'semi-annual',
  semiannually: 'semi-annual',
  halfyear: 'semi-annual',
  halfyearly: 'semi-annual',
  sixmonth: 'semi-annual',
  sixmonthly: 'semi-annual',
  biannual: 'semi-annual',
  semestriel: 'semi-annual',
  annual: 'annual',
  annually: 'annual',
  yearly: 'annual',
  year: 'annual',
  annuel: 'annual',
}

/** Units the model actually writes. Currency symbols are spelled out before
 *  folding, otherwise `k€` would collapse to a bare `k`. */
const UNITS: Record<string, SeenUnit> = {
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  keur: 'kEUR',
  keuro: 'kEUR',
  keuros: 'kEUR',
  thousandeur: 'kEUR',
  meur: 'MEUR',
  meuro: 'MEUR',
  meuros: 'MEUR',
  millioneur: 'MEUR',
  millionseur: 'MEUR',
  percent: 'percent',
  percentage: 'percent',
  pct: 'percent',
  pourcent: 'percent',
  count: 'count',
  number: 'count',
  unit: 'count',
  units: 'count',
  month: 'months',
  months: 'months',
  mois: 'months',
}

/** A rhythm the catalog knows, or null — an unknown one is not a failure,
 *  it is simply a document whose rhythm we do not record. */
export function normalizeReportType(raw: unknown): ReportType | null {
  if (typeof raw !== 'string') return null
  return REPORT_TYPES[fold(raw)] ?? null
}

/** Never fails: what cannot be recognized is 'other', which `toCanonical`
 *  refuses for every catalog key. An unknown unit costs a time series entry,
 *  never a wrong conversion. */
export function normalizeUnit(raw: unknown): SeenUnit {
  if (typeof raw !== 'string') return 'other'
  const spelled = raw.replace(/€/g, 'eur').replace(/%/g, 'percent')
  return UNITS[fold(spelled)] ?? 'other'
}

/** A number, or a number as the model wrote it: `"1 200"`, `"1,2"`. Anything
 *  else is null and costs its metric — a value we cannot read is not a value
 *  we may guess. */
export function looseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[\s\u00a0]/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function str(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function toMetric(raw: unknown): RawMetric | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const label = str(o.raw_label)
  const value = looseNumber(o.value)
  // A metric with no label or no readable value says nothing; it is dropped
  // on its own and the rest of the report is stored.
  if (!label || value === null) return null
  return {
    catalog_key: str(o.catalog_key),
    raw_label: label,
    value,
    unit: normalizeUnit(o.unit),
    period: str(o.period),
  }
}

/**
 * Read a free-JSON answer into the analysis shape, keeping everything that
 * can be kept. Returns null only when the answer carries neither title nor
 * headline — there is then no sheet to store, and that is a real failure.
 */
export function parseLenient(raw: unknown): Analysis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const title = str(o.title)
  const headline = str(o.headline)
  if (!title && !headline) return null

  const highlights = Array.isArray(o.key_highlights)
    ? o.key_highlights.map(str).filter((h): h is string => h !== null)
    : []
  const metrics = Array.isArray(o.metrics)
    ? o.metrics.map(toMetric).filter((m): m is RawMetric => m !== null)
    : []

  return {
    // One of the two is present; a sheet reads fine with the same sentence
    // in both slots, and that beats losing the report over a missing title.
    title: title ?? headline!,
    headline: headline ?? title!,
    key_highlights: highlights,
    report_period: str(o.report_period),
    report_type: normalizeReportType(o.report_type),
    metrics,
  }
}
