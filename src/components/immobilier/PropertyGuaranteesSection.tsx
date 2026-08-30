import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import {
  GuaranteeBadges,
  GuarantorName,
  useGuaranteeFormatters,
} from '~/components/passif/GuaranteeList'

/**
 * « Emprunt lié & sûreté » block of a property sheet.
 *
 * The same rows the loan sheet reads, from the other side (SPEC D13): a PPD
 * taken by SCI Chapelle 2 on its own building is entered once and read from
 * both. Nothing is stored twice, so the two sides cannot diverge.
 *
 * There is no « add » button here. A security is created from the loan it
 * covers, where its beneficiary is unambiguous.
 */
export function PropertyGuaranteesSection({
  propertyId,
  orgSlug,
}: {
  propertyId: Id<'properties'>
  orgSlug: string
}) {
  const { t } = useTranslation('immobilier')
  const { fmtPledged, fmtDate } = useGuaranteeFormatters()
  const data = useConvexQuery(api.guarantees.listBySubjectProperty, {
    propertyId,
  })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t('sheet.guarantees.title')}</h2>
      {!data || data.guarantees.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('sheet.guarantees.empty')}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.guarantees.map((guarantee) => (
            <li
              key={guarantee._id}
              className="flex items-start justify-between gap-4 p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <GuaranteeBadges guarantee={guarantee} />
                <p className="text-muted-foreground text-xs">
                  {guarantee.loanId && guarantee.loanLabel ? (
                    <Link
                      to="/app/$orgSlug/passif/prets/$loanId"
                      params={{ orgSlug, loanId: guarantee.loanId }}
                      className="hover:underline"
                    >
                      {guarantee.loanLabel}
                    </Link>
                  ) : (
                    (guarantee.borrowerName ??
                    t('sheet.guarantees.noLoan'))
                  )}
                  {' · '}
                  <GuarantorName guarantee={guarantee} />
                  {guarantee.actDate != null
                    ? ` · ${fmtDate(guarantee.actDate)}`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">
                {guarantee.pledgedAmountCents != null
                  ? fmtPledged(guarantee.pledgedAmountCents)
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
