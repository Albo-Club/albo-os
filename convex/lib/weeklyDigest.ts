import type { DigestSection } from '../emailTemplates'

/** What one org has to say this week, before any recipient filtering. */
export type OrgFinding = {
  orgSlug: string
  orgName: string
  cash: DigestSection['cash']
  overdue: DigestSection['overdue']
  reports: DigestSection['reports']
}

/**
 * Which Monday mail an org travels in. Albo Club gets its own; everything
 * else — CALTE and its seven subsidiaries — shares a second one, so a mail
 * never mixes two balance sheets.
 *
 * Deliberately "everything that is not Albo" rather than a fixed list of the
 * seven subsidiary slugs: orgs are flat, nothing in the schema says who is a
 * subsidiary of whom, and a list would silently drop an eighth subsidiary
 * created tomorrow out of the digest instead of putting it in the CALTE mail.
 */
export const SOLO_ORG_SLUG = 'albo'

export type DigestFamily = 'albo' | 'calte'

/** The family this org belongs to — see `SOLO_ORG_SLUG`. */
export function familyOf(orgSlug: string): DigestFamily {
  return orgSlug === SOLO_ORG_SLUG ? 'albo' : 'calte'
}

/** Slug of the org whose name titles each family's mail. */
export const FAMILY_HEAD_SLUG: Record<DigestFamily, string> = {
  albo: SOLO_ORG_SLUG,
  calte: 'calte',
}

/**
 * The digest one member receives: their orgs' blocks, minus the ones they
 * unsubscribed from. An org whose blocks are all muted drops out entirely
 * (no empty section), and an empty result means no mail at all —
 * `forecasts.sendWeeklyDigest` never sends a digest with nothing in it.
 *
 * Every block is filtered the same way, including the reports: a member who
 * muted everything must keep receiving nothing, so no block may bypass its
 * own switch and re-arm the Monday mail behind their back.
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

/**
 * One member's Monday mails: their filtered sections, split by family. At
 * most two entries, Albo first; a family with nothing to say produces no
 * entry, hence no mail.
 */
export function digestsFor(
  findings: Array<OrgFinding>,
  prefs: {
    cashThreshold: boolean
    overdueEntries: boolean
    weeklyReports: boolean
  },
): Array<{ family: DigestFamily; sections: Array<DigestSection> }> {
  const families: Array<DigestFamily> = ['albo', 'calte']
  return families
    .map((family) => ({
      family,
      sections: sectionsFor(
        findings.filter((f) => familyOf(f.orgSlug) === family),
        prefs,
      ),
    }))
    .filter((d) => d.sections.length > 0)
}
