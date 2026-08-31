import { useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'

import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
import { PropertyCostBasisTable } from '~/components/immobilier/PropertyCostBasisTable'
import { PropertyDialog } from '~/components/immobilier/PropertyDialog'
import { PropertyGuaranteesSection } from '~/components/immobilier/PropertyGuaranteesSection'
import { PropertyValuationDialog } from '~/components/immobilier/PropertyValuationDialog'
import { usePropertyFormatters } from '~/components/immobilier/formatters'
import { DocumentsSection } from '~/components/documents/DocumentsSection'
import { useReportError } from '~/components/pointage/TransactionSheet'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { LoadingLine } from '~/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/**
 * Kinds offered when filing a document on a property, most likely first — the
 * first one is the dialog's default. A deed of sale or a compromis is
 * `legal`; a works quote is `other`. No property-specific kind was added:
 * two buckets already say all a property needs to say.
 */
const PROPERTY_DOC_KINDS = ['legal', 'other'] as const

export const Route = createFileRoute('/app/$orgSlug/immobilier/$propertyId')({
  component: PropertySheet,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'immobilier',
        )('metaTitleDetail'),
      },
    ],
  }),
})

function NotFound() {
  const { t } = useTranslation('immobilier')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <Link
        to="/app/$orgSlug/immobilier"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('sheet.back')}
      </Link>
      <p className="text-muted-foreground text-sm">{t('sheet.notFound')}</p>
    </main>
  )
}

