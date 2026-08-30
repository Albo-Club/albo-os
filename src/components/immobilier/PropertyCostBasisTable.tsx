import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { usePropertyFormatters } from '~/components/immobilier/formatters'
import { useReportError } from '~/components/pointage/TransactionSheet'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

type CostPoste = Doc<'properties'>['costBasis'][number]['poste']

/** One resolved line item, as `properties.getById` returns it. */
export type ResolvedPoste = {
  poste: CostPoste
  source: 'manual' | 'flows'
  amountCents: number
  flowCount: number
  ignoredFlowCount: number
  ignoredFlowCents: number
}

/**
 * The cost basis of a property: one line per item, ONE amount, and a
 * « Source » column that IS the switch (SPEC D43, § 6.6).
 *
 * The switch is the whole point of the block. A property bought in 2019 —
 * before the bank connection existed — has an entered price and works that
 * come from real transfers; a global toggle would force sacrificing one or
 * the other. So the choice is per line item.
 *
 * A single amount is displayed, never two. When flows exist under an item
 * left on `manual`, the table says so (C14) rather than hide them — but it
 * never adds them in: that addition is the bug this design exists to
 * prevent.
 */
export function PropertyCostBasisTable({
  propertyId,
  postes,
  totalCents,
}: {
  propertyId: Id<'properties'>
  postes: Array<ResolvedPoste>
  totalCents: number
}) {
  const { t } = useTranslation('immobilier')
  const reportError = useReportError('immobilier')
  const { fmtEurCents } = usePropertyFormatters()
  const setSource = useConvexMutation(api.properties.setCostPosteSource)

  async function toggle(poste: ResolvedPoste) {
    try {
      await setSource({
        propertyId,
        poste: poste.poste,
        source: poste.source === 'manual' ? 'flows' : 'manual',
      })
      toast.success(t('source.switched'))
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">{t('sheet.costBasis.title')}</h2>
        <p className="text-muted-foreground text-xs">
          {t('sheet.costBasis.hint')}
        </p>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sheet.costBasis.col.poste')}</TableHead>
              <TableHead className="text-right">
                {t('sheet.costBasis.col.amount')}
              </TableHead>
              <TableHead className="w-40">
                {t('sheet.costBasis.col.source')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {postes.map((poste) => (
              <TableRow key={poste.poste}>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{t(`poste.${poste.poste}`)}</span>
                    {/* Flows exist but the entered amount stands. Saying so
                        beats silently swallowing them. */}
                    {poste.ignoredFlowCount > 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t('source.ignored', {
                          count: poste.ignoredFlowCount,
                        })}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEurCents(poste.amountCents)}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    title={t(
                      poste.source === 'manual'
                        ? 'source.switchToFlows'
                        : 'source.switchToManual',
                    )}
                    onClick={() => toggle(poste)}
                  >
                    {poste.source === 'manual' ? (
                      <Badge variant="secondary">{t('source.manual')}</Badge>
                    ) : poste.flowCount === 0 ? (
                      <Badge variant="outline">{t('source.flowsEmpty')}</Badge>
                    ) : (
                      <Badge variant="outline">
                        {t('source.flows', { count: poste.flowCount })}
                      </Badge>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell>{t('sheet.costBasis.total')}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtEurCents(totalCents)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
