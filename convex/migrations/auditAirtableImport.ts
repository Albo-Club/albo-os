/**
 * Read-only audit of the one-shot Airtable import (org `calte`).
 *
 * The import derived `1 deal = (Entreprise × instrumentKind)` from the
 * Mouvement table (cf. `convex/airtableImport.ts`), so every movement sharing
 * a company and an invest type collapsed into a single deal — whatever its
 * real object. A real-estate acquisition and an intragroup current account
 * ended up in the same row, and so did share sales and employee BSPCE
 * operations.
 *
 * Reviewing that deal by deal in the app is the wrong entry point: what has
 * to be judged is the LIST OF MOVEMENTS, not the deal. This report gives the
 * whole picture at once, flags what deserves a look, and leaves everything
 * else out of the queue. It writes nothing.
 *
 * Flags (per deal):
 * - `to_split`       several disbursement clusters (> 90 days apart), or
 *                    movement labels that split into unrelated groups
 * - `intragroup`     the target company shares its name with a `group_*`
 *                    entity of the org (CALTE financing its own subsidiary)
 * - `duplicate_target` several company rows carry that name
 * - `pointing_gap`   `paidAmount` ≠ the sum of the matched movements: the
 *                    difference sits unmatched in the pointage queue
 * - `no_movement`    no transaction attached at all
 *
 * Execution (prod, manual — read-only, no snapshot needed):
 *   pnpm exec convex run --prod migrations/auditAirtableImport:report \
 *     > audit-import.json
 *   node scripts/render-audit-import.mjs audit-import.json
 */
import { ConvexError } from 'convex/values'
import { internalQuery } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** Two disbursements further apart than this start separate clusters. */
const CLUSTER_GAP_DAYS = 90
const CLUSTER_GAP_MS = CLUSTER_GAP_DAYS * 24 * 60 * 60 * 1000

/** Movements listed per flagged deal (the tail is summarized as a count). */
const MAX_MOVEMENTS = 40

/** Label tokens shorter than this carry no meaning (SAS, CC, N°…). */
const MIN_TOKEN_LENGTH = 3

type Flag =
  | 'to_split'
  | 'intragroup'
  | 'duplicate_target'
  | 'pointing_gap'
  | 'no_movement'

type Movement = {
  id: Id<'transactions'>
  date: number
  direction: 'in' | 'out'
  amount: number
  label: string
}

const normalizeName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Meaningful words of a movement label, for the relatedness test below. */
const tokenize = (label: string): Set<string> =>
  new Set(
    normalizeName(label)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= MIN_TOKEN_LENGTH && !/^\d+$/.test(w)),
  )

/**
 * Do the movements of a deal talk about the same thing? Groups them by
 * shared label word (transitively) and returns the number of unrelated
 * groups. 2+ means the deal aggregates distinct objects — the BSPCE-inside-a
 * -share-deal case. Movements without a usable label are ignored (they can't
 * contradict anything).
 */
function labelGroupCount(movements: Array<Movement>): number {
  const tokenSets = movements
    .map((m) => tokenize(m.label))
    .filter((t) => t.size > 0)
  const parent = tokenSets.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i]
    return i
  }
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const shares = [...tokenSets[i]].some((w) => tokenSets[j].has(w))
      if (shares) parent[find(i)] = find(j)
    }
  }
  return new Set(tokenSets.map((_, i) => find(i))).size
}

