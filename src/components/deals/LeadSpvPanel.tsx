import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Doc } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'

/**
 * Custom central block for a `lead_spv` deal — the management side of an SPV
 * you lead (Hectarea, Eben Home): it tracks the revenue you earn as lead
 * (management fees + carried), not your own investment (that's the sibling
 * `spv_share` deal on the same entity).
 *
 * Level 1 (declarative): the four parameters are stored and shown as-is, with
 * NO waterfall/projection. The amount actually collected to date is the gross
 * sum of inbound transactions attached to the deal (`received`, passed in from
 * the page), read-only. Editing goes through the shared deal edit dialog
 * (`onEdit` → the page's EditDealDialog), never a bespoke form.
 *
 * First real `render: 'custom'` panel — model for the future RoyaltiesPanel.
 */
export function LeadSpvPanel({
  deal,
  received,
  onEdit,
}: {
  deal: Doc<'deals'>
  received?: number
  onEdit?: () => void
}) {
  const { t, i18n } = useTranslation('participations')
  const { fmtEurCents } = useFormatters()

  const fmtPct = (bps: number | undefined) =>
    bps == null
      ? '—'
      : new Intl.NumberFormat(i18n.language, {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(bps / 10000)

  const params = [
    { key: 'amountRaised', value: fmtEurCents(deal.amountRaised) },
    { key: 'managementFeeRate', value: fmtPct(deal.managementFeeRate) },
    { key: 'hurdleRate', value: fmtPct(deal.hurdleRate) },
    { key: 'carriedRate', value: fmtPct(deal.carriedRate) },
  ]

  return (
    <div className="space-y-4">
      {/* Collected to date — derived from inbound transactions, read-only. */}
      <div className="bg-positive/5 border-positive/30 flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-xs">
            {t('fiche.leadSpv.collected')}
          </div>
          <div className="text-positive text-2xl font-semibold tabular-nums">
            {fmtEurCents(received ?? 0)}
          </div>
        </div>
        <p className="text-muted-foreground max-w-[16rem] text-right text-xs">
          {t('fiche.leadSpv.collectedHint')}
        </p>
      </div>

      {/* Declarative parameters (stored). */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-medium">
            {t('fiche.leadSpv.paramsTitle')}
          </span>
          {onEdit && (
            <Button variant="ghost" size="sm" className="h-7" onClick={onEdit}>
              <Pencil className="size-3.5" />
              {t('fiche.leadSpv.edit')}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          {params.map((p) => (
            <div key={p.key} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">
                {t(`field.${p.key}`, { defaultValue: p.key })}
              </span>
              <span className="text-sm tabular-nums">{p.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
