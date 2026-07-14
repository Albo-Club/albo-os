import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'

/**
 * Quarterly VAT entry suggestion (Cash « Aperçu », next to the VAT card):
 * shown only when the last closed civil quarter's net VAT is OWED and the
 * entry hasn't been created yet. One explicit click creates a committed
 * `taxes` outflow due on the 24th after the quarter — the amount is
 * recomputed server-side, then the entry is a normal editable one-off.
 */
export function VatSuggestionCard({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const suggestion = useConvexQuery(api.forecasts.suggestVatEntry, { orgId })
  const createVatEntry = useConvexMutation(api.forecasts.createVatEntry)
  const [pending, setPending] = useState(false)

  if (!suggestion) return null
  // "2026-Q2" → "T2 2026" (fr) / "Q2 2026" (en).
  const [year, quarterNumber] = suggestion.quarterKey.split('-Q')
  const quarter = t('cash:vatSuggestion.quarter', {
    quarter: quarterNumber,
    year,
  })

  async function handleCreate() {
    if (!suggestion) return
    setPending(true)
    try {
      await createVatEntry({
        orgId,
        label: t('cash:vatSuggestion.entryLabel', { quarter }),
      })
      toast.success(t('cash:vatSuggestion.created'))
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        code === 'already_exists'
          ? t('cash:vatSuggestion.alreadyExists')
          : t('cash:vatSuggestion.error'),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-4">
      <h4 className="text-sm font-semibold">
        {t('cash:vatSuggestion.title', { quarter })}
      </h4>
      <p className="text-sm">
        {t('cash:vatSuggestion.body', {
          amount: fmtEur(suggestion.owedCents),
          collected: fmtEur(suggestion.collectedCents),
          deductible: fmtEur(suggestion.deductibleCents),
        })}
      </p>
      {suggestion.unqualifiedCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {t('cash:vatSuggestion.unqualified', {
            count: suggestion.unqualifiedCount,
          })}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void handleCreate()}
      >
        {t('cash:vatSuggestion.create', {
          date: fmtDate(suggestion.dueDateMs),
        })}
      </Button>
    </div>
  )
}
