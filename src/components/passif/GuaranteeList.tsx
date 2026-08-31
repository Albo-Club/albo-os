import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import { Badge } from '~/components/ui/badge'

export type LoanGuarantee = FunctionReturnType<
  typeof api.guarantees.listByLoan
>[number]
export type PledgorGuarantee = FunctionReturnType<
  typeof api.guarantees.listByPledgorOrg
>[number]
export type DealPledges = FunctionReturnType<
  typeof api.guarantees.listBySubjectDeal
>

/**
 * What `GuaranteeDialog` needs to prefill an edit — the fields every
 * guarantee surface returns, and no more. Both `LoanGuarantee` and
 * `PledgorGuarantee` satisfy it, so a security can be corrected from the
 * loan sheet AND from « Garanties données », which is the only place a
 * security given to an outside borrower shows up at all.
 */
export type EditableGuarantee = Pick<
  LoanGuarantee,
  | '_id'
  | 'form'
  | 'rank'
  | 'pledgedAmountCents'
  | 'actDate'
  | 'releasedAt'
  | 'notes'
  | 'loanId'
  | 'subjectKind'
  | 'subject'
  | 'borrowerName'
  | 'pledgorName'
  | 'pledgorOrgSlug'
>

/**
 * Formatters shared by the guarantee surfaces.
 *
 * The pledged amount is at the CENTIME: it is the figure written on the deed,
 * not an estimate. The margin, being computed, is rounded to the euro —
 * « l'actuel au centime, l'estimé arrondi » (CLAUDE.md).
 */
export function useGuaranteeFormatters() {
  const { i18n } = useTranslation('passif')
  const lang = i18n.language
  const money = (cents: number, digits: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(cents / 100)
  return {
    fmtPledged: (cents: number) => money(cents, 2),
    fmtEur: (cents: number) => money(cents, 0),
    fmtDate: (ms: number) =>
      new Date(ms).toLocaleDateString(lang, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }),
  }
}

/** Form + rank badges, and the release marker when the guarantee is lifted. */
export function GuaranteeBadges({
  guarantee,
}: {
  guarantee: Pick<LoanGuarantee, 'form' | 'rank' | 'releasedAt'>
}) {
  const { t } = useTranslation('passif')
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        {t(`guarantees.form.${guarantee.form}`)}
      </Badge>
      {guarantee.rank != null ? (
        <Badge variant="secondary">
          {guarantee.rank === 1
            ? t('guarantees.rankFirst')
            : t('guarantees.rank', { rank: guarantee.rank })}
        </Badge>
      ) : null}
      {guarantee.releasedAt != null ? (
        <Badge variant="secondary">{t('guarantees.released')}</Badge>
      ) : null}
    </span>
  )
}

/**
 * The subject of a guarantee, linked when it is one of our assets. A
 * placement lives in the org that HOLDS it, which is not necessarily the org
 * being looked at — hence the slug carried by the row.
 */
export function GuaranteeSubject({
  guarantee,
}: {
  guarantee: Pick<LoanGuarantee, 'subject' | 'subjectKind'>
}) {
  const label = guarantee.subject.label
  if (!label) return <span className="text-muted-foreground">—</span>
  return <span>{label}</span>
}

/**
 * A guarantor: a group company (linked to its own Passif page) or a
 * free-text label. « Not recorded » is a real state — the source deeds
 * often name a caution without saying who stands it (SPEC Q-B).
 */
export function GuarantorName({
  guarantee,
}: {
  guarantee: Pick<LoanGuarantee, 'pledgorName' | 'pledgorOrgSlug'>
}) {
  const { t } = useTranslation('passif')
  if (!guarantee.pledgorName) {
    return (
      <span className="text-muted-foreground italic">
        {t('guarantees.pledgorUnknown')}
      </span>
    )
  }
  if (guarantee.pledgorOrgSlug) {
    return (
      <Link
        to="/app/$orgSlug/passif"
        params={{ orgSlug: guarantee.pledgorOrgSlug }}
        className="hover:underline"
      >
        {guarantee.pledgorName}
      </Link>
    )
  }
  return <span>{guarantee.pledgorName}</span>
}

/**
 * The margin line under a guarantee: what the pledged asset is worth, what
 * is already pledged on it, and what is left.
 *
 * Deliberately PESSIMISTIC (SPEC § 5.2): a pledged amount does not shrink as
 * the debt is repaid — it is worth its deed amount until the mainlevée. A
 * negative margin is information, not a bug.
 */
export function AssetMarginLine({
  summary,
}: {
  summary: LoanGuarantee['assetSummary']
}) {
  const { t } = useTranslation('passif')
  const { fmtEur } = useGuaranteeFormatters()
  const negative =
    summary.availableMarginCents != null && summary.availableMarginCents < 0

  return (
    <div className="bg-muted/40 mt-2 space-y-1 rounded-md px-3 py-2 text-xs">
      <div className="tabular-nums">
        {summary.currentValueCents == null
          ? t('guarantees.assetLineNoValue', {
              pledged: fmtEur(summary.pledgedTotalCents),
            })
          : t('guarantees.assetLine', {
              value: fmtEur(summary.currentValueCents),
              pledged: fmtEur(summary.pledgedTotalCents),
              margin: fmtEur(summary.availableMarginCents ?? 0),
            })}
      </div>
      {negative ? (
        <div className="text-destructive">{t('guarantees.negativeMargin')}</div>
      ) : null}
      {summary.unquantifiedCount > 0 ? (
        <div className="text-muted-foreground">
          {t('guarantees.unquantifiedNote', {
            count: summary.unquantifiedCount,
          })}
        </div>
      ) : null}
    </div>
  )
}

/** Pledged amount, or the explicit « not quantified » (C3). */
export function PledgedAmount({
  cents,
}: {
  cents: number | null
}) {
  const { t } = useTranslation('passif')
  const { fmtPledged } = useGuaranteeFormatters()
  if (cents == null) {
    return (
      <span className="text-muted-foreground italic">
        {t('guarantees.unquantified')}
      </span>
    )
  }
  return <span className="tabular-nums">{fmtPledged(cents)}</span>
}
