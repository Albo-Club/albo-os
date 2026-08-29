import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { LoadingLine } from '~/components/ui/spinner'

/** Return of `loans:list` — the loans and their derived total. */
export type BankDebt = FunctionReturnType<typeof api.loans.list>
export type BankDebtRow = BankDebt['loans'][number]

/**
 * Localized formatters for the debt section.
 *
 * `fmtEur` is deliberately ROUNDED here: an outstanding is a computed
 * steering figure, not a bank movement — « l'actuel au centime, l'estimé
 * arrondi » (CLAUDE.md § Gestion des arrondis).
 */
function useDebtFormatters() {
  const { i18n } = useTranslation('passif')
  const lang = i18n.language
  const fmtEur = (cents: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(cents / 100)
  const fmtRate = (bps: number) =>
    new Intl.NumberFormat(lang, {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(bps / 10000)
  const fmtMonthYear = (ms: number) =>
    new Date(ms).toLocaleDateString(lang, {
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return { fmtEur, fmtRate, fmtMonthYear }
}

/** Amber while running, neutral once settled — red stays for what goes wrong. */
function StatusBadge({ status }: { status: BankDebtRow['status'] }) {
  const { t } = useTranslation('passif')
  return (
    <Badge
      variant={status === 'active' ? 'outline' : 'secondary'}
      className={
        status === 'active'
          ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
          : undefined
      }
    >
      {t(`debt.status.${status}`)}
    </Badge>
  )
}

/**
 * « Dette bancaire » section of the Passif page: one row per loan, its terms
 * in a single sub-line, and the outstanding on the right.
 *
 * ONE amount per row, of ONE nature (SPEC D44): the right-hand column holds
 * nothing but outstanding capital. A pledged amount belongs to the loan
 * sheet — stacking the two here would invite a comparison that means nothing.
 */
export function BankDebtTable({
  orgSlug,
  debt,
}: {
  orgSlug: string
  debt: BankDebt | undefined
}) {
  const { t } = useTranslation('passif')
  const { fmtEur, fmtRate, fmtMonthYear } = useDebtFormatters()

  if (debt && debt.loans.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('debt.empty')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('debt.col.label')}</TableHead>
            <TableHead>{t('debt.col.terms')}</TableHead>
            <TableHead className="w-28" />
            <TableHead className="text-right">
              {t('debt.col.outstanding')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!debt ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-muted-foreground text-center"
              >
                <LoadingLine>{t('loading')}</LoadingLine>
              </TableCell>
            </TableRow>
          ) : (
            <>
              {debt.loans.map((loan) => (
                <TableRow key={loan._id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/app/$orgSlug/passif/prets/$loanId"
                      params={{ orgSlug, loanId: loan._id }}
                      className="hover:underline"
                    >
                      {loan.label}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {loan.lenderName} · {fmtRate(loan.currentRateBps)}{' '}
                    {t(`debt.${loan.rateKind === 'fixed' ? 'rateFixed' : 'rateVariable'}`)}{' '}
                    ·{' '}
                    {loan.lastPaymentDate
                      ? t('debt.until', {
                          date: fmtMonthYear(loan.lastPaymentDate),
                        })
                      : t('debt.noMaturity')}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={loan.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(loan.outstandingCents)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={3}>{t('debt.total')}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(debt.totalOutstandingCents)}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
