import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'

// Placeholder. The real portfolio view (filterable deals table + scope
// toggle) is built in the V0 mission. Kept minimal so the nav link is valid.
export const Route = createFileRoute('/app/$orgSlug/participations')({
  component: ParticipationsPlaceholder,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale())
          .getFixedT(null, 'nav')('items.participations'),
      },
    ],
  }),
})

function ParticipationsPlaceholder() {
  const { t } = useTranslation('nav')
  return (
    <main className="flex-1 space-y-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('items.participations')}
      </h1>
      <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
    </main>
  )
}
