import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'
import type { ReactNode } from 'react'

import type { Doc, Id } from '../../../../convex/_generated/dataModel'
import type { DealOption } from '~/components/pointage/DealCombobox'
import type { TxDetails } from '~/components/pointage/TransactionSheet'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import {
  useDealTitle,
  useFormatters,
} from '~/components/participations/ParticipationsTable'
import { DealCombobox } from '~/components/pointage/DealCombobox'
import {
  TransactionSheet,
  useReportError,
} from '~/components/pointage/TransactionSheet'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

export const Route = createFileRoute('/app/$orgSlug/deals/$dealId')({
  component: DealDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitleDeal'),
      },
    ],
  }),
})

type InstrumentKind = Doc<'deals'>['instrumentKind']

/** Valeurs de l'enum `instrumentKind` du schéma (ordre d'affichage du dropdown). */
const INSTRUMENTS = [
  'share',
  'bsa',
  'bsa_air',
  'safe',
  'oc',
  'os',
  'convertible_note',
  'cca',
  'royalty',
  'fund_lp',
  'spv_share',
  'secondary',
  'real_estate_direct',
  'scpi',
  'cto',
  'dat',
  'crypto',
  'loan',
  'capitalization_account',
] as const satisfies ReadonlyArray<InstrumentKind>

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

function NotFound() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/participations"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('dealNotFound')}</p>
    </main>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

/**
 * Dialog d'édition du deal : nom personnalisé + type d'instrument.
 * Le changement d'instrument est une étiquette : aucun effet de bord sur
 * les transactions rattachées.
 */
