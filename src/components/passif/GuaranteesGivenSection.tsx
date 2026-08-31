import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import type { PledgorGuarantee } from '~/components/passif/GuaranteeList'
import {
  GuaranteeBadges,
  GuaranteeSubject,
  GuarantorName,
  PledgedAmount,
  useGuaranteeFormatters,
} from '~/components/passif/GuaranteeList'
import { GuaranteeDialog } from '~/components/passif/GuaranteeDialog'
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

type Given = FunctionReturnType<typeof api.guarantees.listByPledgorOrg>

/**
 * The co-securities hanging under a pledge of ours. A lifted one keeps its
 * line — it is history — but says so: without the marker it would read as
 * still sharing the burden of the debt.
 */
function OtherSecurities({
  others,
}: {
  others: PledgorGuarantee['otherSecurities']
}) {
  const { t } = useTranslation('passif')
  const { fmtDate } = useGuaranteeFormatters()
  if (others.length === 0) return null
  return (
    <ul className="border-muted mt-2 space-y-1 border-l-2 pl-3">
      {others.map((other) => (
        <li
          key={other._id}
          className={
            other.releasedAt != null
              ? 'text-muted-foreground text-xs opacity-60'
              : 'text-muted-foreground text-xs'
          }
        >
          {t('guarantees.given.otherSecurity')} :{' '}
          {t(`guarantees.form.${other.form}`)}{' '}
          <PledgedAmount cents={other.pledgedAmountCents} />
          {other.subject.label ? ` · ${other.subject.label}` : ''}
          {other.pledgorName ? ` · ${other.pledgorName}` : ''}
          {other.releasedAt != null
            ? ` · ${t('guarantees.releasedOn', { date: fmtDate(other.releasedAt) })}`
            : ''}
        </li>
      ))}
    </ul>
  )
}

/**
 * « Garanties données » block of the Passif page: the assets this company has
 * pledged for someone else.
 *
 * Visually DETACHED from the three sections above it (muted background): this
 * is not a debt, it is an off-balance-sheet commitment. Folding it into the
 * debt would suggest it can be added to it — it cannot.
 *
 * No total either. Pledged amounts of different natures, some unquantified,
 * summed into one figure would read like an exposure it is not.
 *
 * It is also the ONLY place a security given to a borrower outside the group
 * can be created and corrected — it hangs off no loan sheet of ours — hence
 * the « + » and the row menu here, and not only on the loan sheet. Under a
 * pledge of ours sits what a third party pledged on the SAME outside debt
 * (SPEC § 10 line 10b): our 500 K€ is not alone, and a row that matches no
 * pledge of ours is listed on its own rather than hidden.
 */
export function GuaranteesGivenSection({
  orgId,
  orgName,
  guarantees,
}: {
  orgId: Id<'organizations'>
  orgName: string
  guarantees: Given | undefined
}) {
  const { t } = useTranslation(['passif', 'common'])
  const { fmtDate } = useGuaranteeFormatters()
  const reportError = useReportError('passif')
  const setReleased = useConvexMutation(api.guarantees.setReleased)
  const removeGuarantee = useConvexMutation(api.guarantees.remove)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PledgorGuarantee | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Id<'guarantees'> | null>(
    null,
  )

  async function handleRelease(guarantee: PledgorGuarantee) {
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
    <section className="bg-muted/30 space-y-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">
            {t('passif:guarantees.given.title')}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('passif:guarantees.given.subtitle')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 size-4" />
          {t('passif:guarantees.add')}
        </Button>
      </div>

      {!guarantees || guarantees.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('passif:guarantees.given.empty', { org: orgName })}
        </p>
      ) : (
        <ul className="divide-y">
          {guarantees.map((guarantee) => (
            <li
              key={guarantee._id}
              className={
                guarantee.releasedAt != null ? 'py-3 opacity-60' : 'py-3'
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <GuaranteeBadges guarantee={guarantee} />
                    {/* A security this org filed without giving it: the
                        guarantor is someone else, so it has to be named. */}
                    {guarantee.isOwnPledge ? null : (
                      <Badge variant="secondary">
                        {t('passif:guarantees.given.thirdParty')}
                      </Badge>
                    )}
                    <span className="text-sm">
                      {t('passif:guarantees.given.forBorrower', {
                        borrower: guarantee.borrowerName ?? '—',
                      })}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-sm">
                    {t('passif:guarantees.subjectLabel')}{' '}
                    <GuaranteeSubject guarantee={guarantee} />
                    {guarantee.isOwnPledge ? null : (
                      <>
                        {' · '}
                        {t('passif:guarantees.pledgorLabel')}{' '}
                        <GuarantorName guarantee={guarantee} />
                      </>
                    )}
                    {guarantee.loanLabel ? ` · ${guarantee.loanLabel}` : ''}
                    {guarantee.actDate != null
                      ? ` · ${t('passif:guarantees.actOn', { date: fmtDate(guarantee.actDate) })}`
                      : ''}
                    {guarantee.releasedAt != null
                      ? ` · ${t('passif:guarantees.releasedOn', { date: fmtDate(guarantee.releasedAt) })}`
                      : ''}
                  </div>
                  <OtherSecurities others={guarantee.otherSecurities} />
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <div className="text-right text-sm">
                    <PledgedAmount cents={guarantee.pledgedAmountCents} />
                    {guarantee.borrowerOrgSlug ? (
                      <div>
                        <Link
                          to="/app/$orgSlug/passif"
                          params={{ orgSlug: guarantee.borrowerOrgSlug }}
                          className="text-muted-foreground hover:text-foreground text-xs"
                        >
                          {guarantee.borrowerName}
                        </Link>
                      </div>
                    ) : null}
                  </div>
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
                      <DropdownMenuItem onSelect={() => setEditing(guarantee)}>
                        {t('passif:guarantees.menu.edit')}
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
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <GuaranteeDialog orgId={orgId} onClose={() => setCreating(false)} />
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
    </section>
  )
}
