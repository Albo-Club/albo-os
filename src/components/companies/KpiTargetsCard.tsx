import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import { METRIC_CATALOG } from '../../../convex/lib/metricCatalog'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/**
 * Fiche KPI cible: the metric-catalog keys tracked for this company. Drives
 * the report-extraction grid and the recap checklist (brick "fiche KPI").
 * When the fiche is empty, the dialog pre-checks the metrics already seen in
 * past reports (suggestion) so the first setup is one validation away.
 */
export function KpiTargetsCard({
  companyId,
  seenMetricKeys,
}: {
  companyId: Id<'companies'>
  seenMetricKeys: Array<string>
}) {
  const { t } = useTranslation(['participations', 'common'])
  const company = useConvexQuery(api.companies.getById, { id: companyId })
  const updateCompany = useConvexMutation(api.companies.update)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Array<string> | null>(null)

  const saved = useMemo(() => company?.kpiTargets ?? [], [company])
  const catalogKeys = useMemo(() => new Set(METRIC_CATALOG.map((e) => e.key)), [])

  function openEditor() {
    // Empty fiche → suggest the catalog metrics already seen in reports.
    setSelected(saved.length > 0 ? saved : seenMetricKeys.filter((k) => catalogKeys.has(k)))
    setOpen(true)
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const list = prev ?? []
      return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
    })
  }

  async function save() {
    try {
      await updateCompany({ id: companyId, patch: { kpiTargets: selected ?? [] } })
      toast.success(t('participations:kpiTargets.saved'))
      setOpen(false)
    } catch {
      toast.error(t('participations:kpis.errors.default'))
    }
  }

  if (!company) return null

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('participations:kpiTargets.title')}</h3>
          <p className="text-muted-foreground text-xs">
            {t('participations:kpiTargets.subtitle')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={openEditor}>
          <Pencil className="size-3.5" />
          {t('common:actions.edit')}
        </Button>
      </div>
      {saved.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {saved.map((key) => (
            <Badge key={key} variant="secondary" className="font-mono text-xs uppercase">
              {key}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          {t('participations:kpiTargets.empty')}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('participations:kpiTargets.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('participations:kpiTargets.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {METRIC_CATALOG.map((entry) => (
              <label
                key={entry.key}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
              >
                <Checkbox
                  checked={(selected ?? []).includes(entry.key)}
                  onCheckedChange={() => toggle(entry.key)}
                />
                <span className="font-mono text-xs uppercase">{entry.key}</span>
                <span className="text-muted-foreground truncate text-xs">{entry.hint}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void save()}>{t('common:actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
