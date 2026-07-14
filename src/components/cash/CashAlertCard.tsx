import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import { AmountInput } from '~/components/ui/amount-input'

/** "12 000" / "12000,50" (euros) → integer cents, null if invalid (0 ok). */
function parseThresholdEuros(raw: string): number | null {
  const cleaned = raw.replace(/[\s€]/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/**
 * Threshold-alert setting of the org (Cash « Aperçu », secondary zone):
 * "email me when the projected balance over the next 3 months drops under
 * X €". Evaluated daily by cron with a 7-day cooldown; saving clears the
 * cooldown so a new threshold can fire immediately.
 */
export function CashAlertCard({ orgId }: { orgId: Id<'organizations'> }) {
  const { t } = useTranslation(['cash', 'common'])
  const setting = useConvexQuery(api.forecasts.getCashAlert, { orgId })
  const setCashAlert = useConvexMutation(api.forecasts.setCashAlert)

  const [amount, setAmount] = useState('')
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState(false)

  // Hydrate the form once the setting loads (or changes server-side).
  useEffect(() => {
    if (setting === undefined) return
    setAmount(setting ? String(setting.thresholdCents / 100) : '')
    setActive(setting?.active ?? false)
  }, [setting])

  const thresholdCents = parseThresholdEuros(amount)
  const invalid = active && thresholdCents == null

  async function handleSave() {
    if (invalid || thresholdCents == null) return
    setPending(true)
    try {
      await setCashAlert({ orgId, thresholdCents, active })
      toast.success(t('cash:alert.saved'))
    } catch {
      toast.error(t('cash:alert.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {t('cash:alert.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">{t('cash:alert.hint')}</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="alert-threshold">
              {t('cash:alert.thresholdLabel')}
            </Label>
            <AmountInput
              id="alert-threshold"
              value={amount}
              onChange={setAmount}
              placeholder="50 000"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="alert-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="alert-active">{t('cash:alert.activeLabel')}</Label>
          </div>
          <Button
            variant="outline"
            className="mb-0.5"
            disabled={pending || invalid || thresholdCents == null}
            onClick={() => void handleSave()}
          >
            {t('common:actions.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
