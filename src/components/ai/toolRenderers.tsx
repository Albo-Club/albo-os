/**
 * Rich renderers for chat-agent tool results ("show, don't tell"): compact
 * tables, cards, deep links, action buttons.
 *
 * Every renderer is DEFENSIVE: if the shape doesn't match (missing field or
 * unexpected type) it returns `null` and the raw JSON in the collapsible
 * (`ToolOutput` in AiPanel) stays the source of truth — never a render crash.
 *
 * Shapes are the ones built by the internalQuery functions in convex/:
 * agentTools.ts (listDeals), agentToolsPointage.ts (searchTransactions,
 * listUnmatchedTransactions, suggestMatches), agentToolsForecasts.ts
 * (getForecastBalance), agentToolsLiabilities.ts (listLiabilities),
 * valuations.ts (listValuations). Amounts in cents EUR, rates in bps, dates
 * in ms epoch or ISO depending on the tool — see each renderer.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from '@tanstack/react-router'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import { Check } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { ComponentType } from 'react'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { directionTone, signTone } from '~/lib/moneyTone'

// ─── Local formatting helpers (cents → €, ms/ISO → date, bps → %) ───────────

/** Localized formatters; `i18n.language` drives the display locale. */
function useFmt() {
  const { i18n } = useTranslation()
  const lang = i18n.language
  /** cents → € (no decimals: business amounts are always whole euros). */
  const eur = (cents?: number | null) =>
    typeof cents === 'number'
      ? new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(cents / 100)
      : '—'
  /** ms-epoch date → short local date. */
  const dateMs = (ms?: number | null) =>
    typeof ms === 'number' ? new Date(ms).toLocaleDateString(lang) : '—'
  /** ISO date "YYYY-MM-DD" → short local date. */
  const dateISO = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang) : '—'
  return { eur, dateMs, dateISO }
}

// ─── Shape guards (tools return `unknown`) ──────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function asArray(v: unknown): Array<Record<string, unknown>> | null {
  return Array.isArray(v) ? v.filter(isObj) : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

/** Reads `slug` from the current route (panel mounted under /app/$orgSlug). */
function useOrgSlug(): string | undefined {
  const params = useParams({ strict: false })
  return (params as { orgSlug?: string }).orgSlug
}

/** Extracts a readable Convex error code (same pattern as AiPanel). */
function errorCode(err: unknown): string {
  const data = err instanceof ConvexError ? err.data : null
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'code' in data) {
    return (data as { code: string }).code
  }
  return ''
}

// ─── Presentation primitives (dense, ~24rem-wide panel) ─────────────────────

/** Compact, horizontally scrollable table. */
function MiniTable({
  head,
  children,
}: {
  head: Array<string>
  children: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  )
}

// ═══ 1. listDeals ════════════════════════════════════════════════════════════
// Shape (agentTools.listDealsInternal): Array<{ _id, investor, target, viaSpv,
// instrumentKind, committedAmount, paidAmount, status, signedDate }>.

function DealsRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur } = useFmt()
  const slug = useOrgSlug()
  const rows = asArray(output)
  if (!rows || rows.length === 0) return null

  return (
    <MiniTable
      head={[
        t('renderers.deals.target'),
        t('renderers.deals.instrument'),
        t('renderers.deals.committed'),
        t('renderers.deals.status'),
      ]}
    >
      {rows.map((d, i) => {
        const id = str(d._id)
        const target = str(d.target) ?? '—'
        const instrumentKind = str(d.instrumentKind)
        const status = str(d.status)
        const cell = (
          <>
            <td className="px-2 py-1.5 font-medium">{target}</td>
            <td className="text-muted-foreground px-2 py-1.5">
              {instrumentKind
                ? t(`renderers.instrument.${instrumentKind}`, {
                    defaultValue: instrumentKind,
                  })
                : '—'}
            </td>
            <td className="px-2 py-1.5 tabular-nums">
              {eur(num(d.committedAmount))}
            </td>
            <td className="px-2 py-1.5">
              {status
                ? t(`renderers.status.${status}`, { defaultValue: status })
                : '—'}
            </td>
          </>
        )
        // Deep link to the deal detail (when slug + id are known).
        return id && slug ? (
          <tr key={i} className="hover:bg-accent/50">
            <td className="p-0" colSpan={4}>
              <Link
                to="/app/$orgSlug/deals/$dealId"
                params={{ orgSlug: slug, dealId: id }}
                className="grid grid-cols-[1fr_1fr_auto_auto]"
              >
                {cell}
              </Link>
            </td>
          </tr>
        ) : (
          <tr key={i}>{cell}</tr>
        )
      })}
    </MiniTable>
  )
}

