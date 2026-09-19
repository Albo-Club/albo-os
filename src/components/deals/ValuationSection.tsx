import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
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
import { LoadingLine } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { eurosToCents } from '~/lib/parse'

/** Methods a human can pick when fixing the value of the line by hand. */
const MANUAL_METHODS = ['impairment', 'manual'] as const
type ManualMethod = (typeof MANUAL_METHODS)[number]

/**
 * « Valorisation » of a share deal: the valuation history that feeds its
 * TVPI — rows derived from confirmed capital operations (company sheet),
 * imports, and the manual adjustments entered here (an impairment is just a
 * later row, and wins until the next confirmed round).
 */
export function ValuationSection({ dealId }: { dealId: Id<'deals'> }) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtEur, fmtDate } = useFormatters()
  const valuations = useConvexQuery(api.valuations.list, { dealId })
  const [open, setOpen] = useState(false)

  // Known methods/sources read from their label; anything else (legacy
  // import values) shows as stored.
  const label = (group: 'method' | 'source', value: string | null) =>
    value
      ? t(`participations:valuation.${group}.${value}`, { defaultValue: value })
      : '—'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('participations:valuation.title')}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t('participations:valuation.adjust')}
        </Button>
      </div>

      {!valuations ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : valuations.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('participations:valuation.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('participations:valuation.col.date')}</TableHead>
                <TableHead className="text-right">
                  {t('participations:valuation.col.fairValue')}
                </TableHead>
                <TableHead>
                  {t('participations:valuation.col.method')}
                </TableHead>
                <TableHead>
                  {t('participations:valuation.col.source')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuations.map((valuation) => (
                <TableRow key={valuation._id}>
                  <TableCell>{fmtDate(valuation.asOf)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(valuation.fairValue)}
                  </TableCell>
                  <TableCell>
                    {label('method', valuation.valuationMethod)}
                  </TableCell>
                  <TableCell>
                    <span title={valuation.notes ?? undefined}>
                      {label('source', valuation.source)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {open && (
        <AdjustValuationDialog dealId={dealId} onClose={() => setOpen(false)} />
      )}
    </section>
  )
}

function AdjustValuationDialog({
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
          <Button
            onClick={() => void handleSave()}
            disabled={!valid || pending}
          >
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
