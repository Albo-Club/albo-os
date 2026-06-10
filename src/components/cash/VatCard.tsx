import { Link } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

/**
 * Carte « TVA récupérable » de la page Trésorerie : TVA déductible (charges
 * qualifiées) − TVA collectée (produits qualifiés), dérivée des montants TTC
 * par `transactions:getVatPosition`. Le lien « à qualifier » renvoie vers la
 * page Pointage (onglets Charges/Produits) où le taux se pose ligne à ligne.
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
      maximumFractionDigits: 0,
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
                  to="/app/$orgSlug/pointage"
                  params={{ orgSlug }}
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
