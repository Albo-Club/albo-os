import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import {
  CAPITAL_EVENT_KINDS,
  computeCapitalPosition,
} from '../../../convex/lib/capitalPosition'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  CapitalEventKind,
  TimelinePoint,
} from '../../../convex/lib/capitalPosition'
import { IdentitySection } from '~/components/companies/EntityFiche'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { AmountInput } from '~/components/ui/amount-input'
import { Badge } from '~/components/ui/badge'
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
import { Separator } from '~/components/ui/separator'
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
import { cn } from '~/lib/utils'

type Deals = FunctionReturnType<typeof api.deals.list>

/** Document kinds that can back a capital operation (the legal paperwork). */
const SOURCE_KINDS = new Set(['legal', 'pacte', 'subscription', 'attestation'])

/**
 * « Capital et valorisation » — the entry round of our share deals next to
 * the current point, with the operations recorded since. Everything shown is
 * derived in `computeCapitalPosition`: the entry from the deals, the current
 * point from the latest capital event. Renders nothing on a company we hold
 * through no share deal (SPV, BSA-AIR, OC: lot 1 scope is direct shares).
 */
export function CapitalSection({
  company,
  deals,
}: {
  company: { _id: Id<'companies'>; totalShares?: number | null }
  deals: Deals
}) {
  const { t, i18n } = useTranslation(['participations', 'common'])
  const { fmtEur, fmtEurCents, fmtDate } = useFormatters()
  const events = useConvexQuery(api.capitalEvents.listByCompany, {
    companyId: company._id,
  })
  const removeEvent = useConvexMutation(api.capitalEvents.remove)
  const confirmEvent = useConvexMutation(api.capitalEvents.confirm)
  const rejectEvent = useConvexMutation(api.capitalEvents.reject)
  const [adding, setAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'capitalEvents'> | null>(null)
  // One open detail row at a time: the timeline point's id, or null.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const shareDeals = useMemo(
    () =>
      deals.filter(
        (d) => d.instrumentKind === 'share' && d.status !== 'cancelled',
      ),
    [deals],
  )

  const position = useMemo(
    () =>
      computeCapitalPosition(
        shareDeals.map((d) => ({
          dealId: d._id,
          asOf: d.closingDate ?? d.signedDate ?? null,
          sharesAcquired: d.sharesAcquired ?? null,
          pricePerShareCents: d.pricePerShare ?? null,
          postMoneyCents: d.postMoneyValuation ?? null,
          ownershipBps: d.ownershipPct ?? null,
          costCents: d.paidActual > 0 ? d.paidActual : (d.committedAmount ?? 0),
        })),
        (events ?? [])
          .filter((e) => e.status === null)
          .map((e) => ({
            eventId: e._id,
            asOf: e.asOf,
            kind: e.kind,
            pricePerShareCents: e.pricePerShare,
            sharesIssued: e.sharesIssued,
            totalSharesAfter: e.totalSharesAfter,
          })),
        company.totalShares ?? null,
      ),
    [shareDeals, events, company.totalShares],
  )

  if (shareDeals.length === 0) return null

  const fmtShares = (n: number | null) =>
    n == null ? '—' : n.toLocaleString(i18n.language)
  const fmtBps = (bps: number | null) =>
    bps == null
      ? '—'
      : new Intl.NumberFormat(i18n.language, {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(bps / 10_000)

  // Relegated detail of one operation: what it issued, the resulting share
  // count and the document it was read from. Shown only when the row is open.
  const detailLine = (point: TimelinePoint) => {
    const parts: Array<string> = []
    if (point.sharesIssued != null) {
      parts.push(
        t(
          point.kind === 'entry'
            ? 'participations:capital.detailSubscribed'
            : 'participations:capital.detailIssued',
          { count: point.sharesIssued, shares: fmtShares(point.sharesIssued) },
        ),
      )
    }
    if (point.totalSharesAfter != null) {
      parts.push(
        t('participations:capital.detailTotal', {
          shares: fmtShares(point.totalSharesAfter),
        }),
      )
    }
    const title =
      point.source === 'event'
        ? events?.find((e) => e._id === point.id)?.document?.title
        : null
    if (title) {
      parts.push(t('participations:capital.detailSource', { title }))
    }
    return parts.length > 0
      ? parts.join(' · ')
      : t('participations:capital.detailNone')
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await removeEvent({ eventId: deleteId })
      toast.success(t('participations:capital.deleted'))
    } catch {
      toast.error(t('participations:capital.errors.default'))
    } finally {
      setDeleteId(null)
    }
  }

  // Read from a legal document, waiting for a click: shown after the
  // confirmed rows, never part of the position until confirmed.
  const proposals = (events ?? []).filter((e) => e.status === 'proposed')

  async function decide(eventId: Id<'capitalEvents'>, accept: boolean) {
    try {
      if (accept) await confirmEvent({ eventId })
      else await rejectEvent({ eventId })
      toast.success(
        t(
          accept
            ? 'participations:capital.confirmed'
            : 'participations:capital.rejected',
        ),
      )
    } catch (err) {
      const code = err instanceof ConvexError ? String(err.data) : ''
      toast.error(
        t(`participations:capital.errors.${code}`, {
          defaultValue: t('participations:capital.errors.default'),
        }),
      )
    }
  }

  const delta =
    position.valueCents != null
      ? position.valueCents - position.costCents
      : null

  // The entry point next to today, each label written once. A company with no
  // operation since the entry shows the left column only.
  const compareRows = [
    {
      label: t('participations:capital.pricePerShare'),
      entry: fmtEurCents(position.entry.pricePerShareCents),
      current: fmtEurCents(position.current.pricePerShareCents),
      down: position.downRound,
    },
    {
      label: t('participations:capital.ownership'),
      entry: fmtBps(position.entry.ownershipBps),
      current: fmtBps(position.current.ownershipBps),
      down: false,
    },
    {
      label: t('participations:capital.companyValuation'),
      entry: fmtEur(position.entry.postMoneyCents),
      current: fmtEur(position.current.postMoneyCents),
      down: false,
    },
  ]

  return (
    <IdentitySection
      title={t('participations:capital.title')}
      action={
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t('participations:capital.add')}
        </Button>
      }
    >
      {/* The one number to read first: what the line is worth today, against
          what it cost. Every other figure is relegated below it. */}
      <div className="bg-card space-y-5 rounded-lg border p-5">
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t('participations:capital.lineToday')}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              {fmtEur(position.valueCents)}
            </span>
            {delta != null && delta !== 0 && (
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  delta > 0 ? 'text-positive' : 'text-destructive',
                )}
              >
                {delta > 0 ? '+' : ''}
                {fmtEur(delta)}
              </span>
            )}
            {position.downRound && (
              <Badge variant="destructive" className="self-center">
                {t('participations:capital.downRound')}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {t('participations:capital.costAndShares', {
              cost: fmtEur(position.costCents),
              count: position.sharesHeld,
              shares: fmtShares(position.sharesHeld),
            })}
          </p>
        </div>

        <Separator />

        <div className="space-y-3">
          {position.unchanged ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('participations:capital.entry')}
                {position.entry.asOf != null &&
                  ` · ${fmtDate(position.entry.asOf)}`}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('participations:capital.unchanged')}
              </p>
            </div>
          ) : null}

          <div
            className={cn(
              'grid items-baseline gap-x-5 gap-y-2.5',
              position.unchanged
                ? 'grid-cols-[minmax(0,1fr)_8rem]'
                : 'grid-cols-[minmax(0,1fr)_8rem_8rem]',
            )}
          >
            {!position.unchanged && (
              <>
                <span />
                <ColumnHead
                  label={t('participations:capital.entry')}
                  date={fmtDate(position.entry.asOf)}
                />
                <ColumnHead
                  label={t('participations:capital.current')}
                  date={fmtDate(position.current.asOf)}
                  current
                />
              </>
            )}
            {compareRows.map((row) => (
              <Fragment key={row.label}>
                <span className="text-muted-foreground text-sm">
                  {row.label}
                </span>
                {!position.unchanged && (
                  <span className="text-muted-foreground text-right text-[15px] tabular-nums">
                    {row.entry}
                  </span>
                )}
                <span
                  className={cn(
                    'text-right text-[15px] font-semibold tabular-nums',
                    row.down && 'text-destructive',
                  )}
                >
                  {position.unchanged ? row.entry : row.current}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Read in a legal document, waiting for a click. Above the history
          because it is a to-do, not a fact. */}
      {proposals.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t('participations:capital.pendingTitle')}
          </p>
          {proposals.map((e) => (
            <div
              key={e._id}
              className="bg-muted/40 space-y-2.5 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-sm font-semibold">
                  {t(`participations:capital.kind.${e.kind}`)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t('participations:capital.proposalMeta', {
                    date: fmtDate(e.asOf),
                    price: fmtEurCents(e.pricePerShare),
                    shares: fmtShares(e.totalSharesAfter),
                  })}
                </span>
              </div>
              {e.evidence && (
                <p
                  className="text-muted-foreground truncate text-sm italic"
                  title={e.evidence}
                >
                  {e.evidence}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground min-w-0 truncate text-sm">
                  {e.document?.title
                    ? t('participations:capital.detailSource', {
                        title: e.document.title,
                      })
                    : ''}
                </span>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(e._id, false)}
                  >
                    {t('participations:capital.reject')}
                  </Button>
                  <Button size="sm" onClick={() => void decide(e._id, true)}>
                    {t('participations:capital.confirm')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t('participations:capital.operations')}
        </p>
        {!events ? (
          <LoadingLine>{t('participations:loading')}</LoadingLine>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">
                    {t('participations:capital.col.date')}
                  </TableHead>
                  <TableHead>{t('participations:capital.col.kind')}</TableHead>
                  <TableHead className="w-32 text-right">
                    {t('participations:capital.col.price')}
                  </TableHead>
                  <TableHead className="w-40 text-right">
                    {t('participations:capital.col.postMoney')}
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {position.timeline.map((point) => {
                  const open = expandedId === point.id
                  return (
                    <Fragment key={`${point.source}:${point.id}`}>
                      <TableRow className={cn(open && 'border-b-0')}>
                        <TableCell>{fmtDate(point.asOf)}</TableCell>
                        <TableCell className="font-medium">
                          {t(`participations:capital.kind.${point.kind}`)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEurCents(point.pricePerShareCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtEur(point.postMoneyCents)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-expanded={open}
                            aria-label={t(
                              open
                                ? 'participations:capital.collapse'
                                : 'participations:capital.expand',
                            )}
                            onClick={() =>
                              setExpandedId(open ? null : point.id)
                            }
                          >
                            <ChevronDown
                              className={cn(
                                'size-4 transition-transform',
                                open && 'rotate-180',
                              )}
                            />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="pt-0">
                            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                              <span className="min-w-0">
                                {detailLine(point)}
                              </span>
                              {point.source === 'event' && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="text-destructive h-auto shrink-0 p-0"
                                  onClick={() =>
                                    setDeleteId(point.id as Id<'capitalEvents'>)
                                  }
                                >
                                  {t('participations:capital.removeAction')}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {adding && (
        <AddCapitalEventDialog
          companyId={company._id}
          defaultTotalShares={position.current.totalShares}
          onClose={() => setAdding(false)}
        />
      )}

      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('participations:capital.deleteConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('participations:capital.deleteConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IdentitySection>
  )
}

/**
 * Header of one of the two value columns: the moment, then its date under it.
 * Today's column reads darker, so the eye lands on the current figures.
 */
function ColumnHead({
  label,
  date,
  current = false,
}: {
  label: string
  date: string
  current?: boolean
}) {
  return (
    <span
      className={cn(
        'text-right text-xs font-medium tracking-wide uppercase',
        current ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <span className="text-muted-foreground block text-[11px] font-normal tracking-normal normal-case">
        {date}
      </span>
    </span>
  )
}

function AddCapitalEventDialog({
  companyId,
  defaultTotalShares,
  onClose,
}: {
  companyId: Id<'companies'>
  defaultTotalShares: number | null
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const { fmtEur } = useFormatters()
  const create = useConvexMutation(api.capitalEvents.create)
  const documents = useConvexQuery(api.documents.listByCompany, { companyId })

  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [kind, setKind] = useState<CapitalEventKind>('round')
  const [price, setPrice] = useState('')
  const [issued, setIssued] = useState('')
  const [total, setTotal] = useState('')
  const [roundSize, setRoundSize] = useState('')
  const [documentId, setDocumentId] = useState<string>('none')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)

  const priceCents = eurosToCents(price)
  const totalShares = total.trim() === '' ? null : Number(total)
  const issuedShares = issued.trim() === '' ? null : Number(issued)
  const roundSizeCents =
    roundSize.trim() === '' ? null : eurosToCents(roundSize)
  const valid =
    asOf !== '' &&
    priceCents != null &&
    priceCents > 0 &&
    totalShares != null &&
    Number.isInteger(totalShares) &&
    totalShares > 0 &&
    (issuedShares == null ||
      (Number.isInteger(issuedShares) && issuedShares >= 0)) &&
    (roundSize.trim() === '' || roundSizeCents != null)

  const sourceDocs = (documents ?? []).filter((d) => SOURCE_KINDS.has(d.kind))

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      await create({
        companyId,
        asOf: Date.parse(`${asOf}T00:00:00.000Z`),
        kind,
        pricePerShare: priceCents,
        sharesIssued: issuedShares ?? undefined,
        totalSharesAfter: totalShares,
        roundSize: roundSizeCents ?? undefined,
        documentId:
          documentId === 'none' ? undefined : (documentId as Id<'documents'>),
        notes: notes.trim() || undefined,
      })
      toast.success(t('participations:capital.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? String(err.data) : ''
      toast.error(
        t(`participations:capital.errors.${code}`, {
          defaultValue: t('participations:capital.errors.default'),
        }),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('participations:capital.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('participations:capital.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ce-asof">
                {t('participations:capital.dialog.asOf')}
              </Label>
              <Input
                id="ce-asof"
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-kind">
                {t('participations:capital.dialog.kind')}
              </Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as CapitalEventKind)}
              >
                <SelectTrigger id="ce-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAPITAL_EVENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`participations:capital.kind.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ce-price">
              {t('participations:capital.dialog.pricePerShare')}
            </Label>
            <AmountInput id="ce-price" value={price} onChange={setPrice} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ce-issued">
                {t('participations:capital.dialog.sharesIssued')}
              </Label>
              <Input
                id="ce-issued"
                type="number"
                min={0}
                step={1}
                value={issued}
                onChange={(e) => setIssued(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-total">
                {t('participations:capital.dialog.totalSharesAfter')}
              </Label>
              <Input
                id="ce-total"
                type="number"
                min={1}
                step={1}
                value={total}
                placeholder={
                  defaultTotalShares != null ? String(defaultTotalShares) : ''
                }
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
          </div>
          {priceCents != null && totalShares != null && totalShares > 0 && (
            <p className="text-muted-foreground text-xs">
              {t('participations:capital.dialog.impliedPostMoney', {
                amount: fmtEur(priceCents * totalShares),
              })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ce-round">
              {t('participations:capital.dialog.roundSize')}
            </Label>
            <AmountInput
              id="ce-round"
              value={roundSize}
              onChange={setRoundSize}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ce-doc">
              {t('participations:capital.dialog.document')}
            </Label>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger id="ce-doc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t('participations:capital.dialog.documentNone')}
                </SelectItem>
                {sourceDocs.map((d) => (
                  <SelectItem key={d._id} value={d._id}>
                    <span className="block max-w-[24rem] truncate">
                      {d.title}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ce-notes">
              {t('participations:capital.dialog.notes')}
            </Label>
            <Input
              id="ce-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!valid || pending}
          >
            {t('participations:capital.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
