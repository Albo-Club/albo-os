import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { RulePrefill } from './ForecastSection'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionTone } from '~/lib/moneyTone'
import { Button } from '~/components/ui/button'

// Local mirror of forecasts.suggestRules' output (ForecastOverview pattern).
type Suggestion = {
  pattern: string
  direction: 'in' | 'out'
  label: string
  amountCents: number
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  anchorDay: number
  startDate: number
  category: string | null
  occurrences: number
  minAmountCents: number
  maxAmountCents: number
  lastDates: Array<number>
}

/**
 * Recurring flows detected in the history without a matching rule (Cash
 * « Aperçu », top of the recurring-rules section). Hidden when empty.
 * « Créer la règle » opens the prefilled rule dialog (the human adjusts and
 * saves — detection never writes a rule); « Ignorer » dismisses the
 * (pattern, direction) for good.
 */
export function SuggestedRulesCard({
  orgId,
  onCreate,
}: {
  orgId: Id<'organizations'>
  onCreate: (prefill: RulePrefill) => void
}) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const suggestions = useConvexQuery(api.forecasts.suggestRules, { orgId })
  const dismiss = useConvexMutation(api.forecasts.dismissRuleSuggestion)
  const [pending, setPending] = useState(false)

  if (!suggestions || suggestions.length === 0) return null

  async function handleDismiss(suggestion: Suggestion) {
    setPending(true)
    try {
      await dismiss({
        orgId,
        pattern: suggestion.pattern,
        direction: suggestion.direction,
      })
      toast.success(t('cash:forecast.suggestedRules.dismissed'))
    } catch {
      toast.error(t('cash:forecast.suggestedRules.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <div>
        <h4 className="text-sm font-semibold">
          {t('cash:forecast.suggestedRules.title')}
        </h4>
        <p className="text-muted-foreground text-xs">
          {t('cash:forecast.suggestedRules.hint')}
        </p>
      </div>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li
            key={`${suggestion.direction}:${suggestion.pattern}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          >
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{suggestion.label}</span>
                <span
                  className={`tabular-nums ${directionTone(suggestion.direction)}`}
                >
                  {suggestion.direction === 'out' ? '−' : '+'}
                  {fmtEur(suggestion.amountCents)}
                </span>
                <span className="text-muted-foreground">
                  {t(`cash:forecast.rules.frequency.${suggestion.frequency}`)}
                  {' · '}
                  {t('cash:forecast.rules.day', { day: suggestion.anchorDay })}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                {t('cash:forecast.suggestedRules.occurrences', {
                  count: suggestion.occurrences,
                  min: fmtEur(suggestion.minAmountCents),
                  max: fmtEur(suggestion.maxAmountCents),
                })}
                {' · '}
                {t('cash:forecast.suggestedRules.lastSeen', {
                  date: fmtDate(suggestion.lastDates[0]),
                })}
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  onCreate({
                    label: suggestion.label,
                    amountCents: suggestion.amountCents,
                    direction: suggestion.direction,
                    category: suggestion.category,
                    frequency: suggestion.frequency,
                    anchorDay: suggestion.anchorDay,
                    startDate: suggestion.startDate,
                  })
                }
              >
                {t('cash:forecast.suggestedRules.create')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => void handleDismiss(suggestion)}
              >
                {t('cash:forecast.suggestedRules.ignore')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
