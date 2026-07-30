import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation } from '@convex-dev/react-query'
import { toast } from 'sonner'

import {
  INSTRUMENT_ARCHETYPE,
  INSTRUMENT_FIELDS,
  INSTRUMENT_RENDER,
} from '../../../convex/lib/instrumentMapping'
import { ENUM_FIELD_VALUES } from '../../../convex/lib/instruments'
import { api } from '../../../convex/_generated/api'
import type { ComponentType } from 'react'
import type { Archetype } from '../../../convex/lib/instrumentMapping'
import type { InstrumentKind } from '../../../convex/lib/instruments'
import type { Doc } from '../../../convex/_generated/dataModel'
import type { FieldFormat } from '~/lib/parse'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { LeadSpvPanel } from '~/components/deals/LeadSpvPanel'
import { RoyaltiesPanel } from '~/components/deals/RoyaltiesPanel'
import { signTone } from '~/lib/moneyTone'
import { cn } from '~/lib/utils'
import { IdentityField } from '~/components/companies/EntityFiche'
import { InlineField } from '~/components/ui/inline-field'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'

/**
 * The two instrument-driven surfaces of the deal sheet, both driven by
 * convex/lib/instrumentMapping.ts (single source of truth):
 *
 *   - `InstrumentDetails` — the stored parameters of the instrument, shown as
 *     rows in the sheet's side panel. Reads INSTRUMENT_FIELDS for the ordered
 *     columns and INSTRUMENT_ARCHETYPE for the extras. Every instrument has
 *     one, whatever its render mode.
 *   - `InstrumentPanel` — the bespoke body of a `render: 'custom'` instrument
 *     (royalty projection table, lead-SPV collected tile), in the main column.
 *     Nothing for the other kinds: their parameters ARE the side panel.
 *
 * Neither duplicates the instrument→fields mapping.
 *
 * Fields edit inline when `editable` (click a value → InlineField → one-field
 * `deals.update`).
 */

/**
 * `deals` column → display format. This is NOT the instrument→fields mapping
 * (that lives in instrumentMapping.ts and is read below); it only says how a
 * given column is rendered: cents→€, bps→%, ms→date, enum→i18n label. Exported
 * so the deal edit dialog renders the matching input per field (Lot 3).
 */
export const FIELD_FORMAT: Record<string, FieldFormat> = {
  // Dates (ms epoch)
  closingDate: 'date',
  signedDate: 'date',
  conversionDeadlineDate: 'date',
  maturityDate: 'date',
  grantDate: 'date',
  exerciseDeadlineDate: 'date',
  investmentDate: 'date',
  royaltyStartDate: 'date',
  endDate: 'date',
  // Amounts (cents)
  paidAmount: 'eur',
  committedAmount: 'eur',
  roundSize: 'eur',
  preMoneyValuation: 'eur',
  postMoneyValuation: 'eur',
  valuationCap: 'eur',
  conversionValuation: 'eur',
  principalAmount: 'eur',
  pricePerShare: 'eur',
  structuringFees: 'eur',
  amountRaised: 'eur',
  capitalInvested: 'eur',
  acquisitionFees: 'eur',
  rentReceived: 'eur',
  currentValue: 'eur',
  warrantPrice: 'eur',
  strikePrice: 'eur',
  // Rates (bps)
  ownershipPct: 'pct',
  discount: 'pct',
  interestRate: 'pct',
  spvOwnershipPct: 'pct',
  distributionRate: 'pct',
  conversionDiscount: 'pct',
  managementFeeRate: 'pct',
  hurdleRate: 'pct',
  carriedRate: 'pct',
  royaltyRate: 'pct',
  depreciationRate: 'pct',
  // Decimals (parity / conversion ratio — fractional allowed)
  warrantParity: 'decimal',
  conversionRatio: 'decimal',
  floorMultiple: 'decimal',
  capMultiple: 'decimal',
  // Enums (i18n key `enum.<field>.<value>`)
  roundType: 'enum',
  safeType: 'enum',
  couponPeriodicity: 'enum',
  repaymentModality: 'enum',
  termDuration: 'enum',
  fundType: 'enum',
  propertyType: 'enum',
  // Plain counts
  sharesAcquired: 'number',
  enjoymentDelayMonths: 'number',
  surfaceSqm: 'number',
  warrantsCount: 'number',
  // Year (no thousands grouping)
  vintageYear: 'year',
  // Free text
  bankName: 'text',
  managementCompany: 'text',
  underlyingTarget: 'text',
  spvName: 'text',
  location: 'text',
}

