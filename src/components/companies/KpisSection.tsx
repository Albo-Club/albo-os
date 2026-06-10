import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * KPIs d'une company (kpiSnapshots), les plus récents d'abord. Saisie
 * AI-first : on colle le reporting dans l'assistant qui extrait les
 * métriques (createKpiSnapshot) — pas de formulaire ici, juste lecture et
 * suppression.
 */
export function KpisSection({ companyId }: { companyId: Id<'companies'> }) {
  const { t, i18n } = useTranslation(['participations', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const kpis = useConvexQuery(api.kpis.listByCompany, { companyId })
  const removeKpi = useConvexMutation(api.kpis.remove)
  const [deleteId, setDeleteId] = useState<Id<'kpiSnapshots'> | null>(null)

  // Valeur formatée selon l'unité : cents EUR → €, bps → multiple ×, sinon
  // nombre brut (+ unité).
  function fmtValue(value: number, unit: string | null): string {
    if (unit === 'EUR_cents') return fmtEur(value)
    if (unit === 'bps') {
      return `${new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: 2,
      }).format(value / 10000)}×`
    }
    const formatted = new Intl.NumberFormat(i18n.language).format(value)
    return unit ? `${formatted} ${unit}` : formatted
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeKpi({ snapshotId: deleteId })
      toast.success(t('participations:kpis.deleted'))
    } catch {
      toast.error(t('participations:kpis.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">
        {t('participations:kpis.title')}
      </h2>

      {!kpis ? (
        <div className="text-muted-foreground text-sm">
          {t('participations:loading')}
        </div>
      ) : kpis.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          <p>{t('participations:kpis.empty')}</p>
          <p className="mt-1 text-xs">{t('participations:kpis.emptyHint')}</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('participations:kpis.col.metric')}</TableHead>
                <TableHead>{t('participations:kpis.col.period')}</TableHead>
                <TableHead className="text-right">
                  {t('participations:kpis.col.value')}
                </TableHead>
                <TableHead>{t('participations:kpis.col.source')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {kpis.map((kpi) => (
                <TableRow key={kpi._id}>
                  <TableCell className="font-medium uppercase">
                    {kpi.metricType}
                  </TableCell>
                  <TableCell>
                    {fmtDate(kpi.periodStart)} → {fmtDate(kpi.periodEnd)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtValue(kpi.value, kpi.unit)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {kpi.source ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive size-7"
                      onClick={() => setDeleteId(kpi._id)}
                      aria-label={t('common:actions.delete')}
                      title={t('common:actions.delete')}
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

      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('participations:kpis.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