/** One headline figure. Inline, not a boxed tile — same as the loan sheet. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div
        className={cn(
          'mt-0.5 font-semibold tabular-nums',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function PropertySheet() {
  const { t } = useTranslation(['immobilier', 'common'])
  const { orgSlug, propertyId } = Route.useParams()
  const navigate = useNavigate()
  const reportError = useReportError('immobilier')
  const { fmtEur, fmtEurCents, fmtEurSigned, fmtPercent, fmtDate } =
    usePropertyFormatters()

  const [editing, setEditing] = useState(false)
  const [addingValuation, setAddingValuation] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const sheet = useConvexQuery(api.properties.getById, {
    propertyId: propertyId as Id<'properties'>,
  })
  const documents = useConvexQuery(api.documents.listByProperty, {
    propertyId: propertyId as Id<'properties'>,
  })
  const deallocateTransaction = useConvexMutation(
    api.liabilities.deallocateTransaction,
  )
  const [detaching, setDetaching] = useState<Id<'transactions'> | null>(null)
  const removeProperty = useConvexMutation(api.properties.remove)
  const removeValuation = useConvexMutation(api.properties.removeValuation)

  if (!sheet) {
    return (
      <main className="flex-1 p-6">
        <LoadingLine>{t('immobilier:loading')}</LoadingLine>
      </main>
    )
  }

  const { property, operating } = sheet
  // A property held for trading is not operated: its result is read at the
  // resale, so the sheet puts the cost basis and the exit forward instead
  // (SPEC D29 / § 4.3).
  const isDealer = property.usage === 'marchand_de_biens'

  async function handleDetach(transactionId: Id<'transactions'>) {
    setDetaching(transactionId)
    try {
      // No toast: the row leaves the table by itself (Convex reactivity),
      // which is the feedback — same as the Passif page's allocated rows.
      await deallocateTransaction({ transactionId })
    } catch (err) {
      reportError(err)
    } finally {
      setDetaching(null)
    }
  }

  async function handleDelete() {
    try {
      await removeProperty({ propertyId: propertyId as Id<'properties'> })
      toast.success(t('immobilier:sheet.delete.success'))
      await navigate({ to: '/app/$orgSlug/immobilier', params: { orgSlug } })
    } catch (err) {
      reportError(err)
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <Link
        to="/app/$orgSlug/immobilier"
        params={{ orgSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('immobilier:sheet.back')}
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {property.name}
          </h1>
          <Badge variant={property.status === 'held' ? 'outline' : 'secondary'}>
            {t(`immobilier:status.${property.status}`)}
          </Badge>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('common:actions.menu')}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="mr-2 size-4" />
                  {t('immobilier:sheet.menu.correct')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  {t('immobilier:sheet.menu.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {t(`immobilier:type.${property.propertyType}`)} · {property.address} ·{' '}
          {t(`immobilier:usage.${property.usage}`)}
          {property.acquiredDate != null
            ? ` · ${t('immobilier:sheet.acquiredOn', {
                date: fmtDate(property.acquiredDate),
              })}`
            : ''}
          {property.status === 'sold' && property.saleDate != null
            ? ` · ${t('immobilier:sheet.soldOn', {
                date: fmtDate(property.saleDate),
              })}`
            : ''}
        </p>
      </div>

      {/* Headline figures, inline — no boxed tiles, same as the loan sheet.
          The cost price is bank-exact (centimes); the value, the gain and
          the yield are steering figures and stay rounded (CLAUDE.md). */}
      <div className="grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={t('immobilier:sheet.stats.cost')}
          value={fmtEurCents(sheet.costBasisCents)}
        />
        <Stat
          label={t('immobilier:sheet.stats.value')}
          value={
            sheet.currentValueCents != null
              ? fmtEur(sheet.currentValueCents)
              : '—'
          }
        />
        <Stat
          label={t('immobilier:sheet.stats.gain')}
          value={
            sheet.latentGainCents != null
              ? fmtEurSigned(sheet.latentGainCents)
              : '—'
          }
          tone={
            sheet.latentGainCents == null
              ? undefined
              : sheet.latentGainCents >= 0
                ? 'positive'
                : 'negative'
          }
        />
        {isDealer ? (
          <Stat
            label={t('immobilier:sheet.stats.salePrice')}
            value={
              property.salePriceCents != null
                ? fmtEur(property.salePriceCents)
                : '—'
            }
          />
        ) : (
          <Stat
            label={t('immobilier:sheet.stats.yield')}
            value={fmtPercent(sheet.netYield)}
          />
        )}
        <Stat
          label={
            isDealer
              ? t('immobilier:sheet.stats.exitIrr')
              : t('immobilier:sheet.stats.exitIrr')
          }
          value={fmtPercent(sheet.exitIrr)}
        />
      </div>

      <PropertyCostBasisTable
        propertyId={property._id}
        postes={sheet.costBasis}
        totalCents={sheet.costBasisCents}
      />

      {/* Operations — hidden on a property held for trading, which earns
          nothing until it is resold. */}
      {isDealer ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">
            {t('immobilier:sheet.operating.title')}
          </h2>
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
            {t('immobilier:sheet.operating.hiddenForDealer')}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">
              {t('immobilier:sheet.operating.title')}
            </h2>
            <p className="text-muted-foreground text-xs">
              {t('immobilier:sheet.operating.hint')}
            </p>
          </div>
          {operating.flowCount === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
              {t('immobilier:sheet.operating.empty')}
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      {t('immobilier:sheet.operating.revenue')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEurCents(operating.revenueCents)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      {t('immobilier:sheet.operating.charges')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      − {fmtEurCents(operating.chargesCents)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40 font-medium">
                    <TableCell>{t('immobilier:sheet.operating.net')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEurCents(operating.netCents)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t('immobilier:sheet.valuations.title')}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddingValuation(true)}
          >
            <Plus className="mr-1.5 size-4" />
            {t('immobilier:sheet.valuations.add')}
          </Button>
        </div>
        {sheet.valuations.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('immobilier:sheet.valuations.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('immobilier:sheet.valuations.col.date')}
                  </TableHead>
                  <TableHead>
                    {t('immobilier:sheet.valuations.col.source')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('immobilier:sheet.valuations.col.value')}
                  </TableHead>
                  <TableHead className="w-14" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.valuations.map((valuation) => (
                  <TableRow key={valuation._id}>
                    <TableCell className="tabular-nums">
                      {fmtDate(valuation.asOf)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {valuation.source ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEur(valuation.valueCents)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive size-7"
                        aria-label={t('common:actions.delete')}
                        onClick={async () => {
                          try {
                            await removeValuation({
                              valuationId: valuation._id,
                            })
                            toast.success(
                              t('immobilier:sheet.valuations.deleted'),
                            )
                          } catch (err) {
                            reportError(err)
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <PropertyGuaranteesSection propertyId={property._id} orgSlug={orgSlug} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">
            {t('immobilier:sheet.transactions.title')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('immobilier:sheet.transactions.hint')}
          </p>
        </div>
        {sheet.transactions.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            {t('immobilier:sheet.transactions.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('immobilier:sheet.transactions.col.date')}
                  </TableHead>
                  <TableHead>
                    {t('immobilier:sheet.transactions.col.nature')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('immobilier:sheet.transactions.col.amount')}
                  </TableHead>
                  <TableHead>
                    {t('immobilier:sheet.transactions.col.label')}
                  </TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.transactions.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell>
                      {tx.category ? (
                        <Badge variant="secondary">
                          {t(`pointage:combobox.nature.${tx.category}`, {
                            ns: 'pointage',
                          })}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        tx.direction === 'in'
                          ? 'text-positive'
                          : 'text-destructive',
                      )}
                    >
                      {tx.direction === 'out' ? '− ' : ''}
                      {fmtEurCents(tx.amount)}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">
                      {tx.rawLabel}
                    </TableCell>
                    {/* The sheet UNDOES a matching, it never makes one
                        (SPEC D41). Detaching sends the movement back to the
                        queue, where the human picks its target AND its
                        nature — a property flow cannot be re-aimed without
                        re-answering that second question. */}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={detaching === tx._id}
                        onClick={() => void handleDetach(tx._id)}
                      >
                        {t('passif:allocated.detach')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <DocumentsSection
        anchor={{ kind: 'property', propertyId: property._id }}
        docs={documents}
        kinds={PROPERTY_DOC_KINDS}
        title={t('documents:property.title')}
      />

      {editing ? (
        <PropertyDialog
          orgId={property.orgId}
          property={property}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {addingValuation ? (
        <PropertyValuationDialog
          propertyId={property._id}
          onClose={() => setAddingValuation(false)}
        />
      ) : null}
      {confirmDelete ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmDelete(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('immobilier:sheet.delete.confirmTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('immobilier:sheet.delete.confirmBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('common:actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  )
}
