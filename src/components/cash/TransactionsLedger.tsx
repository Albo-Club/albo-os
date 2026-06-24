import { useMemo, useRef, useState } from 'react'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { LiabilityOptionGroups } from '~/lib/liabilityOptions'
import { buildLiabilityOptions } from '~/lib/liabilityOptions'
import { PointageTable } from '~/components/pointage/PointageTable'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/** Ledger status filter — 'all' = the whole ledger (« Tout »). */
type LedgerFilter =
  | 'all'
  | 'unmatched'
  | 'matched'
  | 'charge'
  | 'tax'
  | 'product'
  | 'internal_transfer'

const FILTERS: Array<LedgerFilter> = [
  'all',
  'unmatched',
  'matched',
  'charge',
  'tax',
  'product',
  'internal_transfer',
]

const ALL_ACCOUNTS = 'all'

/**
 * Pennylane-style complete ledger (Transactions tab of the Cash section): all
 * the org's transactions across accounts, filterable by status / account /
 * search. « À pointer » is the default filter (inbox) and keeps its counter;
 * matched/categorized rows stay visible with their status badge + an inline
 * detach/VAT action (PointageTable `statusColumn` mode). Reconciliation reuses
 * the same row actions as the historical pointage queue.
 */
export function TransactionsLedger({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
}) {
  const { t } = useTranslation(['pointage', 'passif'])
  const [status, setStatus] = useState<LedgerFilter>('unmatched')
  const [accountId, setAccountId] = useState<Id<'bankAccounts'> | undefined>(
    undefined,
  )

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

  const liveTransactions = useConvexQuery(api.transactions.listLedger, {
    orgId,
    status: status === 'all' ? undefined : status,
    bankAccountId: accountId,
    search: searchArg,
  })

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
    : status === 'unmatched'
      ? undefined // → PointageTable's inbox empty message (t('empty'))
      : t('viewEmpty')

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(v) => setStatus(v as LedgerFilter)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="gap-1.5">
              {t(`view.${f}`)}
              {f === 'unmatched' && unmatchedCount ? (
                <Badge variant="secondary">{unmatchedCount}</Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-3">
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
      </div>
      <PointageTable
        transactions={transactions}
        deals={deals}
        liabilityOptions={liabilityOptions}
        orgSlug={orgSlug}
        emptyMessage={emptyMessage}
        statusColumn={status !== 'unmatched'}
        pageResetKey={`${status}:${accountId ?? ''}:${searchArg ?? ''}`}
      />
    </div>
  )
}
