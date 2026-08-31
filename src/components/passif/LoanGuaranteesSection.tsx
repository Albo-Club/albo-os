import { useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import type { LoanGuarantee } from '~/components/passif/GuaranteeList'
import {
  AssetMarginLine,
  GuaranteeBadges,
  GuaranteeSubject,
  GuarantorName,
  PledgedAmount,
  useGuaranteeFormatters,
} from '~/components/passif/GuaranteeList'
import { GuaranteeDialog } from '~/components/passif/GuaranteeDialog'
import { DocumentsSection } from '~/components/documents/DocumentsSection'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

/**
 * Kinds offered when filing a document on a security, most likely first —
 * the first one is the dialog's default. `acte_garantie` exists for exactly
 * this (SPEC § 4.8).
 */
const GUARANTEE_DOC_KINDS = ['acte_garantie', 'legal', 'other'] as const

/**
 * « Garanties » section of a loan sheet: what covers this loan, and how much
 * room is left on each pledged asset.
 *
 * Rows are ordered strongest first (SPEC D48) by the server. The ordering is
 * a reading aid, not a legal verdict — the note under the list says so, and
 * it earns its place: a second rank looks exactly like a first until you read
 * its badge.
 */
export function LoanGuaranteesSection({
  loanId,
  orgId,
}: {
  loanId: Id<'loans'>
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const { fmtDate } = useGuaranteeFormatters()

  const guarantees = useConvexQuery(api.guarantees.listByLoan, { loanId })
  const setReleased = useConvexMutation(api.guarantees.setReleased)
  const removeGuarantee = useConvexMutation(api.guarantees.remove)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LoanGuarantee | null>(null)
  const [confirmDelete, setConfirmDelete] =
    useState<Id<'guarantees'> | null>(null)
  // The deed of ONE security. Opened from the row's ⋯ rather than inlined
  // under it: a list of securities is read to compare amounts and ranks, and
  // an upload zone per row would bury that. `skip` keeps the query from
  // running at all until the dialog is open.
  const [docsFor, setDocsFor] = useState<LoanGuarantee | null>(null)
  const guaranteeDocs = useConvexQuery(
    api.documents.listByGuarantee,
    docsFor ? { guaranteeId: docsFor._id } : 'skip',
  )

  async function handleRelease(guarantee: LoanGuarantee) {
    try {
      const releasing = guarantee.releasedAt == null
      await setReleased({
        guaranteeId: guarantee._id,
        releasedAt: releasing ? Date.now() : undefined,
      })
      toast.success(
        t(
          releasing
            ? 'passif:guarantees.released_success'
            : 'passif:guarantees.unreleased_success',
        ),
      )
    } catch (err) {
      reportError(err)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await removeGuarantee({ guaranteeId: confirmDelete })
      toast.success(t('passif:guarantees.deleteSuccess'))
    } catch (err) {
      reportError(err)
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('passif:guarantees.title')}</h2>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-4" />
          {t('passif:guarantees.add')}
        </Button>
      </div>

      {!guarantees || guarantees.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {t('passif:guarantees.empty')}
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {guarantees.map((guarantee) => (
              <li
                key={guarantee._id}
                className={
                  guarantee.releasedAt != null ? 'p-4 opacity-60' : 'p-4'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <GuaranteeBadges guarantee={guarantee} />
                  <div className="flex items-center gap-1">
                    <PledgedAmount cents={guarantee.pledgedAmountCents} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={t('common:actions.menu')}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setEditing(guarantee)}
                        >
                          {t('passif:guarantees.menu.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDocsFor(guarantee)}
                        >
                          {t('documents:guarantee.action')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void handleRelease(guarantee)}
                        >
                          {t(
                            guarantee.releasedAt == null
                              ? 'passif:guarantees.menu.release'
                              : 'passif:guarantees.menu.unrelease',
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setConfirmDelete(guarantee._id)}
                        >
                          {t('passif:guarantees.menu.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="text-muted-foreground mt-1 text-sm">
                  {t('passif:guarantees.subjectLabel')}{' '}
                  <GuaranteeSubject guarantee={guarantee} />
                  {' · '}
                  {t('passif:guarantees.pledgorLabel')}{' '}
                  <GuarantorName guarantee={guarantee} />
                  {guarantee.actDate != null
                    ? ` · ${t('passif:guarantees.actOn', { date: fmtDate(guarantee.actDate) })}`
                    : ''}
                  {guarantee.releasedAt != null
                    ? ` · ${t('passif:guarantees.releasedOn', { date: fmtDate(guarantee.releasedAt) })}`
                    : ''}
                </div>
                {/* The margin belongs to the ASSET, not to this loan: it
                    counts every pledge on it, including those benefiting
                    another company or an outside borrower (D-QA). */}
                {guarantee.subjectKind !== 'external' ? (
                  <AssetMarginLine summary={guarantee.assetSummary} />
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            {t('passif:guarantees.sortNote')}
          </p>
        </>
      )}

      {creating ? (
        <GuaranteeDialog
          orgId={orgId}
          loanId={loanId}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <GuaranteeDialog
          orgId={orgId}
          guarantee={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmDelete ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('passif:guarantees.deleteConfirmTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('passif:guarantees.deleteConfirmBody')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t('common:actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {docsFor ? (
        <Dialog open onOpenChange={(open) => !open && setDocsFor(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('documents:guarantee.dialogTitle')}</DialogTitle>
              <DialogDescription>
                {t(`passif:guarantees.form.${docsFor.form}`)}
                {docsFor.subject.label ? ` · ${docsFor.subject.label}` : ''}
              </DialogDescription>
            </DialogHeader>
            <DocumentsSection
              anchor={{ kind: 'guarantee', guaranteeId: docsFor._id }}
              docs={guaranteeDocs}
              kinds={GUARANTEE_DOC_KINDS}
              title={t('documents:guarantee.sectionTitle')}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}
