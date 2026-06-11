/**
 * "BP vs actual" series of a deal (pure logic, tested by
 * tests/projectionSeries.test.ts).
 *
 * Table periods = sorted union of the periods of both BP versions. Actuals
 * (matched transactions) are bucketed into the period whose start is the
 * most recent ≤ transaction date (txs earlier than the first period are
 * clamped into the first one). All amounts are net cents: `in` − `out`.
 */

export type ProjectionLine = {
  period: number // ms epoch, period start
  amountCents: number // positive
  direction: 'in' | 'out'
}

export type ActualTx = {
  transactionDate: number
  amount: number // positive (cents)
  direction: 'in' | 'out'
}

export type PlanVsActualRow = {
  period: number
  initialCents: number
  revisedCents: number
  actualCents: number
  initialCumCents: number
  revisedCumCents: number
  actualCumCents: number
  /**
   * Cumulative gap actual − expected. Reference = revised BP if one
   * exists, otherwise initial BP.
   */
  gapCumCents: number
}

function netCents(lines: Array<ProjectionLine>, period: number): number {
  let net = 0
  for (const line of lines) {
    if (line.period !== period) continue
    net += line.direction === 'in' ? line.amountCents : -line.amountCents
  }
  return net
}

export function buildPlanVsActual({
  initial,
  revised,
  actuals,
}: {
  initial: Array<ProjectionLine>
  revised: Array<ProjectionLine>
  actuals: Array<ActualTx>
}): Array<PlanVsActualRow> {
  const periods = [
    ...new Set([...initial, ...revised].map((line) => line.period)),
  ].sort((a, b) => a - b)
  if (periods.length === 0) return []

  // Net actuals per period (clamped before the first period).
  const actualByPeriod = new Map<number, number>()
  for (const tx of actuals) {
    let bucket = periods[0]
    for (const period of periods) {
      if (period <= tx.transactionDate) bucket = period
      else break
    }
    const net = tx.direction === 'in' ? tx.amount : -tx.amount
    actualByPeriod.set(bucket, (actualByPeriod.get(bucket) ?? 0) + net)
  }

  const hasRevised = revised.length > 0
  let initialCum = 0
  let revisedCum = 0
  let actualCum = 0

  return periods.map((period) => {
    const initialCents = netCents(initial, period)
    const revisedCents = netCents(revised, period)
    const actualCents = actualByPeriod.get(period) ?? 0
    initialCum += initialCents
    revisedCum += revisedCents
    actualCum += actualCents
    return {
      period,
      initialCents,
      revisedCents,
      actualCents,
      initialCumCents: initialCum,
      revisedCumCents: revisedCum,
      actualCumCents: actualCum,
      gapCumCents: actualCum - (hasRevised ? revisedCum : initialCum),
    }
  })
}
