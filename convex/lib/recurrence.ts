/**
 * Logique pure de la couche cash flow forecast (aucune dépendance Convex,
 * aucun import Node) : date-math de récurrence + décision d'upsert des
 * occurrences. Tout est calculé en UTC sur des ms epoch, conformément aux
 * conventions du schéma. Testé par tests/recurrence.test.ts (node:test,
 * volontairement hors de convex/ pour rester hors du bundle de déploiement).
 */

export type ForecastFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type RecurrenceRule = {
  frequency: ForecastFrequency
  /** « Tous les N pas » — 1 = chaque semaine/mois/trimestre/année. */
  interval: number
  /** Jour du mois 1-31 (monthly/quarterly/yearly) ou jour ISO 1-7 (weekly). */
  anchorDay: number
  startDate: number
  /** Borne incluse ; absent = sans fin. */
  endDate?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Nombre de jours du mois (month 0-based, normalisé par Date.UTC), en UTC. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** "YYYY-MM-DD" UTC. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** "YYYY-MM" UTC — clé de bucket pour l'agrégation mensuelle du solde. */
export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7)
}

/** Clé d'idempotence d'une occurrence dérivée d'une règle. */
export function ruleDerivedKey(ruleId: string, occurrenceMs: number): string {
  return `rule:${ruleId}:${isoDay(occurrenceMs)}`
}

// ─── Agrégation mensuelle du solde projeté ──────────────────────────────────

export type ForecastConfidence = 'confirmed' | 'expected' | 'probable'

export type ForecastEntryStatus = 'pending' | 'realized' | 'cancelled'

/** Rang de confiance : `minConfidence` inclut tout rang supérieur ou égal. */
export const CONFIDENCE_RANK: Record<ForecastConfidence, number> = {
  confirmed: 2,
  expected: 1,
  probable: 0,
}

/** Champs d'une entry nécessaires à l'agrégation du solde. */
export type BalanceEntry = {
  date: number
  amountCents: number
  direction: 'in' | 'out'
  confidence: ForecastConfidence
  status: ForecastEntryStatus
  currency: string
}

export type MonthlyBalance = {
  monthKey: string
  inflowCents: number
  outflowCents: number
  netCents: number
  projectedBalanceCents: number
}

