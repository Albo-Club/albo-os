import type { DigestSection } from '../emailTemplates'

/** What one org has to say this week, before any recipient filtering. */
export type OrgFinding = {
  orgName: string
  cash: DigestSection['cash']
  overdue: DigestSection['overdue']
  reports: DigestSection['reports']
}

/**
 * The digest one member receives: their orgs' blocks, minus the ones they
 * unsubscribed from. An org whose blocks are all muted drops out entirely
 * (no empty section), and an empty result means no mail at all —
 * `forecasts.sendWeeklyDigest` never sends a digest with nothing in it.
 *
 * Every block is filtered the same way, including the report count: a
 * member who muted everything must keep receiving nothing, so no block may
 * bypass its own switch and re-arm the Monday mail behind their back.
 */
export function sectionsFor(
  findings: Array<OrgFinding>,
  prefs: {
    cashThreshold: boolean
    overdueEntries: boolean
    weeklyReports: boolean
  },
): Array<DigestSection> {
  const sections: Array<DigestSection> = []
  for (const finding of findings) {
    const cash = prefs.cashThreshold ? finding.cash : null
    const overdue = prefs.overdueEntries ? finding.overdue : null
    const reports = prefs.weeklyReports ? finding.reports : null
    if (!cash && !overdue && !reports) continue
    sections.push({ orgName: finding.orgName, cash, overdue, reports })
  }
  return sections
}
