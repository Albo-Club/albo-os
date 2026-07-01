import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
// Single source of truth for instrument kinds (cf. convex/lib/instruments.ts).
import { INSTRUMENTS } from '../../../../convex/lib/instruments'
// Single source of truth for people roles (cf. convex/lib/people.ts).
import { PERSON_ROLES } from '../../../../convex/lib/people'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { InstrumentKind } from '../../../../convex/lib/instruments'
import type { PersonRole } from '../../../../convex/lib/people'
import { attioPersonUrl } from '~/lib/attio'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { DealsList } from '~/components/participations/ParticipationsTable'
import { CompanyLogo } from '~/components/CompanyLogo'
import { SectorCombobox } from '~/components/companies/SectorCombobox'
import {
  AttioCompanyLink,
  EntityNatureBadge,
  IdentityField,
  IdentitySection,
  PeopleList,
} from '~/components/companies/EntityFiche'
import { ReportingsSection } from '~/components/companies/ReportingsSection'
import { CompanyReportsSection } from '~/components/companies/CompanyReportsSection'
import { CompanyIntelligenceCard } from '~/components/companies/CompanyIntelligenceCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
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
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '~/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

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

// A person row in the edit dialog. attioRecordId is set by picking an Attio
// search suggestion (Lot 5c) and cleared when the name is edited by hand.
type PersonDraft = { role: PersonRole; name: string; attioRecordId?: string }

/** Entity edit dialog: name + SIREN (9 digits or empty) +
 * people (founders / board / co-investors, full-list replacement at save). */
