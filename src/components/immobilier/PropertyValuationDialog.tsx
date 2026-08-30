import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
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

/**
 * Adds a dated valuation to a property.
 *
 * No automatic estimate — no PriceHubble, no third-party API (SPEC D20).
 * `source` is a free label because that is what the information really is:
 * an agency estimate, a notary's figure, an expert appraisal.
 */
export function PropertyValuationDialog({
  propertyId,
  onClose,
}: {
  propertyId: Id<'properties'>
  onClose: () => void
}) {
  const { t } = useTranslation(['immobilier', 'common'])
  const reportError = useReportError('immobilier')
  const addValuation = useConvexMutation(api.properties.addValuation)

  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState('')
  const [source, setSource] = useState('')
  const [pending, setPending] = useState(false)

  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  const valid = asOf !== '' && Number.isFinite(parsed) && parsed >= 0

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      await addValuation({
        propertyId,
        asOf: Date.parse(`${asOf}T00:00:00.000Z`),
        valueCents: Math.round(parsed * 100),
        source: source.trim() || undefined,
      })
      toast.success(t('immobilier:sheet.valuations.saved'))
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
            {t('immobilier:sheet.valuations.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('immobilier:sheet.valuations.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="v-asof">
              {t('immobilier:sheet.valuations.asOf')}
            </Label>
            <Input
              id="v-asof"
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-value">
              {t('immobilier:sheet.valuations.value')}
            </Label>
            <AmountInput id="v-value" value={value} onChange={setValue} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-source">
              {t('immobilier:sheet.valuations.source')}
            </Label>
            <Input
              id="v-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={t('immobilier:sheet.valuations.sourcePlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!valid || pending}>
            {t('immobilier:create.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
