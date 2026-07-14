import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { directionTone } from '~/lib/moneyTone'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

// Local mirror of forecasts.suggestForecastMatches' output (ForecastOverview
// pattern — no runtime type sharing with convex/).
type Suggestion = {
  entry: {
    _id: Id<'forecastEntries'>
    date: number
    label: string
    amountCents: number
    direction: 'in' | 'out'
    confidence: 'confirmed' | 'expected' | 'probable'
    derivedFromRule: boolean
  }
  transaction: {
    _id: Id<'transactions'>
    transactionDate: number
    rawLabel: string
    counterparty: string | null
    amountCents: number
  }
  /** Deal-linked entry + unpointed transaction → offer the match after
   * reconciling (computed server-side). */
  pointToDealId: Id<'deals'> | null
}

/**
 * Suggested forecast-entry ↔ transaction reconciliations (Cash « Aperçu »
 * tab). Hidden when there is nothing to suggest. Equal amounts reconcile in
 * one click; a differing amount opens the explicit decision dialog: close
 * with the gap (default) or keep the remainder as a new pending entry
 * (partial payment — only offered when the transaction pays LESS than
 * forecast).
 */
export function ForecastMatchSuggestions({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation(['cash', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const suggestions = useConvexQuery(api.forecasts.suggestForecastMatches, {
    orgId,
  })
  const markEntryRealized = useConvexMutation(api.forecasts.markEntryRealized)
  const matchTransaction = useConvexMutation(api.transactions.matchTransaction)

  const [decision, setDecision] = useState<Suggestion | null>(null)
  const [pending, setPending] = useState(false)

  if (!suggestions || suggestions.length === 0) return null

  async function pointToDeal(suggestion: Suggestion) {
    if (!suggestion.pointToDealId) return
    try {
      await matchTransaction({
        transactionId: suggestion.transaction._id,
        dealId: suggestion.pointToDealId,
      })
      toast.success(t('cash:forecast.suggestions.pointed'))
    } catch {
      toast.error(t('cash:forecast.suggestions.error'))
    }
  }

  async function reconcile(
    suggestion: Suggestion,
    mode: 'close' | 'keepRemainder',
  ) {
    setPending(true)
    try {
      await markEntryRealized({
        entryId: suggestion.entry._id,
        transactionId: suggestion.transaction._id,
        mode,
      })
      const message =
        mode === 'keepRemainder'
          ? t('cash:forecast.suggestions.remainderKept', {
              amount: fmtEur(
                suggestion.entry.amountCents - suggestion.transaction.amountCents,
              ),
            })
          : t('cash:forecast.suggestions.matched')
      // Deal-linked entry + still-unpointed transaction: offer the second
      // gesture right away (matching stays a distinct, explicit action).
      if (suggestion.pointToDealId) {
        toast.success(message, {
          action: {
            label: t('cash:forecast.suggestions.pointAction'),
            onClick: () => void pointToDeal(suggestion),
          },
          duration: 10000,
        })
      } else {
        toast.success(message)
      }
      setDecision(null)
    } catch {
      toast.error(t('cash:forecast.suggestions.error'))
    } finally {
      setPending(false)
    }
  }

  function handleMatch(suggestion: Suggestion) {
    // No gap → nothing to decide.
    if (suggestion.entry.amountCents === suggestion.transaction.amountCents) {
      void reconcile(suggestion, 'close')
      return
    }
    setDecision(suggestion)
  }

  const remainderCents = decision
    ? decision.entry.amountCents - decision.transaction.amountCents
    : 0

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">
          {t('cash:forecast.suggestions.title')}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t('cash:forecast.suggestions.hint')}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {suggestions.map((suggestion) => {
          const { entry, transaction } = suggestion
          const deltaCents = entry.amountCents - transaction.amountCents
          return (
            <li
              key={entry._id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm"
            >
              <div className="min-w-0 flex-1 basis-52">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{entry.label}</span>
                  {entry.derivedFromRule && (
                    <Badge variant="secondary">
                      {t('cash:forecast.suggestions.ruleBadge')}
                    </Badge>
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  {fmtDate(entry.date)} ·{' '}
                  <span className={`tabular-nums ${directionTone(entry.direction)}`}>
                    {entry.direction === 'out' ? '−' : '+'}
                    {fmtEur(entry.amountCents)}
                  </span>
                </div>
              </div>
              <ArrowRight className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1 basis-52">
                <div className="truncate">
                  {transaction.counterparty ?? transaction.rawLabel}
                </div>
                <div className="text-muted-foreground text-xs">
                  {fmtDate(transaction.transactionDate)} ·{' '}
                  <span className={`tabular-nums ${directionTone(entry.direction)}`}>
                    {entry.direction === 'out' ? '−' : '+'}
                    {fmtEur(transaction.amountCents)}
                  </span>
                  {deltaCents !== 0 && (
                    <>
                      {' · '}
                      {t('cash:forecast.suggestions.delta', {
                        amount: fmtEur(Math.abs(deltaCents)),
                      })}
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleMatch(suggestion)}
              >
                {t('cash:forecast.suggestions.match')}
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('cash:forecast.suggestions.dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          {decision && (
            <div className="space-y-3 text-sm">
              <p>
                {t('cash:forecast.suggestions.dialogBody', {
                  expected: fmtEur(decision.entry.amountCents),
                  actual: fmtEur(decision.transaction.amountCents),
                })}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('cash:forecast.suggestions.closeWithGapHint')}
              </p>
              {remainderCents > 0 && (
                <p className="text-muted-foreground text-xs">
                  {t('cash:forecast.suggestions.keepRemainderHint')}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDecision(null)}
            >
              {t('common:actions.cancel')}
            </Button>
            {remainderCents > 0 && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => decision && void reconcile(decision, 'keepRemainder')}
              >
                {t('cash:forecast.suggestions.keepRemainder', {
                  amount: fmtEur(remainderCents),
                })}
              </Button>
            )}
            <Button
              disabled={pending}
              onClick={() => decision && void reconcile(decision, 'close')}
            >
              {t('cash:forecast.suggestions.closeWithGap')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
