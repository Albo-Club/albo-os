/**
 * Canonical metric catalog (brick 5). Pure, unit-tested.
 *
 * The anti-drift system, per validated design:
 * - CLOSED catalog: kpiSnapshots only ever receives keys listed here. An
 *   unrecognized metric stays on the report's raw snapshot (and will be
 *   surfaced for approval in the recap, brick 6) — it can never pollute
 *   time series.
 * - The LLM reports values AS WRITTEN plus the unit it saw; conversion to
 *   storage conventions (EUR cents, basis points) is DETERMINISTIC CODE.
 * - "A missing metric is not a zero": absent → not reported at all.
 */

export type CatalogUnit = 'eur' | 'percent' | 'count' | 'months'

export interface CatalogEntry {
  key: string
  unit: CatalogUnit
  /** Short French hint shown to the extraction model. */
  hint: string
}

export const METRIC_CATALOG: Array<CatalogEntry> = [
  { key: 'revenue', unit: 'eur', hint: "chiffre d'affaires de la période" },
  { key: 'mrr', unit: 'eur', hint: 'revenu récurrent mensuel' },
  { key: 'arr', unit: 'eur', hint: 'revenu récurrent annuel' },
  { key: 'gmv', unit: 'eur', hint: "volume d'affaires (marketplace)" },
  { key: 'cogs', unit: 'eur', hint: 'coût des ventes' },
  { key: 'gross_margin', unit: 'eur', hint: 'marge brute (montant)' },
  { key: 'gross_margin_pct', unit: 'percent', hint: 'marge brute en %' },
  { key: 'staff_costs', unit: 'eur', hint: 'charges de personnel' },
  { key: 'other_opex', unit: 'eur', hint: "autres charges d'exploitation" },
  { key: 'ebitda', unit: 'eur', hint: 'EBITDA' },
  { key: 'ebitda_margin_pct', unit: 'percent', hint: 'marge EBITDA en %' },
  { key: 'depreciation', unit: 'eur', hint: 'amortissements' },
  { key: 'operating_result', unit: 'eur', hint: "résultat d'exploitation" },
  { key: 'financial_result', unit: 'eur', hint: 'résultat financier' },
  { key: 'pretax_result', unit: 'eur', hint: 'résultat avant impôts' },
  { key: 'net_result', unit: 'eur', hint: 'résultat net' },
  { key: 'tax', unit: 'eur', hint: 'impôts' },
  { key: 'cash_position', unit: 'eur', hint: 'trésorerie disponible fin de période' },
  { key: 'burn_rate', unit: 'eur', hint: 'burn mensuel brut' },
  { key: 'burn_rate_net', unit: 'eur', hint: 'burn mensuel net' },
  { key: 'runway_months', unit: 'months', hint: 'runway en mois' },
  { key: 'capital_raised', unit: 'eur', hint: 'montant levé (si annoncé)' },
  { key: 'debt', unit: 'eur', hint: 'dette financière' },
  { key: 'headcount', unit: 'count', hint: 'effectif (FTE)' },
  { key: 'customers', unit: 'count', hint: 'clients actifs/payants' },
  { key: 'users', unit: 'count', hint: 'utilisateurs' },
  { key: 'subscribers', unit: 'count', hint: 'abonnés' },
  { key: 'churn_rate_pct', unit: 'percent', hint: 'churn en %' },
  { key: 'conversion_rate_pct', unit: 'percent', hint: 'taux de conversion en %' },
  { key: 'nps', unit: 'count', hint: 'NPS' },
  { key: 'aum', unit: 'eur', hint: 'encours sous gestion' },
  { key: 'tvpi', unit: 'count', hint: 'TVPI (multiple)' },
  { key: 'dpi', unit: 'count', hint: 'DPI (multiple)' },
  { key: 'moic', unit: 'count', hint: 'MOIC (multiple)' },
  { key: 'irr_pct', unit: 'percent', hint: 'TRI en %' },
]

const CATALOG_BY_KEY = new Map(METRIC_CATALOG.map((e) => [e.key, e]))

/** The unit vocabulary the LLM may use for "value as written". */
export type SeenUnit = 'EUR' | 'kEUR' | 'MEUR' | 'percent' | 'count' | 'months' | 'other'

export interface RawMetric {
  catalog_key: string | null
  raw_label: string
  value: number
  unit: SeenUnit
  period: string | null
}

export interface CanonicalMetric {
  metricType: string
  value: number
  /** Storage unit per Albo OS conventions. */
  unit: 'EUR_cents' | 'bps' | 'count' | 'months'
}

/**
 * Deterministic conversion of a raw (as-written) metric to storage
 * conventions. Returns null when the metric can't safely land in the
 * catalog: unknown key, or a seen unit incompatible with the catalog unit
 * (e.g. a percentage reported for an EUR metric) — it then stays on the raw
 * snapshot only. Non-EUR currencies never reach this function: the prompt
 * instructs the model to keep them out of catalog keys (unit 'other').
 */
export function toCanonical(m: RawMetric): CanonicalMetric | null {
  if (!m.catalog_key) return null
  const entry = CATALOG_BY_KEY.get(m.catalog_key)
  if (!entry) return null
  if (!Number.isFinite(m.value)) return null

  switch (entry.unit) {
    case 'eur': {
      if (m.unit === 'EUR') return { metricType: entry.key, value: Math.round(m.value * 100), unit: 'EUR_cents' }
      if (m.unit === 'kEUR') return { metricType: entry.key, value: Math.round(m.value * 100_000), unit: 'EUR_cents' }
      if (m.unit === 'MEUR') return { metricType: entry.key, value: Math.round(m.value * 100_000_000), unit: 'EUR_cents' }
      return null
    }
    case 'percent': {
      if (m.unit !== 'percent') return null
      // "11 %" → 1100 bps. Values already in decimal (0.11) are the model's
      // job to report as 11 percent; a decimal <1 with percent unit is
      // ambiguous → treated as a fraction of a percent, stored as-is.
      return { metricType: entry.key, value: Math.round(m.value * 100), unit: 'bps' }
    }
    case 'count': {
      if (m.unit !== 'count') return null
      return { metricType: entry.key, value: m.value, unit: 'count' }
    }
    case 'months': {
      if (m.unit !== 'months') return null
      return { metricType: entry.key, value: m.value, unit: 'months' }
    }
  }
}

/** Catalog rendered for the extraction prompt. */
export function catalogPromptList(): string {
  return METRIC_CATALOG.map((e) => `- ${e.key} (${e.unit}) : ${e.hint}`).join('\n')
}

const MAX_KPI_TARGETS = 15

/**
 * Per-company target KPI list (fiche KPI cible): dedupe, keep only catalog
 * keys, cap the length. Order is preserved (it drives the recap checklist).
 */
export function sanitizeKpiTargets(keys: Array<string>): Array<string> {
  const out: Array<string> = []
  for (const key of keys) {
    if (CATALOG_BY_KEY.has(key) && !out.includes(key)) out.push(key)
    if (out.length >= MAX_KPI_TARGETS) break
  }
  return out
}

/** The target keys rendered for the extraction prompt (with their hints). */
export function targetsPromptList(targets: Array<string>): string {
  return targets
    .map((key) => {
      const e = CATALOG_BY_KEY.get(key)
      return e ? `- ${e.key} (${e.unit}) : ${e.hint}` : `- ${key}`
    })
    .join('\n')
}
