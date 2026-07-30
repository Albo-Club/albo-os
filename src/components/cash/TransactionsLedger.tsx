import { useMemo, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { LiabilityOptionGroups } from '~/lib/liabilityOptions'
import { buildLiabilityOptions } from '~/lib/liabilityOptions'
import { PointageTable } from '~/components/pointage/PointageTable'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/**
 * The ledger's single filter. 'all' = the whole ledger; 'unmatched' is the
 * inbox (surfaced by its own button, not by the type menu); 'deal' and
 * 'liability' split the 'matched' status by nature of the attachment, so a
 * generic « Pointé » entry would be redundant with the two of them.
 */
type LedgerFilter =
  | 'all'
  | 'unmatched'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'
  | 'deal'
  | 'liability'
  | 'ignored'

/** Entries of the « Type » menu, in reading order. */
const TYPE_FILTERS: ReadonlyArray<LedgerFilter> = [
  'all',
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
 * Pennylane-style complete ledger (Transactions tab of the Cash section): all
 * the org's transactions across accounts, narrowed by ONE filter — the
 * « À pointer » button (the inbox, with its counter, the default landing) or
 * the « Type » menu — plus account and search. Matched/categorized rows stay
 * visible with their status badge + an inline detach/VAT action (PointageTable
 * `statusColumn` mode). Reconciliation reuses the same row actions as the
 * historical pointage queue.
 */
export function TransactionsLedger({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
}) {
  const { t } = useTranslation(['pointage', 'passif'])
  const [filter, setFilter] = useState<LedgerFilter>('unmatched')
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

  const accounts = useConvexQuery(api.cash.listAccounts, { orgId })
  const unmatchedCount = useConvexQuery(api.transactions.countByStatus, {
    orgId,
    status: 'unmatched',
  })
  // Lightweight options (ids + names only) for the inline matching comboboxes.
  const deals = useConvexQuery(api.deals.listOptions, { orgId })
  const liabilities = useConvexQuery(api.liabilities.listOptions, { orgId })

  const byAttachment = filter === 'deal' || filter === 'liability'
  const liveTransactions = useConvexQuery(api.transactions.listLedger, {
    orgId,
    status: filter === 'all' || byAttachment ? undefined : filter,
    matchedKind: byAttachment ? filter : undefined,
    bankAccountId: accountId,
    search: searchArg,
  })
  // One-click suggestions — inbox view only (they only render on unmatched
  // rows anyway).
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
  const transactions = liveTransactions ?? lastRef.current

  const emptyMessage = searchArg
    ? t('search.noResults')
    : filter === 'unmatched'
      ? undefined // → PointageTable's inbox empty message (t('empty'))
      : t('viewEmpty')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* The inbox as a toggle: pressing it filters, pressing it again goes
            back to the whole ledger. It is not a « Type », hence its own
            control next to the menu. */}
        <Button
          variant={filter === 'unmatched' ? 'secondary' : 'outline'}
          aria-pressed={filter === 'unmatched'}
          className={
            filter === 'unmatched' ? 'ring-ring/40 gap-1.5 ring-2' : 'gap-1.5'
          }
          onClick={() =>
            setFilter(filter === 'unmatched' ? 'all' : 'unmatched')
          }
        >
          {t('view.unmatched')}
          {unmatchedCount ? (
            <Badge variant="secondary">{unmatchedCount}</Badge>
          ) : null}
        </Button>
        <Select
          value={TYPE_FILTERS.includes(filter) ? filter : 'all'}
          onValueChange={(v) => setFilter(v as LedgerFilter)}
        >
          <SelectTrigger className="w-60">
            <span className="text-muted-foreground mr-1">
              {t('filter.type')}
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {t(`view.${f}`)}
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
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search.placeholder')}
          className="max-w-sm"
        />
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
        deals={deals}
        liabilityOptions={liabilityOptions}
        suggestions={suggestions}
        orgSlug={orgSlug}
        emptyMessage={emptyMessage}
        statusColumn={filter !== 'unmatched'}
        pageResetKey={`${filter}:${accountId ?? ''}:${searchArg ?? ''}`}
      />
    </div>
  )
}
