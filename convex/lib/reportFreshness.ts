/**
 * « Silent company » detection — a portfolio company that stopped sending
 * investor reports, or never started.
 *
 * Threshold: `organizations.reportSilenceMonths` (4 months by default),
 * measured on the RECEPTION date of the last report, never on the period it
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

export type SilentCompany = {
  companyId: Id<'companies'>
  companyName: string
  /** Reception date of the last report, null when the company never reported. */
  lastReportAt: number | null
  /** Most recent period covered by a report, null when unknown. */
  coverageUntil: number | null
  /** What the silence is counted from: last report, else first disbursement. */
  sinceAt: number
}

/** Date before which a company is considered silent (calendar months back). */
export function silenceCutoff(now: number, months: number): number {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff.getTime()
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
 * The org's silent companies, longest silence first. One indexed scan of the
 * org's reports; the transactions are only read for companies that never
 * reported (the sole case where the disbursement date is needed).
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
  for (const status of ['active', 'partially_exited'] as const) {
    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('status', status),
      )
      .collect()
    for (const deal of deals) {
      const list = dealsByCompany.get(deal.targetCompanyId) ?? []
      list.push(deal._id)
      dealsByCompany.set(deal.targetCompanyId, list)
      const signed = deal.signedDate ?? deal._creationTime
      const known = signedByCompany.get(deal.targetCompanyId)
      if (known === undefined || signed < known) {
        signedByCompany.set(deal.targetCompanyId, signed)
      }
    }
  }

  // Last reception + last covered period per company, in one scan.
  const lastReport = new Map<Id<'companies'>, number>()
  const coverage = new Map<Id<'companies'>, number>()
  const reports = await ctx.db
    .query('companyReports')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  for (const report of reports) {
    const receivedAt = report.emailDate ?? report._creationTime
    const known = lastReport.get(report.companyId)
    if (known === undefined || receivedAt > known) {
      lastReport.set(report.companyId, receivedAt)
    }
    if (report.periodSortDate !== undefined) {
      const covered = coverage.get(report.companyId)
      if (covered === undefined || report.periodSortDate > covered) {
        coverage.set(report.companyId, report.periodSortDate)
      }
    }
  }

  const companies = await ctx.db
    .query('companies')
    .withIndex('by_org_kind', (q) =>
      q.eq('orgId', orgId).eq('kind', 'portfolio'),
    )
    .collect()

  const silent: Array<SilentCompany> = []
  for (const company of companies) {
    if (company.archivedAt) continue
    const deals = dealsByCompany.get(company._id)
    if (!deals) continue

    const lastReportAt = lastReport.get(company._id) ?? null
    let sinceAt: number
    if (lastReportAt !== null) {
      sinceAt = lastReportAt
    } else {
      // Never reported: count from the first disbursement.
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
      lastReportAt,
      coverageUntil: coverage.get(company._id) ?? null,
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
