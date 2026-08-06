/**
 * « Silent company » detection — a portfolio company that stopped giving news,
 * or never started.
 *
 * Two channels count as news, because an entity has two ways of reaching us:
 * the investor reports ingested by email (`companyReports`) and the investor
 * communications published on a fund-admin portal (`vascoCommunicationsCache`,
 * e.g. the Parallel SPVs). An SPV never emails anything — it publishes on the
 * portal — so reading the reports alone flagged every linked SPV as silent
 * while its communications were days old.
 *
 * Threshold: `organizations.reportSilenceMonths` (4 months by default),
 * measured on the RECEPTION date of the last news, never on the period it
 * covers — a quarterly reporter would otherwise look silent the day after
 * reporting.
 *
 * A company that never reported is measured from its FIRST DISBURSEMENT
 * instead: funds wired two weeks ago do not owe a report yet. That date is
 * the earliest outflow reconciled on one of its live deals, falling back to
 * the deal's signature date when nothing is reconciled (old imported deals
 * would never be evaluable otherwise).
 *
 * Scope: non-archived portfolio companies target of at least one live deal —
 * an exited position would nag forever.
 */

import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/** Months of silence before a company is flagged, when the org sets nothing. */
export const DEFAULT_SILENCE_MONTHS = 4

/** Bounds of the per-org setting (validated in the mutation and the form). */
export const MIN_SILENCE_MONTHS = 1
export const MAX_SILENCE_MONTHS = 24

/** Channel the last news came through — the tooltip names it, so the reader
 * knows where to go looking. */
export type NewsSource = 'report' | 'vasco'

export type SilentCompany = {
  companyId: Id<'companies'>
  companyName: string
  /** Reception date of the last news, null when the company never gave any. */
  lastNewsAt: number | null
  /** Channel of that last news, null when there never was any. */
  lastNewsSource: NewsSource | null
  /** Most recent period covered by a report, null when unknown. */
  coverageUntil: number | null
  /** What the silence is counted from: last news, else first disbursement. */
  sinceAt: number
}

/** Date before which a company is considered silent (calendar months back). */
export function silenceCutoff(now: number, months: number): number {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff.getTime()
}

/**
 * Records a stored report's dates on its company row — the denormalized copy
 * `listSilentCompanies` reads (cf. `companies.lastReportAt` in the schema).
 *
 * Called from the single write site of `companyReports`
 * (`reportStore.storeForCompany`), so the copy cannot silently fall behind.
 * Monotonic: only a MORE RECENT date wins, which keeps a re-imported period
 * or a back-dated report from rewinding the freshness. Writes nothing when
 * neither date moves — an idempotent re-import stays a no-op.
 */
export async function recordReportOnCompany(
  ctx: GenericMutationCtx<DataModel>,
  companyId: Id<'companies'>,
  report: { receivedAt: number; periodSortDate?: number },
): Promise<void> {
  const company = await ctx.db.get('companies', companyId)
  if (!company) return

  const patch: {
    lastReportAt?: number
    lastReportCoverageAt?: number
  } = {}
  if (
    company.lastReportAt === undefined ||
    report.receivedAt > company.lastReportAt
  ) {
    patch.lastReportAt = report.receivedAt
  }
  if (
    report.periodSortDate !== undefined &&
    (company.lastReportCoverageAt === undefined ||
      report.periodSortDate > company.lastReportCoverageAt)
  ) {
    patch.lastReportCoverageAt = report.periodSortDate
  }
  if (Object.keys(patch).length === 0) return
  await ctx.db.patch('companies', companyId, patch)
}

/** Earliest outflow reconciled on a deal, null when nothing is pointed. */
async function firstOutflowAt(
  ctx: Ctx,
  dealId: Id<'deals'>,
): Promise<number | null> {
  const txs = await ctx.db
    .query('transactions')
    .withIndex('by_deal', (q) => q.eq('dealId', dealId))
    .collect()
  let first: number | null = null
  for (const tx of txs) {
    if (tx.direction !== 'out') continue
    if (first === null || tx.transactionDate < first) first = tx.transactionDate
  }
  return first
}

/**
 * The org's silent companies, longest silence first. Reads the org's live
 * deals, its portfolio companies and its portal communications; the reports
 * themselves are NEVER read here — their two dates are denormalized on the
 * company row (cf. `recordReportOnCompany`). The transactions are only read
 * for companies that never gave news (the sole case where the disbursement
 * date is needed).
 */
