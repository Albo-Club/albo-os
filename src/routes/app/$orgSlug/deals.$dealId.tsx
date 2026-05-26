import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../../../convex/_generated/api'
import type { ReactNode } from 'react'

import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/$orgSlug/deals/$dealId')({
  component: DealDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitleDeal'),
      },
    ],
  }),
})

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

function NotFound() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/participations"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('dealNotFound')}</p>
    </main>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function Transactions({ dealId }: { dealId: Id<'deals'> }) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const txs = useConvexQuery(api.transactions.listByDeal, { dealId })
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{t('tx.title')}</h2>
      {!txs ? (
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      ) : txs.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('tx.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tx.col.date')}</TableHead>
                <TableHead>{t('tx.col.direction')}</TableHead>
                <TableHead className="text-right">
                  {t('tx.col.amount')}
                </TableHead>
                <TableHead>{t('tx.col.label')}</TableHead>
                <TableHead>{t('tx.col.counterparty')}</TableHead>
                <TableHead>{t('tx.col.account')}</TableHead>
                <TableHead>{t('tx.col.reconciled')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txs.map((tx) => (
                <TableRow key={tx._id}>
                  <TableCell>{fmtDate(tx.transactionDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={tx.direction === 'in' ? 'default' : 'secondary'}
                    >
                      {t(`tx.${tx.direction}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(tx.amount)}
                  </TableCell>
                  <TableCell>{tx.rawLabel}</TableCell>
                  <TableCell>{tx.counterparty ?? '—'}</TableCell>
                  <TableCell>{tx.account?.label ?? '—'}</TableCell>
                  <TableCell>{tx.reconciled ? t('tx.yes') : t('tx.no')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function DealDetail() {
  const { t, i18n } = useTranslation('participations')
  const lang = i18n.language
  const { orgSlug, dealId } = Route.useParams()
  const deal = useConvexQuery(api.deals.getById, {
    id: dealId as Id<'deals'>,
  })
  const { fmtEur, fmtDate } = useFormatters()
  const fmtPct = (bps?: number | null) =>
    bps == null
      ? null
      : new Intl.NumberFormat(lang, {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(bps / 10000)
  const fmtNum = (n?: number | null) =>
    n == null ? null : new Intl.NumberFormat(lang).format(n)

  if (!deal) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      </main>
    )
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      {deal.target && (
        <Link
          to="/app/$orgSlug/participations/$companyId"
          params={{ orgSlug, companyId: deal.target._id }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {deal.target.name}
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`instrument.${deal.instrumentKind}`, {
            defaultValue: deal.instrumentKind,
          })}
        </h1>
        <Badge variant={statusVariant(deal.status)}>
          {t(`status.${deal.status}`, { defaultValue: deal.status })}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <Info
          label={t('deal.investor')}
          value={
            deal.investor ? (
              <>
                {deal.investor.name}
                {deal.spv ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('deal.viaSpv')} {deal.spv.name}
                  </span>
                ) : null}
              </>
            ) : null
          }
        />
        <Info
          label={t('deal.target')}
          value={
            deal.target ? (
              <Link
                to="/app/$orgSlug/participations/$companyId"
                params={{ orgSlug, companyId: deal.target._id }}
                className="underline-offset-4 hover:underline"
              >
                {deal.target.name}
              </Link>
            ) : null
          }
        />
        <Info label={t('deal.committed')} value={fmtEur(deal.committedAmount)} />
        <Info label={t('deal.paid')} value={fmtEur(deal.paidAmount)} />
        <Info label={t('deal.shares')} value={fmtNum(deal.sharesAcquired)} />
        <Info
          label={t('deal.pricePerShare')}
          value={fmtEur(deal.pricePerShare)}
        />
        <Info label={t('deal.interestRate')} value={fmtPct(deal.interestRate)} />
        <Info label={t('deal.maturity')} value={fmtDate(deal.maturityDate)} />
        <Info label={t('deal.principal')} value={fmtEur(deal.principalAmount)} />
        <Info label={t('deal.royaltyRate')} value={fmtPct(deal.royaltyRate)} />
        <Info
          label={t('deal.royaltyCap')}
          value={fmtEur(deal.royaltyCapAmount)}
        />
        <Info label={t('deal.valuationCap')} value={fmtEur(deal.valuationCap)} />
        <Info label={t('deal.discount')} value={fmtPct(deal.discount)} />
        <Info
          label={t('deal.entryValuation')}
          value={fmtEur(deal.entryValuation)}
        />
        <Info label={t('deal.roundSize')} value={fmtEur(deal.roundSize)} />
        <Info label={t('deal.signed')} value={fmtDate(deal.signedDate)} />
        <Info label={t('deal.closing')} value={fmtDate(deal.closingDate)} />
        <Info label={t('deal.exited')} value={fmtDate(deal.exitedDate)} />
        <Info label={t('deal.currency')} value={deal.currency} />
      </div>

      {deal.notes && (
        <div className="space-y-1">
          <span className="text-muted-foreground text-xs">
            {t('deal.notes')}
          </span>
          <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
        </div>
      )}

      <Transactions dealId={deal._id} />
    </main>
  )
}
