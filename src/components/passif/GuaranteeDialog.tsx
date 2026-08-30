import { useState } from 'react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import type { LoanGuarantee } from '~/components/passif/GuaranteeList'
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

type GuaranteeForm =
  | 'nantissement'
  | 'hypotheque'
  | 'ppd'
  | 'caution'
  | 'garantie_organisme'
type SubjectKind = 'placement' | 'shares' | 'external'

const FORMS = [
  'ppd',
  'hypotheque',
  'nantissement',
  'garantie_organisme',
  'caution',
] as const satisfies ReadonlyArray<GuaranteeForm>

/** `YYYY-MM-DD` → midnight UTC, per the schema's date convention. */
const dateInputToMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`)
const msToDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Amount typed in euros → cents. `null` = not quantified, a valid state. */
function parseEuros(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

/**
 * Dialog to create or edit a guarantee.
 *
 * The form mirrors the model's own shape: THREE independent questions (SPEC
 * D17) — the form of the security, the asset it bites on, and who commits.
 * A single field could not express « caution given by CALTE over its own
 * shares », which is exactly why they are three.
 *
 * Two states the form must let the user express, and that a naive form would
 * forbid:
 * - an **unquantified** guarantee (an unlimited surety): the amount is left
 *   empty, and the guarantee is then excluded from the pledged total (C3);
 * - an **unknown guarantor**: the source deeds often name a caution without
 *   saying who stands it (Q-B).
 *
 * `orgId` scopes the pickers to the org being looked at. The guarantee itself
 * may well point at another org's asset — that is the whole point of D13 —
 * but a picker listing every org's deals would be unreadable, so the asset is
 * chosen from the org that holds it.
 */
export function GuaranteeDialog({
  orgId,
  loanId,
  guarantee,
  onClose,
}: {
  orgId: Id<'organizations'>
  /** Prefills the beneficiary when opened from a loan sheet. */
  loanId?: Id<'loans'>
  guarantee?: LoanGuarantee
  onClose: () => void
}) {
  const { t } = useTranslation(['passif', 'common'])
  const reportError = useReportError('passif')
  const createGuarantee = useConvexMutation(api.guarantees.create)
  const updateGuarantee = useConvexMutation(api.guarantees.update)

  const loans = useConvexQuery(api.loans.listOptions, { orgId })
  const deals = useConvexQuery(api.deals.listOptions, { orgId })
  const me = useConvexQuery(api.users.me)
  const orgs = me?.kind === 'ready' ? me.orgs : undefined

  const [form, setForm] = useState<GuaranteeForm>(
    guarantee?.form ?? 'nantissement',
  )
  const [beneficiary, setBeneficiary] = useState<'loan' | 'external'>(
    guarantee ? (guarantee.loanId ? 'loan' : 'external') : 'loan',
  )
  const [selectedLoan, setSelectedLoan] = useState<string>(
    guarantee?.loanId ?? loanId ?? '',
  )
  const [borrowerLabel, setBorrowerLabel] = useState(
    guarantee && !guarantee.loanId ? (guarantee.borrowerName ?? '') : '',
  )
  const [subjectKind, setSubjectKind] = useState<SubjectKind>(
    guarantee?.subjectKind ?? 'placement',
  )
  const [subjectDeal, setSubjectDeal] = useState<string>(
    guarantee?.subject.dealId ?? '',
  )
  const [subjectCompany, setSubjectCompany] = useState<string>(
    guarantee?.subject.companyId ?? '',
  )
  const [subjectLabel, setSubjectLabel] = useState(
    guarantee?.subjectKind === 'external' ? (guarantee.subject.label ?? '') : '',
  )
  const [pledgorKind, setPledgorKind] = useState<'org' | 'external' | 'none'>(
    guarantee
      ? guarantee.pledgorOrgSlug
        ? 'org'
        : guarantee.pledgorName
          ? 'external'
          : 'none'
      : 'org',
  )
  const [pledgorOrg, setPledgorOrg] = useState<string>(orgId)
  const [pledgorLabel, setPledgorLabel] = useState(
    guarantee && !guarantee.pledgorOrgSlug ? (guarantee.pledgorName ?? '') : '',
  )
  const [rank, setRank] = useState(
    guarantee?.rank != null ? String(guarantee.rank) : '',
  )
  const [amount, setAmount] = useState(
    guarantee?.pledgedAmountCents != null
      ? String(guarantee.pledgedAmountCents / 100)
      : '',
  )
  const [actDate, setActDate] = useState(
    guarantee?.actDate != null ? msToDateInput(guarantee.actDate) : '',
  )
  const [notes, setNotes] = useState(guarantee?.notes ?? '')
  const [pending, setPending] = useState(false)

  const companies = useConvexQuery(
    api.companies.list,
    subjectKind === 'shares' ? { orgId } : 'skip',
  )

  const valid =
    (beneficiary === 'loan'
      ? selectedLoan !== ''
      : borrowerLabel.trim() !== '') &&
    (subjectKind === 'placement'
      ? subjectDeal !== ''
      : subjectKind === 'shares'
        ? subjectCompany !== ''
        : subjectLabel.trim() !== '') &&
    (pledgorKind !== 'external' || pledgorLabel.trim() !== '')

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      const parsedRank = Number.parseInt(rank, 10)
      const fields = {
        loanId:
          beneficiary === 'loan'
            ? (selectedLoan as Id<'loans'>)
            : undefined,
        borrowerLabel:
          beneficiary === 'external' ? borrowerLabel.trim() : undefined,
        pledgorOrgId:
          pledgorKind === 'org'
            ? (pledgorOrg as Id<'organizations'>)
            : undefined,
        pledgorLabel:
          pledgorKind === 'external' ? pledgorLabel.trim() : undefined,
        subjectKind,
        subjectDealId:
          subjectKind === 'placement'
            ? (subjectDeal as Id<'deals'>)
            : undefined,
        subjectCompanyId:
          subjectKind === 'shares'
            ? (subjectCompany as Id<'companies'>)
            : undefined,
        subjectLabel:
          subjectKind === 'external' ? subjectLabel.trim() : undefined,
        form,
        rank: Number.isFinite(parsedRank) ? parsedRank : undefined,
        // Empty = not quantified. That is a deliberate state, not a missing
        // value: an unlimited surety does not add up (C3).
        pledgedAmountCents: parseEuros(amount) ?? undefined,
        actDate: actDate !== '' ? dateInputToMs(actDate) : undefined,
        notes: notes.trim() || undefined,
      }
      if (guarantee) {
        await updateGuarantee({ guaranteeId: guarantee._id, ...fields })
        toast.success(t('passif:guarantees.dialog.editSuccess'))
      } else {
        await createGuarantee(fields)
        toast.success(t('passif:guarantees.dialog.createSuccess'))
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {guarantee
              ? t('passif:guarantees.dialog.editTitle')
              : t('passif:guarantees.dialog.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('passif:guarantees.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ── 1. The form of the security ───────────────────────────── */}
          <Field
            label={t('passif:guarantees.dialog.formLabel')}
            htmlFor="g-form"
          >
            <Select
              value={form}
              onValueChange={(value) => setForm(value as GuaranteeForm)}
            >
              <SelectTrigger id="g-form" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`passif:guarantees.form.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={t('passif:guarantees.dialog.rankLabel')}
            htmlFor="g-rank"
          >
            <Input
              id="g-rank"
              type="number"
              inputMode="numeric"
              min={1}
              value={rank}
              onChange={(event) => setRank(event.target.value)}
            />
          </Field>

          {/* ── 2. The beneficiary ────────────────────────────────────── */}
          <Field
            label={t('passif:guarantees.dialog.beneficiaryLabel')}
            htmlFor="g-beneficiary"
          >
            <Select
              value={beneficiary}
              onValueChange={(value) =>
                setBeneficiary(value as 'loan' | 'external')
              }
            >
              <SelectTrigger id="g-beneficiary" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="loan">
                  {t('passif:guarantees.dialog.beneficiaryLoan')}
                </SelectItem>
                <SelectItem value="external">
                  {t('passif:guarantees.dialog.beneficiaryExternal')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {beneficiary === 'loan' ? (
            <Field
              label={t('passif:guarantees.dialog.loanLabel')}
              htmlFor="g-loan"
            >
              <Select value={selectedLoan} onValueChange={setSelectedLoan}>
                <SelectTrigger id="g-loan" className="w-full">
                  <SelectValue
                    placeholder={t('passif:guarantees.dialog.choose')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(loans ?? []).map((option) => (
                    <SelectItem key={option._id} value={option._id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              label={t('passif:guarantees.dialog.borrowerLabelLabel')}
              htmlFor="g-borrower"
            >
              <Input
                id="g-borrower"
                value={borrowerLabel}
                onChange={(event) => setBorrowerLabel(event.target.value)}
                placeholder={t(
                  'passif:guarantees.dialog.borrowerLabelPlaceholder',
                )}
              />
            </Field>
          )}

          {/* ── 3. The subject ────────────────────────────────────────── */}
          <Field
            label={t('passif:guarantees.dialog.subjectKindLabel')}
            htmlFor="g-subject-kind"
          >
            <Select
              value={subjectKind}
              onValueChange={(value) => setSubjectKind(value as SubjectKind)}
            >
              <SelectTrigger id="g-subject-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="placement">
                  {t('passif:guarantees.dialog.subjectPlacement')}
                </SelectItem>
                <SelectItem value="shares">
                  {t('passif:guarantees.dialog.subjectShares')}
                </SelectItem>
                <SelectItem value="external">
                  {t('passif:guarantees.dialog.subjectExternal')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {subjectKind === 'placement' ? (
            <Field
              label={t('passif:guarantees.dialog.subjectDealLabel')}
              htmlFor="g-deal"
            >
              <Select value={subjectDeal} onValueChange={setSubjectDeal}>
                <SelectTrigger id="g-deal" className="w-full">
                  <SelectValue
                    placeholder={t('passif:guarantees.dialog.choose')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(deals ?? []).map((option) => (
                    <SelectItem key={option._id} value={option._id}>
                      {option.name ?? option.target?.name ?? option._id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : subjectKind === 'shares' ? (
            <Field
              label={t('passif:guarantees.dialog.subjectCompanyLabel')}
              htmlFor="g-company"
            >
              <Select value={subjectCompany} onValueChange={setSubjectCompany}>
                <SelectTrigger id="g-company" className="w-full">
                  <SelectValue
                    placeholder={t('passif:guarantees.dialog.choose')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(companies ?? []).map((company) => (
                    <SelectItem key={company._id} value={company._id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              label={t('passif:guarantees.dialog.subjectLabelLabel')}
              htmlFor="g-subject-label"
            >
              <Input
                id="g-subject-label"
                value={subjectLabel}
                onChange={(event) => setSubjectLabel(event.target.value)}
                placeholder={t(
                  'passif:guarantees.dialog.subjectLabelPlaceholder',
                )}
              />
            </Field>
          )}

          {/* ── 4. The guarantor ──────────────────────────────────────── */}
          <Field
            label={t('passif:guarantees.dialog.pledgorKindLabel')}
            htmlFor="g-pledgor-kind"
          >
            <Select
              value={pledgorKind}
              onValueChange={(value) =>
                setPledgorKind(value as 'org' | 'external' | 'none')
              }
            >
              <SelectTrigger id="g-pledgor-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org">
                  {t('passif:guarantees.dialog.pledgorOrg')}
                </SelectItem>
                <SelectItem value="external">
                  {t('passif:guarantees.dialog.pledgorExternal')}
                </SelectItem>
                <SelectItem value="none">
                  {t('passif:guarantees.dialog.pledgorNone')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {pledgorKind === 'org' ? (
            <Field
              label={t('passif:guarantees.dialog.pledgorOrgLabel')}
              htmlFor="g-pledgor-org"
            >
              <Select value={pledgorOrg} onValueChange={setPledgorOrg}>
                <SelectTrigger id="g-pledgor-org" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(orgs ?? []).map((org) => (
                    <SelectItem key={org._id} value={org._id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : pledgorKind === 'external' ? (
            <Field
              label={t('passif:guarantees.dialog.pledgorLabelLabel')}
              htmlFor="g-pledgor-label"
            >
              <Input
                id="g-pledgor-label"
                value={pledgorLabel}
                onChange={(event) => setPledgorLabel(event.target.value)}
                placeholder={t(
                  'passif:guarantees.dialog.pledgorLabelPlaceholder',
                )}
              />
            </Field>
          ) : (
            <div />
          )}

          {/* ── 5. The pledge itself ──────────────────────────────────── */}
          <Field
            label={t('passif:guarantees.dialog.amountLabel')}
            htmlFor="g-amount"
            hint={t('passif:guarantees.dialog.amountHint')}
          >
            <AmountInput id="g-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field
            label={t('passif:guarantees.dialog.actDateLabel')}
            htmlFor="g-act"
          >
            <Input
              id="g-act"
              type="date"
              value={actDate}
              onChange={(event) => setActDate(event.target.value)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={t('passif:guarantees.dialog.notesLabel')}
              htmlFor="g-notes"
            >
              <Input
                id="g-notes"
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
