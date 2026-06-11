import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { DealsList } from '~/components/participations/ParticipationsTable'
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

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value ?? '—'}</span>
    </div>
  )
}

/** Entity edit dialog: name + SIREN (9 digits or empty). */
function EditCompanyDialog({
  company,
  onClose,
}: {
  company: { _id: Id<'companies'>; name: string; siren?: string | null }
  onClose: () => void
}) {
  const { t } = useTranslation(['participations', 'common'])
  const updateCompany = useConvexMutation(api.companies.update)
  const [name, setName] = useState(company.name)
  const [siren, setSiren] = useState(company.siren ?? '')
  const [pending, setPending] = useState(false)

  // Client-side validation (mirror of the mutation): spaces ignored,
  // 9 digits or empty (= clears it).
  const cleanedSiren = siren.replace(/\s/g, '')
  const sirenInvalid = cleanedSiren !== '' && !/^\d{9}$/.test(cleanedSiren)
  const nameMissing = name.trim() === ''

  async function handleSave() {
    setPending(true)
    try {
      await updateCompany({
        id: company._id,
        patch: { name: name.trim(), siren },
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || sirenInvalid || nameMissing}
          >
            {t('common:actions.save')}
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
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {company ? company.name : t('loading')}
        </h1>
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
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <Info label={t('info.sector')} value={company?.sector} />
        <Info label={t('info.siren')} value={company?.siren} />
        <Info label={t('info.domain')} value={company?.domain} />
        <Info label={t('info.ownership')} value={ownership} />
      </div>

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

      {company && <KpisSection companyId={company._id} />}
      {company && <ReportingsSection companyId={company._id} />}

      {company && editOpen && (
        <EditCompanyDialog
          company={company}
          onClose={() => setEditOpen(false)}
        />
      )}
    </main>
  )
}
