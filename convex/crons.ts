/**
 * Convex cron jobs — first (and only) cron surface of the app. Crons call
 * INTERNAL functions that run without auth: same exception family as the
 * backfills, NOT a precedent for skipping `requireOrgMember` in
 * public functions (cf. KNOWN_ISSUES « Cash flow forecast »).
 */
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Monthly photo of every org's projected balance — feeds the forecast
// reliability measure (projected vs realized once the month closes).
crons.monthly(
  'capture forecast snapshots',
  { day: 1, hourUTC: 5, minuteUTC: 0 },
  internal.forecasts.captureSnapshots,
  {},
)

// Daily cash threshold alerts (7-day cooldown handled in the mutation).
crons.daily(
  'check cash alerts',
  { hourUTC: 7, minuteUTC: 0 },
  internal.forecasts.checkCashAlerts,
  {},
)

export default crons
