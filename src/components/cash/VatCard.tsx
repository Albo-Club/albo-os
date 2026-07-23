import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

/**
 * "Recoverable VAT" card on the Cash page: deductible VAT (qualified
 * expenses) − collected VAT (qualified income), derived from tax-inclusive
 * amounts by `transactions:getVatPosition`. The "to qualify" link points to
 * the Transactions ledger (Cash section) where the rate is set per line.
 */
export function VatCard({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
}) {
  const { t, i18n } = useTranslation('cash')
  const position = useConvexQuery(api.transactions.getVatPosition, { orgId })

  const fmtEur = (cents: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {t('vat.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!position ? (
          <div className="text-muted-foreground text-sm">{t('loading')}</div>
        ) : (
          <div className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">
              {fmtEur(position.netCents)}
            </div>
            <p className="text-muted-foreground text-xs">
              {t('vat.breakdown', {
                deductible: fmtEur(position.deductibleCents),
                collected: fmtEur(position.collectedCents),
              })}
            </p>
            {position.unqualifiedCount > 0 && (
              <p className="text-muted-foreground text-xs">
                <Link
                  to="/app/$orgSlug/cash"
                  params={{ orgSlug }}
                  search={{ tab: 'transactions' }}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  {t('vat.unqualified', {
                    count: position.unqualifiedCount,
                  })}
                </Link>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
