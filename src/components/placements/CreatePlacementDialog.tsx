import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../convex/_generated/api'
import { TREASURY_PLACEMENT_KINDS } from '../../../convex/lib/instrumentMapping'
import type { Id } from '../../../convex/_generated/dataModel'
import type { InstrumentKind } from '../../../convex/lib/instruments'
import { eurosToCents } from '~/lib/parse'
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

/** Sentinel of the support Select: create a new company inline. */
const NEW_SUPPORT = 'new'

/**
 * « Nouveau placement » dialog (Placements page): create a treasury-placement
 * deal — crypto, capitalization account, term deposit, brokerage — without
 * going through an existing company sheet. The support (insurer, exchange,
 * broker…) is an existing company of the org OR a brand-new one created
 * inline (name only, kind 'portfolio') in the same gesture. Investor = a
 * group entity, same rule as every deal (assertInvestorIsGroupEntity).
 * Liquidity keeps its per-kind default (editable later on the placement
 * sheet).
 */
export function CreatePlacementDialog({
  orgId,
  orgSlug,
  onClose,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  onClose: () => void
}) {
  const { t } = useTranslation(['placements', 'participations', 'common'])
  const navigate = useNavigate()
  const createCompany = useConvexMutation(api.companies.create)
  const createDeal = useConvexMutation(api.deals.create)
  const companies = useConvexQuery(api.companies.list, { orgId })

  // Investor must be a group entity — same rule as the backend.
  const groupEntities = useMemo(
    () => (companies ?? []).filter((c) => c.kind.startsWith('group_')),
    [companies],
  )
  // Support candidates: the org's non-group companies, alphabetical.
  const supports = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.kind.startsWith('group_'))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  )

  const [investorId, setInvestorId] = useState('')
  const [supportId, setSupportId] = useState<string>(NEW_SUPPORT)
  const [supportName, setSupportName] = useState('')
  const [kind, setKind] = useState('')
  const [bankName, setBankName] = useState('')
  const [opened, setOpened] = useState('') // YYYY-MM-DD → closingDate (ms)
  const [balance, setBalance] = useState('') // euros → currentValue (cents)
  const [pending, setPending] = useState(false)

  // Preselect the investor when the org has a single group entity; never
  // guess a default when several exist.
  useEffect(() => {
    if (groupEntities.length === 1 && investorId === '') {
      setInvestorId(groupEntities[0]._id)
    }
  }, [groupEntities, investorId])

  const balanceInvalid = balance.trim() !== '' && eurosToCents(balance) == null
  const supportMissing =
    supportId === NEW_SUPPORT && supportName.trim() === ''
  const canSubmit =
    investorId !== '' && kind !== '' && !supportMissing && !balanceInvalid &&
    !pending

  async function handleCreate() {
    setPending(true)
    try {
      // Inline company creation first — a stray company without a deal is
      // harmless if the second call fails (the user just retries).
      const targetCompanyId =
        supportId === NEW_SUPPORT
          ? await createCompany({
              orgId,
              name: supportName.trim(),
              kind: 'portfolio',
            })
          : (supportId as Id<'companies'>)
      const dealId = await createDeal({
        orgId,
        investorCompanyId: investorId as Id<'companies'>,
        targetCompanyId,
        instrumentKind: kind as InstrumentKind,
        closingDate: opened === '' ? undefined : new Date(opened).getTime(),
        currentValue:
          balance.trim() === ''
            ? undefined
            : (eurosToCents(balance) ?? undefined),
        bankName: bankName.trim() === '' ? undefined : bankName.trim(),
      })
      toast.success(t('placements:create.created'))
      onClose()
      navigate({
        to: '/app/$orgSlug/placements/$dealId',
        params: { orgSlug, dealId },
      })
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['investor_must_be_group_entity', 'investor_wrong_org']
      toast.error(
        t(
          known.includes(code)
            ? `participations:createDeal.errors.${code}`
            : 'placements:create.errors.default',
        ),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('placements:create.title')}</DialogTitle>
          <DialogDescription>
            {t('placements:create.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('placements:create.investorLabel')}</Label>
            <Select value={investorId} onValueChange={setInvestorId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t('placements:create.investorPlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {groupEntities.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('placements:create.supportLabel')}</Label>
            <Select value={supportId} onValueChange={setSupportId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_SUPPORT}>
                  {t('placements:create.supportNew')}
                </SelectItem>
                {supports.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {supportId === NEW_SUPPORT && (
              <Input
                value={supportName}
                onChange={(e) => setSupportName(e.target.value)}
                placeholder={t('placements:create.supportNamePlaceholder')}
                aria-label={t('placements:create.supportNameAria')}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('placements:create.typeLabel')}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t('placements:create.typePlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {[...TREASURY_PLACEMENT_KINDS].map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`participations:instrument.${k}`, { defaultValue: k })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="placement-bank">
              {t('placements:create.bankLabel')}
            </Label>
            <Input
              id="placement-bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder={t('placements:create.bankPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="placement-opened">
              {t('placements:create.openedLabel')}
            </Label>
            <Input
              id="placement-opened"
              type="date"
              value={opened}
              onChange={(e) => setOpened(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="placement-balance">
              {t('placements:create.balanceLabel')}
            </Label>
            <AmountInput
              id="placement-balance"
              value={balance}
              onChange={setBalance}
              placeholder="100 000"
            />
            {balanceInvalid && (
              <p className="text-destructive text-xs">
                {t('placements:create.balanceInvalid')}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {t('placements:create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