// ═══ 2. searchTransactions ═══════════════════════════════════════════════════
// Shape (agentToolsPointage.searchTransactionsInternal): { count, totalInCents,
// totalOutCents, totalVatInCents, totalVatOutCents, vatUnqualifiedCount,
// truncated, rows: Array<{ _id, dateISO, direction, amountCents, rawLabel,
// counterparty, matchStatus, vatRateBps, vatCents, accountLabel }> }.

function SearchTransactionsRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur, dateISO } = useFmt()
  if (!isObj(output)) return null
  const rows = asArray(output.rows)
  const count = num(output.count)
  if (rows === null || count === null) return null

  const totalIn = num(output.totalInCents) ?? 0
  const totalOut = num(output.totalOutCents) ?? 0
  const vatIn = num(output.totalVatInCents) ?? 0
  const vatOut = num(output.totalVatOutCents) ?? 0
  const hasVat = vatIn > 0 || vatOut > 0
  const truncated = output.truncated === true

  return (
    <div className="space-y-2">
      {/* Pre-aggregated totals header (never recomputed here). */}
      <div className="bg-muted/40 flex flex-wrap gap-x-4 gap-y-1 rounded-md border px-2.5 py-2 text-xs">
        <span className="text-muted-foreground">
          {t('renderers.search.count', { count })}
        </span>
        <span>
          {t('renderers.search.in')}{' '}
          <span className={`tabular-nums ${directionTone('in')}`}>
            {eur(totalIn)}
          </span>
        </span>
        <span>
          {t('renderers.search.out')}{' '}
          <span className={`tabular-nums ${directionTone('out')}`}>
            {eur(totalOut)}
          </span>
        </span>
        {hasVat && (
          <span className="text-muted-foreground">
            {t('renderers.search.vat')}{' '}
            <span className="tabular-nums">{eur(vatIn + vatOut)}</span>
          </span>
        )}
        {truncated && (
          <Badge variant="outline" className="text-[10px]">
            {t('renderers.search.partial')}
          </Badge>
        )}
      </div>

      {rows.length > 0 && (
        <MiniTable
          head={[
            t('renderers.tx.date'),
            t('renderers.tx.label'),
            t('renderers.tx.amount'),
          ]}
        >
          {rows.map((tx, i) => {
            const direction = str(tx.direction)
            const amount = num(tx.amountCents)
            const counterparty = str(tx.counterparty)
            const signed =
              direction === 'out' && amount != null ? -amount : amount
            return (
              <tr key={i}>
                <td className="text-muted-foreground px-2 py-1.5 whitespace-nowrap tabular-nums">
                  {dateISO(str(tx.dateISO))}
                </td>
                <td className="px-2 py-1.5">
                  <span className="block max-w-[14rem] truncate">
                    {str(tx.rawLabel) ?? '—'}
                  </span>
                  {counterparty && (
                    <span className="text-muted-foreground block max-w-[14rem] truncate">
                      {counterparty}
                    </span>
                  )}
                </td>
                <td
                  className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${
                    direction === 'in' || direction === 'out'
                      ? directionTone(direction)
                      : ''
                  }`}
                >
                  {eur(signed)}
                </td>
              </tr>
            )
          })}
        </MiniTable>
      )}
    </div>
  )
}

// ═══ 3. listUnmatchedTransactions ════════════════════════════════════════════
// Shape (agentToolsPointage.listUnmatchedInternal): Array<{ _id, dateISO,
// direction, amountCents, rawLabel, counterparty, accountLabel }>.

function UnmatchedTransactionsRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur, dateISO } = useFmt()
  const rows = asArray(output)
  if (!rows || rows.length === 0) return null

  return (
    <MiniTable
      head={[
        t('renderers.tx.date'),
        t('renderers.tx.label'),
        t('renderers.tx.amount'),
      ]}
    >
      {rows.map((tx, i) => {
        const direction = str(tx.direction)
        const amount = num(tx.amountCents)
        const signed = direction === 'out' && amount != null ? -amount : amount
        return (
          <tr key={i}>
            <td className="text-muted-foreground px-2 py-1.5 whitespace-nowrap tabular-nums">
              {dateISO(str(tx.dateISO))}
            </td>
            <td className="px-2 py-1.5">
              <span className="block max-w-[15rem] truncate">
                {str(tx.rawLabel) ?? '—'}
              </span>
            </td>
            <td
              className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${
                direction === 'in' || direction === 'out'
                  ? directionTone(direction)
                  : ''
              }`}
            >
              {eur(signed)}
            </td>
          </tr>
        )
      })}
    </MiniTable>
  )
}