export async function listSilentCompanies(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  now: number,
): Promise<Array<SilentCompany>> {
  const org = await ctx.db.get('organizations', orgId)
  const cutoff = silenceCutoff(
    now,
    org?.reportSilenceMonths ?? DEFAULT_SILENCE_MONTHS,
  )

  // Live deals, kept per company for the never-reported fallback.
  const dealsByCompany = new Map<Id<'companies'>, Array<Id<'deals'>>>()
  const signedByCompany = new Map<Id<'companies'>, number>()
  const activeDeals = await ctx.db
    .query('deals')
    .withIndex('by_org_status', (q) =>
      q.eq('orgId', orgId).eq('status', 'active'),
    )
    .collect()
  for (const deal of activeDeals) {
    const list = dealsByCompany.get(deal.targetCompanyId) ?? []
    list.push(deal._id)
    dealsByCompany.set(deal.targetCompanyId, list)
    const signed = deal.signedDate ?? deal._creationTime
    const known = signedByCompany.get(deal.targetCompanyId)
    if (known === undefined || signed < known) {
      signedByCompany.set(deal.targetCompanyId, signed)
    }
  }

  const companies = await ctx.db
    .query('companies')
    .withIndex('by_org_kind', (q) =>
      q.eq('orgId', orgId).eq('kind', 'portfolio'),
    )
    .collect()

  // Last portal communication per company, for the entities linked to their
  // issuer. Publishing IS the reception here — there is no mail to wait for.
  // The cache is only read when at least one entity is linked, so an org
  // without a portal connection keeps its previous set of subscriptions.
  const byIssuer = new Map<string, Id<'companies'>>()
  for (const company of companies) {
    if (company.vascoClientSlug && company.vascoIssuerId) {
      byIssuer.set(
        `${company.vascoClientSlug}:${company.vascoIssuerId}`,
        company._id,
      )
    }
  }
  const lastComm = new Map<Id<'companies'>, number>()
  if (byIssuer.size > 0) {
    const comms = await ctx.db
      .query('vascoCommunicationsCache')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    for (const comm of comms) {
      const companyId = byIssuer.get(`${comm.clientSlug}:${comm.issuerId}`)
      if (companyId === undefined) continue
      // `publishDate` is an ISO string from the portal — an unparseable or
      // missing one is no proof of life, so it is dropped rather than
      // defaulted to the row's fetch date (which would be today, always).
      const publishedAt = comm.publishDate ? Date.parse(comm.publishDate) : NaN
      if (Number.isNaN(publishedAt)) continue
      const known = lastComm.get(companyId)
      if (known === undefined || publishedAt > known) {
        lastComm.set(companyId, publishedAt)
      }
    }
  }

  const silent: Array<SilentCompany> = []
  for (const company of companies) {
    if (company.archivedAt) continue
    const deals = dealsByCompany.get(company._id)
    if (!deals) continue

    // The most recent news wins, whichever channel carried it.
    const reportedAt = company.lastReportAt ?? null
    const communicatedAt = lastComm.get(company._id) ?? null
    let lastNewsAt: number | null = null
    let lastNewsSource: NewsSource | null = null
    if (reportedAt !== null || communicatedAt !== null) {
      const commWins =
        communicatedAt !== null &&
        (reportedAt === null || communicatedAt > reportedAt)
      lastNewsAt = commWins ? communicatedAt : reportedAt
      lastNewsSource = commWins ? 'vasco' : 'report'
    }

    let sinceAt: number
    if (lastNewsAt !== null) {
      sinceAt = lastNewsAt
    } else {
      // Never gave news: count from the first disbursement.
      let firstPaid: number | null = null
      for (const dealId of deals) {
        const paidAt = await firstOutflowAt(ctx, dealId)
        if (paidAt !== null && (firstPaid === null || paidAt < firstPaid)) {
          firstPaid = paidAt
        }
      }
      sinceAt = firstPaid ?? signedByCompany.get(company._id) ?? now
    }

    if (sinceAt > cutoff) continue
    silent.push({
      companyId: company._id,
      companyName: company.name,
      lastNewsAt,
      lastNewsSource,
      coverageUntil: company.lastReportCoverageAt ?? null,
      sinceAt,
    })
  }

  silent.sort((a, b) => a.sinceAt - b.sinceAt)
  return silent
}

/**
 * Tags participation rows with their silence alert. Pending and settled rows
 * never carry one: nothing is disbursed yet, or the position is closed.
 */
export function withReportAlerts<
  T extends {
    companyId: Id<'companies'>
    pending: boolean
    settled: boolean
  },
>(
  rows: Array<T>,
  silent: Array<SilentCompany>,
): Array<T & { reportAlert: SilentCompany | null }> {
  const byCompany = new Map(silent.map((s) => [s.companyId, s]))
  return rows.map((row) => ({
    ...row,
    reportAlert:
      row.pending || row.settled
        ? null
        : (byCompany.get(row.companyId) ?? null),
  }))
}
