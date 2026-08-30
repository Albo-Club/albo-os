import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Doc } from '../../../convex/_generated/dataModel'
import { useReportError } from '~/components/pointage/TransactionSheet'
import { AmountInput } from '~/components/ui/amount-input'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

/** Projection horizon of the loan instalments, aligned with the cash tab. */
const FORECAST_MONTHS = 24

/** `YYYY-MM-DD` → midnight UTC, per the schema's date convention. */
const dateInputToMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`)

/** Amount typed in euros → cents. Empty = leave the field unchanged. */
function parseEuros(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed * 100)
}

/**
 * « Mettre à jour au JJ/MM » — records a dated AMENDMENT to the loan's terms
 * (`loans:addAmendment`).
 *
 * The difference with « Corriger » is the whole point of the two gestures
 * (SPEC D35). « Corriger » overwrites, as if the previous terms had never
 * existed — that is for a typo. An amendment KEEPS them: the instalments
 * already run stay exactly as they were, and the new terms apply to the
 * capital that remains. The app cannot tell one from the other, so the user
 * says which it is.
 *
 * Every field but the date is OPTIONAL, and empty means « unchanged ». A
 * renegotiation that only moves the rate types one number.
 */
export function LoanAmendmentDialog({
  loan,
  onClose,
}: {
  loan: Doc<'loans'>
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const addAmendment = useConvexMutation(api.loans.addAmendment)
  // An amendment moves every instalment after it, so the projection is
  // rebuilt — same stance as a rate step or a saved loan.
  const expandLoanSchedules = useConvexMutation(
    api.forecasts.expandLoanSchedules,
  )

  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [rate, setRate] = useState('')
  const [duration, setDuration] = useState('')
  const [insurance, setInsurance] = useState('')
  const [outstanding, setOutstanding] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)

  const parsedRate = Number.parseFloat(rate.replace(',', '.'))
  const parsedDuration = Number.parseInt(duration, 10)
  const valid = effectiveDate !== ''

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      await addAmendment({
        loanId: loan._id,
        effectiveDate: dateInputToMs(effectiveDate),
        // Empty = unchanged. Sending 0 would mean « zero rate », which is a
        // legal loan and not at all the same statement.
        rateBps:
          Number.isFinite(parsedRate) && parsedRate >= 0
            ? Math.round(parsedRate * 100)
            : undefined,
        durationMonths:
          Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
        insuranceMonthlyCents: parseEuros(insurance),
        outstandingCents: parseEuros(outstanding),
        notes: notes.trim() || undefined,
      })
      await expandLoanSchedules({ horizonMonths: FORECAST_MONTHS })
      toast.success(t('passif:loan.amendments.success'))
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('passif:loan.amendments.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('passif:loan.amendments.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="amendment-date">
              {t('passif:loan.amendments.effectiveLabel')}
            </Label>
            <Input
              id="amendment-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amendment-rate">
                {t('passif:loan.amendments.rateLabel')}
              </Label>
              <Input
                id="amendment-rate"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amendment-duration">
                {t('passif:loan.amendments.durationLabel')}
              </Label>
              <Input
                id="amendment-duration"
                type="number"
                min="1"
                step="1"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amendment-insurance">
              {t('passif:loan.amendments.insuranceLabel')}
            </Label>
            <AmountInput
              id="amendment-insurance"
              value={insurance}
              onChange={setInsurance}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amendment-outstanding">
              {t('passif:loan.amendments.outstandingLabel')}
            </Label>
            <AmountInput
              id="amendment-outstanding"
              value={outstanding}
              onChange={setOutstanding}
            />
            <p className="text-muted-foreground text-xs">
              {t('passif:loan.amendments.outstandingHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amendment-notes">
              {t('passif:loan.amendments.notesLabel')}
            </Label>
            <Input
              id="amendment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {t('passif:loan.amendments.emptyMeansUnchanged')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid || pending}>
            {t('passif:loan.amendments.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
