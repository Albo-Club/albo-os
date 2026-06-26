import { useMemo, useRef, useState } from 'react'
import {
  ArchiveRestore,
  ArrowUpRight,
  ChevronDown,
  Download,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { cn } from '~/lib/utils'
import { ParticipationsTable } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export const Route = createFileRoute('/app/$orgSlug/participations/')({
  component: Participations,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitle'),
      },
    ],
  }),
})

/** Entity creation dialog: name + SIREN (9 digits or empty).
 * kind is forced to 'portfolio' (not exposed). */
function CreateCompanyDialog({
  orgId,
  orgSlug,
  onClose,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const navigate = useNavigate()
  const createCompany = useConvexMutation(api.companies.create)
  const [name, setName] = useState('')
  const [siren, setSiren] = useState('')
  const [pending, setPending] = useState(false)

  // Client-side validation (mirror of the mutation): spaces ignored,
  // 9 digits or empty.
  const cleanedSiren = siren.replace(/\s/g, '')
  const sirenInvalid = cleanedSiren !== '' && !/^\d{9}$/.test(cleanedSiren)
  const nameMissing = name.trim() === ''

  async function handleCreate() {
    setPending(true)
    try {
      const newId = await createCompany({
        orgId,
        name: name.trim(),
        kind: 'portfolio',
        siren: cleanedSiren === '' ? undefined : siren,
      })
      toast.success(t('participations:create.created'))
      onClose()
      navigate({
        to: '/app/$orgSlug/participations/$companyId',
        params: { orgSlug, companyId: newId },
      })
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['invalid_siren', 'siren_already_used']
      toast.error(
        t(
          known.includes(code)
            ? `participations:create.errors.${code}`
            : 'participations:create.errors.default',
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
          <DialogTitle>{t('participations:create.title')}</DialogTitle>
          <DialogDescription>
            {t('participations:create.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-company-name">
              {t('participations:edit.nameLabel')}
            </Label>
            <Input
              id="new-company-name"
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
            <Label htmlFor="new-company-siren">
              {t('participations:edit.sirenLabel')}
            </Label>
            <Input
              id="new-company-siren"
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={pending || sirenInvalid || nameMissing}
          >
            {t('common:actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Collapsible list of the org's archived entities, with a Restore action. */
function ArchivedSection({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)
  const restoreCompany = useConvexMutation(api.companies.restore)
  const archived = useConvexQuery(api.companies.listArchived, { orgId })
  const [pendingId, setPendingId] = useState<Id<'companies'> | null>(null)

  // Nothing archived: render nothing (keeps the page clean).
  if (!archived || archived.length === 0) return null

  async function handleRestore(id: Id<'companies'>) {
    setPendingId(id)
    try {
      await restoreCompany({ id })
      toast.success(t('archive.restored'))
    } catch {
      toast.error(t('archive.errors.default'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
      >
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
        {t('archive.sectionTitle', { count: archived.length })}
      </button>
      {open && (
        <div className="rounded-lg border divide-y">
          {archived.map((company) => (
            <div
              key={company._id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <Link
                to="/app/$orgSlug/participations/$companyId"
                params={{ orgSlug, companyId: company._id }}
                className="truncate text-sm underline-offset-4 hover:underline"
              >
                {company.name}
              </Link>
              <Button
                variant="outline"
                size="sm"
                disabled={pendingId === company._id}
                onClick={() => void handleRestore(company._id)}
              >
                <ArchiveRestore className="size-4" />
                {t('archive.restore')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Collapsible list of the org's portfolio entities not referenced by any deal
 * (as target, investor or via-SPV). A discreet door to reach orphan entities
 * so they can be completed / archived / deleted from their detail sheet —
 * otherwise they'd be invisible (the table derives from deals). Mirrors
 * ArchivedSection. Orphans are matched by ID, never by name; group_* legal
 * entities are excluded by querying companies.list with kind 'portfolio'.
 */
function WithoutDealSection({
  orgId,
  orgSlug,
  deals,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  deals:
    | Array<{
        targetCompanyId: Id<'companies'>
        investorCompanyId: Id<'companies'>
        viaSpvCompanyId?: Id<'companies'>
      }>
    | undefined
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)
  const companies = useConvexQuery(api.companies.list, {
    orgId,
    kind: 'portfolio',
  })

  // Orphans = portfolio entities (non-archived, from companies.list) whose _id
  // is referenced by no deal. Matched strictly by ID. Both queries must have
  // resolved before we can tell an entity is truly orphan.
  const withoutDeal = useMemo(() => {
    if (!companies || !deals) return undefined
    const referenced = new Set<string>()
    for (const d of deals) {
      referenced.add(d.targetCompanyId)
      referenced.add(d.investorCompanyId)
      if (d.viaSpvCompanyId) referenced.add(d.viaSpvCompanyId)
    }
    return companies.filter((c) => !referenced.has(c._id))
  }, [companies, deals])

  // No orphan entity: render nothing (the normal case — keeps the page clean).
  if (!withoutDeal || withoutDeal.length === 0) return null

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
      >
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
        {t('withoutDeal.sectionTitle', { count: withoutDeal.length })}
      </button>
      {open && (
        <div className="rounded-lg border divide-y">
          {withoutDeal.map((company) => (
            <div
              key={company._id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <Link
                to="/app/$orgSlug/participations/$companyId"
                params={{ orgSlug, companyId: company._id }}
                className="truncate text-sm underline-offset-4 hover:underline"
              >
                {company.name}
              </Link>
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/app/$orgSlug/participations/$companyId"
                  params={{ orgSlug, companyId: company._id }}
                >
                  <ArrowUpRight className="size-4" />
                  {t('openDetail')}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Participations() {
  const { t } = useTranslation(['participations', 'common'])
  const { orgSlug } = Route.useParams()
  const [createOpen, setCreateOpen] = useState(false)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )
  // Filled by the table; lets the header menu trigger the (search-aware) export.
  const exportRef = useRef<(() => void) | null>(null)
  const hasDeals = Boolean(deals && deals.length > 0)

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {org && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('common:actions.menu')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t('create.button')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasDeals}
                onSelect={() => exportRef.current?.()}
              >
                <Download className="size-4" />
                {t('export.button')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ParticipationsTable deals={deals} orgSlug={orgSlug} exportRef={exportRef} />

      {org && (
        <WithoutDealSection orgId={org._id} orgSlug={orgSlug} deals={deals} />
      )}

      {org && <ArchivedSection orgId={org._id} orgSlug={orgSlug} />}

      {createOpen && org && (
        <CreateCompanyDialog
          orgId={org._id}
          orgSlug={orgSlug}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </main>
  )
}
