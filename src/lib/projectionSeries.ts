/**
 * Séries « BP vs réalisé » d'un deal (logique pure, testée par
 * tests/projectionSeries.test.ts).
 *
 * Les périodes du tableau = union triée des périodes des deux versions du
 * BP. Le réalisé (transactions pointées) est rangé dans la période dont le
 * début est le plus récent ≤ date de la transaction (les tx antérieures à
 * la première période sont clampées dans la première). Tous les montants
 * sont nets en cents : `in` − `out`.
 */

export type ProjectionLine = {
  period: number // ms epoch, début de période
  amountCents: number // positif
  direction: 'in' | 'out'
}

export type ActualTx = {
  transactionDate: number
  amount: number // positif (cents)
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
   * Écart cumulé réalisé − attendu. Référence = BP révisé s'il existe,
   * sinon BP initial.
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

  // Réalisé net par période (clamp avant la première période).
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
