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

// Powens connection health: pull the connection states every 6h (belt &
// braces with the CONNECTION_SYNCED webhook — the pull is the only feed that
// still works when webhooks stop arriving) + staleness evaluation & alerts.
crons.interval(
  'poll powens connections health',
  { hours: 6 },
  internal.powens.pollConnectionsHealth,
  {},
)

// Refresh the VASCO/Parallel communications cache every 2 days. VASCO has no
// webhook for the investor persona (pull-only), so the UI reads a local cache
// and this keeps it fresh in the background; a manual "refresh" button covers
// urgent needs. cf. KNOWN_ISSUES.md « VASCO API ».
crons.interval(
  'refresh vasco communications cache',
  { hours: 48 },
  internal.vasco.refreshAllVascoCaches,
  {},
)

export default crons
