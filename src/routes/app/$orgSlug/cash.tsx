import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'

// Placeholder. Cash management (balances, forecasts, reconciliation) is
// phase 2 — see schema tables bankAccounts/transactions/forecasts.
export const Route = createFileRoute('/app/$orgSlug/cash')({
  component: CashPlaceholder,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'nav')('items.cash'),
      },
    ],
  }),
})

function CashPlaceholder() {
  const { t } = useTranslation('nav')
  return (
    <main className="flex-1 space-y-2 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('items.cash')}
      </h1>
      <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
    </main>
  )
}
