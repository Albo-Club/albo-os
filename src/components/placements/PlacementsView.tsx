import { useMemo, useState } from 'react'
import { Coins, LineChart, PiggyBank, TrendingUp } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import {
  PLACEMENT_LIQUIDITIES,
  placementLiquidity,
} from '../../../convex/lib/instrumentMapping'
import type { PlacementLiquidity } from '../../../convex/lib/instrumentMapping'
import type { Id } from '../../../convex/_generated/dataModel'
import { cn } from '~/lib/utils'
import { signTone } from '~/lib/moneyTone'
import { xirr } from '~/lib/xirr'
import { parseAmountToCents } from '~/lib/royalties'
import { CompanyLogo } from '~/components/CompanyLogo'
import { KpiCard } from '~/components/placements/KpiCard'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Input } from '~/components/ui/input'
import { useAmountField } from '~/components/ui/amount-input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Minimal shape of a treasury-placement deal row (subset of `deals.list`). */
export type PlacementRow = {
  _id: Id<'deals'>
  name?: string | null
  target: { name: string; domain?: string | null } | null
  instrumentKind: string
  /** Declared balance of the account (cents), updated by hand. */
  currentValue?: number | null
  bankName?: string | null
  closingDate?: number | null
  paidActual?: number | null
  received?: number | null
  flows?: Array<{ amount: number; date: number }>
  /** Per-deal liquidity override — default derived from instrumentKind. */
  liquidity?: string | null
}

/**
 * Finary-style account metrics, all derived at display time:
 * gain = balance + withdrawn − paid (null while no balance is declared, so an
 * unmarked account never reads as a −100 % loss), and the annualized return is
 * the XIRR of the matched dated flows plus the current balance as a terminal
 * inflow at `now`.
 */
function accountMetrics(d: PlacementRow, now: number) {
  const paid = d.paidActual ?? 0
  const withdrawn = d.received ?? 0
  const balance = d.currentValue ?? null
  const gain = balance == null ? null : balance + withdrawn - paid
  const gainPct = gain != null && paid > 0 ? gain / paid : null
  const terminal =
    balance != null && balance > 0 ? [{ amount: balance, date: now }] : []
  const annualized =
    balance == null ? null : xirr([...(d.flows ?? []), ...terminal])
  return { paid, withdrawn, balance, gain, gainPct, annualized }
}

/**
 * Balance cell, editable inline (click → € input → Enter/blur saves, Escape
 * cancels) — same interaction as the royalty CA cell. Saving patches the
 * deal's `currentValue` through `deals.update`, which also logs the new
 * balance as a valuation row (dated history). Emptying the input is a no-op
 * (deal columns can't be cleared).
 */
function EditableBalance({
  deal,
  ariaLabel,
}: {
  deal: PlacementRow
  ariaLabel: string
}) {
  const { t } = useTranslation('placements')
  const { fmtEurCents } = useFormatters()
  const updateDeal = useConvexMutation(api.deals.update)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Rule-of-hooks: the amount-field hook runs on every render (same pattern
  // as EditableCa / DealFieldInput); props are only spread while editing.
  const amountProps = useAmountField(draft, setDraft)

  const value = deal.currentValue ?? null

  function begin() {
    setDraft(value != null ? String(value / 100) : '')
    setEditing(true)
  }

  async function commit() {
    setEditing(false)
    if (draft.trim() === '') return
    const cents = parseAmountToCents(draft)
    if (cents == null || cents === value) return
    try {
      await updateDeal({ id: deal._id, patch: { currentValue: cents } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  if (editing) {
    return (
      <TableCell
        className="text-right tabular-nums"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          {...amountProps}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="h-7 w-32 text-right tabular-nums"
        />
      </TableCell>
    )
  }

  return (
    <TableCell
      className="hover:bg-muted/50 cursor-pointer text-right font-medium tabular-nums"
      role="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        begin()
      }}
    >
      {value == null ? '—' : fmtEurCents(value)}
    </TableCell>
  )
}

/** Section band tint per liquidity bucket (mirrors participationBucketBand). */
function liquidityBand(bucket: PlacementLiquidity): {
  band: string
  dot: string
} {
  switch (bucket) {
    case 'liquid':
      return { band: 'bg-positive/10', dot: 'bg-positive' }
    case 'semi_liquid':
      return { band: 'bg-warning/10', dot: 'bg-warning' }
    case 'illiquid':
      return { band: 'bg-muted', dot: 'bg-muted-foreground' }
  }
}

/**
 * Treasury placements, tracked like accounts (Finary-style): summary tiles
 * (total balance, net paid in, unrealized gain, annualized return) above one
 * table per liquidity bucket (liquid / semi-liquid / illiquid — default by
 * instrument kind, per-deal override) with each declared balance editable in
 * place. Real cash amounts and account balances → cent precision (see
 * CLAUDE.md § arrondis); only the return ratios are percentages.
 */
export function PlacementsView({
  deals,
  orgSlug,
}: {
  deals: Array<PlacementRow> | undefined
  orgSlug: string
}) {
  const { t } = useTranslation(['placements', 'participations'])
  const { fmtEurCents, fmtPercent } = useFormatters()

  const computed = useMemo(() => {
    if (!deals) return undefined
    // One timestamp per computation: the terminal-flow date of every XIRR.
    const now = Date.now()
    const rows = [...deals]
      .map((d) => ({ deal: d, m: accountMetrics(d, now) }))
      .sort((a, b) => (b.m.balance ?? b.m.paid) - (a.m.balance ?? a.m.paid))

    let balance = 0
    let paid = 0
    let withdrawn = 0
    // Gain and global XIRR only aggregate the accounts with a declared
    // balance — a not-yet-marked account must not read as a total loss.
    let gain = 0
    let hasGain = false
    const flows: Array<{ amount: number; date: number }> = []
    for (const { deal, m } of rows) {
      balance += m.balance ?? 0
      paid += m.paid
      withdrawn += m.withdrawn
      if (m.gain != null) {
        gain += m.gain
        hasGain = true
        flows.push(...(deal.flows ?? []))
        if (m.balance != null && m.balance > 0)
          flows.push({ amount: m.balance, date: now })
      }
    }
    const totals = {
      balance,
      invested: paid - withdrawn,
      gain: hasGain ? gain : null,
      gainPct: hasGain && paid > 0 ? gain / paid : null,
      annualized: xirr(flows),
    }
    // One bucket per liquidity, in PLACEMENT_LIQUIDITIES display order.
    const buckets = new Map<PlacementLiquidity, typeof rows>(
      PLACEMENT_LIQUIDITIES.map((key) => [key, []]),
    )
    for (const row of rows) {
      buckets
        .get(placementLiquidity(row.deal.instrumentKind, row.deal.liquidity))
        ?.push(row)
    }
    return { rows, totals, buckets }
  }, [deals])

  if (!computed) return null
  const { rows, totals, buckets } = computed

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {t('placements:empty')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('placements:tiles.balance')}
          value={fmtEurCents(totals.balance)}
          icon={PiggyBank}
        />
        <KpiCard
          label={t('placements:tiles.invested')}
          value={fmtEurCents(totals.invested)}
          hint={t('placements:tiles.investedHint')}
          icon={Coins}
        />
        <KpiCard
          label={t('placements:tiles.gain')}
          value={totals.gain == null ? '—' : fmtEurCents(totals.gain)}
          delta={
            totals.gainPct == null
              ? undefined
              : Math.round(totals.gainPct * 1000) / 10
          }
          icon={TrendingUp}
        />
        <KpiCard
          label={t('placements:tiles.yield')}
          value={fmtPercent(totals.annualized)}
          hint={t('placements:tiles.yieldHint')}
          icon={LineChart}
        />
      </div>

      {PLACEMENT_LIQUIDITIES.map((key) => {
        const bucketRows = buckets.get(key) ?? []
        // An empty liquidity bucket is not rendered at all.
        if (bucketRows.length === 0) return null
        const { band, dot } = liquidityBand(key)
        return (
          <section key={key} className="space-y-3">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                band,
              )}
            >
              <span aria-hidden className={cn('size-2 rounded-full', dot)} />
              {t(`placements:sections.${key}`)}
              <span className="text-muted-foreground">
                ({t('placements:placementsCount', { count: bucketRows.length })})
              </span>
            </div>
            <PlacementsTable rows={bucketRows} orgSlug={orgSlug} />
          </section>
        )
      })}
    </div>
  )
}

