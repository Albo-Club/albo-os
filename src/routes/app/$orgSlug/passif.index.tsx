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
import { BankDebtTable } from '~/components/passif/BankDebtTable'
import { GuaranteesGivenSection } from '~/components/passif/GuaranteesGivenSection'
import { LoanDialog } from '~/components/passif/LoanDialog'

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
  const [openDialog, setOpenDialog] = useState<
    'equity' | 'loan' | 'debt' | null
  >(null)
  const [editEquity, setEditEquity] = useState<EquityPositionRow | null>(null)
  const [editLoan, setEditLoan] = useState<LoanRow | null>(null)

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const liabilities = useConvexQuery(
    api.liabilities.getLiabilities,
    org ? { orgId: org._id } : 'skip',
  )
  // The user's orgs — feed the selects in the creation dialogs
  // (holder of an equity position, parties of a shareholder loan).
  const me = useConvexQuery(api.users.me)
  const orgs = me?.kind === 'ready' ? me.orgs : undefined
  // Bank debt: its own query, deliberately separate from `getLiabilities` —
  // it reads no transaction, so a matching gesture never invalidates it.
  const debt = useConvexQuery(
    api.loans.list,
    org ? { orgId: org._id } : 'skip',
  )
  const accounts = useConvexQuery(
    api.cash.listAccounts,
    org ? { orgId: org._id } : 'skip',
  )
  // Off-balance-sheet: what this company pledged for someone else. Read
  // from the guarantor side of the very same rows the loans read (D13).
  const guaranteesGiven = useConvexQuery(
    api.guarantees.listByPledgorOrg,
    org ? { orgId: org._id } : 'skip',
  )

  // Matching transactions to these targets lives in the Pointage tab
  // (Deals / Equity / Shareholder loans combobox); here we read the
  // balances, detach, and create the targets.
  return (
    <main className="flex-1 space-y-8 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      {/* Order of the sections is the order of usefulness (SPEC D39):
          bank debt, then current accounts, then equity. No tile banner on
          top and NO grand total: equity is not due, so adding it to the debt
          would produce a figure that means nothing (D38). */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('debt.title')}</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={!org}
            onClick={() => setOpenDialog('debt')}
          >
            <Plus className="mr-1.5 size-4" />
            {t('create.debt.button')}
          </Button>
        </div>
        <BankDebtTable orgSlug={orgSlug} debt={debt} />
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

      {org ? (
        <GuaranteesGivenSection
          orgId={org._id}
          orgName={org.name}
          guarantees={guaranteesGiven}
        />
      ) : null}

      {org && openDialog === 'debt' && (
        <LoanDialog
          orgId={org._id}
          accounts={(accounts ?? []).map((account) => ({
            _id: account._id,
            label: account.displayName ?? account.label,
          }))}
          onClose={() => setOpenDialog(null)}
        />
      )}
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
