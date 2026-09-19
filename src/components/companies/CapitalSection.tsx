import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
  CapitalSnapshot,
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
  const [adding, setAdding] = useState(false)
  const [deleteId, setDeleteId] = useState<Id<'capitalEvents'> | null>(null)

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
        (events ?? []).map((e) => ({
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

  const documentTitle = (point: TimelinePoint) =>
    point.source === 'event'
      ? (events?.find((e) => e._id === point.id)?.document?.title ?? '—')
      : '—'

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

  const delta =
    position.valueCents != null
      ? position.valueCents - position.costCents
      : null

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
      <div className="grid gap-3 sm:grid-cols-3">
        <SnapshotTile
          title={t('participations:capital.entry')}
          snapshot={position.entry}
          fmtEur={fmtEur}
          fmtEurCents={fmtEurCents}
          fmtDate={fmtDate}
          fmtBps={fmtBps}
        />
        <SnapshotTile
          title={t('participations:capital.current')}
          snapshot={position.current}
          fmtEur={fmtEur}
          fmtEurCents={fmtEurCents}
          fmtDate={fmtDate}
          fmtBps={fmtBps}
          badge={
            position.downRound ? (
              <Badge variant="destructive">
                {t('participations:capital.downRound')}
              </Badge>
            ) : position.unchanged ? (
              <span className="text-muted-foreground text-xs">
                {t('participations:capital.unchanged')}
              </span>
            ) : null
          }
        />
        <div className="bg-card rounded-lg border p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {t('participations:capital.line')}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            <Row label={t('participations:capital.value')}>
              <span className="tabular-nums">
                {fmtEur(position.valueCents)}
              </span>
              {delta != null && delta !== 0 && (
                <span
                  className={
                    delta > 0
                      ? 'text-positive ml-2 text-xs tabular-nums'
                      : 'text-destructive ml-2 text-xs tabular-nums'
                  }
                >
                  {delta > 0 ? '+' : ''}
                  {fmtEur(delta)}
                </span>
              )}
            </Row>
            <Row label={t('participations:capital.cost')}>
              <span className="tabular-nums">{fmtEur(position.costCents)}</span>
            </Row>
            <Row label={t('participations:capital.sharesHeld')}>
              <span className="tabular-nums">
                {fmtShares(position.sharesHeld)}
              </span>
            </Row>
          </dl>
        </div>
      </div>

      {!events ? (
        <LoadingLine>{t('participations:loading')}</LoadingLine>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('participations:capital.col.date')}</TableHead>
                <TableHead>{t('participations:capital.col.kind')}</TableHead>
                <TableHead className="text-right">
                  {t('participations:capital.col.price')}
                </TableHead>
                <TableHead className="text-right">
                  {t('participations:capital.col.issued')}
                </TableHead>
                <TableHead className="text-right">
                  {t('participations:capital.col.total')}
                </TableHead>
                <TableHead className="text-right">
                  {t('participations:capital.col.postMoney')}
                </TableHead>
                <TableHead>{t('participations:capital.col.source')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {position.timeline.map((point) => (
                <TableRow key={`${point.source}:${point.id}`}>
                  <TableCell>{fmtDate(point.asOf)}</TableCell>
                  <TableCell className="font-medium">
                    {t(`participations:capital.kind.${point.kind}`)}
                    {point.kind === 'entry' && point.sharesIssued != null && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        {t('participations:capital.entrySubscribed', {
                          count: point.sharesIssued,
                        })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEurCents(point.pricePerShareCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {point.kind === 'entry'
                      ? '—'
                      : fmtShares(point.sharesIssued)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtShares(point.totalSharesAfter)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(point.postMoneyCents)}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[14rem] truncate">
                    {documentTitle(point)}
                  </TableCell>
                  <TableCell>
                    {point.source === 'event' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        onClick={() =>
                          setDeleteId(point.id as Id<'capitalEvents'>)
                        }
                        aria-label={t('common:actions.delete')}
                        title={t('common:actions.delete')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function SnapshotTile({
  title,
  snapshot,
  badge,
  fmtEur,
  fmtEurCents,
  fmtDate,
  fmtBps,
}: {
  title: string
  snapshot: CapitalSnapshot
  badge?: React.ReactNode
  fmtEur: (cents?: number | null) => string
  fmtEurCents: (cents?: number | null) => string
  fmtDate: (ms?: number | null) => string
  fmtBps: (bps: number | null) => string
}) {
  const { t } = useTranslation('participations')
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase">
          {title}
          {snapshot.asOf != null && (
            <span className="ml-2 font-normal normal-case">
              {fmtDate(snapshot.asOf)}
            </span>
          )}
        </p>
        {badge}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {fmtEur(snapshot.postMoneyCents)}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <Row label={t('capital.pricePerShare')}>
          <span className="tabular-nums">
            {fmtEurCents(snapshot.pricePerShareCents)}
          </span>
        </Row>
        <Row label={t('capital.ownership')}>
          <span className="tabular-nums">{fmtBps(snapshot.ownershipBps)}</span>
        </Row>
      </dl>
    </div>
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
