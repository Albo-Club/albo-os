import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
// Single source of truth for instrument kinds (cf. convex/lib/instruments.ts).
import { INSTRUMENTS } from '../../../../convex/lib/instruments'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { InstrumentKind } from '../../../../convex/lib/instruments'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { DealsList } from '~/components/participations/ParticipationsTable'
import { CompanyLogo } from '~/components/CompanyLogo'
import {
  AttioCompanyLink,
  EntityNatureBadge,
  IdentityField,
  IdentitySection,
  PeopleList,
} from '~/components/companies/EntityFiche'
import { KpisSection } from '~/components/companies/KpisSection'
import { ReportingsSection } from '~/components/companies/ReportingsSection'
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

export const Route = createFileRoute('/app/$orgSlug/participations/$companyId')({
  component: ParticipationDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitleDetail'),
      },
    ],
  }),
})

function BackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation('participations')
  return (
    <Link
      to="/app/$orgSlug/participations"
      params={{ orgSlug }}
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      {t('back')}
    </Link>
  )
}

function NotFound() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <BackLink orgSlug={orgSlug} />
      <p className="text-muted-foreground text-sm">{t('notFound')}</p>
    </main>
  )
}

/** Entity edit dialog: name + SIREN (9 digits or empty) + portfolio group. */
function EditCompanyDialog({
  company,
  orgId,
  onClose,
}: {
  company: {
    _id: Id<'companies'>
    name: string
    siren?: string | null
    group?: string | null
  }
  orgId: Id<'organizations'>
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateCompany = useConvexMutation(api.companies.update)
  const groups = useConvexQuery(api.participations.listGroups, { orgId })
  const [name, setName] = useState(company.name)
  const [siren, setSiren] = useState(company.siren ?? '')
  const [group, setGroup] = useState(company.group ?? '')
  const [groupKind, setGroupKind] = useState<'sponsor' | 'group' | ''>('')
  const [pending, setPending] = useState(false)

  // Client-side validation (mirror of the mutation): spaces ignored,
  // 9 digits or empty (= clears it).
  const cleanedSiren = siren.replace(/\s/g, '')
  const sirenInvalid = cleanedSiren !== '' && !/^\d{9}$/.test(cleanedSiren)
  const nameMissing = name.trim() === ''

  // A group is "new" when the typed name doesn't match any existing one.
  // Creating one forces a kind choice (sponsor | group); assigning to an
  // existing group never asks (its kind is already set).
  const trimmedGroup = group.trim()
  const isNewGroup =
    trimmedGroup !== '' && !groups?.some((g) => g.group === trimmedGroup)
  const kindMissing = isNewGroup && groupKind === ''

  async function handleSave() {
    setPending(true)
    try {
      await updateCompany({
        id: company._id,
        patch: {
          name: name.trim(),
          siren,
          group,
          ...(isNewGroup && groupKind ? { groupKind } : {}),
        },
      })
      toast.success(t('participations:edit.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['invalid_siren', 'siren_already_used']
      toast.error(
        t(
          known.includes(code)
            ? `participations:edit.errors.${code}`
            : 'participations:edit.errors.default',
        ),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('participations:edit.companyTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:edit.companyDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company-name">
              {t('participations:edit.nameLabel')}
            </Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {nameMissing && (
              <p className="text-destructive text-xs">
                {t('participations:edit.nameRequired')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-siren">
              {t('participations:edit.sirenLabel')}
            </Label>
            <Input
              id="company-siren"
              value={siren}
              onChange={(e) => setSiren(e.target.value)}
              placeholder={t('participations:edit.sirenPlaceholder')}
            />
            {sirenInvalid && (
              <p className="text-destructive text-xs">
                {t('participations:edit.sirenInvalid')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-group">
              {t('participations:edit.groupLabel')}
            </Label>
            <Input
              id="company-group"
              list="company-group-options"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('participations:edit.groupPlaceholder')}
            />
            <datalist id="company-group-options">
              {groups?.map((g) => (
                <option key={g.group} value={g.group}>
                  {g.displayName}
                </option>
              ))}
            </datalist>
            <p className="text-muted-foreground text-xs">
              {t('participations:edit.groupHint')}
            </p>
          </div>
          {isNewGroup && (
            <div className="space-y-2">
              <Label htmlFor="company-group-kind">
                {t('participations:edit.kindLabel')}
              </Label>
              <Select
                value={groupKind}
                onValueChange={(v) => setGroupKind(v as 'sponsor' | 'group')}
              >
                <SelectTrigger id="company-group-kind">
                  <SelectValue
                    placeholder={t('participations:edit.kindPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sponsor">
                    {t('participations:kind.sponsor')}
                  </SelectItem>
                  <SelectItem value="group">
                    {t('participations:kind.group')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {kindMissing && (
                <p className="text-destructive text-xs">
                  {t('participations:edit.kindRequired')}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || sirenInvalid || nameMissing || kindMissing}
          >
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Deal creation dialog, scoped to the current entity (the target).
 * Investor = a group entity (`group_*`) of the org. status ('active') and
 * currency ('EUR') keep their backend defaults — not exposed here.
 */
function CreateDealDialog({
  orgId,
  company,
  onClose,
}: {
  company: { _id: Id<'companies'>; name: string }
  orgId: Id<'organizations'>
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const createDeal = useConvexMutation(api.deals.create)
  const companies = useConvexQuery(api.companies.list, { orgId })
  // Investor must be a group entity — same rule as the backend
  // (assertInvestorIsGroupEntity).
  const groupEntities = useMemo(
    () => (companies ?? []).filter((c) => c.kind.startsWith('group_')),
    [companies],
  )

  const [investorId, setInvestorId] = useState('')
  const [instrument, setInstrument] = useState('')
  const [amount, setAmount] = useState('') // euros (UI), converted to cents
  const [signed, setSigned] = useState('') // YYYY-MM-DD, converted to ms epoch
  const [pending, setPending] = useState(false)

  // Preselect the investor when the org has a single group entity; never
  // guess a default when several exist.
  useEffect(() => {
    if (groupEntities.length === 1 && investorId === '') {
      setInvestorId(groupEntities[0]._id)
    }
  }, [groupEntities, investorId])

  const amountInvalid =
    amount.trim() !== '' && (Number.isNaN(Number(amount)) || Number(amount) < 0)
  const canSubmit =
    investorId !== '' && instrument !== '' && !amountInvalid && !pending

  async function handleCreate() {
    setPending(true)
    try {
      await createDeal({
        orgId,
        investorCompanyId: investorId as Id<'companies'>,
        targetCompanyId: company._id,
        instrumentKind: instrument as InstrumentKind,
        committedAmount:
          amount.trim() === '' ? undefined : Math.round(Number(amount) * 100),
        signedDate: signed === '' ? undefined : new Date(signed).getTime(),
      })
      toast.success(t('participations:createDeal.created'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = [
        'investor_must_be_group_entity',
        'investor_wrong_org',
        'target_wrong_org',
        'spv_wrong_org',
      ]
      toast.error(
        t(
          known.includes(code)
            ? `participations:createDeal.errors.${code}`
            : 'participations:createDeal.errors.default',
        ),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('participations:createDeal.title')}</DialogTitle>
          <DialogDescription>
            {t('participations:createDeal.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deal-target">
              {t('participations:createDeal.targetLabel')}
            </Label>
            <Input id="deal-target" value={company.name} disabled />
          </div>
          <div className="space-y-2">
            <Label>{t('participations:createDeal.investorLabel')}</Label>
            <Select value={investorId} onValueChange={setInvestorId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t(
                    'participations:createDeal.investorPlaceholder',
                  )}
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
            <Label>{t('participations:edit.instrumentLabel')}</Label>
            <Select value={instrument} onValueChange={setInstrument}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t(
                    'participations:createDeal.instrumentPlaceholder',
                  )}
                />
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
          <div className="space-y-2">
            <Label htmlFor="deal-amount">
              {t('participations:createDeal.committedLabel')}
            </Label>
            <Input
              id="deal-amount"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('participations:createDeal.committedPlaceholder')}
            />
            {amountInvalid && (
              <p className="text-destructive text-xs">
                {t('participations:createDeal.amountInvalid')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="deal-signed">
              {t('participations:createDeal.signedLabel')}
            </Label>
            <Input
              id="deal-signed"
              type="date"
              value={signed}
              onChange={(e) => setSigned(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {t('common:actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ParticipationDetail() {
  const { t, i18n } = useTranslation(['participations', 'common'])
  const { orgSlug, companyId } = Route.useParams()
  const [editOpen, setEditOpen] = useState(false)
  const [createDealOpen, setCreateDealOpen] = useState(false)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const company = useConvexQuery(api.companies.getById, {
    id: companyId as Id<'companies'>,
  })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id, targetCompanyId: companyId as Id<'companies'> } : 'skip',
  )

  const ownership = useMemo(() => {
    const total = company?.totalShares
    if (!deals || !total || total <= 0) return null
    const held = deals.reduce((s, d) => s + (d.sharesAcquired ?? 0), 0)
    if (held <= 0) return null
    return new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(held / total)
  }, [deals, company?.totalShares, i18n.language])

  return (
    <main className="flex-1 space-y-6 p-6">
      <BackLink orgSlug={orgSlug} />
      {/* Header: name + nature + ownership + (kept) edit actions. */}
      <div className="flex flex-wrap items-center gap-3">
        <CompanyLogo
          domain={company?.domain}
          companyName={company?.name}
          size="lg"
        />
        <h1 className="text-2xl font-semibold tracking-tight">
          {company ? company.name : t('loading')}
        </h1>
        {company && <EntityNatureBadge nature="company" />}
        {ownership && (
          <span className="text-muted-foreground text-sm">
            {t('info.ownership')} {ownership}
          </span>
        )}
        {company && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="size-4" />
            {t('common:actions.edit')}
          </Button>
        )}
        {company && org && (
          <Button size="sm" onClick={() => setCreateDealOpen(true)}>
            <Plus className="size-4" />
            {t('createDeal.button')}
          </Button>
        )}
      </div>

      {/* Identity block — nature "company". */}
      <IdentitySection title={t('identity.title')}>
        <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
          <IdentityField label={t('info.sector')} value={company?.sector} />
          <IdentityField label={t('info.siren')} value={company?.siren} />
          <IdentityField label={t('info.domain')} value={company?.domain} />
          <IdentityField label={t('info.ownership')} value={ownership} />
          <IdentityField
            label={t('identity.attio')}
            value={
              <AttioCompanyLink attioCompanyId={company?.attioCompanyId} />
            }
          />
        </div>
      </IdentitySection>

      {/* People — no schema stores these yet (empty "to be filled in"). */}
      <div className="grid gap-6 sm:grid-cols-3">
        <IdentitySection title={t('identity.founders')}>
          <PeopleList people={[]} />
        </IdentitySection>
        <IdentitySection title={t('identity.board')}>
          <PeopleList people={[]} />
        </IdentitySection>
        <IdentitySection title={t('identity.coInvestors')}>
          <PeopleList people={[]} />
        </IdentitySection>
      </div>

      <IdentitySection title={t('col.deals')}>
        {!deals ? (
          <div className="text-muted-foreground text-sm">{t('loading')}</div>
        ) : deals.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
            {t('empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <DealsList deals={deals} orgSlug={orgSlug} />
          </div>
        )}
      </IdentitySection>

      {/* Reporting/KPIs + Documents zones of the skeleton. */}
      {company && <KpisSection companyId={company._id} />}
      {company && <ReportingsSection companyId={company._id} />}

      {company && editOpen && org && (
        <EditCompanyDialog
          company={company}
          orgId={org._id}
          onClose={() => setEditOpen(false)}
        />
      )}

      {company && createDealOpen && org && (
        <CreateDealDialog
          company={company}
          orgId={org._id}
          onClose={() => setCreateDealOpen(false)}
        />
      )}
    </main>
  )
}