function EditDealDialog({
  deal,
  onClose,
}: {
  deal: { _id: Id<'deals'>; name?: string | null; instrumentKind: InstrumentKind }
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateDeal = useConvexMutation(api.deals.update)
  const [name, setName] = useState(deal.name ?? '')
  const [instrument, setInstrument] = useState<InstrumentKind>(
    deal.instrumentKind,
  )
  const [pending, setPending] = useState(false)

  async function handleSave() {
    setPending(true)
    try {
      // '' = effacement du nom (le titre retombe sur l'instrument).
      await updateDeal({
        id: deal._id,
        patch: { name, instrumentKind: instrument },
      })
      toast.success(t('participations:edit.saved'))
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
          <DialogTitle>{t('participations:edit.dealTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:edit.dealDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deal-name">
              {t('participations:edit.nameLabel')}
            </Label>
            <Input
              id="deal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('participations:edit.dealNamePlaceholder')}
            />
            <p className="text-muted-foreground text-xs">
              {t('participations:edit.dealNameHint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t('participations:edit.instrumentLabel')}</Label>
            <Select
              value={instrument}
              onValueChange={(v) => setInstrument(v as InstrumentKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSTRUMENTS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`participations:instrument.${kind}`, {
                      defaultValue: kind,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Champs du deal courant utilisés par la section transactions. */
type CurrentDeal = {
  _id: Id<'deals'>
  orgId: Id<'organizations'>
  target: { name: string } | null
  investor: { name: string } | null
  instrumentKind: string
}

/** Combobox (deal courant pré-sélectionné) + bouton « Réattribuer ». */
function ReattachActions({
  deals,
  currentDeal,
  pending,
  onReattach,
}: {
  deals: Array<DealOption> | undefined
  currentDeal: DealOption
  pending: boolean
  onReattach: (deal: DealOption) => void
}) {
  const { t } = useTranslation('participations')
  const [deal, setDeal] = useState<DealOption | null>(currentDeal)
  return (
    <div className="flex items-center justify-end gap-2">
      <DealCombobox
        deals={deals}
        value={deal}
        onSelect={setDeal}
        disabled={pending}
      />
      <Button
        size="sm"
        disabled={!deal || deal._id === currentDeal._id || pending}
        onClick={() => deal && onReattach(deal)}
      >
        {t('tx.reattach')}
      </Button>
    </div>
  )
}

function Transactions({ deal }: { deal: CurrentDeal }) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const reportError = useReportError()
  const txs = useConvexQuery(api.transactions.listByDeal, { dealId: deal._id })

  const [sheetTx, setSheetTx] = useState<TxDetails | null>(null)
  const [pending, setPending] = useState(false)

  // Deals de l'org pour le combobox de réattribution — chargés seulement à
  // l'ouverture du sheet.
  const deals = useConvexQuery(
    api.deals.list,
    sheetTx ? { orgId: deal.orgId } : 'skip',
  )
  const matchTransaction = useConvexMutation(api.transactions.matchTransaction)

  // Réattribuer = re-pointer la transaction sur le nouveau deal via
  // `matchTransaction` (jamais d'écriture directe de `dealId`/`matchStatus`).
  async function handleReattach(tx: TxDetails, newDeal: DealOption) {
    setPending(true)
    try {
      await matchTransaction({ transactionId: tx._id, dealId: newDeal._id })
      toast.success(t('tx.reattached', { deal: newDeal.target?.name ?? '—' }))
      // `listByDeal` réactif : la transaction sort de la liste d'elle-même.
      setSheetTx(null)
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{t('tx.title')}</h2>
      {!txs ? (
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      ) : txs.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t('tx.empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tx.col.date')}</TableHead>
                <TableHead>{t('tx.col.direction')}</TableHead>
                <TableHead className="text-right">
                  {t('tx.col.amount')}
                </TableHead>
                <TableHead>{t('tx.col.label')}</TableHead>
                <TableHead>{t('tx.col.counterparty')}</TableHead>
                <TableHead>{t('tx.col.account')}</TableHead>
                <TableHead>{t('tx.col.reconciled')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txs.map((tx) => (
                <TableRow
                  key={tx._id}
                  className="cursor-pointer"
                  onClick={() => setSheetTx(tx)}
                >
                  <TableCell>{fmtDate(tx.transactionDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={tx.direction === 'in' ? 'default' : 'secondary'}
                    >
                      {t(`tx.${tx.direction}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtEur(tx.amount)}
                  </TableCell>
                  <TableCell>{tx.rawLabel}</TableCell>
                  <TableCell>{tx.counterparty ?? '—'}</TableCell>
                  <TableCell>{tx.account?.label ?? '—'}</TableCell>
                  <TableCell>{tx.reconciled ? t('tx.yes') : t('tx.no')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TransactionSheet
        tx={sheetTx}
        onOpenChange={(open) => {
          if (!open) setSheetTx(null)
        }}
        footer={
          sheetTx && (
            <ReattachActions
              key={sheetTx._id}
              deals={deals}
              currentDeal={deal}
              pending={pending}
              onReattach={(newDeal) => void handleReattach(sheetTx, newDeal)}
            />
          )
        }
      />
    </section>
  )
}

function DealDetail() {
  const { t, i18n } = useTranslation(['participations', 'common'])
  const lang = i18n.language
  const { orgSlug, dealId } = Route.useParams()
  const [editOpen, setEditOpen] = useState(false)
  const deal = useConvexQuery(api.deals.getById, {
    id: dealId as Id<'deals'>,
  })
  // Montants calculés depuis les transactions rattachées (même query que le
  // sous-composant Transactions — souscription partagée, pas de double charge).
  const txs = useConvexQuery(api.transactions.listByDeal, {
    dealId: dealId as Id<'deals'>,
  })
  const paidActual = txs?.reduce(
    (sum, tx) => (tx.direction === 'out' ? sum + tx.amount : sum),
    0,
  )
  const received = txs?.reduce(
    (sum, tx) => (tx.direction === 'in' ? sum + tx.amount : sum),
    0,
  )
  const { fmtEur, fmtDate } = useFormatters()
  const dealTitle = useDealTitle()
  const fmtPct = (bps?: number | null) =>
    bps == null
      ? null
      : new Intl.NumberFormat(lang, {
          style: 'percent',
          maximumFractionDigits: 2,
        }).format(bps / 10000)
  const fmtNum = (n?: number | null) =>
    n == null ? null : new Intl.NumberFormat(lang).format(n)

  if (!deal) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <div className="text-muted-foreground text-sm">{t('loading')}</div>
      </main>
    )
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      {deal.target && (
        <Link
          to="/app/$orgSlug/participations/$companyId"
          params={{ orgSlug, companyId: deal.target._id }}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {deal.target.name}
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* Nom seul : l'instrument est déjà affiché dans la grille d'infos. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {dealTitle(deal, { withInstrument: false })}
        </h1>
        <Badge variant={statusVariant(deal.status)}>
          {t(`status.${deal.status}`, { defaultValue: deal.status })}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          {t('common:actions.edit')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <Info
          label={t('deal.instrument')}
          value={t(`instrument.${deal.instrumentKind}`, {
            defaultValue: deal.instrumentKind,
          })}
        />
        <Info
          label={t('deal.investor')}
          value={
            deal.investor ? (
              <>
                {deal.investor.name}
                {deal.spv ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('deal.viaSpv')} {deal.spv.name}
                  </span>
                ) : null}
              </>
            ) : null
          }
        />
        <Info
          label={t('deal.target')}
          value={
            deal.target ? (
              <Link
                to="/app/$orgSlug/participations/$companyId"
                params={{ orgSlug, companyId: deal.target._id }}
                className="underline-offset-4 hover:underline"
              >
                {deal.target.name}
              </Link>
            ) : null
          }
        />
        <Info label={t('deal.committed')} value={fmtEur(deal.committedAmount)} />
        <Info label={t('deal.paid')} value={fmtEur(paidActual)} />
        <Info label={t('deal.received')} value={fmtEur(received)} />
        <Info label={t('deal.shares')} value={fmtNum(deal.sharesAcquired)} />
        <Info
          label={t('deal.pricePerShare')}
          value={fmtEur(deal.pricePerShare)}
        />
        <Info label={t('deal.interestRate')} value={fmtPct(deal.interestRate)} />
        <Info label={t('deal.maturity')} value={fmtDate(deal.maturityDate)} />
        <Info label={t('deal.principal')} value={fmtEur(deal.principalAmount)} />
        <Info label={t('deal.royaltyRate')} value={fmtPct(deal.royaltyRate)} />
        <Info
          label={t('deal.royaltyCap')}
          value={fmtEur(deal.royaltyCapAmount)}
        />
        <Info label={t('deal.valuationCap')} value={fmtEur(deal.valuationCap)} />
        <Info label={t('deal.discount')} value={fmtPct(deal.discount)} />
        <Info
          label={t('deal.entryValuation')}
          value={fmtEur(deal.entryValuation)}
        />
        <Info label={t('deal.roundSize')} value={fmtEur(deal.roundSize)} />
        <Info label={t('deal.signed')} value={fmtDate(deal.signedDate)} />
        <Info label={t('deal.closing')} value={fmtDate(deal.closingDate)} />
        <Info label={t('deal.exited')} value={fmtDate(deal.exitedDate)} />
        <Info label={t('deal.currency')} value={deal.currency} />
      </div>

      {deal.notes && (
        <div className="space-y-1">
          <span className="text-muted-foreground text-xs">
            {t('deal.notes')}
          </span>
          <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
        </div>
      )}

      <Transactions deal={deal} />

      {editOpen && (
        <EditDealDialog deal={deal} onClose={() => setEditOpen(false)} />
      )}
    </main>
  )
}
