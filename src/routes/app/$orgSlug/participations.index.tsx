import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { ParticipationsTable } from '~/components/participations/ParticipationsTable'
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

function Participations() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  const [createOpen, setCreateOpen] = useState(false)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org ? { orgId: org._id } : 'skip',
  )

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        {org && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('create.button')}
          </Button>
        )}
      </div>
      <ParticipationsTable deals={deals} orgSlug={orgSlug} />

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
