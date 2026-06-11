import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type { EquityPositionRow, LoanRow } from './PassifTables'
import { useReportError } from '~/components/pointage/TransactionSheet'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
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

/** Selectable org (subset of `api.users.me` → `orgs`). */
export type OrgOption = {
  _id: Id<'organizations'>
  name: string
}

type EquityType = Doc<'equityPositions'>['type']

/** Values of the schema's `equityPositionType` enum (dropdown order). */
const EQUITY_TYPES = [
  'capital_social',
  'prime_emission',
  'augmentation_capital',
  'report_a_nouveau',
] as const satisfies ReadonlyArray<EquityType>

/** Today's date as `YYYY-MM-DD` (default value of the date fields). */
const today = () => new Date().toISOString().slice(0, 10)

/** ms epoch → `YYYY-MM-DD` (prefill in edit mode). */
const msToDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Parse an amount typed in euros → cents (null if invalid or ≤ 0). */
function parseEuros(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

// ─── « + Capital » / edit ────────────────────────────────────────────────────

/**
 * Dialog to create OR edit an equity position issued by the current org
 * (`liabilities:createEquityPosition` / `updateEquityPosition`). Absent
 * `position` = creation. The holder is either a group org, a free-form
 * label, or none.
 */
export function CreateEquityDialog({
  orgId,
  orgs,
  position,
  onClose,
}: {
  orgId: Id<'organizations'>
  orgs: Array<OrgOption>
  position?: EquityPositionRow
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const createEquityPosition = useConvexMutation(
    api.liabilities.createEquityPosition,
  )
  const updateEquityPosition = useConvexMutation(
    api.liabilities.updateEquityPosition,
  )

  const [type, setType] = useState<EquityType>(position?.type ?? 'capital_social')
  const [amount, setAmount] = useState(
    position ? String(position.amountCents / 100) : '',
  )
  // 'none' | 'external' | an organization _id.
  const [holder, setHolder] = useState<string>(
    position?.holderOrgId ?? (position?.holderLabel ? 'external' : 'none'),
  )
  const [holderLabel, setHolderLabel] = useState(position?.holderLabel ?? '')
  const [date, setDate] = useState(
    position ? msToDateInput(position.effectiveDate) : today(),
  )
  const [shares, setShares] = useState(
    position?.shares != null ? String(position.shares) : '',
  )
  const [pending, setPending] = useState(false)

  // The issuing org cannot hold its own capital.
  const holderOrgs = orgs.filter((org) => org._id !== orgId)

  const amountCents = parseEuros(amount)
  const valid =
    amountCents !== null &&
    date !== '' &&
    (holder !== 'external' || holderLabel.trim() !== '')

  async function handleSave() {
    // `valid` implies `amountCents !== null` (TS narrowing via alias).
    if (!valid) return
    setPending(true)
    try {
      const sharesValue = Number.parseInt(shares, 10)
      const fields = {
        type,
        amountCents,
        holderOrgId:
          holder !== 'none' && holder !== 'external'
            ? (holder as Id<'organizations'>)
            : undefined,
        holderLabel: holder === 'external' ? holderLabel.trim() : undefined,
        shares: Number.isFinite(sharesValue) ? sharesValue : undefined,
        effectiveDate: new Date(date).getTime(),
      }
      if (position) {
        await updateEquityPosition({ positionId: position._id, ...fields })
        toast.success(t('passif:edit.equity.success'))
      } else {
        await createEquityPosition({ orgId, ...fields })
        toast.success(t('passif:create.equity.success'))
      }
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {position
              ? t('passif:edit.equity.title')
              : t('passif:create.equity.title')}
          </DialogTitle>
          <DialogDescription>
            {t('passif:create.equity.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('passif:create.equity.typeLabel')}</Label>
            <Select
              value={type}
              onValueChange={(value) => setType(value as EquityType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUITY_TYPES.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`passif:equity.type.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="equity-amount">
              {t('passif:create.equity.amountLabel')}
            </Label>
            <Input
              id="equity-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('passif:create.equity.amountPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('passif:create.equity.holderLabel')}</Label>
            <Select value={holder} onValueChange={setHolder}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t('passif:create.equity.holderNone')}
                </SelectItem>
                {holderOrgs.map((org) => (
                  <SelectItem key={org._id} value={org._id}>
                    {org.name}
                  </SelectItem>
                ))}
                <SelectItem value="external">
                  {t('passif:create.equity.holderExternal')}
                </SelectItem>
              </SelectContent>
            </Select>
            {holder === 'external' && (
              <Input
                value={holderLabel}
                onChange={(e) => setHolderLabel(e.target.value)}
                placeholder={t(
                  'passif:create.equity.holderExternalPlaceholder',
                )}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="equity-date">
              {t('passif:create.equity.dateLabel')}
            </Label>
            <Input
              id="equity-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equity-shares">
              {t('passif:create.equity.sharesLabel')}
            </Label>
            <Input
              id="equity-shares"
              type="number"
              min="0"
              step="1"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder={t('passif:create.equity.sharesPlaceholder')}
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
            {position ? t('common:actions.save') : t('common:actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── « + Compte courant » / edit ─────────────────────────────────────────────

/**
 * Dialog to create OR edit a creditor → debtor inter-entity current
 * account (`liabilities:createIntercompanyLoan` /
 * `updateIntercompanyLoan`). Absent `loan` = creation. In edit mode the
 * parties are NOT editable (the derived balance depends on the loan's
 * identity): only date, rate and blocked flag are. Rate in % converted
 * to bps.
 */
export function CreateLoanDialog({
  orgId,
  orgs,
  loan,
  onClose,
}: {
  orgId: Id<'organizations'>
  orgs: Array<OrgOption>
  loan?: LoanRow
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const createIntercompanyLoan = useConvexMutation(
    api.liabilities.createIntercompanyLoan,
  )
  const updateIntercompanyLoan = useConvexMutation(
    api.liabilities.updateIntercompanyLoan,
  )

  const [fromOrgId, setFromOrgId] = useState<string>(loan?.fromOrgId ?? orgId)
  const [toOrgId, setToOrgId] = useState<string>(loan?.toOrgId ?? '')
  const [date, setDate] = useState(
    loan ? msToDateInput(loan.openedDate) : today(),
  )
  const [remunerated, setRemunerated] = useState(loan?.interestRateBps != null)
  const [rate, setRate] = useState(
    loan?.interestRateBps != null ? String(loan.interestRateBps / 100) : '',
  )
  const [isBlocked, setIsBlocked] = useState(loan?.isBlocked ?? false)
  const [pending, setPending] = useState(false)

  const ratePct = Number.parseFloat(rate.replace(',', '.'))
  const valid =
    fromOrgId !== '' &&
    toOrgId !== '' &&
    fromOrgId !== toOrgId &&
    date !== '' &&
    (!remunerated || (Number.isFinite(ratePct) && ratePct >= 0))

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      const fields = {
        interestRateBps: remunerated ? Math.round(ratePct * 100) : undefined,
        isBlocked,
        openedDate: new Date(date).getTime(),
      }
      if (loan) {
        await updateIntercompanyLoan({ loanId: loan._id, ...fields })
        toast.success(t('passif:edit.loan.success'))
      } else {
        await createIntercompanyLoan({
          fromOrgId: fromOrgId as Id<'organizations'>,
          toOrgId: toOrgId as Id<'organizations'>,
          ...fields,
        })
        toast.success(t('passif:create.loan.success'))
      }
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  const orgSelect = (
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
  ) => (
    <Select value={value} onValueChange={onChange} disabled={!!loan}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((org) => (
          <SelectItem key={org._id} value={org._id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {loan ? t('passif:edit.loan.title') : t('passif:create.loan.title')}
          </DialogTitle>
          <DialogDescription>
            {loan
              ? t('passif:edit.loan.description')
              : t('passif:create.loan.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('passif:create.loan.fromLabel')}</Label>
            {orgSelect(
              fromOrgId,
              setFromOrgId,
              t('passif:create.loan.orgPlaceholder'),
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('passif:create.loan.toLabel')}</Label>
            {orgSelect(
              toOrgId,
              setToOrgId,
              t('passif:create.loan.orgPlaceholder'),
            )}
            {fromOrgId !== '' && fromOrgId === toOrgId && (
              <p className="text-destructive text-xs">
                {t('passif:errors.same_org')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="loan-date">
              {t('passif:create.loan.dateLabel')}
            </Label>
            <Input
              id="loan-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="loan-remunerated"
              checked={remunerated}
              onCheckedChange={(checked) => setRemunerated(checked === true)}
            />
            <Label htmlFor="loan-remunerated">
              {t('passif:create.loan.remuneratedLabel')}
            </Label>
          </div>
          {remunerated && (
            <div className="space-y-2">
              <Label htmlFor="loan-rate">
                {t('passif:create.loan.rateLabel')}
              </Label>
              <Input
                id="loan-rate"
                type="number"
                min="0"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder={t('passif:create.loan.ratePlaceholder')}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="loan-blocked"
              checked={isBlocked}
              onCheckedChange={(checked) => setIsBlocked(checked === true)}
            />
            <Label htmlFor="loan-blocked">
              {t('passif:create.loan.blockedLabel')}
            </Label>
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
            {loan ? t('common:actions.save') : t('common:actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
