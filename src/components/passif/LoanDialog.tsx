import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { useReportError } from '~/components/pointage/TransactionSheet'
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

type AmortizationKind = Doc<'loans'>['amortizationKind']
type LoanStatus = Doc<'loans'>['status']

const KINDS = [
  'constant_annuity',
  'constant_capital',
  'bullet',
  'revolving',
] as const satisfies ReadonlyArray<AmortizationKind>

const STATUSES = ['active', 'repaid', 'cancelled'] as const

/** Projection horizon of the loan instalments, aligned with the cash tab. */
const FORECAST_MONTHS = 24

/** Today's date as `YYYY-MM-DD` (default value of the date fields). */
const today = () => new Date().toISOString().slice(0, 10)

/** ms epoch → `YYYY-MM-DD` (prefill in edit mode). */
const msToDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** `YYYY-MM-DD` → midnight UTC, per the schema's date convention. */
const dateInputToMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`)

/**
 * Amount typed in euros → cents. `null` when unusable, which is also how an
 * empty optional field (insurance, ceiling) reports "not filled in".
 *
 * `AmountInput` groups thousands with spaces while typing and emits the raw
 * string, hence the space stripping.
 */
function parseEuros(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

/** Percentage typed by the user → basis points. `null` when unusable. */
function parsePercent(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

/** Positive integer, or `null`. */
function parseCount(value: string): number | null {
  const parsed = Number.parseInt(value.replace(/\s/g, ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

/** One labelled field, stacked. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/** Bank accounts of the org, for the direct-debit select. */
export type AccountOption = { _id: Id<'bankAccounts'>; label: string }

/**
 * Dialog to create OR correct a bank loan (`loans:create` / `loans:update`).
 * Absent `loan` = creation.
 *
 * « Corriger » OVERWRITES the terms and recomputes the whole schedule: the
 * app cannot tell a typo from an amendment, and keeping the before and the
 * after of an amendment is a later gesture (SPEC D35). Revising a VARIABLE
 * rate is not a correction — it goes through a rate step on the loan sheet.
 *
 * The form reshapes itself around `amortizationKind`: a revolving has no
 * duration and no deferral (nothing to amortize), so those fields would be
 * dead weight and the ceiling takes their place.
 */
export function LoanDialog({
  orgId,
  accounts,
  loan,
  onClose,
}: {
  orgId: Id<'organizations'>
  accounts: Array<AccountOption>
  loan?: Doc<'loans'>
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const createLoan = useConvexMutation(api.loans.create)
  const updateLoan = useConvexMutation(api.loans.update)
  // Every save re-projects the schedule into the forecast (idempotent per
  // derivedKey), exactly as saving a forecast rule re-runs `expandRules`.
  // « Corriger » recomputes everything, so a stale instalment must not
  // survive in the projection.
  const expandLoanSchedules = useConvexMutation(
    api.forecasts.expandLoanSchedules,
  )

  const [label, setLabel] = useState(loan?.label ?? '')
  const [lenderName, setLenderName] = useState(loan?.lenderName ?? '')
  const [principal, setPrincipal] = useState(
    loan ? String(loan.principalCents / 100) : '',
  )
  const [signedDate, setSignedDate] = useState(
    loan ? msToDateInput(loan.signedDate) : today(),
  )
  const [firstPaymentDate, setFirstPaymentDate] = useState(
    loan ? msToDateInput(loan.firstPaymentDate) : today(),
  )
  const [kind, setKind] = useState<AmortizationKind>(
    loan?.amortizationKind ?? 'constant_annuity',
  )
  const [duration, setDuration] = useState(
    loan?.durationMonths != null ? String(loan.durationMonths) : '',
  )
  const [creditLimit, setCreditLimit] = useState(
    loan?.creditLimitCents != null ? String(loan.creditLimitCents / 100) : '',
  )
  const [endDate, setEndDate] = useState(
    loan?.endDate != null ? msToDateInput(loan.endDate) : '',
  )
  const [rate, setRate] = useState(loan ? String(loan.rateBps / 100) : '')
  const [rateKind, setRateKind] = useState<'fixed' | 'variable'>(
    loan?.rateKind ?? 'fixed',
  )
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>(
    loan?.paymentFrequency ?? 'monthly',
  )
  const [insurance, setInsurance] = useState(
    loan?.insuranceMonthlyCents != null
      ? String(loan.insuranceMonthlyCents / 100)
      : '',
  )
  const [deferral, setDeferral] = useState(
    loan?.deferralMonths != null ? String(loan.deferralMonths) : '',
  )
  const [deferralKind, setDeferralKind] = useState<'partial' | 'total'>(
    loan?.deferralKind ?? 'partial',
  )
  const [accountId, setAccountId] = useState<string>(
    loan?.bankAccountId ?? 'none',
  )
  const [status, setStatus] = useState<LoanStatus>(loan?.status ?? 'active')
  const [notes, setNotes] = useState(loan?.notes ?? '')
  const [pending, setPending] = useState(false)

  const isRevolving = kind === 'revolving'
  const principalCents = parseEuros(principal)
  const rateBps = parsePercent(rate)
  const durationMonths = parseCount(duration)

  const valid =
    label.trim() !== '' &&
    lenderName.trim() !== '' &&
    principalCents !== null &&
    rateBps !== null &&
    signedDate !== '' &&
    firstPaymentDate !== '' &&
    (isRevolving || durationMonths !== null)

  async function handleSave() {
    // `valid` implies principalCents and rateBps are non-null — TS narrows
    // through the alias (same pattern as CreateEquityDialog).
    if (!valid) return
    setPending(true)
    try {
      const deferralMonths = parseCount(deferral)
      const fields = {
        label: label.trim(),
        lenderName: lenderName.trim(),
        principalCents,
        signedDate: dateInputToMs(signedDate),
        firstPaymentDate: dateInputToMs(firstPaymentDate),
        durationMonths: isRevolving ? undefined : (durationMonths ?? undefined),
        amortizationKind: kind,
        creditLimitCents: isRevolving
          ? (parseEuros(creditLimit) ?? undefined)
          : undefined,
        endDate:
          isRevolving && endDate !== '' ? dateInputToMs(endDate) : undefined,
        rateBps,
        rateKind,
        insuranceMonthlyCents: parseEuros(insurance) ?? undefined,
        paymentFrequency: frequency,
        deferralMonths: isRevolving ? undefined : (deferralMonths ?? undefined),
        deferralKind:
          !isRevolving && deferralMonths !== null ? deferralKind : undefined,
        bankAccountId:
          accountId !== 'none' ? (accountId as Id<'bankAccounts'>) : undefined,
        notes: notes.trim() || undefined,
      }
      if (loan) {
        await updateLoan({ loanId: loan._id, status, ...fields })
        toast.success(t('passif:edit.debt.success'))
      } else {
        await createLoan({ orgId, ...fields })
        toast.success(t('passif:create.debt.success'))
      }
      await expandLoanSchedules({ orgId, horizonMonths: FORECAST_MONTHS })
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* shadcn's dialog has no height cap: without it the lower fields and
          the footer fall off the viewport (CLAUDE.md § anti-patterns). */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {loan ? t('passif:edit.debt.title') : t('passif:create.debt.title')}
          </DialogTitle>
          <DialogDescription>
            {loan
              ? t('passif:edit.debt.description')
              : t('passif:create.debt.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('passif:create.debt.labelLabel')} htmlFor="loan-label">
            <Input
              id="loan-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('passif:create.debt.labelPlaceholder')}
            />
          </Field>
          <Field
            label={t('passif:create.debt.lenderLabel')}
            htmlFor="loan-lender"
          >
            <Input
              id="loan-lender"
              value={lenderName}
              onChange={(event) => setLenderName(event.target.value)}
              placeholder={t('passif:create.debt.lenderPlaceholder')}
            />
          </Field>

          <Field label={t('passif:create.debt.kindLabel')} htmlFor="loan-kind">
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as AmortizationKind)}
            >
              <SelectTrigger id="loan-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`passif:debt.kind.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={
              isRevolving
                ? t('passif:create.debt.principalRevolvingLabel')
                : t('passif:create.debt.principalLabel')
            }
            htmlFor="loan-principal"
          >
            <AmountInput
              id="loan-principal"
              value={principal}
              onChange={setPrincipal}
              placeholder={t('passif:create.debt.principalPlaceholder')}
            />
          </Field>

          {isRevolving ? (
            <>
              <Field
                label={t('passif:create.debt.limitLabel')}
                htmlFor="loan-limit"
              >
                <AmountInput
                  id="loan-limit"
                  value={creditLimit}
                  onChange={setCreditLimit}
                  placeholder={t('passif:create.debt.limitPlaceholder')}
                />
              </Field>
              <Field
                label={t('passif:create.debt.endDateLabel')}
                htmlFor="loan-end"
              >
                <Input
                  id="loan-end"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </Field>
              <p className="text-muted-foreground sm:col-span-2 text-xs">
                {t('passif:create.debt.revolvingHint')}
              </p>
            </>
          ) : (
            <>
              <Field
                label={t('passif:create.debt.durationLabel')}
                htmlFor="loan-duration"
              >
                <Input
                  id="loan-duration"
                  type="number"
                  inputMode="numeric"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  placeholder={t('passif:create.debt.durationPlaceholder')}
                />
              </Field>
              <Field
                label={t('passif:create.debt.deferralLabel')}
                htmlFor="loan-deferral"
              >
                <Input
                  id="loan-deferral"
                  type="number"
                  inputMode="numeric"
                  value={deferral}
                  onChange={(event) => setDeferral(event.target.value)}
                />
              </Field>
              {parseCount(deferral) !== null ? (
                <Field
                  label={t('passif:create.debt.deferralKindLabel')}
                  htmlFor="loan-deferral-kind"
                >
                  <Select
                    value={deferralKind}
                    onValueChange={(value) =>
                      setDeferralKind(value as 'partial' | 'total')
                    }
                  >
                    <SelectTrigger id="loan-deferral-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="partial">
                        {t('passif:create.debt.deferralPartial')}
                      </SelectItem>
                      <SelectItem value="total">
                        {t('passif:create.debt.deferralTotal')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </>
          )}

          <Field label={t('passif:create.debt.rateLabel')} htmlFor="loan-rate">
            <Input
              id="loan-rate"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder={t('passif:create.debt.ratePlaceholder')}
            />
          </Field>
          <Field
            label={t('passif:create.debt.rateKindLabel')}
            htmlFor="loan-rate-kind"
          >
            <Select
              value={rateKind}
              onValueChange={(value) =>
                setRateKind(value as 'fixed' | 'variable')
              }
            >
              <SelectTrigger id="loan-rate-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">{t('passif:debt.rateFixed')}</SelectItem>
                <SelectItem value="variable">
                  {t('passif:debt.rateVariable')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t('passif:create.debt.signedLabel')}
            htmlFor="loan-signed"
          >
            <Input
              id="loan-signed"
              type="date"
              value={signedDate}
              onChange={(event) => setSignedDate(event.target.value)}
            />
          </Field>
          <Field
            label={t('passif:create.debt.firstPaymentLabel')}
            htmlFor="loan-first"
          >
            <Input
              id="loan-first"
              type="date"
              value={firstPaymentDate}
              onChange={(event) => setFirstPaymentDate(event.target.value)}
            />
          </Field>

          <Field
            label={t('passif:create.debt.frequencyLabel')}
            htmlFor="loan-frequency"
          >
            <Select
              value={frequency}
              onValueChange={(value) =>
                setFrequency(value as 'monthly' | 'quarterly')
              }
            >
              <SelectTrigger id="loan-frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  {t('passif:create.debt.frequencyMonthly')}
                </SelectItem>
                <SelectItem value="quarterly">
                  {t('passif:create.debt.frequencyQuarterly')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={t('passif:create.debt.insuranceLabel')}
            htmlFor="loan-insurance"
          >
            <AmountInput
              id="loan-insurance"
              value={insurance}
              onChange={setInsurance}
              placeholder={t('passif:create.debt.insurancePlaceholder')}
            />
          </Field>

          <Field
            label={t('passif:create.debt.accountLabel')}
            htmlFor="loan-account"
          >
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="loan-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t('passif:create.debt.accountNone')}
                </SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account._id} value={account._id}>
                    {account.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {loan ? (
            <Field
              label={t('passif:create.debt.statusLabel')}
              htmlFor="loan-status"
            >
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as LoanStatus)}
              >
                <SelectTrigger id="loan-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`passif:debt.status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <div className="sm:col-span-2">
            <Field
              label={t('passif:create.debt.notesLabel')}
              htmlFor="loan-notes"
            >
              <Input
                id="loan-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!valid || pending}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