/** Minuit UTC du 1er du mois de `ms`. */
function startOfMonthUtc(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/**
 * Agrège des entries prévisionnelles en solde projeté mensuel cumulé.
 *
 * - Seules les entries `pending`, en EUR, de confiance ≥ `minConfidence`
 *   comptent (absent = tout). Les non-EUR sont comptées à part (visibilité),
 *   jamais agrégées.
 * - La grille couvre tous les mois de [windowStart, windowEnd], y compris
 *   ceux sans flux (net 0), pour une trajectoire continue.
 * - Le solde projeté de chaque mois = solde de départ + cumul des nets.
 */
export function buildMonthlyBalance(params: {
  entries: Array<BalanceEntry>
  startingBalanceCents: number
  windowStart: number
  windowEnd: number
  minConfidence?: ForecastConfidence
}): { months: Array<MonthlyBalance>; ignoredNonEurEntries: number } {
  const minRank = params.minConfidence
    ? CONFIDENCE_RANK[params.minConfidence]
    : 0

  // Grille de mois (clé → flux), dans l'ordre chronologique.
  const buckets = new Map<
    string,
    { inflowCents: number; outflowCents: number }
  >()
  for (
    let cursor = startOfMonthUtc(params.windowStart);
    cursor <= params.windowEnd;
    cursor = addMonthsUtc(cursor, 1)
  ) {
    buckets.set(monthKey(cursor), { inflowCents: 0, outflowCents: 0 })
  }

  let ignoredNonEurEntries = 0
  for (const entry of params.entries) {
    if (entry.status !== 'pending') continue
    if (entry.currency !== 'EUR') {
      ignoredNonEurEntries += 1
      continue
    }
    if (CONFIDENCE_RANK[entry.confidence] < minRank) continue
    const bucket = buckets.get(monthKey(entry.date))
    if (!bucket) continue // hors fenêtre
    if (entry.direction === 'in') bucket.inflowCents += entry.amountCents
    else bucket.outflowCents += entry.amountCents
  }

  let runningCents = params.startingBalanceCents
  const months: Array<MonthlyBalance> = []
  for (const [key, bucket] of buckets) {
    const netCents = bucket.inflowCents - bucket.outflowCents
    runningCents += netCents
    months.push({
      monthKey: key,
      inflowCents: bucket.inflowCents,
      outflowCents: bucket.outflowCents,
      netCents,
      projectedBalanceCents: runningCents,
    })
  }

  return { months, ignoredNonEurEntries }
}

// ─── Décision d'upsert des occurrences générées ─────────────────────────────

/** État minimal d'une entry existante pour décider de l'upsert. */
export type ExistingEntryState = {
  overridden: boolean
  status: ForecastEntryStatus
}

/**
 * Décision d'upsert d'une occurrence générée par expandRules :
 * - `create` : aucune entry pour cette derivedKey.
 * - `skip` : l'entry existante est protégée — éditée à la main (`overridden`),
 *   déjà réalisée ou annulée. La régénération ne la touche JAMAIS.
 * - `update` : entry dérivée intacte → resynchro depuis la règle.
 */
export function entryUpsertAction(
  existing: ExistingEntryState | null,
): 'create' | 'update' | 'skip' {
  if (!existing) return 'create'
  if (existing.overridden || existing.status !== 'pending') return 'skip'
  return 'update'
}

/**
 * Ajoute n mois (UTC) à un timestamp en clampant le jour du mois
 * (31 janv. + 1 mois = 28/29 févr.). Sert à borner l'horizon de projection.
 */
export function addMonthsUtc(ms: number, months: number): number {
  const d = new Date(ms)
  const targetMonth = d.getUTCMonth() + months
  const day = Math.min(
    d.getUTCDate(),
    daysInMonth(d.getUTCFullYear(), targetMonth),
  )
  return Date.UTC(
    d.getUTCFullYear(),
    targetMonth,
    day,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

/** Minuit UTC du `anchorDay` (clampé au dernier jour) du mois year/month. */
function monthAnchor(year: number, month: number, anchorDay: number): number {
  const day = Math.min(anchorDay, daysInMonth(year, month))
  return Date.UTC(year, month, day)
}

/**
 * Déplie les occurrences d'une règle dans la fenêtre [from, to] (bornes
 * incluses). Les occurrences tombent à minuit UTC, jamais avant `startDate`
 * ni après `endDate`. La séquence est ancrée sur `startDate` (un trimestriel
 * démarré en mars tombe en mars/juin/sept./déc., quel que soit `from`).
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  from: number,
  to: number,
): Array<number> {
  const interval = Math.max(1, Math.floor(rule.interval))
  const windowStart = Math.max(from, rule.startDate)
  const windowEnd = rule.endDate === undefined ? to : Math.min(to, rule.endDate)
  if (windowEnd < windowStart) return []

  const out: Array<number> = []

  if (rule.frequency === 'weekly') {
    const start = new Date(rule.startDate)
    const startMidnight = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    )
    // getUTCDay() : 0 = dimanche … 6 = samedi → ISO : 1 = lundi … 7 = dimanche.
    const startIsoDay = start.getUTCDay() === 0 ? 7 : start.getUTCDay()
    // Première occurrence : premier `anchorDay` ISO ≥ startDate.
    const offsetDays = (rule.anchorDay - startIsoDay + 7) % 7
    const stepMs = 7 * interval * DAY_MS
    for (
      let occ = startMidnight + offsetDays * DAY_MS;
      occ <= windowEnd;
      occ += stepMs
    ) {
      if (occ >= windowStart) out.push(occ)
    }
    return out
  }

  // monthly / quarterly / yearly : pas exprimé en mois.
  const monthsPerStep =
    rule.frequency === 'monthly'
      ? interval
      : rule.frequency === 'quarterly'
        ? 3 * interval
        : 12 * interval

  const start = new Date(rule.startDate)
  const year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  // Première occurrence ≥ startDate : le anchorDay du mois de startDate,
  // sinon celui du pas suivant.
  if (monthAnchor(year, month, rule.anchorDay) < rule.startDate) {
    month += monthsPerStep
  }
  for (
    let occ = monthAnchor(year, month, rule.anchorDay);
    occ <= windowEnd;
    month += monthsPerStep, occ = monthAnchor(year, month, rule.anchorDay)
  ) {
    if (occ >= windowStart) out.push(occ)
  }
  return out
}
