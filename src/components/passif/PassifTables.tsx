import { Fragment, useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../../convex/_generated/api'

import type { Id } from '../../../convex/_generated/dataModel'
import {
  useFormatters,
  useReportError,
} from '~/components/pointage/TransactionSheet'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

// ─── Shapes minimales (retours de `liabilities:getLiabilities`) ─────────────

/** Transaction pointée sur une cible passif. */
export type AllocatedTx = {
  _id: Id<'transactions'>
  direction: 'in' | 'out'
  amount: number
  transactionDate: number
  rawLabel: string
  counterparty: string | null
}

/** Position de capital enrichie (détenteur résolu + tx pointées). */
export type EquityPositionRow = {
  _id: Id<'equityPositions'>
  type:
    | 'capital_social'
    | 'prime_emission'
    | 'augmentation_capital'
    | 'report_a_nouveau'
  amountCents: number
  effectiveDate: number
  holderName: string | null
  transactions: Array<AllocatedTx>
}

/** C/C inter-entités enrichi (contrepartie résolue + solde + tx pointées). */
export type LoanRow = {
  _id: Id<'intercompanyLoans'>
  side: 'creditor' | 'debtor'
  balanceCents: number
  counterpartyName: string | null
  transactions: Array<AllocatedTx>
}

// ─── Formatage ───────────────────────────────────────────────────────────────

/** Formateurs montants en cents EUR (non signé / solde signé), localisés. */
function usePassifFormatters() {
  const { i18n } = useTranslation('passif')
  const lang = i18n.language
  const fmtEur = (cents: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(cents / 100)
  const fmtBalance = (cents: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
      signDisplay: 'exceptZero',
    }).format(cents / 100)
  return { fmtEur, fmtBalance }
}

/** Créance (solde ≥ 0) en vert, dette (solde < 0) en rouge. */
const balanceTone = (cents: number) =>
  cents >= 0 ? 'text-emerald-600' : 'text-destructive'

// ─── Sous-lignes des transactions pointées (+ Détacher) ─────────────────────

/**
 * Lignes indentées des transactions pointées sur une cible passif, avec
 * bouton « Détacher » → `liabilities:deallocateTransaction`. La query
 * `getLiabilities` étant réactive, la ligne et le solde se recalculent seuls.
 */
function AllocatedTxRows({
  transactions,
  colSpan,
}: {
  transactions: Array<AllocatedTx>
  /** Nombre de colonnes de la table parente, hors colonne du bouton. */
  colSpan: number
}) {
  const { t } = useTranslation('passif')
  const { fmtDate, fmtSigned } = useFormatters()
  const reportError = useReportError('passif')
  const deallocateTransaction = useConvexMutation(
    api.liabilities.deallocateTransaction,
  )
  const [pendingId, setPendingId] = useState<Id<'transactions'> | null>(null)

  async function handleDetach(tx: AllocatedTx) {
    setPendingId(tx._id)
    try {
      await deallocateTransaction({ transactionId: tx._id })
    } catch (err) {
      reportError(err)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <>
      {transactions.map((tx) => (
        <TableRow key={tx._id} className="bg-muted/30">
          <TableCell colSpan={colSpan} className="pl-8">
            <span className="text-muted-foreground text-xs tabular-nums">
              {fmtDate(tx.transactionDate)}
            </span>
            <span className="ml-3 text-xs">{tx.rawLabel}</span>
            <span
              className={`ml-3 text-xs tabular-nums ${
                tx.direction === 'out' ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {fmtSigned(tx.amount, tx.direction)}
            </span>
          </TableCell>
          <TableCell className="text-right">
            <Button
              size="sm"
              variant="outline"
              disabled={pendingId === tx._id}
              onClick={() => void handleDetach(tx)}
            >
              {t('allocated.detach')}
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

// ─── Capitaux propres ────────────────────────────────────────────────────────

/**
 * Positions de capital émises par l'org : type, détenteur, date, montant et
 * ligne de total. Les transactions pointées apparaissent en sous-lignes avec
 * « Détacher ».
 */
export function EquityTable({
  positions,
}: {
  positions: Array<EquityPositionRow> | undefined
}) {
  const { t } = useTranslation('passif')
  const { fmtDate } = useFormatters()
  const { fmtEur } = usePassifFormatters()

  if (positions && positions.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('equity.empty')}
      </div>
    )
  }

  const totalCents = (positions ?? []).reduce(
    (sum, position) => sum + position.amountCents,
    0,
  )

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('equity.col.type')}</TableHead>
            <TableHead>{t('equity.col.holder')}</TableHead>
            <TableHead>{t('equity.col.date')}</TableHead>
            <TableHead className="text-right">
              {t('equity.col.amount')}
            </TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!positions ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-muted-foreground text-center"
              >
                {t('loading')}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {positions.map((position) => (
                <Fragment key={position._id}>
                  <TableRow>
                    <TableCell>{t(`equity.type.${position.type}`)}</TableCell>
                    <TableCell>{position.holderName ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(position.effectiveDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtEur(position.amountCents)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <AllocatedTxRows
                    transactions={position.transactions}
                    colSpan={4}
                  />
                </Fragment>
              ))}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell colSpan={3}>{t('equity.total')}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(totalCents)}
                </TableCell>
                <TableCell />
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Comptes courants d'associés ─────────────────────────────────────────────

/**
 * C/C inter-entités vus par l'org : contrepartie, position (créance/dette
 * selon `side`) et solde dérivé signé (vert = créance, rouge = dette). Les
 * transactions pointées apparaissent en sous-lignes avec « Détacher ».
 */
export function LoansTable({ loans }: { loans: Array<LoanRow> | undefined }) {
  const { t } = useTranslation('passif')
  const { fmtBalance } = usePassifFormatters()

  if (loans && loans.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('loans.empty')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('loans.col.counterparty')}</TableHead>
            <TableHead>{t('loans.col.side')}</TableHead>
            <TableHead className="text-right">
              {t('loans.col.balance')}
            </TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loans ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-muted-foreground text-center"
              >
                {t('loading')}
              </TableCell>
            </TableRow>
          ) : (
            loans.map((loan) => (
              <Fragment key={loan._id}>
                <TableRow>
                  <TableCell>{loan.counterpartyName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(
                        loan.side === 'creditor'
                          ? 'loans.receivable'
                          : 'loans.payable',
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${balanceTone(loan.balanceCents)}`}
                  >
                    {fmtBalance(loan.balanceCents)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <AllocatedTxRows transactions={loan.transactions} colSpan={3} />
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
