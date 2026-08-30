import { useState } from 'react'
import {
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'

import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
import { LoanAmendmentDialog } from '~/components/passif/LoanAmendmentDialog'
import { LoanDialog } from '~/components/passif/LoanDialog'
import { LoanGuaranteesSection } from '~/components/passif/LoanGuaranteesSection'
import { LoanRateDialog } from '~/components/passif/LoanRateDialog'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'
import { useReportError } from '~/components/pointage/TransactionSheet'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { LoadingLine } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/$orgSlug/passif/prets/$loanId')({
  component: LoanSheet,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'passif')('loan.metaTitle'),
      },
    ],
  }),
})

function NotFound() {
  const { t } = useTranslation('passif')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/passif"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('loan.back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('loan.notFound')}</p>
    </main>
  )
}

/** One headline figure. Inline, not a boxed tile (SPEC § 6.4). */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/**
 * Formatters of the loan sheet. Two families on purpose, per the house rule
 * « l'actuel au centime, l'estimé arrondi » (CLAUDE.md):
 * - `fmtEur` (rounded) for the outstanding, the principal, the ceiling —
 *   computed steering figures.
 * - `fmtEurCents` for the schedule rows, which must tie to the bank.
 */
function useLoanFormatters() {
  const { i18n } = useTranslation('passif')
  const lang = i18n.language
  const money = (cents: number, digits: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(cents / 100)
  return {
    fmtEur: (cents: number) => money(cents, 0),
    fmtEurCents: (cents: number) => money(cents, 2),
    fmtRate: (bps: number) =>
      new Intl.NumberFormat(lang, {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(bps / 10000),
    fmtDate: (ms: number) =>
      new Date(ms).toLocaleDateString(lang, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }),
  }
}

function LoanSheet() {
  const { t } = useTranslation(['passif', 'common'])
  const { orgSlug, loanId } = Route.useParams()
  const navigate = useNavigate()
  const reportError = useReportError('passif')
  const { fmtEur, fmtEurCents, fmtRate, fmtDate } = useLoanFormatters()

  const [editing, setEditing] = useState(false)
  const [amending, setAmending] = useState(false)
  const [addingRate, setAddingRate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const sheet = useConvexQuery(api.loans.getById, {
    loanId: loanId as Id<'loans'>,
  })
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    org ? { orgId: org._id } : 'skip',
  )
  const documents = useConvexQuery(api.documents.listByLoan, {
    loanId: loanId as Id<'loans'>,
  })
  const removeLoan = useConvexMutation(api.loans.remove)
  const removeRate = useConvexMutation(api.loans.removeRate)
  const removeAmendment = useConvexMutation(api.loans.removeAmendment)

  // Most recent instalment first — the one being watched sits at the top.
  const schedule = [...(sheet?.schedule ?? [])].reverse()
  const { page, pageCount, setPage } = usePagination(schedule.length, loanId)

  if (!sheet) {
    return (
      <main className="flex-1 p-6">
        <LoadingLine>{t('passif:loading')}</LoadingLine>
      </main>
    )
  }

  const { loan, summary } = sheet
  const isRevolving = loan.amortizationKind === 'revolving'
  const now = Date.now()

  async function handleDelete() {
    try {
      await removeLoan({ loanId: loanId as Id<'loans'> })
      toast.success(t('passif:delete.success'))
      await navigate({ to: '/app/$orgSlug/passif', params: { orgSlug } })
    } catch (err) {
      reportError(err)
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <Link
        to="/app/$orgSlug/passif"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('passif:loan.back')}
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loan.label}
          </h1>
          <Badge
            variant={loan.status === 'active' ? 'outline' : 'secondary'}
            className={
              loan.status === 'active'
                ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
                : undefined
            }
          >
            {t(`passif:debt.status.${loan.status}`)}
          </Badge>
          <div className="ml-auto">
            {/* Rare gestures that touch the foundations of the computation —
                out of sight on purpose (SPEC D40). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t('common:actions.menu')}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="mr-2 size-4" />
                  {t('passif:loan.menu.correct')}
                </DropdownMenuItem>
                {/* The second of the two rare gestures (SPEC D35, D40):
                    « Corriger » overwrites a typo, « Mettre à jour » keeps
                    the history of a renegotiation. A revolving has no
                    schedule to segment — it is corrected in place. */}
                {!isRevolving ? (
                  <DropdownMenuItem onSelect={() => setAmending(true)}>
                    <CalendarClock className="mr-2 size-4" />
                    {t('passif:loan.menu.amend')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  {t('passif:loan.menu.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {loan.lenderName} ·{' '}
          {t('passif:loan.signedOn', { date: fmtDate(loan.signedDate) })}
          {sheet.accountLabel
            ? ` · ${t('passif:loan.debitedFrom', { account: sheet.accountLabel })}`
            : ''}
        </p>
      </div>

      {/* Headline figures, inline — no boxed tiles (SPEC § 6.4). */}
      <div className="grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label={t(
            isRevolving
              ? 'passif:loan.stats.outstandingRevolving'
              : 'passif:loan.stats.principal',
          )}
          value={fmtEur(loan.principalCents)}
        />
        {isRevolving ? (
          <Stat
            label={t('passif:loan.stats.limit')}
            value={
              loan.creditLimitCents != null
                ? fmtEur(loan.creditLimitCents)
                : '—'
            }
          />
        ) : (
          <Stat
            label={t('passif:loan.stats.outstanding')}
            value={fmtEur(summary.outstandingCents)}
          />
        )}
        <Stat
          label={t('passif:loan.stats.kind')}
          value={t(`passif:debt.kind.${loan.amortizationKind}`)}
        />
        <Stat
          label={t('passif:loan.stats.rate')}
          value={`${fmtRate(summary.currentRateBps)} ${t(
            loan.rateKind === 'fixed'
              ? 'passif:debt.rateFixed'
              : 'passif:debt.rateVariable',
          )}`}
        />
        <Stat
          label={t(
            loan.paymentFrequency === 'monthly'
              ? 'passif:loan.stats.payment'
              : 'passif:loan.stats.paymentQuarterly',
          )}
          value={
            summary.currentPaymentCents > 0
              ? fmtEur(summary.currentPaymentCents)
              : '—'
          }
        />
        <Stat
          label={t('passif:loan.stats.insurance')}
          value={
            loan.insuranceMonthlyCents != null
              ? fmtEur(loan.insuranceMonthlyCents)
              : '—'
          }
        />
      </div>

      <LoanGuaranteesSection loanId={loan._id} orgId={loan.orgId} />

      {/* Rate series — variable-rate loans only. On a fixed rate there is
          nothing to enter and nothing to maintain (SPEC § 4.1 bis). */}
      {loan.rateKind === 'variable' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">{t('passif:loan.rates.title')}</h2>
              <p className="text-muted-foreground text-xs">
                {t('passif:loan.rates.hint')}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAddingRate(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('passif:loan.rates.add')}
            </Button>
          </div>
          {sheet.rates.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              {t('passif:loan.rates.empty')}
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('passif:loan.rates.col.from')}</TableHead>
                    <TableHead className="text-right">
                      {t('passif:loan.rates.col.rate')}
                    </TableHead>
                    <TableHead>{t('passif:loan.rates.col.nature')}</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheet.rates.map((step) => (
                    <TableRow
                      key={step._id}
                      className={step.kind === 'forecast' ? 'opacity-60' : undefined}
                    >
                      <TableCell className="tabular-nums">
                        {fmtDate(step.fromDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtRate(step.rateBps)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {t(`passif:loan.rates.${step.kind}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive size-7"
                          aria-label={t('common:actions.delete')}
                          onClick={async () => {
                            try {
                              await removeRate({ rateId: step._id })
                              toast.success(t('passif:loan.rates.deleted'))
                            } catch (err) {
                              reportError(err)
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}

      {/* Amendments — only when there are any. A loan that was never
          renegotiated has nothing to show, and an empty section would just
          advertise a gesture nobody needs (SPEC D35). */}
      {sheet.amendments.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">
              {t('passif:loan.amendments.title')}
            </h2>
            <p className="text-muted-foreground text-xs">
              {t('passif:loan.amendments.hint')}
            </p>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('passif:loan.amendments.col.from')}
                  </TableHead>
                  <TableHead>
                    {t('passif:loan.amendments.col.changes')}
                  </TableHead>
                  <TableHead className="w-14" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.amendments.map((amendment) => {
                  // Only what the amendment actually changed — an untouched
                  // field carries over, and listing it would suggest it moved.
                  const changes: Array<string> = []
                  if (amendment.rateBps != null) {
                    changes.push(
                      t('passif:loan.amendments.change.rate', {
                        value: fmtRate(amendment.rateBps),
                      }),
                    )
                  }
                  if (amendment.durationMonths != null) {
                    changes.push(
                      t('passif:loan.amendments.change.duration', {
                        count: amendment.durationMonths,
                      }),
                    )
                  }
                  if (amendment.insuranceMonthlyCents != null) {
                    changes.push(
                      t('passif:loan.amendments.change.insurance', {
                        value: fmtEur(amendment.insuranceMonthlyCents),
                      }),
                    )
                  }
                  if (amendment.outstandingCents != null) {
                    changes.push(
                      t('passif:loan.amendments.change.outstanding', {
                        value: fmtEur(amendment.outstandingCents),
                      }),
                    )
                  }
                  return (
                    <TableRow key={amendment._id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {fmtDate(amendment.effectiveDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>
                            {changes.length > 0
                              ? changes.join(' · ')
                              : t('passif:loan.amendments.change.none')}
                          </span>
                          {amendment.notes ? (
                            <span className="text-muted-foreground text-xs">
                              {amendment.notes}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive size-7"
                          aria-label={t('common:actions.delete')}
                          onClick={async () => {
                            try {
                              await removeAmendment({
                                amendmentId: amendment._id,
                              })
                              toast.success(
                                t('passif:loan.amendments.deleted'),
                              )
                            } catch (err) {
                              reportError(err)
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {/* Schedule — or, on a revolving, the explanation of why there is none. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">
            {t('passif:loan.schedule.title')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('passif:loan.schedule.hint')}
          </p>
        </div>

        {isRevolving ? (
          <div className="text-muted-foreground space-y-1 rounded-lg border border-dashed p-6 text-sm">
            <p className="text-foreground font-medium">
              {t('passif:loan.schedule.revolvingTitle')}
            </p>
            <p>{t('passif:loan.schedule.revolvingBody')}</p>
            {summary.availableCreditCents != null ? (
              <p>
                {t('passif:loan.schedule.revolvingHeadroom', {
                  amount: fmtEur(summary.availableCreditCents),
                })}
              </p>
            ) : null}
          </div>
        ) : schedule.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('passif:loan.schedule.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('passif:loan.schedule.col.date')}</TableHead>
                    <TableHead className="text-right">
                      {t('passif:loan.schedule.col.payment')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('passif:loan.schedule.col.capital')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('passif:loan.schedule.col.interest')}
                    </TableHead>
                    {loan.insuranceMonthlyCents != null ? (
                      <TableHead className="text-right">
                        {t('passif:loan.schedule.col.insurance')}
                      </TableHead>
                    ) : null}
                    <TableHead className="text-right">
                      {t('passif:loan.schedule.col.outstanding')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('passif:loan.schedule.colActual')}
                    </TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule
                    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                    .map((row) => {
                    const isDue = row.date <= now
                    return (
                      <TableRow
                        key={row.index}
                        className={cn(
                          // Upcoming instalments are dimmed; a due one is not
                          // a fault, so it stays plain — amber and red are
                          // reserved for what is waiting or wrong.
                          !isDue && 'text-muted-foreground',
                          row.isBalloon && 'bg-muted/40 font-medium',
                        )}
                      >
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {fmtDate(row.date)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEurCents(row.paymentCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEurCents(row.capitalCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEurCents(row.interestCents)}
                        </TableCell>
                        {loan.insuranceMonthlyCents != null ? (
                          <TableCell className="text-right tabular-nums">
                            {fmtEurCents(row.insuranceCents)}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums">
                          {fmtEurCents(row.remainingCents)}
                        </TableCell>
                        {/* The actual is the CONSEQUENCE of a matching
                            gesture made in the queue, never a way to make
                            one here (SPEC D41). Amber marks a wait, not a
                            fault — red stays for what goes wrong. */}
                        <TableCell className="text-right tabular-nums">
                          {row.actualCents != null ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {fmtEurCents(row.actualCents)}
                            </span>
                          ) : isDue ? (
                            <span className="text-amber-700 dark:text-amber-400">
                              {t('passif:loan.schedule.toMatch')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          {row.isBalloon ? (
                            <Badge variant="outline">
                              {t('passif:loan.schedule.balloon')}
                            </Badge>
                          ) : null}
                          {row.capitalized ? (
                            <Badge variant="secondary">
                              {t('passif:loan.schedule.capitalized')}
                            </Badge>
                          ) : row.isDeferred ? (
                            <Badge variant="secondary">
                              {t('passif:loan.schedule.deferred')}
                            </Badge>
                          ) : null}
                          {row.projected ? (
                            <Badge variant="secondary">
                              {t('passif:loan.schedule.projected')}
                            </Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <PaginationFooter
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
            />
            <p className="text-muted-foreground text-xs">
              {t('passif:loan.schedule.attributionNote')}
            </p>
            {loan.insuranceMonthlyCents != null ? (
              <p className="text-muted-foreground text-xs">
                {t('passif:loan.schedule.insuranceNote')}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">
            {t('passif:loan.transactions.title')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('passif:loan.transactions.hint')}
          </p>
        </div>
        {sheet.transactions.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('passif:loan.transactions.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('passif:loan.transactions.col.date')}
                  </TableHead>
                  <TableHead>
                    {t('passif:loan.transactions.col.direction')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('passif:loan.transactions.col.amount')}
                  </TableHead>
                  <TableHead>
                    {t('passif:loan.transactions.col.label')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.transactions.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell>
                      {t(`passif:loan.transactions.${tx.direction}`)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEurCents(tx.amount)}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">
                      {tx.rawLabel}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell colSpan={2}>
                    {t('passif:loan.transactions.total')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEurCents(sheet.paidCents)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t('passif:loan.documents.title')}
        </h2>
        {!documents || documents.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('passif:loan.documents.empty')}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((doc) => (
              <li key={doc._id} className="p-3 text-sm">
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {doc.title}
                  </a>
                ) : (
                  doc.title
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {amending ? (
        <LoanAmendmentDialog loan={loan} onClose={() => setAmending(false)} />
      ) : null}
      {editing ? (
        <LoanDialog
          orgId={loan.orgId}
          accounts={(accounts ?? []).map((account) => ({
            _id: account._id,
            label: account.displayName ?? account.label,
          }))}
          loan={loan}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {addingRate ? (
        <LoanRateDialog
          loanId={loan._id}
          onClose={() => setAddingRate(false)}
        />
      ) : null}
      {confirmDelete ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmDelete(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('passif:delete.confirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('passif:delete.debtConfirmBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('common:actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  )
}
