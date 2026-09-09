/**
 * Which backup archives to keep, and which to drop (ALB-234).
 *
 * A pure function over the archive NAMES — no clock, no network, no state.
 * That is the whole point: the rotation is recomputed from what is actually
 * in the bucket on every run, so a missed run, a late run or a run replayed
 * twice all converge on the same set. Nothing has to be labelled, promoted
 * or remembered between runs.
 *
 * Names are `albo-os-YYYY-MM-DD.zip` (data only) and
 * `albo-os-YYYY-MM-DD-full.zip` (data + file storage).
 *
 * Three overlapping buckets, union kept:
 *   - daily   : the N most recent archives, whatever their kind.
 *   - weekly  : for each of the N most recent ISO weeks that hold one, the
 *               most recent FULL archive of that week.
 *   - monthly : same, per calendar month.
 *
 * Weekly and monthly only ever hold FULL archives on purpose: a restore point
 * a week old that carries no files is not a restore point. The daily bucket
 * is data-only most days, which is the whole cost saving — a PDF never
 * changes after upload, so re-exporting it 365 times a year protects nothing.
 *
 * The horizons are counted over the archives PRESENT, not over the calendar.
 * If backups stopped for two months, this keeps the last four weeks that
 * exist rather than deciding that everything is too old and deleting the lot.
 *
 * Anything whose name is not recognised is reported as `unknown` and NEVER
 * dropped: this function's output drives deletions, so a stray file in the
 * folder must not be collateral damage.
 */

/** Default horizons: 7 daily, 4 weekly, 12 monthly (ALB-234). */
export const DEFAULT_POLICY = { daily: 7, weekly: 4, monthly: 12 }

const NAME_RE = /^albo-os-(\d{4})-(\d{2})-(\d{2})(-full)?\.zip$/

/**
 * ISO-8601 week key, e.g. "2026-W37". Thursday-based: the ISO week of a date
 * is the week containing the Thursday of that date's Monday-start week, which
 * is what makes the year roll over correctly around 1 January.
 * @param {string} ymd `YYYY-MM-DD`
 */
export function isoWeekKey(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const dayMonFirst = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayMonFirst + 3) // the Thursday of this ISO week
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((t.getTime() - jan4.getTime()) / (7 * 86400000))
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * @param {string} name
 * @returns {{ name: string, date: string, full: boolean } | null}
 */
export function parseArchiveName(name) {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, full] = m
  const date = `${y}-${mo}-${d}`
  // Reject a well-formed but impossible date (2026-02-31): it would sort and
  // group wrong, and it is not something this script ever wrote.
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(date)) return null
  return { name, date, full: Boolean(full) }
}

/**
 * @param {Array<string>} names archive names present in the bucket
 * @param {{ daily: number, weekly: number, monthly: number }} [policy]
 * @returns {{ keep: Array<string>, drop: Array<string>, unknown: Array<string> }}
 */
export function planRetention(names, policy = DEFAULT_POLICY) {
  const unknown = []
  const archives = []
  for (const name of names) {
    const parsed = parseArchiveName(name)
    if (parsed) archives.push(parsed)
    else unknown.push(name)
  }

  // Most recent first. Same date twice (a manual run on top of the cron):
  // the full one wins the tie, so the richer archive is the one a bucket
  // slot keeps.
  archives.sort((a, b) => (a.date === b.date ? Number(b.full) - Number(a.full) : b.date < a.date ? -1 : 1))

  const keep = new Set()

  for (const a of archives.slice(0, policy.daily)) keep.add(a.name)

  for (const [bucketKey, limit] of [
    [(a) => isoWeekKey(a.date), policy.weekly],
    [(a) => a.date.slice(0, 7), policy.monthly],
  ]) {
    const firstOfBucket = new Map()
    for (const a of archives) {
      // Only FULL archives can hold a weekly or monthly slot.
      if (!a.full) continue
      const key = bucketKey(a)
      if (!firstOfBucket.has(key)) firstOfBucket.set(key, a.name)
    }
    // `archives` is already sorted most-recent-first, so Map insertion order
    // is bucket order — the N first are the N most recent buckets.
    for (const name of [...firstOfBucket.values()].slice(0, limit)) keep.add(name)
  }

  return {
    keep: archives.filter((a) => keep.has(a.name)).map((a) => a.name),
    drop: archives.filter((a) => !keep.has(a.name)).map((a) => a.name),
    unknown,
  }
}
