import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import {
  GuaranteeBadges,
  GuaranteeSubject,
  PledgedAmount,
  useGuaranteeFormatters,
} from '~/components/passif/GuaranteeList'

type Given = FunctionReturnType<typeof api.guarantees.listByPledgorOrg>

/**
 * « Garanties données » block of the Passif page: the assets this company has
 * pledged for someone else.
 *
 * Visually DETACHED from the three sections above it (muted background): this
 * is not a debt, it is an off-balance-sheet commitment. Folding it into the
 * debt would suggest it can be added to it — it cannot.
 *
 * No total either. Pledged amounts of different natures, some unquantified,
 * summed into one figure would read like an exposure it is not.
 */
export function GuaranteesGivenSection({
  orgName,
  guarantees,
}: {
  orgName: string
  guarantees: Given | undefined
}) {
  const { t } = useTranslation('passif')
  const { fmtDate } = useGuaranteeFormatters()

  return (
    <section className="bg-muted/30 space-y-3 rounded-lg border border-dashed p-4">
      <div>
        <h2 className="text-lg font-medium">
          {t('guarantees.given.title')}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t('guarantees.given.subtitle')}
        </p>
      </div>

      {!guarantees || guarantees.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('guarantees.given.empty', { org: orgName })}
        </p>
      ) : (
        <ul className="divide-y">
          {guarantees.map((guarantee) => (
            <li
              key={guarantee._id}
              className={
                guarantee.releasedAt != null ? 'py-3 opacity-60' : 'py-3'
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <GuaranteeBadges guarantee={guarantee} />
                    <span className="text-sm">
                      {t('guarantees.given.forBorrower', {
                        borrower: guarantee.borrowerName ?? '—',
                      })}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm">
                    {t('guarantees.subjectLabel')}{' '}
                    <GuaranteeSubject guarantee={guarantee} />
                    {guarantee.loanLabel ? ` · ${guarantee.loanLabel}` : ''}
                    {guarantee.actDate != null
                      ? ` · ${t('guarantees.actOn', { date: fmtDate(guarantee.actDate) })}`
                      : ''}
                    {guarantee.releasedAt != null
                      ? ` · ${t('guarantees.releasedOn', { date: fmtDate(guarantee.releasedAt) })}`
                      : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <PledgedAmount cents={guarantee.pledgedAmountCents} />
                  {guarantee.borrowerOrgSlug ? (
                    <div>
                      <Link
                        to="/app/$orgSlug/passif"
                        params={{ orgSlug: guarantee.borrowerOrgSlug }}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        {guarantee.borrowerName}
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
