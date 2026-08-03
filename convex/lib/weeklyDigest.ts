import type { DigestSection } from '../emailTemplates'

/** What is off in one org this week, before any recipient filtering. */
export type OrgFinding = {
  orgName: string
  cash: DigestSection['cash']
  overdue: DigestSection['overdue']
}

/**
 * The digest one member receives: their orgs' findings, minus the blocks
 * they unsubscribed from. An org whose blocks are all muted drops out
 * entirely (no empty section), and an empty result means no mail at all —
 * `forecasts.sendWeeklyDigest` never sends a digest with nothing in it.
 */
export function sectionsFor(
  findings: Array<OrgFinding>,
  prefs: { cashThreshold: boolean; overdueEntries: boolean },
): Array<DigestSection> {
  const sections: Array<DigestSection> = []
  for (const finding of findings) {
    const cash = prefs.cashThreshold ? finding.cash : null
    const overdue = prefs.overdueEntries ? finding.overdue : null
    if (!cash && !overdue) continue
    sections.push({ orgName: finding.orgName, cash, overdue })
  }
  return sections
}