/**
 * Display unit per format, shown as a trailing suffix next to inputs (edit
 * dialog) and values (panels). Symbols, not translatable copy — generic by
 * format, never coded field-by-field. Formats without a unit are omitted.
 */
export const FORMAT_UNIT: Partial<Record<FieldFormat, string>> = {
  eur: '€',
  pct: '%',
  decimal: '×',
}

/**
 * Marker column splitting a SAFE field list into pre/post-conversion. Its
 * presence in INSTRUMENT_FIELDS[kind] identifies the SAFE two-state config;
 * everything from this column onwards is post-conversion (the split is read
 * from the mapping order — no hardcoded field list here).
 */
const SAFE_SPLIT_FIELD = 'conversionValuation'

/**
 * Minimal shape a custom panel needs from a deal's transactions: the dated,
 * signed cash flows (the royalty panel uses them for the realized bar, CoC and
 * TRI). Structurally a subset of `transactions.listByDeal`'s rows.
 */
export type PanelTransaction = {
  direction: 'in' | 'out'
  amount: number
  transactionDate: number
}

/**
 * Props every custom panel receives. `received` (inbound transactions sum) and
 * `transactions` (the dated flows, for realized indicators) are threaded from
 * the page. The instrument's stored parameters are NOT a panel's job — they
 * live in `InstrumentDetails`, in the side panel.
 */
export type CustomPanelProps = {
  deal: Doc<'deals'>
  received?: number
  transactions?: Array<PanelTransaction>
}

/**
 * instrumentKind → custom panel, for the 'custom'-rendered kinds. A kind with
 * render='custom' but no entry here falls back to a neutral placeholder. This
 * is the routing point for custom panels — add a line per future panel,
 * nothing else.
 */
const CUSTOM_PANELS: Partial<
  Record<InstrumentKind, ComponentType<CustomPanelProps>>
> = {
  lead_spv: LeadSpvPanel,
  royalty: RoyaltiesPanel,
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
      {text}
    </div>
  )
}

/** Placement (crypto / capitalization_account): latent gain, front-only. */
function LatentGain({ deal }: { deal: Doc<'deals'> }) {
  const { t } = useTranslation('participations')
  const { fmtEur } = useFormatters()
  // Cost basis = the invested amount (committedAmount). Fallback to the legacy
  // paidAmount for older placements that only carried that field.
  const gain =
    (deal.currentValue ?? 0) - (deal.committedAmount ?? deal.paidAmount ?? 0)
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <span className="text-muted-foreground text-sm">
        {t('fiche.placement.latentGain')}
      </span>
      <span className={cn('text-base font-semibold tabular-nums', signTone(gain))}>
        {gain > 0 ? '+' : ''}
        {fmtEur(gain)}
      </span>
    </div>
  )
}

