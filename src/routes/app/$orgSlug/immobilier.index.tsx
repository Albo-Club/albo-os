import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
import { InvestmentsTabs } from '~/components/investments/InvestmentsTabs'
import { PropertyDialog } from '~/components/immobilier/PropertyDialog'
import { usePropertyFormatters } from '~/components/immobilier/formatters'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { LoadingLine } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/$orgSlug/immobilier/')({
  component: Immobilier,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'immobilier')('metaTitle'),
      },
    ],
  }),
})

/**
 * Immobilier tab of the Investissements section — the third one, next to
 * Entreprises and Placements (SPEC D28). A property is an investment, but
 * it would distort the portfolio's TVPI/MOIC if it sat under Entreprises.
 */
function Immobilier() {
  const { t } = useTranslation(['immobilier', 'nav'])
  const { orgSlug } = Route.useParams()
  const [creating, setCreating] = useState(false)
  const { fmtEur, fmtPercent } = usePropertyFormatters()

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const data = useConvexQuery(
    api.properties.list,
    org ? { orgId: org._id } : 'skip',
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('nav:items.investments')}
          </h1>
          <Button onClick={() => setCreating(true)} disabled={!org}>
            <Plus className="size-4" />
            {t('immobilier:create.button')}
          </Button>
        </div>
        <InvestmentsTabs
          orgSlug={orgSlug}
          active="immobilier"
          orgId={org?._id}
        />
        <p className="text-muted-foreground text-sm">
          {t('immobilier:subtitle')}
        </p>
      </div>

      {!data ? (
        <LoadingLine>{t('immobilier:loading')}</LoadingLine>
      ) : data.properties.length === 0 ? (
        <div className="text-muted-foreground space-y-1 rounded-lg border border-dashed p-8 text-center text-sm">
          <p className="text-foreground font-medium">
            {t('immobilier:list.empty')}
          </p>
          <p>{t('immobilier:list.emptyHint')}</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('immobilier:list.col.name')}</TableHead>
                <TableHead>{t('immobilier:list.col.type')}</TableHead>
                <TableHead>{t('immobilier:list.col.usage')}</TableHead>
                <TableHead className="text-right">
                  {t('immobilier:list.col.cost')}
                </TableHead>
                <TableHead className="text-right">
                  {t('immobilier:list.col.yield')}
                </TableHead>
                <TableHead className="text-right">
                  {t('immobilier:list.col.value')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.properties.map((property) => (
                <TableRow
                  key={property._id}
                  // A sold property stays listed, dimmed (C9) — it is history,
                  // not something to act on.
                  className={cn(property.status === 'sold' && 'opacity-60')}
                >
                  <TableCell>
                    <Link
                      to="/app/$orgSlug/immobilier/$propertyId"
                      params={{ orgSlug, propertyId: property._id }}
                      className="flex min-w-0 flex-col hover:underline"
                    >
                      <span className="flex items-center gap-2 truncate font-medium">
                        {property.name}
                        {property.status === 'sold' ? (
                          <Badge variant="secondary">
                            {t('immobilier:status.sold')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {property.address}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {t(`immobilier:type.${property.propertyType}`)}
                  </TableCell>
                  <TableCell>
                    {t(`immobilier:usage.${property.usage}`)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(property.costBasisCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* A property held for trading is not operated: its
                        result is read at the resale, not as a yield. */}
                    {property.usage === 'marchand_de_biens'
                      ? '—'
                      : fmtPercent(property.netYield)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {property.currentValueCents != null
                      ? fmtEur(property.currentValueCents)
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={5}>
                  {t('immobilier:list.count', {
                    count: data.properties.length,
                  })}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  title={t('immobilier:list.totalHint')}
                >
                  {fmtEur(data.totalValueCents)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {creating && org ? (
        <PropertyDialog orgId={org._id} onClose={() => setCreating(false)} />
      ) : null}
    </main>
  )
}