function EditCompanyDialog({
  company,
  orgId,
  onClose,
}: {
  company: {
    _id: Id<'companies'>
    name: string
    siren?: string | null
    domain?: string | null
    sector?: string | null
    people?: Array<PersonDraft>
  }
  orgId: Id<'organizations'>
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateCompany = useConvexMutation(api.companies.update)
  // Sectors already used by other entities in the org, so a free-typed sector
  // reappears in the picker afterwards (cf. SectorCombobox `extraSectors`).
  const orgCompanies = useConvexQuery(api.companies.list, { orgId })
  const existingSectors = useMemo(
    () =>
      (orgCompanies ?? [])
        .map((c) => c.sector)
        .filter((s): s is string => !!s),
    [orgCompanies],
  )
  const [name, setName] = useState(company.name)
  const [siren, setSiren] = useState(company.siren ?? '')
  const [domain, setDomain] = useState(company.domain ?? '')
  const [sector, setSector] = useState(company.sector ?? '')
  const [people, setPeople] = useState<Array<PersonDraft>>(company.people ?? [])
  const [pending, setPending] = useState(false)

  // Client-side validation (mirror of the mutation): spaces ignored,
  // 9 digits or empty (= clears it).
  const cleanedSiren = siren.replace(/\s/g, '')
  const sirenInvalid = cleanedSiren !== '' && !/^\d{9}$/.test(cleanedSiren)
  const nameMissing = name.trim() === ''
  // Mirror of the backend reject (invalid_person_name): any empty name blocks.
  const someNameEmpty = people.some((p) => p.name.trim() === '')

  // updatePerson spreads the existing row, so attioRecordId survives an edit.
  const addPerson = () =>
    setPeople((prev) => [...prev, { role: 'founder', name: '' }])
  const removePerson = (index: number) =>
    setPeople((prev) => prev.filter((_, i) => i !== index))
  const updatePerson = (index: number, patch: Partial<PersonDraft>) =>
    setPeople((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    )

  async function handleSave() {
    setPending(true)
    try {
      await updateCompany({
        id: company._id,
        patch: {
          name: name.trim(),
          siren,
          // Trimmed; '' clears it (normalized backend-side, mirror of SIREN).
          domain: domain.trim(),
          // Slug for a predefined sector, free text otherwise; '' clears it.
          sector,
          // Full-list replacement. Trim names; keep attioRecordId when present.
          people: people.map((p) => ({
            role: p.role,
            name: p.name.trim(),
            ...(p.attioRecordId ? { attioRecordId: p.attioRecordId } : {}),
          })),
        },
      })
      toast.success(t('participations:edit.saved'))
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = [
        'invalid_siren',
        'siren_already_used',
        'invalid_person_name',
      ]
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
          {/* Domain — feeds the company logo (logo.dev hotlink). Bare host,
              e.g. "exemple.com"; empty clears it back to the fallback icon. */}
          <div className="space-y-2">
            <Label htmlFor="company-domain">
              {t('participations:edit.domainLabel')}
            </Label>
            <Input
              id="company-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('participations:edit.domainPlaceholder')}
            />
          </div>
          {/* Sector — predefined list + free entry (creatable combobox).
              Stored as a slug for predefined sectors, verbatim otherwise. */}
          <div className="space-y-2">
            <Label>{t('participations:edit.sectorLabel')}</Label>
            <SectorCombobox
              value={sector}
              onChange={setSector}
              extraSectors={existingSectors}
            />
          </div>
          {/* People — founders / board / co-investors. Each row searches Attio
              by name (Lot 5c): picking a suggestion fills name + attioRecordId
              (the link is built at display time), while typing a free name
              keeps the person unlinked (Lot 5b). */}
          <div className="space-y-2">
            <Label>{t('participations:edit.peopleLabel')}</Label>
            <div className="space-y-2">
              {people.map((p, i) => (
                <PersonRow
                  key={i}
                  person={p}
                  orgId={orgId}
                  onChange={(patch) => updatePerson(i, patch)}
                  onRemove={() => removePerson(i)}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPerson}
            >
              <Plus className="size-4" />
              {t('participations:edit.peopleAdd')}
            </Button>
            {someNameEmpty && (
              <p className="text-destructive text-xs">
                {t('participations:edit.peopleNameRequired')}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              pending ||
              sirenInvalid ||
              nameMissing ||
              someNameEmpty
            }
          >
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One person row: role select + name input with Attio search (Lot 5c) + remove.
 * Typing debounces a backend search on Attio's people object; picking a result
 * fills name + attioRecordId. Editing the name by hand unlinks (Lot 5b path).
 * The search is an aid — the manual entry keeps working if Attio is down or the
 * key is missing (the action degrades to an empty list + a neutral error).
 */
function PersonRow({
  person,
  orgId,
  onChange,
  onRemove,
}: {
  person: PersonDraft
  orgId: Id<'organizations'>
  onChange: (patch: Partial<PersonDraft>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('participations')
  const searchPeople = useAction(api.attio.searchPeople)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [results, setResults] = useState<
    Array<{ name: string; attioRecordId: string }>
  >([])
  // The name the user actively picked / a pre-linked name — never re-searched
  // (avoids reopening the dropdown right after a selection or on mount).
  const skipNameRef = useRef<string | null>(
    person.attioRecordId ? person.name : null,
  )
  // Only search once the user has typed in THIS field, so opening the dialog
  // never fires a search for every existing person.
  const touchedRef = useRef(false)
  const debounced = useDebouncedValue(person.name, 300)

  useEffect(() => {
    const q = debounced.trim()
    if (!touchedRef.current || q.length < 2 || q === skipNameRef.current) {
      setResults([])
      setError(false)
      setLoading(false)
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    setOpen(true)
    searchPeople({ orgId, query: q })
      .then((res) => {
        if (cancelled) return
        setResults(res.results)
        setError(res.error != null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setResults([])
        setError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, orgId, searchPeople])

  function handleNameChange(value: string) {
    // Editing the name by hand breaks the Attio link.
    touchedRef.current = true
    skipNameRef.current = null
    onChange({ name: value, attioRecordId: undefined })
  }

  function handleSelect(s: { name: string; attioRecordId: string }) {
    skipNameRef.current = s.name
    onChange({ name: s.name, attioRecordId: s.attioRecordId })
    setOpen(false)
    setResults([])
  }

  const linked = Boolean(person.attioRecordId)

  return (
    <div className="flex items-start gap-2">
      <Select
        value={person.role}
        onValueChange={(v) => onChange({ role: v as PersonRole })}
      >
        <SelectTrigger className="w-40 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERSON_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {t(`participations:personRole.${role}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex-1 space-y-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <Input
              value={person.name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => {
                if (results.length > 0 || loading || error) setOpen(true)
              }}
              placeholder={t('participations:edit.peopleNamePlaceholder')}
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {loading ? (
              <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t('participations:edit.personSearching')}
              </div>
            ) : error ? (
              <div className="text-muted-foreground px-2 py-1.5 text-sm">
                {t('participations:edit.personSearchError')}
              </div>
            ) : results.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-sm">
                {t('participations:edit.personSearchNoResults')}
              </div>
            ) : (
              <ul>
                {results.map((s) => (
                  <li key={s.attioRecordId}>
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                    >
                      <span className="truncate">{s.name}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {t('participations:edit.attioBadge')}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
        {linked && (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Link2 className="size-3" />
            {t('participations:edit.personLinkedToAttio')}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={onRemove}
        aria-label={t('participations:edit.peopleRemove')}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
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
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [createDealOpen, setCreateDealOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const archiveCompany = useConvexMutation(api.companies.archive)
  const removeCompany = useConvexMutation(api.companies.remove)
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

  // Group people by role for the three sections. The name links to the Attio
  // person record when attioRecordId is set (and the workspace base is
  // configured); plain text otherwise.
  const peopleByRole = useMemo(() => {
    const people = company?.people ?? []
    const group = (role: PersonRole) =>
      people
        .filter((p) => p.role === role)
        .map((p) => ({
          name: p.name,
          attioUrl: p.attioRecordId ? attioPersonUrl(p.attioRecordId) : undefined,
        }))
    return {
      founder: group('founder'),
      board: group('board'),
      coinvestor: group('coinvestor'),
    }
  }, [company?.people])

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
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                {t('common:actions.edit')}
              </DropdownMenuItem>
              {org && (
                <DropdownMenuItem onSelect={() => setCreateDealOpen(true)}>
                  <Plus className="size-4" />
                  {t('createDeal.button')}
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

      {/* Identity block — nature "company". */}
      <IdentitySection title={t('identity.title')}>
        <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
          <IdentityField
            label={t('info.sector')}
            value={
              company?.sector
                ? t(`sectors.${company.sector}`, {
                    defaultValue: company.sector,
                  })
                : undefined
            }
          />
          <IdentityField label={t('info.siren')} value={company?.siren} />
          <IdentityField label={t('info.domain')} value={company?.domain} />
          <IdentityField
            label={t('info.ownershipGlobal')}
            value={ownership}
          />
          <IdentityField
            label={t('info.sharesConsolidated')}
            value={sharesConsolidated}
          />
          <IdentityField
            label={t('identity.attio')}
            value={
              <AttioCompanyLink attioCompanyId={company?.attioCompanyId} />
            }
          />
        </div>
      </IdentitySection>

      {/* People — founders / board / co-investors, fed from company.people.
          Empty sections render the discreet "to be filled in" state. */}
      <div className="grid gap-6 sm:grid-cols-3">
        <IdentitySection title={t('identity.founders')}>
          <PeopleList people={peopleByRole.founder} />
        </IdentitySection>
        <IdentitySection title={t('identity.board')}>
          <PeopleList people={peopleByRole.board} />
        </IdentitySection>
        <IdentitySection title={t('identity.coInvestors')}>
          <PeopleList people={peopleByRole.coinvestor} />
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

      {/* Reporting zone: manual documents, email-ingested reports, AI synthesis. */}
      {company && (
        <section>
          <Tabs defaultValue="documents">
            <TabsList variant="line">
              <TabsTrigger value="documents">
                {t('tabs.documents')}
              </TabsTrigger>
              <TabsTrigger value="reports">{t('tabs.reports')}</TabsTrigger>
              <TabsTrigger value="intelligence">
                {t('tabs.intelligence')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="documents" className="pt-4">
              <ReportingsSection companyId={company._id} />
            </TabsContent>
            <TabsContent value="reports" className="space-y-3 pt-4">
              <h2 className="text-lg font-semibold tracking-tight">
                {t('reports.title')}
              </h2>
              <CompanyReportsSection companyId={company._id} />
            </TabsContent>
            <TabsContent value="intelligence" className="pt-4">
              <CompanyIntelligenceCard companyId={company._id} />
            </TabsContent>
          </Tabs>
        </section>
      )}

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
