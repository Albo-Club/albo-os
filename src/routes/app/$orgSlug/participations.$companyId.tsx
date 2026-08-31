import { useEffect, useMemo, useState } from 'react'
import {
  AlignLeft,
  Archive,
  IdCard,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
// Single source of truth for instrument kinds (cf. convex/lib/instruments.ts).
import { INSTRUMENTS } from '../../../../convex/lib/instruments'
// Instrument → editable fields mapping, shared with the deal edit dialog.
import { INSTRUMENT_FIELDS } from '../../../../convex/lib/instrumentMapping'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { InstrumentKind } from '../../../../convex/lib/instruments'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { formatSiren } from '~/lib/siren'
import { CompanyLogo } from '~/components/CompanyLogo'
import { CompanyDealsTable } from '~/components/companies/CompanyDealsTable'
import { SectorCombobox } from '~/components/companies/SectorCombobox'
import {
  IdentityField,
  IdentitySection,
} from '~/components/companies/EntityFiche'
import { AttioCompanyField } from '~/components/companies/AttioCompanyField'
import { PeopleEditor } from '~/components/companies/PeopleEditor'
import { CompanyDocumentsCard } from '~/components/companies/CompanyDocumentsCard'
import { CompanyReportsSection } from '~/components/companies/CompanyReportsSection'
import { CompanyAiSynthesisBlock } from '~/components/companies/CompanyAiSynthesisBlock'
import { EntityIntegrationsDialog } from '~/components/companies/EntityIntegrationsDialog'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { InlineField } from '~/components/ui/inline-field'
import { Input } from '~/components/ui/input'
import { AmountInput } from '~/components/ui/amount-input'
import { eurosToCents, parseField } from '~/lib/parse'
import { DealFieldInput } from '~/components/deals/DealFieldInput'
import { FIELD_FORMAT } from '~/components/deals/InstrumentBlock'
import { Label } from '~/components/ui/label'
import { LoadingLine } from '~/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useStickyBottom } from '~/hooks/useStickyBottom'

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

/**
 * Entity rename dialog. Everything else on the fiche — sector, SIREN, domain,
 * summary, people — is edited in place in the identity panel; only the name,
 * which lives in the sticky header, still goes through a dialog.
 */
function RenameCompanyDialog({
  company,
  onClose,
}: {
  company: { _id: Id<'companies'>; name: string }
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateCompany = useConvexMutation(api.companies.update)
  const [name, setName] = useState(company.name)
  const [pending, setPending] = useState(false)
  const nameMissing = name.trim() === ''

  async function handleSave() {
    setPending(true)
    try {
      await updateCompany({ id: company._id, patch: { name: name.trim() } })
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('participations:edit.companyTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:edit.companyDescription')}
          </DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={pending || nameMissing}
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
  // Instrument-specific fields collected at creation (parity with the edit
  // dialog), minus the ones already captured by the dedicated controls below
  // (committedAmount = "Montant engagé", signedDate). Same source of truth as
  // the edit dialog: INSTRUMENT_FIELDS. Values are strings in the display unit,
  // parsed to the storage unit on submit.
  const [values, setValues] = useState<Record<string, string>>({})
  const extraFields = useMemo(
    () =>
      (instrument
        ? (INSTRUMENT_FIELDS[instrument as InstrumentKind] ?? [])
        : []
      ).filter((f) => f !== 'committedAmount' && f !== 'signedDate'),
    [instrument],
  )

  // Preselect the investor when the org has a single group entity; never
  // guess a default when several exist.
  useEffect(() => {
    if (groupEntities.length === 1 && investorId === '') {
      setInvestorId(groupEntities[0]._id)
    }
  }, [groupEntities, investorId])

  const amountInvalid = amount.trim() !== '' && eurosToCents(amount) == null
  // A non-empty extra field that fails to parse (letters in a € field, …)
  // blocks the submit — no partial write.
  const extrasValid = extraFields.every(
    (f) => parseField(FIELD_FORMAT[f] ?? 'text', values[f] ?? '') !== null,
  )
  const canSubmit =
    investorId !== '' &&
    instrument !== '' &&
    !amountInvalid &&
    extrasValid &&
    !pending

  async function handleCreate() {
    setPending(true)
    try {
      // Parse the instrument-specific fields to their storage unit; skip empty
      // (undefined) and invalid (null — already blocked by canSubmit) values.
      const extras: Record<string, unknown> = {}
      for (const f of extraFields) {
        const parsed = parseField(FIELD_FORMAT[f] ?? 'text', values[f] ?? '')
        if (parsed === undefined || parsed === null) continue
        extras[f] = parsed
      }
      await createDeal({
        orgId,
        investorCompanyId: investorId as Id<'companies'>,
        targetCompanyId: company._id,
        instrumentKind: instrument as InstrumentKind,
        committedAmount:
          amount.trim() === '' ? undefined : (eurosToCents(amount) ?? undefined),
        signedDate: signed === '' ? undefined : new Date(signed).getTime(),
        ...extras,
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
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
            <Select
              value={instrument}
              onValueChange={(v) => {
                setInstrument(v)
                // Field set changes with the instrument → drop stale values.
                setValues({})
              }}
            >
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
            <AmountInput
              id="deal-amount"
              value={amount}
              onChange={setAmount}
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
          {extraFields.length > 0 && (
            <div className="space-y-4 border-t pt-4">
              {extraFields.map((field) => (
                <DealFieldInput
                  key={field}
                  field={field}
                  format={FIELD_FORMAT[field] ?? 'text'}
                  value={values[field] ?? ''}
                  onChange={(v) => setValues((s) => ({ ...s, [field]: v }))}
                />
              ))}
            </div>
          )}
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
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [createDealOpen, setCreateDealOpen] = useState(false)
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Identity panel: scrolls with the page, then freezes once its bottom shows.
  const { ref: asideRef, top: asideTop } = useStickyBottom()
  const archiveCompany = useConvexMutation(api.companies.archive)
  const removeCompany = useConvexMutation(api.companies.remove)
  const updateCompany = useConvexMutation(api.companies.update)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const company = useConvexQuery(api.companies.getById, {
    id: companyId as Id<'companies'>,
  })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id, targetCompanyId: companyId as Id<'companies'> } : 'skip',
  )

  // Deals targeting this entity block archiving (the obvious Sezame case).
  // Other references (investor/SPV, relations, KPI, accounts, documents) are
  // caught server-side and surfaced via the error toast below.
  const dealCount = deals?.length ?? 0

  // Legal entities (group_*) can never be hard-deleted (server refuses too).
  const isGroup = company?.kind.startsWith('group_') ?? false

  async function handleArchive() {
    if (!company) return
    setArchiving(true)
    try {
      await archiveCompany({ id: company._id })
      toast.success(t('participations:archive.archived'))
      setArchiveOpen(false)
      navigate({ to: '/app/$orgSlug/participations', params: { orgSlug } })
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        t(
          code === 'company_has_references'
            ? 'participations:archive.errors.company_has_references'
            : 'participations:archive.errors.default',
        ),
      )
    } finally {
      setArchiving(false)
    }
  }

  async function handleDelete() {
    if (!company) return
    setDeleting(true)
    try {
      await removeCompany({ id: company._id })
      toast.success(t('participations:deleteCompany.deleted'))
      setDeleteOpen(false)
      navigate({ to: '/app/$orgSlug/participations', params: { orgSlug } })
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        t(
          code === 'company_has_references' ||
            code === 'cannot_delete_group_entity'
            ? `participations:deleteCompany.errors.${code}`
            : 'participations:deleteCompany.errors.default',
        ),
      )
    } finally {
      setDeleting(false)
    }
  }

  // Inline save of one Identity field (sector / SIREN / domain), reusing the
  // shared companies.update mutation. SIREN uniqueness/format is enforced
  // server-side; surface the specific reason on reject.
  async function saveCompany(patch: {
    sector?: string
    siren?: string
    domain?: string
    summary?: string
  }) {
    if (!company) return
    try {
      await updateCompany({ id: company._id, patch })
      toast.success(t('participations:edit.saved'))
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
    }
  }

  // Shares held across all deals on this company (consolidated), and the
  // resulting global ownership % when the company's total share count is known.
  const heldShares = useMemo(
    () => deals?.reduce((s, d) => s + (d.sharesAcquired ?? 0), 0) ?? 0,
    [deals],
  )

  const sharesConsolidated = useMemo(
    () =>
      heldShares > 0
        ? new Intl.NumberFormat(i18n.language).format(heldShares)
        : null,
    [heldShares, i18n.language],
  )

  const ownership = useMemo(() => {
    const total = company?.totalShares
    if (!total || total <= 0 || heldShares <= 0) return null
    return new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(heldShares / total)
  }, [heldShares, company?.totalShares, i18n.language])

  return (
    <main className="flex-1 space-y-6 p-6">
      <BackLink orgSlug={orgSlug} />
      {/* Header: name + nature + ownership + (kept) edit actions. Sticky so the
          title stays pinned while scrolling; full-bleed bg + border mask the
          content passing underneath (scroll container is the layout's Outlet). */}
      <div className="bg-background sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <CompanyLogo
          domain={company?.domain}
          companyName={company?.name}
          size="lg"
        />
        <h1 className="text-2xl font-semibold tracking-tight">
          {company ? company.name : <LoadingLine>{t('loading')}</LoadingLine>}
        </h1>
        {ownership && (
          <span className="text-muted-foreground text-sm">
            {t('info.ownership')} {ownership}
          </span>
        )}
        {company && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="ml-auto"
                aria-label={t('common:actions.menu')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="size-4" />
                {t('common:actions.rename')}
              </DropdownMenuItem>
              {org && (
                <DropdownMenuItem onSelect={() => setCreateDealOpen(true)}>
                  <Plus className="size-4" />
                  {t('createDeal.button')}
                </DropdownMenuItem>
              )}
              {/* Link to an external platform object (e.g. a VASCO issuer) —
                  works on any portfolio entity, whatever its name. */}
              {company.kind === 'portfolio' && (
                <DropdownMenuItem onSelect={() => setIntegrationsOpen(true)}>
                  <Link2 className="size-4" />
                  {t('integrations.menuItem')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setArchiveOpen(true)}
              >
                <Archive className="size-4" />
                {t('archive.button')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                {t('common:actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Two-column layout under the header: the main column (health synthesis
          → deals → reporting tabs) plus the identity side panel on the right.
          Below lg the panel stacks AFTER the main content. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          {/* Company health synthesis first — the "santé de la boîte" is the
              first thing to see on the page. */}
          {company && <CompanyAiSynthesisBlock companyId={company._id} />}

          <IdentitySection title={t('col.deals')}>
            {!deals ? (
              <LoadingLine>{t('loading')}</LoadingLine>
            ) : deals.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
                {t('empty')}
              </div>
            ) : (
              <CompanyDealsTable deals={deals} orgSlug={orgSlug} />
            )}
          </IdentitySection>

          {/* What the company sends us — analysed reports and VASCO
              communications — in one chronological feed. The documents it
              produced live in the identity panel, not here. */}
          {company && (
            <CompanyReportsSection company={company} deals={deals ?? []} />
          )}
        </div>

        {/* Side panel: the identity card ("fiche d'identité") — identity
            fields, summary and people, stacked in one calm card, each section
            introduced by a small squared icon chip; the data itself carries no
            box — label left, value right, hairline between rows — then the
            documents card under it. Two cards rather than one section more:
            the vault carries its own count and its own add button, and it can
            grow without breaking the rhythm of the identity rows.

            From lg up the panel is sticky: it scrolls with the page until its
            bottom edge is reached, then freezes while the main column keeps
            scrolling (see useStickyBottom for why the offset is computed). */}
        <aside
          ref={asideRef}
          style={{ top: asideTop }}
          className="w-full shrink-0 space-y-4 lg:sticky lg:w-80"
        >
          <div className="bg-card space-y-5 rounded-xl border p-4">
            {/* Identity — sector / SIREN / domain edit inline (click the value);
              ownership, share count and the Attio link are computed/derived
              and stay read-only. */}
            <IdentitySection
              title={t('identity.title')}
              icon={<IdCard className="size-3.5" />}
            >
              <div className="flex flex-col">
                <InlineField
                  layout="row"
                  label={t('info.sector')}
                  format="text"
                  rawValue={company?.sector}
                  display={
                    company?.sector
                      ? t(`sectors.${company.sector}`, {
                          defaultValue: company.sector,
                        })
                      : ''
                  }
                  ariaLabel={t('edit.inlineLabel', { field: t('info.sector') })}
                  disabled={!company}
                  renderEditor={({ done }) =>
                    company ? (
                      <SectorCombobox
                        value={company.sector ?? ''}
                        defaultOpen
                        onOpenChange={(o) => !o && done()}
                        onChange={(v) => void saveCompany({ sector: v })}
                        extraSectors={company.sector ? [company.sector] : []}
                      />
                    ) : null
                  }
                />
                <InlineField
                  layout="row"
                  label={t('info.siren')}
                  format="text"
                  rawValue={company?.siren}
                  display={formatSiren(company?.siren)}
                  ariaLabel={t('edit.inlineLabel', { field: t('info.siren') })}
                  disabled={!company}
                  onCommit={(v) => saveCompany({ siren: String(v) })}
                  onClear={() => saveCompany({ siren: '' })}
                />
                <InlineField
                  layout="row"
                  label={t('info.domain')}
                  format="text"
                  rawValue={company?.domain}
                  display={company?.domain ?? ''}
                  ariaLabel={t('edit.inlineLabel', { field: t('info.domain') })}
                  disabled={!company}
                  onCommit={(v) => saveCompany({ domain: String(v) })}
                  onClear={() => saveCompany({ domain: '' })}
                />
                <IdentityField
                  label={t('info.ownershipGlobal')}
                  value={ownership}
                />
                <IdentityField
                  label={t('info.sharesConsolidated')}
                  value={sharesConsolidated}
                />
                {company && org && (
                  <AttioCompanyField company={company} orgId={org._id} />
                )}
              </div>
            </IdentitySection>

            {/* Optional 2-3 line summary, promoted to its own section, edited
              in place like the identity rows above. Left aligned on purpose:
              justifying a paragraph in a 320px column digs white rivers
              between the words. */}
            <IdentitySection
              title={t('identity.summary')}
              icon={<AlignLeft className="size-3.5" />}
            >
              <InlineField
                layout="block"
                format="multiline"
                label={t('identity.summary')}
                rawValue={company?.summary}
                display={company?.summary ?? ''}
                placeholder={t('identity.summaryPlaceholder')}
                ariaLabel={t('edit.inlineLabel', {
                  field: t('identity.summary'),
                })}
                disabled={!company}
                onCommit={(v) => saveCompany({ summary: String(v) })}
                onClear={() => saveCompany({ summary: '' })}
              />
            </IdentitySection>

            {/* People — founders / board / co-investors, added / renamed /
                removed in place (Attio search as an aid). */}
            {company && org && (
              <PeopleEditor company={company} orgId={org._id} />
            )}
          </div>

          {/* The vault: everything filed on this entity, deal documents
              included. Five most recent here, the whole library in its
              sheet. */}
          {company && (
            <CompanyDocumentsCard
              company={company}
              orgSlug={orgSlug}
              deals={deals ?? []}
            />
          )}
        </aside>
      </div>

      {company && renameOpen && (
        <RenameCompanyDialog
          company={company}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {company && createDealOpen && org && (
        <CreateDealDialog
          company={company}
          orgId={org._id}
          onClose={() => setCreateDealOpen(false)}
        />
      )}

      {company && integrationsOpen && (
        <EntityIntegrationsDialog
          company={company}
          orgSlug={orgSlug}
          onClose={() => setIntegrationsOpen(false)}
        />
      )}

      <Dialog
        open={archiveOpen}
        onOpenChange={(open) => !open && setArchiveOpen(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('archive.confirmTitle')}</DialogTitle>
          </DialogHeader>
          {/* Deals targeting this entity block archiving: surface the reason
              here, behind the archive action, rather than inline on the page. */}
          <p className="text-muted-foreground text-sm">
            {dealCount > 0
              ? t('archive.blocked', { count: dealCount })
              : t('archive.confirmBody')}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={archiving}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleArchive()}
              disabled={archiving || dealCount > 0}
            >
              {t('archive.button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !open && setDeleteOpen(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteCompany.confirmTitle')}</DialogTitle>
          </DialogHeader>
          {/* Legal entities and still-referenced entities can't be deleted:
              surface the reason here, behind the delete action. The server
              enforces both guards too. */}
          <p className="text-muted-foreground text-sm">
            {isGroup
              ? t('deleteCompany.blockedGroup')
              : dealCount > 0
                ? t('deleteCompany.blocked', { count: dealCount })
                : t('deleteCompany.confirmBody')}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting || isGroup || dealCount > 0}
            >
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
