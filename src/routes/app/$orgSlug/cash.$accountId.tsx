import { useRef, useState } from 'react'
import { ArrowUpRight, Pencil } from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { directionTone } from '~/lib/moneyTone'

export const Route = createFileRoute('/app/$orgSlug/cash/$accountId')({
  component: AccountDetail,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'cash')('metaTitleDetail'),
      },
    ],
  }),
})

function BackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation('cash')
  return (
    <Link
      to="/app/$orgSlug/cash"
      params={{ orgSlug }}
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      {t('back')}
    </Link>
  )
}

function NotFound() {
  const { t } = useTranslation('cash')
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

/** "1 234,56", "-500", "12 000 €" (euros, sign allowed) → cents, null if invalid. */
function parseSignedEuros(raw: string): number | null {
  const cleaned = raw.replace(/[\s€]/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/**
 * Account edit dialog: custom name (`displayName` — `label`, the original
 * bank name, stays read-only), lifecycle (closed at the bank), pledge flag
 * (nantissement / blocked funds), and — for NON-connected accounts only —
 * a manual balance entry (Powens is the source of truth on connected ones).
 * Each block saves through its own mutation, only when it changed.
 */
function EditAccountDialog({
  account,
  onClose,
}: {
  account: {
    _id: Id<'bankAccounts'>
    label: string
    displayName: string | null
    accountStatus: 'active' | 'closed'
    pledged: boolean
    isConnected: boolean
    currentBalance: number | null
  }
  onClose: () => void
}) {
  const { t } = useTranslation(['cash', 'common'])
  const renameAccount = useConvexMutation(api.cash.updateAccountName)
  const updateSettings = useConvexMutation(api.cash.updateAccountSettings)
  const updateBalance = useConvexMutation(api.cash.updateAccountBalance)

  const [name, setName] = useState(account.displayName ?? '')
  const [closed, setClosed] = useState(account.accountStatus === 'closed')
  const [pledged, setPledged] = useState(account.pledged)
  const [balance, setBalance] = useState(
    account.currentBalance != null ? String(account.currentBalance / 100) : '',
  )
  const [pending, setPending] = useState(false)

  const balanceCents = balance.trim() === '' ? null : parseSignedEuros(balance)
  const balanceChanged =
    !account.isConnected &&
    balance.trim() !== '' &&
    balanceCents !== account.currentBalance
  const invalidBalance = balanceChanged && balanceCents == null

  async function handleSave() {
    if (invalidBalance) return
    setPending(true)
    try {
      if (name !== (account.displayName ?? '')) {
        await renameAccount({ bankAccountId: account._id, displayName: name })
      }
      const status = closed ? 'closed' : 'active'
      if (status !== account.accountStatus || pledged !== account.pledged) {
        await updateSettings({
          bankAccountId: account._id,
          accountStatus: status,
          pledged,
        })
      }
      if (balanceChanged && balanceCents != null) {
        await updateBalance({
          bankAccountId: account._id,
          currentBalance: balanceCents,
        })
      }
      toast.success(t('cash:edit.saved'))
      onClose()
    } catch {
      toast.error(t('cash:edit.errors.default'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('cash:edit.title')}</DialogTitle>
          <DialogDescription>{t('cash:edit.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-name">{t('cash:rename.nameLabel')}</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={account.label}
            />
            <p className="text-muted-foreground text-xs">
              {t('cash:rename.nameHint')}
            </p>
          </div>
          {!account.isConnected && (
            <div className="space-y-2">
              <Label htmlFor="account-balance">
                {t('cash:edit.balanceLabel')}
              </Label>
              <Input
                id="account-balance"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="12 000"
                aria-invalid={invalidBalance}
              />
              <p className="text-muted-foreground text-xs">
                {t('cash:edit.balanceHint')}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="account-pledged"
              checked={pledged}
              onCheckedChange={(checked) => setPledged(checked === true)}
            />
            <Label htmlFor="account-pledged">{t('cash:edit.pledged')}</Label>
          </div>
          <p className="text-muted-foreground text-xs">
            {t('cash:edit.pledgedHint')}
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="account-closed"
              checked={closed}
              onCheckedChange={(checked) => setClosed(checked === true)}
            />
            <Label htmlFor="account-closed">{t('cash:edit.closed')}</Label>
          </div>
          <p className="text-muted-foreground text-xs">
            {t('cash:edit.closedHint')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={pending || invalidBalance}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountDetail() {
  const { t, i18n } = useTranslation(['cash', 'common'])
  const lang = i18n.language
  const { orgSlug, accountId } = Route.useParams()
  const [renameOpen, setRenameOpen] = useState(false)
  const account = useConvexQuery(api.cash.getAccount, {
    bankAccountId: accountId as Id<'bankAccounts'>,
  })

  // Server-side search (Convex search index), debounced. While a new
  // term is reloading, keep the last displayed list (no empty-list
  // flash).
  const [search, setSearch] = useState('')
  const searchArg = useDebouncedValue(search).trim() || undefined
  const liveTransactions = useConvexQuery(api.cash.listAccountTransactions, {
    bankAccountId: accountId as Id<'bankAccounts'>,
    search: searchArg,
  })
  const lastTransactionsRef = useRef(liveTransactions)
  if (liveTransactions !== undefined) {
    lastTransactionsRef.current = liveTransactions
  }
  const transactions = liveTransactions ?? lastTransactionsRef.current

  // Local display pagination; snaps back to page 1 when the search changes.
  const { page, pageCount, setPage } = usePagination(
    transactions?.length ?? 0,
    searchArg ?? '',
  )
  const pagedTransactions = transactions?.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  const fmtEur = (cents?: number | null) =>
    cents == null
      ? null
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(cents / 100)
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  const fmtSigned = (cents: number, direction: 'in' | 'out') => {
    const signed = direction === 'out' ? -cents : cents
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: 'always',
    }).format(signed / 100)
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <BackLink orgSlug={orgSlug} />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {account
              ? `${account.bankName} · ${account.displayName ?? account.label}`
              : t('loading')}
          </h1>
          {account?.pledged && (
            <Badge variant="outline">{t('badges.pledged')}</Badge>
          )}
          {account?.accountStatus === 'closed' && (
            <Badge variant="secondary">{t('badges.closed')}</Badge>
          )}
          {account && !account.isConnected && (
            <Badge variant="outline">{t('badges.notConnected')}</Badge>
          )}
          {account && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameOpen(true)}
            >
              <Pencil className="size-4" />
              {t('common:actions.edit')}
            </Button>
          )}
        </div>
        {/* Original bank name, read-only, shown only when renamed. */}
        {account?.displayName && (
          <p className="text-muted-foreground text-sm">
            {t('originalName', { name: account.label })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <Info label={t('detail.owner')} value={account?.owner?.name} />
        <Info
          label={t('col.balance')}
          value={
            account ? (fmtEur(account.currentBalance) ?? t('noBalance')) : null
          }
        />
        <Info
          label={t('detail.asOf')}
          value={
            account?.balanceAsOf != null ? fmtDate(account.balanceAsOf) : null
          }
        />
        <Info label={t('detail.iban')} value={account?.iban} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">
          {t('tx.title')}
        </h2>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tx.search.placeholder')}
          className="max-w-sm"
        />
        {!transactions ? (
          <p className="text-muted-foreground text-sm">{t('tx.loading')}</p>
        ) : transactions.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
            {searchArg ? t('tx.search.noResults') : t('tx.empty')}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tx.col.date')}</TableHead>
                  <TableHead>{t('tx.col.label')}</TableHead>
                  <TableHead>{t('tx.col.deal')}</TableHead>
                  <TableHead className="text-right">
                    {t('tx.col.amount')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedTransactions?.map((tx) => (
                  <TableRow key={tx._id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(tx.transactionDate)}
                    </TableCell>
                    <TableCell>{tx.rawLabel}</TableCell>
                    <TableCell>
                      {tx.deal ? (
                        <Link
                          to="/app/$orgSlug/deals/$dealId"
                          params={{ orgSlug, dealId: tx.deal._id }}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 hover:underline"
                        >
                          {tx.deal.targetName ?? '—'}
                          <ArrowUpRight className="size-3 shrink-0" />
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${directionTone(tx.direction)}`}
                    >
                      {fmtSigned(tx.amount, tx.direction)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <PaginationFooter
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
        />
      </section>

      {account && renameOpen && (
        <EditAccountDialog
          account={account}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </main>
  )
}
