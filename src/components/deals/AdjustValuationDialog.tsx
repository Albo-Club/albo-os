import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { eurosToCents } from '~/lib/parse'

/** Methods a human can pick when fixing the value of the line by hand. */
const MANUAL_METHODS = ['impairment', 'manual'] as const
type ManualMethod = (typeof MANUAL_METHODS)[number]

/**
 * Reads a stored `valuationMethod` / `source` back as a label. Known values
 * come from the translations; anything else (legacy import values) shows as
 * stored.
 */
export function useValuationLabel() {
  const { t } = useTranslation('participations')
  return (group: 'method' | 'source', value: string | null) =>
    value
      ? t(`participations:valuation.${group}.${value}`, { defaultValue: value })
      : '—'
}

/**
 * Hand-entered valuation of a deal: an impairment or a manual mark, written
 * as one more row of its history (it wins until the next confirmed round).
 * Shared by the « Valorisation » section and the fund panel.
 */
export function AdjustValuationDialog({
  dealId,
  onClose,
}: {
  dealId: Id<'deals'>
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const create = useConvexMutation(api.valuations.create)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<ManualMethod>('impairment')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)

  const cents = eurosToCents(amount)
  const valid = asOf !== '' && cents != null && cents > 0

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      await create({
        dealId,
        asOf: Date.parse(`${asOf}T00:00:00.000Z`),
        fairValue: cents,
        valuationMethod: method,
        source: 'manual',
        notes: notes.trim() || undefined,
      })
      toast.success(t('participations:valuation.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? String(err.data) : ''
      toast.error(
        t(`participations:valuation.errors.${code}`, {
          defaultValue: t('participations:valuation.errors.default'),
        }),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('participations:valuation.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('participations:valuation.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="val-asof">
                {t('participations:valuation.dialog.asOf')}
              </Label>
              <Input
                id="val-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="val-method">
                {t('participations:valuation.dialog.method')}
              </Label>
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as ManualMethod)}
              >
                <SelectTrigger id="val-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`participations:valuation.method.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="val-amount">
              {t('participations:valuation.dialog.fairValue')}
            </Label>
            <AmountInput id="val-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="val-notes">
              {t('participations:valuation.dialog.notes')}
            </Label>
            <Input
              id="val-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid || pending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
