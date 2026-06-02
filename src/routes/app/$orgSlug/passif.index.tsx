import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import type { LiabilityOption } from '~/components/passif/LiabilityCombobox'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import {
  AllocateTable,
  EquityTable,
  LoansTable,
} from '~/components/passif/PassifTables'

export const Route = createFileRoute('/app/$orgSlug/passif/')({
  component: Passif,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'passif')('metaTitle'),
      },
    ],
  }),
})

function Passif() {
  const { t } = useTranslation('passif')
  const { orgSlug } = Route.useParams()

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const liabilities = useConvexQuery(
    api.liabilities.getLiabilities,
    org ? { orgId: org._id } : 'skip',
  )
  const transactions = useConvexQuery(
    api.transactions.listUnmatched,
    org ? { orgId: org._id } : 'skip',
  )

  // Cibles de pointage = positions de capital + C/C de l'org.
  const options = useMemo<Array<LiabilityOption> | undefined>(() => {
    if (!liabilities) return undefined
    return [
      ...liabilities.equityPositions.map((position) => ({
        kind: 'equity' as const,
        targetId: position._id,
        label: t(`equity.type.${position.type}`),
        sublabel: position.holderName ?? '—',
      })),
      ...liabilities.loans.map((loan) => ({
        kind: 'intercompany_loan' as const,
        targetId: loan._id,
        label: loan.counterpartyName ?? '—',
        sublabel: t(
          loan.side === 'creditor' ? 'loans.receivable' : 'loans.payable',
        ),
      })),
    ]
  }, [liabilities, t])

  // Filtre de sécurité : une tx allouée au passif est `matched` et n'est donc
  // plus dans `listUnmatched` — on ne garde que les tx sans allocation.
  const allocatable = transactions?.filter((tx) => tx.allocation == null)

  return (
    <main className="flex-1 space-y-8 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('equity.title')}</h2>
        <EquityTable positions={liabilities?.equityPositions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('loans.title')}</h2>
        <LoansTable loans={liabilities?.loans} />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">{t('allocate.title')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('allocate.subtitle')}
          </p>
        </div>
        <AllocateTable transactions={allocatable} options={options} />
      </section>
    </main>
  )
}