// ═══ 4. suggestMatches ═══════════════════════════════════════════════════════
// Shape (agentToolsPointage.suggestMatchesInternal): Array<{ transactionId,
// dateISO, direction, amountCents, rawLabel, candidates: Array<{ kind,
// targetId, targetLabel, evidence: { similarMatchedCount, decisionsCount,
// amountDeltaCents }, score }> }>.
// Direct action (no model approval): per-candidate "Pointer" button via the
// PUBLIC mutations api.transactions.matchTransaction (deal target) /
// api.liabilities.allocateTransaction (liability target).

/** Candidate "Pointer" button: direct user action. */
function PointButton({
  txId,
  candidate,
  done,
  disabled,
  onDone,
}: {
  txId: string
  candidate: {
    kind: string
    targetId: string
    targetLabel: string | null
  }
  done: boolean
  disabled: boolean
  onDone: () => void
}) {
  const { t } = useTranslation('chat')
  const [busy, setBusy] = useState(false)
  const matchToDeal = useConvexMutation(api.transactions.matchTransaction)
  const allocate = useConvexMutation(api.liabilities.allocateTransaction)

  async function handleClick() {
    setBusy(true)
    try {
      if (candidate.kind === 'deal') {
        await matchToDeal({
          transactionId: txId as Id<'transactions'>,
          dealId: candidate.targetId as Id<'deals'>,
        })
      } else if (
        candidate.kind === 'equity' ||
        candidate.kind === 'intercompany_loan'
      ) {
        await allocate({
          transactionId: txId as Id<'transactions'>,
          kind: candidate.kind,
          targetId: candidate.targetId,
        })
      } else {
        return
      }
      toast.success(t('renderers.suggest.pointed'))
      onDone()
    } catch (err) {
      const code = errorCode(err)
      toast.error(
        code
          ? t(`renderers.errors.${code}`, {
              defaultValue: t('renderers.errors.default'),
            })
          : t('renderers.errors.default'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <span className="text-positive inline-flex items-center gap-1 text-xs">
        <Check className="size-3.5" />
        {t('renderers.suggest.pointedShort')}
      </span>
    )
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={disabled || busy}
      onClick={() => void handleClick()}
    >
      {t('renderers.suggest.point')}
    </Button>
  )
}

function SuggestMatchesRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur, dateISO } = useFmt()
  // Local "matched" state per transaction (freezes the group on success).
  const [pointed, setPointed] = useState<Record<string, string>>({})
  const groups = asArray(output)
  if (!groups || groups.length === 0) return null

  return (
    <div className="space-y-2">
      {groups.map((g, i) => {
        const txId = str(g.transactionId)
        if (!txId) return null
        const direction = str(g.direction)
        const amount = num(g.amountCents)
        const signed = direction === 'out' && amount != null ? -amount : amount
        const candidates = asArray(g.candidates) ?? []
        const pointedTarget = pointed[txId]

        return (
          <div key={i} className="space-y-1.5 rounded-md border p-2">
            {/* Analyzed transaction info. */}
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">
                {str(g.rawLabel) ?? '—'}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  direction === 'in' || direction === 'out'
                    ? directionTone(direction)
                    : ''
                }`}
              >
                {eur(signed)}
              </span>
            </div>
            <div className="text-muted-foreground text-[11px]">
              {dateISO(str(g.dateISO))}
            </div>

            {candidates.length === 0 ? (
              <div className="text-muted-foreground text-xs italic">
                {t('renderers.suggest.noCandidate')}
              </div>
            ) : (
              <ul className="space-y-1">
                {candidates.map((c, j) => {
                  const kind = str(c.kind) ?? ''
                  const targetId = str(c.targetId) ?? ''
                  const score = num(c.score)
                  const isDone = pointedTarget === targetId
                  // The group freezes as soon as one candidate is matched.
                  const groupDone = Boolean(pointedTarget)
                  return (
                    <li
                      key={j}
                      className="bg-muted/30 flex items-center justify-between gap-2 rounded px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                          >
                            {t(`renderers.suggest.kind.${kind}`, {
                              defaultValue: kind,
                            })}
                          </Badge>
                          <span className="truncate text-xs">
                            {str(c.targetLabel) ??
                              t('renderers.suggest.unknownTarget')}
                          </span>
                        </div>
                        {score != null && (
                          <span className="text-muted-foreground text-[10px]">
                            {t('renderers.suggest.score', { score })}
                          </span>
                        )}
                      </div>
                      <PointButton
                        txId={txId}
                        candidate={{
                          kind,
                          targetId,
                          targetLabel: str(c.targetLabel),
                        }}
                        done={isDone}
                        disabled={groupDone}
                        onDone={() =>
                          setPointed((prev) => ({ ...prev, [txId]: targetId }))
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ═══ 5. getForecastBalance ═══════════════════════════════════════════════════
// Shape (agentToolsForecasts.getForecastBalanceInternal, consumption
// semantics of forecasts.computeForecastGridForOrg): { startingBalanceCents,
// currency, currentMonthKey, ignoredNonEurAccounts, ignoredNonEurEntries,
// months: Array<{ monthKey, inflowCents, outflowCents, netCents,
// projectedBalanceCents }> }.

function ForecastBalanceRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur } = useFmt()
  if (!isObj(output)) return null
  const months = asArray(output.months)
  if (!months || months.length === 0) return null
  const starting = num(output.startingBalanceCents)

  return (
    <div className="space-y-1.5">
      {starting != null && (
        <div className="text-muted-foreground text-xs">
          {t('renderers.forecast.starting')}{' '}
          <span className="tabular-nums">{eur(starting)}</span>
        </div>
      )}
      <MiniTable
        head={[
          t('renderers.forecast.month'),
          t('renderers.forecast.in'),
          t('renderers.forecast.out'),
          t('renderers.forecast.balance'),
        ]}
      >
        {months.map((m, i) => {
          const balance = num(m.projectedBalanceCents)
          return (
            <tr key={i}>
              <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                {str(m.monthKey) ?? '—'}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {eur(num(m.inflowCents))}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {eur(num(m.outflowCents))}
              </td>
              <td
                className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                  balance != null && balance < 0 ? 'text-destructive' : ''
                }`}
              >
                {eur(balance)}
              </td>
            </tr>
          )
        })}
      </MiniTable>
    </div>
  )
}

