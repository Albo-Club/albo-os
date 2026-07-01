import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { dateInputToMs, eurosToCents, msToDateInput } from '~/lib/parse'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '~/components/ui/input-group'
import { Input } from '~/components/ui/input'
import { useAmountField } from '~/components/ui/amount-input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/** Exit statuses offered in the dialog (display order). */
const EXIT_STATUSES = [
  'fully_exited',
  'partially_exited',
  'written_off',
] as const

type ExitStatus = (typeof EXIT_STATUSES)[number]

/**
 * Dedicated gesture to mark a deal as exited: status + exit date + exit
 * proceeds. Proceeds are pre-filled from the deal's realized inflows
 * (Σ incoming transactions) but freely overridable — `exitProceeds` is a
 * reporting field, not the MOIC basis. Persists through the generic
 * `deals.update`; the "cancel exit" action reverts to `active` and clears
 * both lifecycle fields (sent as `null`, cleared server-side).
 */
export function ExitDealDialog({
  deal,
  received,
  onClose,
}: {
  deal: Doc<'deals'>
  /** Σ incoming transactions (cents), pre-fills the proceeds field. */
  received?: number
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateDeal = useConvexMutation(api.deals.update)

  const isExited = deal.status !== 'active'

  const [status, setStatus] = useState<ExitStatus>(
    isExited ? (deal.status as ExitStatus) : 'fully_exited',
  )
  const [date, setDate] = useState(
    msToDateInput(deal.exitedDate ?? Date.now()),
  )
  const [proceeds, setProceeds] = useState(() => {
    const cents = deal.exitProceeds ?? received
    return cents != null ? String(cents / 100) : ''
  })
  const [pending, setPending] = useState(false)

  const parsedDate = dateInputToMs(date)
  const parsedProceeds = proceeds.trim() === '' ? null : eurosToCents(proceeds)
  // Date is required; proceeds is optional but must parse when provided.
  const valid = parsedDate != null && !(proceeds.trim() !== '' && parsedProceeds == null)

  async function handleSave() {
    // `valid` narrows parsedDate to a number (aliased condition).
    if (!valid) return
    setPending(true)
    try {
      await updateDeal({
        id: deal._id,
        patch: {
          status,
          exitedDate: parsedDate,
          exitProceeds: parsedProceeds ?? undefined,
        },
      })
      toast.success(t('participations:exit.saved'))
      onClose()
    } catch {
      toast.error(t('participations:edit.errors.default'))
    } finally {
      setPending(false)
    }
  }

  async function handleCancelExit() {
    setPending(true)
    try {
      // null clears the lifecycle fields server-side (reversibility).
      await updateDeal({
        id: deal._id,
        patch: { status: 'active', exitedDate: null, exitProceeds: null },
      })
      toast.success(t('participations:exit.reverted'))
      onClose()
    } catch {
      toast.error(t('participations:edit.errors.default'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('participations:exit.title')}</DialogTitle>
          <DialogDescription>
            {t('participations:exit.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('participations:exit.statusLabel')}</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ExitStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXIT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`participations:status.${s}`, { defaultValue: s })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exit-date">
              {t('participations:exit.dateLabel')}
            </Label>
            <Input
              id="exit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exit-proceeds">
              {t('participations:exit.proceedsLabel')}
            </Label>
            <InputGroup>
              <InputGroupInput
                id="exit-proceeds"
                {...useAmountField(proceeds, setProceeds)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>€</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <p className="text-muted-foreground text-xs">
              {t('participations:exit.proceedsHint')}
            </p>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {isExited ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleCancelExit()}
              disabled={pending}
            >
              {t('participations:exit.cancelExit')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={!valid || pending}>
              {t('common:actions.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