function FieldsView({
  deal,
  instrumentKind,
  archetype,
  formatField,
  editable,
}: {
  deal: Doc<'deals'>
  instrumentKind: InstrumentKind
  archetype: Archetype
  formatField: (field: string) => string
  editable?: boolean
}) {
  const { t } = useTranslation('participations')
  const updateDeal = useConvexMutation(api.deals.update)
  const fields = INSTRUMENT_FIELDS[instrumentKind] ?? []
  const splitIdx = fields.indexOf(SAFE_SPLIT_FIELD)
  const isSafe = splitIdx >= 0

  // Default conversion state derived from the presence of post-conversion
  // data: filled `conversionValuation` ⇒ post, otherwise pre.
  const [post, setPost] = useState(deal.conversionValuation != null)

  const visible = isSafe ? (post ? fields : fields.slice(0, splitIdx)) : fields

  // Inline save: one-field patch on the shared `deals.update` mutation (same
  // path as the edit dialog, so the field is marked manually edited and the
  // Airtable re-import leaves it untouched).
  async function saveField(field: string, parsed: number | string) {
    try {
      await updateDeal({ id: deal._id, patch: { [field]: parsed } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  return (
    <div className="space-y-4">
      {isSafe && (
        <Tabs value={post ? 'post' : 'pre'} onValueChange={(v) => setPost(v === 'post')}>
          <TabsList>
            <TabsTrigger value="pre">{t('fiche.safe.pre')}</TabsTrigger>
            <TabsTrigger value="post">{t('fiche.safe.post')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Rows, not a grid: the side panel is 320px wide, so label left / value
          right with a hairline between is what keeps long labels on one line
          (same shape as the company identity panel). */}
      <div className="flex flex-col">
        {visible.map((field) => {
          const label = t(`field.${field}`, { defaultValue: field })
          if (!editable) {
            return (
              <IdentityField
                key={field}
                label={label}
                value={formatField(field)}
              />
            )
          }
          const format = FIELD_FORMAT[field] ?? 'text'
          return (
            <InlineField
              key={field}
              layout="row"
              label={label}
              format={format}
              rawValue={(deal as Record<string, unknown>)[field]}
              display={formatField(field)}
              unit={FORMAT_UNIT[format]}
              enumOptions={
                format === 'enum' ? ENUM_FIELD_VALUES[field] : undefined
              }
              renderEnumLabel={(opt) =>
                t(`enum.${field}.${opt}`, { defaultValue: opt })
              }
              selectPlaceholder={t('edit.selectPlaceholder')}
              ariaLabel={t('edit.inlineLabel', { field: label })}
              onCommit={(parsed) => saveField(field, parsed)}
            />
          )
        })}
      </div>

      {archetype === 'placement' && deal.currentValue != null && (
        <LatentGain deal={deal} />
      )}
    </div>
  )
}

export function InstrumentDetails({
  deal,
  instrumentKind,
  editable,
}: {
  deal: Doc<'deals'>
  instrumentKind: InstrumentKind
  // Inline-edit the fields. Off while previewing a different instrument type
  // (the shown fields wouldn't match the saved type).
  editable?: boolean
}) {
  const { t, i18n } = useTranslation('participations')
  const lang = i18n.language
  const { fmtEur, fmtDate } = useFormatters()

  const fmtPct = (bps: number) =>
    new Intl.NumberFormat(lang, {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(bps / 10000)
  const fmtNum = (n: number) => new Intl.NumberFormat(lang).format(n)

  const formatField = (field: string): string => {
    const raw = (deal as Record<string, unknown>)[field]
    if (raw == null || raw === '') return '—'
    switch (FIELD_FORMAT[field] ?? 'text') {
      case 'eur':
        return fmtEur(raw as number)
      case 'pct':
        return fmtPct(raw as number)
      case 'date':
        return fmtDate(raw as number)
      case 'enum':
        return t(`enum.${field}.${String(raw)}`, { defaultValue: String(raw) })
      case 'number':
      case 'decimal':
        return fmtNum(raw as number)
      default:
        return String(raw)
    }
  }

  // 'placeholder' kinds (cto, unknown) carry no field config at all — the
  // neutral block stands in until their layout is modelled. Every other kind,
  // custom-rendered or not, has parameters to show here.
  if (INSTRUMENT_RENDER[instrumentKind] === 'placeholder') {
    return <Placeholder text={t('fiche.cto.placeholder')} />
  }

  return (
    <FieldsView
      deal={deal}
      instrumentKind={instrumentKind}
      archetype={INSTRUMENT_ARCHETYPE[instrumentKind]}
      formatField={formatField}
      editable={editable}
    />
  )
}

/**
 * Bespoke body of a `render: 'custom'` instrument, in the sheet's main column
 * (royalty projection table, lead-SPV collected tile). Renders nothing for the
 * other kinds: their content is entirely the side panel's field rows.
 */
export function InstrumentPanel({
  deal,
  instrumentKind,
  received,
  transactions,
}: {
  deal: Doc<'deals'>
  instrumentKind: InstrumentKind
  received?: number
  transactions?: Array<PanelTransaction>
}) {
  if (INSTRUMENT_RENDER[instrumentKind] !== 'custom') return null
  // render='custom' but no panel registered yet — nothing to show (none today:
  // lead_spv + royalty both have panels).
  const Panel = CUSTOM_PANELS[instrumentKind]
  if (!Panel) return null
  return <Panel deal={deal} received={received} transactions={transactions} />
}
