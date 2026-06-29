/**
 * Pure helpers for the royalties custom panel (RoyaltiesPanel). Parsing of the
 * pasted BP (tab-separated Excel/Sheets selection) and the per-quarter derived
 * figures. Kept here (not in the component) so they stay testable and mirror
 * src/lib/parse.ts. Storage conventions: amounts in cents, rates in bps.
 */

export type BpPoint = { quarter: string; plannedRevenue: number }
export type ActualPoint = { quarter: string; actualRevenue: number }

/**
 * Raw quarter label → canonical `"Qn YYYY"` (e.g. "T3 2025", "2025-Q3",
 * "3T 2025" → "Q3 2025"). Accepts the French "T" and English "Q" markers in
 * any order around the digit. Returns null when no quarter digit (1-4) and a
 * 4-digit year can both be found — that row is then skipped by the caller.
 */
export function normalizeQuarter(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const year = s.match(/\b(20\d{2})\b/)?.[1]
  const q =
    s.match(/[QqTt]\s*([1-4])\b/)?.[1] ?? s.match(/\b([1-4])\s*[QqTt]/)?.[1]
  if (!year || !q) return null
  return `Q${q} ${year}`
}

/** Sort key for a canonical `"Qn YYYY"` quarter (year-major). */
export function quarterSortKey(quarter: string): number {
  const m = quarter.match(/Q([1-4])\s+(\d{4})/)
  if (!m) return 0
  return Number(m[2]) * 10 + Number(m[1])
}

/**
 * Amount string pasted from Excel/Sheets → cents (integer). Tolerant of FR and
 * US formats: strips the € symbol and (regular / non-breaking / narrow)
 * spaces, then resolves the decimal separator. When both `,` and `.` are
 * present the rightmost is the decimal separator and the other is the
 * thousands grouping. A lone comma followed by exactly 3 digits is read as a
 * thousands separator ("12,000" → 12000), otherwise as a decimal ("12,50" →
 * 12.5) — UNLESS a space already groups the thousands ("311 995,152"), in
 * which case the comma is always the decimal separator (a space and a comma
 * can't both be thousands groupers). Returns null for a non-finite or negative
 * result.
 */
export function parseAmountToCents(raw: string): number | null {
  // A space between digits means the thousands are already grouped by spaces,
  // so a lone comma further right must be the decimal separator. `\s` covers
  // regular, non-breaking and narrow spaces.
  const hadSpaceGroup = /\d\s\d/.test(raw)
  let s = raw.trim().replace(/[\u20ac$\s]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1
    const isThousands = !hadSpaceGroup && decimals === 3
    s = isThousands ? s.replace(/,/g, '') : s.replace(',', '.')
  }
  const n = Number.parseFloat(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export type BpParseResult = { rows: Array<BpPoint>; skipped: number }

/**
 * Pasted BP block (2 columns: quarter, planned revenue) → BP points. Lines
 * split on `\n`, columns on `\t`. Rows that can't be parsed (missing column,
 * unrecognized quarter, bad amount) are counted in `skipped`. Duplicate
 * quarters keep the last occurrence. Result is sorted chronologically.
 */
export function parseBpPaste(text: string): BpParseResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const byQuarter = new Map<string, number>()
  let skipped = 0
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length < 2) {
      skipped++
      continue
    }
    const quarter = normalizeQuarter(cols[0])
    const planned = parseAmountToCents(cols[1])
    if (!quarter || planned == null) {
      skipped++
      continue
    }
    byQuarter.set(quarter, planned)
  }
  const rows = [...byQuarter.entries()]
    .map(([quarter, plannedRevenue]) => ({ quarter, plannedRevenue }))
    .sort((a, b) => quarterSortKey(a.quarter) - quarterSortKey(b.quarter))
  return { rows, skipped }
}

/** One assembled table row: union of BP and actuals for a quarter + derived. */
export type RoyaltyRow = {
  quarter: string
  // CA
  plannedRevenue?: number // BP initial
  degradedRevenue?: number // BP dégradé = planned × (1 - depreciation)
  actualRevenue?: number // réel
  // Royalties (= CA × royaltyRate)
  plannedRoyalty?: number
  degradedRoyalty?: number
  actualRoyalty?: number
  // Gap: actual royalty vs degraded royalty (€ and ratio). % is identical
  // whether computed on CA or royalties (the rate cancels out); € uses
  // royalties — the figure the investor actually receives.
  gapAbs?: number
  gapPct?: number
}

/** Column cumulative totals shown in the table footer. */
export type RoyaltyTotals = {
  plannedRevenue: number
  degradedRevenue: number
  actualRevenue: number
  plannedRoyalty: number
  degradedRoyalty: number
  actualRoyalty: number
  gapAbs: number
}

/**
 * Assemble the comparison rows (one per quarter, union of BP ∪ actuals, sorted)
 * and the column totals. Everything is derived here — nothing is stored beyond
 * bpPoints / actualPoints / the three scalar parameters.
 */
export function buildRoyaltyRows(
  bpPoints: Array<BpPoint> | undefined,
  actualPoints: Array<ActualPoint> | undefined,
  depreciationRate: number | undefined, // bps
  royaltyRate: number | undefined, // bps
): { rows: Array<RoyaltyRow>; totals: RoyaltyTotals } {
  const deprec = (depreciationRate ?? 0) / 10000
  const rate = (royaltyRate ?? 0) / 10000
  const plannedByQ = new Map((bpPoints ?? []).map((p) => [p.quarter, p.plannedRevenue]))
  const actualByQ = new Map((actualPoints ?? []).map((p) => [p.quarter, p.actualRevenue]))
  const quarters = [...new Set([...plannedByQ.keys(), ...actualByQ.keys()])].sort(
    (a, b) => quarterSortKey(a) - quarterSortKey(b),
  )

  const totals: RoyaltyTotals = {
    plannedRevenue: 0,
    degradedRevenue: 0,
    actualRevenue: 0,
    plannedRoyalty: 0,
    degradedRoyalty: 0,
    actualRoyalty: 0,
    gapAbs: 0,
  }

  const rows = quarters.map((quarter): RoyaltyRow => {
    const planned = plannedByQ.get(quarter)
    const actual = actualByQ.get(quarter)
    const degraded = planned != null ? Math.round(planned * (1 - deprec)) : undefined
    const plannedRoyalty = planned != null ? Math.round(planned * rate) : undefined
    const degradedRoyalty = degraded != null ? Math.round(degraded * rate) : undefined
    const actualRoyalty = actual != null ? Math.round(actual * rate) : undefined
    const gapAbs =
      actualRoyalty != null && degradedRoyalty != null
        ? actualRoyalty - degradedRoyalty
        : undefined
    const gapPct =
      gapAbs != null && degradedRoyalty
        ? gapAbs / degradedRoyalty
        : undefined

    if (planned != null) {
      totals.plannedRevenue += planned
      totals.plannedRoyalty += plannedRoyalty ?? 0
    }
    if (degraded != null) {
      totals.degradedRevenue += degraded
      totals.degradedRoyalty += degradedRoyalty ?? 0
    }
    if (actual != null) {
      totals.actualRevenue += actual
      totals.actualRoyalty += actualRoyalty ?? 0
    }
    if (gapAbs != null) totals.gapAbs += gapAbs

    return {
      quarter,
      plannedRevenue: planned,
      degradedRevenue: degraded,
      actualRevenue: actual,
      plannedRoyalty,
      degradedRoyalty,
      actualRoyalty,
      gapAbs,
      gapPct,
    }
  })

  return { rows, totals }
}
