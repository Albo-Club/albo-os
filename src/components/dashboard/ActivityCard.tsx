import { Link } from '@tanstack/react-router'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { cn } from '~/lib/utils'
import { directionTone } from '~/lib/moneyTone'

type ActivityTx = {
  _id: string
  transactionDate: number
  direction: 'in' | 'out'
  amount: number
  rawLabel: string
  accountLabel: string | null
  dealLabel: string | null
}

function ActivityRow({ tx }: { tx: ActivityTx }) {
  const { fmtEur, fmtDate } = useFormatters()
  const Icon = tx.direction === 'out' ? ArrowUpRight : ArrowDownLeft
  const subLabel = tx.dealLabel ?? tx.accountLabel

  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{tx.rawLabel}</div>
        <div className="text-muted-foreground text-xs">
          {fmtDate(tx.transactionDate)}
          {subLabel ? ` · ${subLabel}` : ''}
        </div>
      </div>
      <span className={cn('shrink-0 tabular-nums', directionTone(tx.direction))}>
        {tx.direction === 'out' ? '−' : '+'}
        {fmtEur(tx.amount)}
      </span>
    </div>
  )
}

/** Recent activity feed (last transactions) with a link to the cash view. */
export function ActivityCard({
  orgSlug,
  transactions,
}: {
  orgSlug: string
  transactions: Array<ActivityTx>
}) {
  const { t } = useTranslation('dashboard')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('recent.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t('recent.empty')}
          </div>
        ) : (
          <div className="divide-y">
            {transactions.map((tx) => (
              <ActivityRow key={tx._id} tx={tx} />
            ))}
          </div>
        )}
        <Link
          to="/app/$orgSlug/cash"
          params={{ orgSlug }}
          className="text-primary mt-3 inline-block text-sm underline-offset-4 hover:underline"
        >
          {t('recent.seeCash')} →
        </Link>
      </CardContent>
    </Card>
  )
}
