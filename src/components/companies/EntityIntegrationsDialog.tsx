import { useState } from 'react'
import { Link as RouterLink } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { Link2, Unlink } from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { VascoLinkDialog } from '~/components/vasco/VascoCommunicationsSection'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'

/**
 * « Intégrations » dialog of an entity page (menu ⋯): one row per registry
 * platform that supports entity links (`entityLink`), with the org's
 * connection state — connected platforms offer the link/unlink flow (the
 * platform's own picker), unconnected ones point to Réglages → Intégrations.
 * Available on EVERY portfolio entity: linking no longer depends on the
 * entity's name matching the platform.
 */
export function EntityIntegrationsDialog({
  company,
  orgSlug,
  onClose,
}: {
  company: Doc<'companies'>
  orgSlug: string
  onClose: () => void
}) {
  const { t } = useTranslation(['participations'])
  const [vascoOpen, setVascoOpen] = useState(false)
  const integrations = useConvexQuery(api.connections.listIntegrations, {
    orgId: company.orgId,
  })

  // The platform picker step is skipped while the picker dialog is open —
  // the two dialogs swap instead of stacking.
  if (vascoOpen) {
    return (
      <VascoLinkDialog
        company={company}
        onClose={() => {
          setVascoOpen(false)
          onClose()
        }}
      />
    )
  }

  const linkable = (integrations ?? []).filter((i) => i.entityLink)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('participations:integrations.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('participations:integrations.dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        {integrations === undefined ? (
          <p className="text-muted-foreground text-sm">
            {t('participations:loading')}
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {linkable.map((item) => {
              const connected = (item.connections ?? []).some(
                (c) => c.state !== 'inactive',
              )
              // Today the only entity-linkable platform is VASCO; a future
              // one plugs its own picker here.
              const isLinked =
                item.platform === 'vasco' &&
                Boolean(company.vascoClientSlug && company.vascoIssuerId)
              return (
                <div
                  key={item.platform}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                      }`}
                    />
                    <span className="text-sm font-medium">
                      {t(`participations:integrations.platforms.${item.platform}`)}
                    </span>
                    {isLinked && (
                      <span className="text-muted-foreground text-xs">
                        {t('participations:integrations.linked')}
                      </span>
                    )}
                  </span>
                  {connected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setVascoOpen(true)}
                    >
                      {isLinked ? (
                        <Unlink className="size-4" />
                      ) : (
                        <Link2 className="size-4" />
                      )}
                      {isLinked
                        ? t('participations:integrations.changeLink')
                        : t('participations:integrations.link')}
                    </Button>
                  ) : (
                    <RouterLink
                      to="/app/$orgSlug/settings/integrations"
                      params={{ orgSlug }}
                      className="text-muted-foreground hover:text-foreground text-xs underline"
                    >
                      {t('participations:integrations.notConnected')}
                    </RouterLink>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