// ═══ 6. listLiabilities ══════════════════════════════════════════════════════
// Shape (agentToolsLiabilities.listLiabilitiesInternal): { equityPositions:
// Array<{ _id, type, holderName, amountCents, effectiveDateISO,
// allocatedTransactions }>, loans: Array<{ _id, counterpartyName, side,
// balanceCents, interestRateBps, isBlocked, allocatedTransactions }> }.

function LiabilitiesRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur } = useFmt()
  if (!isObj(output)) return null
  const equity = asArray(output.equityPositions)
  const loans = asArray(output.loans)
  if (equity === null && loans === null) return null
  if ((equity?.length ?? 0) === 0 && (loans?.length ?? 0) === 0) return null

  return (
    <div className="space-y-3">
      {equity && equity.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t('renderers.liabilities.equity')}
          </div>
          <MiniTable
            head={[
              t('renderers.liabilities.type'),
              t('renderers.liabilities.holder'),
              t('renderers.liabilities.amount'),
            ]}
          >
            {equity.map((p, i) => {
              const type = str(p.type)
              return (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    {type
                      ? t(`renderers.liabilities.equityType.${type}`, {
                          defaultValue: type,
                        })
                      : '—'}
                  </td>
                  <td className="text-muted-foreground px-2 py-1.5">
                    {str(p.holderName) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {eur(num(p.amountCents))}
                  </td>
                </tr>
              )
            })}
          </MiniTable>
        </div>
      )}

      {loans && loans.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t('renderers.liabilities.loans')}
          </div>
          <MiniTable
            head={[
              t('renderers.liabilities.counterparty'),
              t('renderers.liabilities.side'),
              t('renderers.liabilities.balance'),
            ]}
          >
            {loans.map((l, i) => {
              const side = str(l.side)
              const balance = num(l.balanceCents)
              return (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    {str(l.counterpartyName) ?? '—'}
                  </td>
                  <td className="text-muted-foreground px-2 py-1.5">
                    {side
                      ? t(`renderers.liabilities.${side}`, {
                          defaultValue: side,
                        })
                      : '—'}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums ${
                      balance != null ? signTone(balance) : ''
                    }`}
                  >
                    {eur(balance)}
                  </td>
                </tr>
              )
            })}
          </MiniTable>
        </div>
      )}
    </div>
  )
}

// ═══ 7. listValuations ═══════════════════════════════════════════════════════
// Shape (valuations.listInternal): Array<{ _id, asOf, fairValue,
// valuationMethod, source, notes }>. asOf in ms epoch.

function ValuationsRenderer({ output }: { output: unknown }) {
  const { t } = useTranslation('chat')
  const { eur, dateMs } = useFmt()
  const rows = asArray(output)
  if (!rows || rows.length === 0) return null

  return (
    <MiniTable
      head={[
        t('renderers.valuations.date'),
        t('renderers.valuations.value'),
        t('renderers.valuations.source'),
      ]}
    >
      {rows.map((v, i) => (
        <tr key={i}>
          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
            {dateMs(num(v.asOf))}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">
            {eur(num(v.fairValue))}
          </td>
          <td className="text-muted-foreground px-2 py-1.5">
            {str(v.source) ?? str(v.valuationMethod) ?? '—'}
          </td>
        </tr>
      ))}
    </MiniTable>
  )
}

// ─── Tool-name → renderer registry ──────────────────────────────────────────

const toolRenderers: Record<string, ComponentType<{ output: unknown }>> = {
  listDeals: DealsRenderer,
  searchTransactions: SearchTransactionsRenderer,
  listUnmatchedTransactions: UnmatchedTransactionsRenderer,
  suggestMatches: SuggestMatchesRenderer,
  getForecastBalance: ForecastBalanceRenderer,
  listLiabilities: LiabilitiesRenderer,
  listValuations: ValuationsRenderer,
}

/** Rich renderer for a tool, or `undefined` when none (→ JSON fallback). */
export function getToolRenderer(
  toolName: string,
): ComponentType<{ output: unknown }> | undefined {
  return Object.prototype.hasOwnProperty.call(toolRenderers, toolName)
    ? toolRenderers[toolName]
    : undefined
}
