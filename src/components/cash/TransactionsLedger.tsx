import { useMemo, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { LiabilityOptionGroups } from '~/lib/liabilityOptions'
import type { PlannedEntry } from '~/components/pointage/PointageTable'
import { buildLiabilityOptions } from '~/lib/liabilityOptions'
import { eurosToCents } from '~/lib/parse'
import { normalizeSearch } from '~/lib/searchText'
import { PointageTable } from '~/components/pointage/PointageTable'
import { Button } from '~/components/ui/button'
import { AmountInput } from '~/components/ui/amount-input'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/**
 * The register's single « Statut » filter. 'all' = the whole register
 * (planned entries + every transaction); 'unmatched' = everything left to
 * handle (unmatched transactions AND overdue planned entries); 'planned' =
 * the forecast entries alone; 'deal' and 'liability' split the 'matched'
 * status by nature of the attachment.
 */
export type LedgerFilter =
  | 'all'
  | 'unmatched'
  | 'planned'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'
  | 'deal'
  | 'liability'
  | 'ignored'

/** Entries of the « Statut » menu, in reading order — also the values the
 * route accepts as `?filter=` (To do CTAs, bookmarks). */
export const LEDGER_FILTERS: ReadonlyArray<LedgerFilter> = [
  'all',
  'unmatched',
  'planned',
  'charge',
  'tax',
  'product',
  'internal_transfer',
  'deal',
  'liability',
  'ignored',
]

const ALL_ACCOUNTS = 'all'

/**
 * The single register of the Cash overview: planned forecast entries (future
 * ones on top, overdue ones inline) merged with every real transaction,
 * newest first, behind one filter bar — search, amount range, status,
 * account (same filter grammar as the participations list). No standalone
 * « À pointer » button: the daily reconciliation queue lives in the To do
 * page, which links here with `?filter=unmatched`. Matched/categorized rows
 * stay visible with their status badge + inline detach/VAT actions
 * (PointageTable).
 */
export function TransactionsLedger({
  orgId,
  orgSlug,
  initialFilter,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  /** Filter preselected by the route's `?filter=` (To do CTAs). */
  initialFilter?: LedgerFilter
}) {
  const { t } = useTranslation(['pointage', 'passif'])
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter ?? 'all')
  const [accountId, setAccountId] = useState<Id<'bankAccounts'> | undefined>(
    undefined,
  )
  const [applyingRules, setApplyingRules] = useState(false)
  const applyCategoryRules = useConvexMutation(
    api.transactions.applyCategoryRules,
  )

  // On-demand replay of the learned categorization rules on the queue
  // (new ingested transactions get them applied automatically at insert).
  async function handleApplyRules() {
    setApplyingRules(true)
    try {
      const { applied } = await applyCategoryRules({ orgId })
      toast(
        applied > 0
          ? t('rules.applied', { count: applied })
          : t('rules.nothingToApply'),
      )
    } catch {
      toast.error(t('errors.failed'))
    } finally {
      setApplyingRules(false)
    }
  }

  // Server-side search (Convex search index), debounced.
  const [search, setSearch] = useState('')
  const searchArg = useDebouncedValue(search).trim() || undefined

  // Amount range, applied client-side on the loaded rows (the register is
  // bounded to the newest LEDGER_LIMIT transactions anyway — see
  // KNOWN_ISSUES « Registre Transactions »). Raw euro strings; invalid or
  // empty input = no bound.
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const minCents = minAmount.trim() === '' ? null : eurosToCents(minAmount)
  const maxCents = maxAmount.trim() === '' ? null : eurosToCents(maxAmount)
  const amountActive = minCents != null || maxCents != null

  const accounts = useConvexQuery(api.cash.listAccounts, { orgId })
  const unmatchedCount = useConvexQuery(api.transactions.countByStatus, {
    orgId,
    status: 'unmatched',
  })
  // Lightweight options (ids + names only) for the inline matching comboboxes.
  const deals = useConvexQuery(api.deals.listOptions, { orgId })
  const liabilities = useConvexQuery(api.liabilities.listOptions, { orgId })

  const byAttachment = filter === 'deal' || filter === 'liability'
  const liveTransactions = useConvexQuery(
    api.transactions.listLedger,
    filter === 'planned'
      ? 'skip'
      : {
          orgId,
          status:
            filter === 'all' || byAttachment
              ? undefined
              : (filter),
          matchedKind: byAttachment ? filter : undefined,
          bankAccountId: accountId,
          search: searchArg,
        },
  )
  // Planned forecast entries (pending, next 90 days + overdue) — shared
  // subscription with ForecastOverview. They carry no bank account, so an
  // account filter hides them.
  const upcoming = useConvexQuery(api.forecasts.getUpcomingEntries, { orgId })
  // One-click suggestions — reconciliation view only (they only render on
  // unmatched rows anyway).
  const suggestions = useConvexQuery(
    api.transactions.getPointageSuggestions,
    filter === 'unmatched' ? { orgId } : 'skip',
  )

  const liabilityOptions = useMemo<LiabilityOptionGroups | undefined>(() => {
    if (!liabilities) return undefined
    return buildLiabilityOptions(liabilities, {
      equityType: (type) =>
        t(`passif:equity.type.${type}`, { defaultValue: type }),
      receivable: t('passif:loans.receivable'),
      payable: t('passif:loans.payable'),
    })
  }, [liabilities, t])

  // Keep the last list displayed while a new filter/search reloads (no flash).
  const lastRef = useRef(liveTransactions)
  if (liveTransactions !== undefined) lastRef.current = liveTransactions
  const loadedTransactions =
    filter === 'planned' ? [] : (liveTransactions ?? lastRef.current)
  const transactions = useMemo(() => {
    if (!loadedTransactions || (minCents == null && maxCents == null)) {
      return loadedTransactions
    }
    return loadedTransactions.filter(
      (tx) =>
        (minCents == null || tx.amount >= minCents) &&
        (maxCents == null || tx.amount <= maxCents),
    )
  }, [loadedTransactions, minCents, maxCents])

  const showPlanned =
    (filter === 'all' || filter === 'planned' || filter === 'unmatched') &&
    accountId === undefined
  const plannedEntries = useMemo<Array<PlannedEntry> | undefined>(() => {
    if (!showPlanned) return []
    if (!upcoming) return undefined
    const term = searchArg ? normalizeSearch(searchArg) : ''
    return upcoming.entries.filter((entry) => {
      if (filter === 'unmatched' && !entry.overdue) return false
      if (term && !normalizeSearch(entry.label).includes(term)) return false
      if (minCents != null && entry.amountCents < minCents) return false
      if (maxCents != null && entry.amountCents > maxCents) return false
      return true
    })
  }, [showPlanned, upcoming, searchArg, filter, minCents, maxCents])

  const emptyMessage = searchArg
    ? t('search.noResults')
    : filter === 'unmatched'
      ? undefined // → PointageTable's inbox empty message (t('empty'))
      : t('viewEmpty')

  const amountLabel = amountActive
    ? [
        minCents != null ? `≥ ${minAmount} €` : null,
        maxCents != null ? `≤ ${maxAmount} €` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search.placeholder')}
          className="max-w-sm"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={amountActive ? 'secondary' : 'outline'}>
              {t('filter.amount')}
              {amountLabel && (
                <span className="text-muted-foreground font-normal">
                  {amountLabel}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-3" align="start">
            <div className="space-y-1.5">
              <Label htmlFor="ledger-amount-min">{t('filter.amountMin')}</Label>
              <AmountInput
                id="ledger-amount-min"
                value={minAmount}
                onChange={setMinAmount}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ledger-amount-max">{t('filter.amountMax')}</Label>
              <AmountInput
                id="ledger-amount-max"
                value={maxAmount}
                onChange={setMaxAmount}
                placeholder="100 000"
              />
            </div>
            {amountActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMinAmount('')
                  setMaxAmount('')
                }}
              >
                {t('filter.amountClear')}
              </Button>
            )}
          </PopoverContent>
        </Popover>
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as LedgerFilter)}
        >
          <SelectTrigger className="w-64">
            <span className="text-muted-foreground mr-1">
              {t('filter.status')}
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEDGER_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {t(`view.${f}`)}
                {f === 'unmatched' && unmatchedCount
                  ? ` (${unmatchedCount})`
                  : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={accountId ?? ALL_ACCOUNTS}
          onValueChange={(v) =>
            setAccountId(
              v === ALL_ACCOUNTS ? undefined : (v as Id<'bankAccounts'>),
            )
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACCOUNTS}>
              {t('filter.allAccounts')}
            </SelectItem>
            {accounts?.map((a) => (
              <SelectItem key={a._id} value={a._id}>
                {a.bankName} · {a.displayName ?? a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filter === 'unmatched' && (
          <Button
            variant="outline"
            size="sm"
            disabled={applyingRules}
            onClick={() => void handleApplyRules()}
          >
            <Wand2 className="size-4" />
            {t('rules.apply')}
          </Button>
        )}
      </div>
      <PointageTable
        transactions={transactions}
        plannedEntries={plannedEntries}
        deals={deals}
        liabilityOptions={liabilityOptions}
        suggestions={suggestions}
        orgSlug={orgSlug}
        emptyMessage={emptyMessage}
        statusColumn
        pageResetKey={`${filter}:${accountId ?? ''}:${searchArg ?? ''}:${minCents ?? ''}:${maxCents ?? ''}`}
      />
    </div>
  )
}
