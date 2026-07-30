import { useTranslation } from 'react-i18next'

import { useFormatters } from '~/components/participations/ParticipationsTable'

/**
 * Custom central block for a `lead_spv` deal — the management side of an SPV
 * you lead (Hectarea, Eben Home): it tracks the revenue you earn as lead
 * (management fees + carried), not your own investment (that's the sibling
 * `spv_share` deal on the same entity).
 *
 * Level 1 (declarative), with NO waterfall/projection: the amount actually
 * collected to date is the gross sum of inbound transactions attached to the
 * deal (`received`, passed in from the page), read-only. The four stored
 * parameters (raised, fees, hurdle, carried) live in the sheet's side panel
 * (`InstrumentDetails`) like every other instrument's.
 */
export function LeadSpvPanel({ received }: { received?: number }) {
  const { t } = useTranslation('participations')
  const { fmtEurCents } = useFormatters()

  return (
    // Collected to date — derived from inbound transactions, read-only.
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
  )
}
