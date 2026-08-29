import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import { useReportError } from '~/components/pointage/TransactionSheet'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/** `YYYY-MM-DD` → midnight UTC, per the schema's date convention. */
const dateInputToMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`)

/**
 * Adds a step to a variable loan's rate series (`loans:addRate`): a revision
 * that happened (`actual`) or a steering assumption (`forecast`).
 *
 * The distinction is not cosmetic — instalments past the last `actual` step
 * are flagged as projected on the schedule, because the app does not pretend
 * to know the 2029 rate (SPEC D47).
 */
export function LoanRateDialog({
  loanId,
  onClose,
}: {
  loanId: Id<'loans'>
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const addRate = useConvexMutation(api.loans.addRate)

  const [fromDate, setFromDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [rate, setRate] = useState('')
  const [kind, setKind] = useState<'actual' | 'forecast'>('actual')
  const [pending, setPending] = useState(false)

  const parsed = Number.parseFloat(rate.replace(',', '.'))
  const rateBps = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null
  const valid = rateBps !== null && fromDate !== ''

  async function handleSave() {
    if (rateBps === null) return
    setPending(true)
    try {
      await addRate({
        loanId,
        fromDate: dateInputToMs(fromDate),
        rateBps,
        kind,
      })
      toast.success(t('passif:loan.rates.success'))
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
          <DialogTitle>{t('passif:loan.rates.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('passif:loan.rates.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rate-from">
              {t('passif:loan.rates.fromLabel')}
            </Label>
            <Input
              id="rate-from"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-value">
              {t('passif:loan.rates.rateLabel')}
            </Label>
            <Input
              id="rate-value"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-kind">
              {t('passif:loan.rates.natureLabel')}
            </Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as 'actual' | 'forecast')}
            >
              <SelectTrigger id="rate-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="actual">
                  {t('passif:loan.rates.actual')}
                </SelectItem>
                <SelectItem value="forecast">
                  {t('passif:loan.rates.forecast')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!valid || pending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