/** One liquidity bucket's table — same columns for every bucket. */
function PlacementsTable({
  rows,
  orgSlug,
}: {
  rows: Array<{ deal: PlacementRow; m: ReturnType<typeof accountMetrics> }>
  orgSlug: string
}) {
  const { t } = useTranslation(['placements', 'participations'])
  const navigate = useNavigate()
  const { fmtEurCents, fmtDate, fmtPercent } = useFormatters()

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('placements:col.name')}</TableHead>
            <TableHead>{t('placements:col.type')}</TableHead>
            <TableHead>{t('placements:col.opened')}</TableHead>
            <TableHead className="text-right">
              {t('placements:col.paid')}
            </TableHead>
            <TableHead className="text-right">
              {t('placements:col.withdrawn')}
            </TableHead>
            <TableHead className="text-right">
              {t('placements:col.balance')}
            </TableHead>
            <TableHead className="text-right">
              {t('placements:col.gain')}
            </TableHead>
            <TableHead className="text-right">
              {t('placements:col.yield')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ deal, m }) => {
            const name = deal.target?.name ?? deal.name ?? '—'
            // A placement opens its light placement sheet (balance history,
            // matched flows), not the full deal sheet.
            const openPlacement = () =>
              navigate({
                to: '/app/$orgSlug/placements/$dealId',
                params: { orgSlug, dealId: deal._id },
              })
            return (
              <TableRow
                key={deal._id}
                className="cursor-pointer"
                onClick={openPlacement}
                tabIndex={0}
                role="link"
                aria-label={t('placements:rowOpenAria', { name })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openPlacement()
                }}
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <CompanyLogo
                      domain={deal.target?.domain}
                      companyName={name}
                      size="sm"
                    />
                    <span className="flex flex-col">
                      {name}
                      {deal.bankName && (
                        <span className="text-muted-foreground text-xs font-normal">
                          {deal.bankName}
                        </span>
                      )}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`participations:instrument.${deal.instrumentKind}`, {
                    defaultValue: deal.instrumentKind,
                  })}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fmtDate(deal.closingDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEurCents(m.paid)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.withdrawn === 0 ? '—' : fmtEurCents(m.withdrawn)}
                </TableCell>
                <EditableBalance
                  deal={deal}
                  ariaLabel={t('placements:balanceEditAria', { name })}
                />
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    m.gain != null && signTone(m.gain),
                  )}
                >
                  {m.gain == null
                    ? '—'
                    : `${m.gain > 0 ? '+' : ''}${fmtEurCents(m.gain)}${
                        m.gainPct == null
                          ? ''
                          : ` (${m.gainPct > 0 ? '+' : ''}${fmtPercent(m.gainPct)})`
                      }`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtPercent(m.annualized)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
