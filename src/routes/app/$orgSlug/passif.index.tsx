import { useState } from 'react'
import { Plus } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import type {
  EquityPositionRow,
  LoanRow,
} from '~/components/passif/PassifTables'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Button } from '~/components/ui/button'
import {
  CreateEquityDialog,
  CreateLoanDialog,
} from '~/components/passif/CreateLiabilityDialogs'
import { EquityTable, LoansTable } from '~/components/passif/PassifTables'

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
  const [openDialog, setOpenDialog] = useState<'equity' | 'loan' | null>(null)
  const [editEquity, setEditEquity] = useState<EquityPositionRow | null>(null)
  const [editLoan, setEditLoan] = useState<LoanRow | null>(null)

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const liabilities = useConvexQuery(
    api.liabilities.getLiabilities,
    org ? { orgId: org._id } : 'skip',
  )
  // Orgs de l'utilisateur — alimentent les selects des dialogs de création
  // (détenteur d'une position de capital, parties d'un C/C).
  const me = useConvexQuery(api.users.me)
  const orgs = me?.kind === 'ready' ? me.orgs : undefined

  // Le pointage des transactions vers ces cibles vit dans l'onglet Pointage
  // (combobox Deals / Capitaux propres / Comptes courants) ; ici on lit les
  // soldes, on détache, et on crée les cibles.
  return (
    <main className="flex-1 space-y-8 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('equity.title')}</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={!org || !orgs}
            onClick={() => setOpenDialog('equity')}
          >
            <Plus className="mr-1.5 size-4" />
            {t('create.equity.button')}
          </Button>
        </div>
        <EquityTable
          positions={liabilities?.equityPositions}
          onEdit={setEditEquity}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('loans.title')}</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={!org || !orgs}
            onClick={() => setOpenDialog('loan')}
          >
            <Plus className="mr-1.5 size-4" />
            {t('create.loan.button')}
          </Button>
        </div>
        <LoansTable loans={liabilities?.loans} onEdit={setEditLoan} />
      </section>

      {org && orgs && openDialog === 'equity' && (
        <CreateEquityDialog
          orgId={org._id}
          orgs={orgs}
          onClose={() => setOpenDialog(null)}
        />
      )}
      {org && orgs && openDialog === 'loan' && (
        <CreateLoanDialog
          orgId={org._id}
          orgs={orgs}
          onClose={() => setOpenDialog(null)}
        />
      )}
      {org && orgs && editEquity && (
        <CreateEquityDialog
          orgId={org._id}
          orgs={orgs}
          position={editEquity}
          onClose={() => setEditEquity(null)}
        />
      )}
      {org && orgs && editLoan && (
        <CreateLoanDialog
          orgId={org._id}
          orgs={orgs}
          loan={editLoan}
          onClose={() => setEditLoan(null)}
        />
      )}
    </main>
  )
}
