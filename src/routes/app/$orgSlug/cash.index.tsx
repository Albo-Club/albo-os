import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../../convex/_generated/api'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { CashAccounts } from '~/components/cash/CashAccounts'
import { ForecastSection } from '~/components/cash/ForecastSection'
import { VatCard } from '~/components/cash/VatCard'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/app/$orgSlug/cash/')({
  component: Cash,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'cash')('metaTitle'),
      },
    ],
  }),
})

function Cash() {
  const { t } = useTranslation('cash')
  const { orgSlug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    org ? { orgId: org._id } : 'skip',
  )
  const startBankConnection = useAction(api.powens.startBankConnection)
  const [connecting, setConnecting] = useState(false)

  async function handleConnect() {
    if (!org) return
    setConnecting(true)
    try {
      const { webviewUrl } = await startBankConnection({ orgId: org._id })
      window.location.href = webviewUrl
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(t(`connect.errors.${code}`, t('connect.failed')))
      setConnecting(false)
    }
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Button onClick={handleConnect} disabled={!org || connecting}>
          {connecting ? t('connect.connecting') : t('connect.button')}
        </Button>
      </div>
      <CashAccounts accounts={accounts} orgSlug={orgSlug} />
      {org && <VatCard orgId={org._id} orgSlug={orgSlug} />}
      {org && <ForecastSection orgId={org._id} />}
    </main>
  )
}