/** Disbursements split into clusters separated by more than the gap. */
function clusterOutflows(movements: Array<Movement>) {
  const outs = movements
    .filter((m) => m.direction === 'out')
    .sort((a, b) => a.date - b.date)
  const clusters: Array<{
    from: number
    to: number
    count: number
    total: number
  }> = []
  for (const m of outs) {
    const last = clusters.length > 0 ? clusters[clusters.length - 1] : null
    if (last && m.date - last.to <= CLUSTER_GAP_MS) {
      last.to = m.date
      last.count += 1
      last.total += m.amount
    } else {
      clusters.push({ from: m.date, to: m.date, count: 1, total: m.amount })
    }
  }
  return clusters
}

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', 'calte'))
      .first()
    if (!org) throw new ConvexError('calte_org_absent')
    const orgId = org._id

    const [companies, allDeals, transactions] = await Promise.all([
      ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
      ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
      ctx.db
        .query('transactions')
        .withIndex('by_org_date', (q) => q.eq('orgId', orgId))
        .collect(),
    ])

    // Scope: the deals the import built. Deals created since (Attio, manual)
    // were never aggregated, so the flags would be meaningless on them.
    const deals = allDeals.filter((d) => d.airtableId)

    const companiesById = new Map<Id<'companies'>, Doc<'companies'>>(
      companies.map((c) => [c._id, c]),
    )
    const groupEntityNames = new Set(
      companies
        .filter((c) => c.kind.startsWith('group_'))
        .map((c) => normalizeName(c.name)),
    )
    const rowsByName = new Map<string, Array<Doc<'companies'>>>()
    for (const c of companies) {
      if (c.archivedAt) continue
      const key = normalizeName(c.name)
      rowsByName.set(key, [...(rowsByName.get(key) ?? []), c])
    }

    const dealsPerCompany = new Map<Id<'companies'>, number>()
    for (const d of allDeals) {
      dealsPerCompany.set(
        d.targetCompanyId,
        (dealsPerCompany.get(d.targetCompanyId) ?? 0) + 1,
      )
    }

    const movementsByDeal = new Map<Id<'deals'>, Array<Movement>>()
    // Unmatched movements, indexed by the counterparty the import wrote from
    // the linked Entreprise — the only remaining thread back to the company
    // once `dealId` was dropped for lack of an Airtable « Pointé ».
    const unmatchedByCounterparty = new Map<string, Array<Movement>>()
    for (const t of transactions) {
      const m: Movement = {
        id: t._id,
        date: t.transactionDate,
        direction: t.direction,
        amount: t.amount,
        label: t.rawLabel,
      }
      if (t.dealId) {
        movementsByDeal.set(t.dealId, [
          ...(movementsByDeal.get(t.dealId) ?? []),
          m,
        ])
      } else if (t.counterparty) {
        const key = normalizeName(t.counterparty)
        unmatchedByCounterparty.set(key, [
          ...(unmatchedByCounterparty.get(key) ?? []),
          m,
        ])
      }
    }

    const rows = deals.map((d) => {
      const target = companiesById.get(d.targetCompanyId) ?? null
      const targetKey = target ? normalizeName(target.name) : ''
      const movements = (movementsByDeal.get(d._id) ?? []).sort(
        (a, b) => a.date - b.date,
      )
      const paidActual = movements
        .filter((m) => m.direction === 'out')
        .reduce((s, m) => s + m.amount, 0)
      const received = movements
        .filter((m) => m.direction === 'in')
        .reduce((s, m) => s + m.amount, 0)
      const clusters = clusterOutflows(movements)
      const groups = labelGroupCount(movements)

      const flags: Array<Flag> = []
      if (movements.length === 0) flags.push('no_movement')
      if (clusters.length >= 2 || groups >= 2) flags.push('to_split')
      if (targetKey && groupEntityNames.has(targetKey)) flags.push('intragroup')
      if ((rowsByName.get(targetKey)?.length ?? 0) > 1) {
        flags.push('duplicate_target')
      }
      const gap = (d.paidAmount ?? 0) - paidActual
      if (gap !== 0) flags.push('pointing_gap')

      // Only the deals in the queue carry their detail — the rest would just
      // pad the report.
      const detailed = flags.length > 0
      const orphanCandidates = flags.includes('pointing_gap')
        ? (unmatchedByCounterparty.get(targetKey) ?? [])
        : []

      return {
        id: d._id,
        airtableId: d.airtableId ?? null,
        target: target?.name ?? null,
        targetId: d.targetCompanyId,
        instrument: d.instrumentKind,
        status: d.status,
        signedDate: d.signedDate ?? null,
        paidAmount: d.paidAmount ?? 0,
        paidActual,
        received,
        pointingGap: gap,
        counts: {
          movements: movements.length,
          out: movements.filter((m) => m.direction === 'out').length,
          in: movements.filter((m) => m.direction === 'in').length,
          clusters: clusters.length,
          labelGroups: groups,
        },
        flags,
        clusters: detailed ? clusters : [],
        movements: detailed ? movements.slice(0, MAX_MOVEMENTS) : [],
        movementsOmitted: detailed
          ? Math.max(0, movements.length - MAX_MOVEMENTS)
          : 0,
        orphanCandidates: orphanCandidates.slice(0, MAX_MOVEMENTS),
        orphanCandidatesOmitted: Math.max(
          0,
          orphanCandidates.length - MAX_MOVEMENTS,
        ),
      }
    })

    // Flagged first, biggest money first: the queue reads top-down.
    const flagged = rows
      .filter((r) => r.flags.length > 0)
      .sort((a, b) => b.paidAmount - a.paidAmount)
    const clean = rows
      .filter((r) => r.flags.length === 0)
      .sort((a, b) => b.paidAmount - a.paidAmount)

    const byFlag: Record<string, number> = {}
    for (const r of flagged) {
      for (const f of r.flags) byFlag[f] = (byFlag[f] ?? 0) + 1
    }

    const duplicateCompanies = [...rowsByName.entries()]
      .filter(([, rowsForName]) => rowsForName.length > 1)
      .map(([name, rowsForName]) => ({
        name,
        rows: rowsForName.map((c) => ({
          id: c._id,
          name: c.name,
          kind: c.kind,
          fromImport: Boolean(c.airtableId),
          deals: dealsPerCompany.get(c._id) ?? 0,
        })),
      }))
      .sort((a, b) => b.rows.length - a.rows.length)

    return {
      org: { slug: org.slug, id: orgId },
      thresholds: { clusterGapDays: CLUSTER_GAP_DAYS },
      summary: {
        dealsInOrg: allDeals.length,
        dealsFromImport: deals.length,
        flagged: flagged.length,
        clean: clean.length,
        byFlag,
        flaggedPaidTotal: flagged.reduce((s, r) => s + r.paidAmount, 0),
        importedPaidTotal: rows.reduce((s, r) => s + r.paidAmount, 0),
      },
      duplicateCompanies,
      deals: [...flagged, ...clean],
    }
  },
})
