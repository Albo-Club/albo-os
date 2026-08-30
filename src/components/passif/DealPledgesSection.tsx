import { useConvexQuery } from '@convex-dev/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import {
  GuaranteeBadges,
  GuarantorName,
  PledgedAmount,
  useGuaranteeFormatters,
} from '~/components/passif/GuaranteeList'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * « Nantissements sur ce contrat » — the block that carries the module's main
 * value (SPEC U3, § 6.5).
 *
 * It answers the one question nobody could answer without pulling out the
 * deeds: **what does this contract secure in total, and how much room is
 * left?** The answer only holds because the list includes the pledges that
 * benefit ANOTHER group company, and those that benefit a borrower outside
 * the group entirely (D-QA). Leaving the latter out is precisely how the
 * available margin would be overstated — an error in our disfavour, and an
 * invisible one.
 *
 * The section renders nothing when the contract is pledged nowhere: an empty
 * block on every placement sheet would be noise.
 */
export function DealPledgesSection({ dealId }: { dealId: Id<'deals'> }) {
  const { t } = useTranslation('passif')
  const { fmtEur, fmtDate } = useGuaranteeFormatters()
  const view = useConvexQuery(api.guarantees.listBySubjectDeal, { dealId })

  if (!view || view.guarantees.length === 0) return null

  const { summary } = view
  const negative =
    summary.availableMarginCents != null && summary.availableMarginCents < 0

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('guarantees.onDeal.title')}
      </h2>

      {/* Three figures, and only three: value, pledged, margin. */}
      <div className="grid grid-cols-1 gap-4 border-y py-4 sm:grid-cols-3">
        <div>
          <div className="text-muted-foreground text-xs uppercase">
            {t('guarantees.onDeal.value')}
          </div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {summary.currentValueCents == null
              ? '—'
              : fmtEur(summary.currentValueCents)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase">
            {t('guarantees.onDeal.pledged')}
          </div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {fmtEur(summary.pledgedTotalCents)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase">
            {t('guarantees.onDeal.margin')}
          </div>
          <div
            className={`mt-0.5 font-semibold tabular-nums ${
              negative ? 'text-destructive' : ''
            }`}
          >
            {summary.availableMarginCents == null
              ? '—'
              : fmtEur(summary.availableMarginCents)}
          </div>
        </div>
      </div>

      {summary.currentValueCents == null ? (
        <p className="text-muted-foreground text-xs">
          {t('guarantees.onDeal.noValue')}
        </p>
      ) : null}
      {negative ? (
        <p className="text-destructive text-xs">
          {t('guarantees.negativeMargin')}
        </p>
      ) : null}
      {summary.unquantifiedCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t('guarantees.unquantifiedNote', {
            count: summary.unquantifiedCount,
          })}
        </p>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('guarantees.onDeal.beneficiary')}</TableHead>
              <TableHead />
              <TableHead className="text-right">
                {t('guarantees.onDeal.total')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.guarantees.map((guarantee) => (
              <TableRow
                key={guarantee._id}
                className={
                  guarantee.releasedAt != null ? 'opacity-60' : undefined
                }
              >
                <TableCell>
                  <div className="font-medium">
                    {/* A beneficiary inside the group links to its own Passif
                        page; an outside one is a plain label. */}
                    {guarantee.borrowerOrgSlug ? (
                      <Link
                        to="/app/$orgSlug/passif"
                        params={{ orgSlug: guarantee.borrowerOrgSlug }}
                        className="hover:underline"
                      >
                        {guarantee.borrowerName}
                      </Link>
                    ) : (
                      (guarantee.borrowerName ?? '—')
                    )}
                    {guarantee.loanLabel ? (
                      <span className="text-muted-foreground font-normal">
                        {' · '}
                        {guarantee.loanLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t('guarantees.pledgorLabel')}{' '}
                    <GuarantorName guarantee={guarantee} />
                    {guarantee.actDate != null
                      ? ` · ${t('guarantees.actOn', { date: fmtDate(guarantee.actDate) })}`
                      : ''}
                    {guarantee.releasedAt != null
                      ? ` · ${t('guarantees.releasedOn', { date: fmtDate(guarantee.releasedAt) })}`
                      : ''}
                  </div>
                </TableCell>
                <TableCell>
                  <GuaranteeBadges guarantee={guarantee} />
                </TableCell>
                <TableCell className="text-right">
                  <PledgedAmount cents={guarantee.pledgedAmountCents} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={2}>{t('guarantees.onDeal.total')}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtEur(summary.pledgedTotalCents)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
