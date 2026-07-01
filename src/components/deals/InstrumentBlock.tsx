import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  INSTRUMENT_ARCHETYPE,
  INSTRUMENT_FIELDS,
  INSTRUMENT_RENDER,
} from '../../../convex/lib/instrumentMapping'
import type { ComponentType, ReactNode } from 'react'
import type { Archetype } from '../../../convex/lib/instrumentMapping'
import type { InstrumentKind } from '../../../convex/lib/instruments'
import type { Doc } from '../../../convex/_generated/dataModel'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { LeadSpvPanel } from '~/components/deals/LeadSpvPanel'
import { RoyaltiesPanel } from '~/components/deals/RoyaltiesPanel'
import { signTone } from '~/lib/moneyTone'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'

/**
 * Read-only central block of the deal sheet, driven by
 * convex/lib/instrumentMapping.ts (single source of truth). The block reads
 * INSTRUMENT_RENDER to pick a render mode, INSTRUMENT_FIELDS for the ordered
 * columns to show, and INSTRUMENT_ARCHETYPE for the colored badge. It NEVER
 * duplicates the instrument→fields mapping.
 *
 * No mutation, no editable field: the parent's instrument selector only
 * previews a layout (cf. deals.$dealId.tsx).
 */

export type FieldFormat =
  | 'eur'
  | 'pct'
  | 'date'
  | 'enum'
  | 'number'
  | 'decimal'
  | 'year'
  | 'text'

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

/** Archetype → tinted badge classes (brand tokens, never raw colors). */
const ARCHETYPE_BADGE: Record<Archetype, string> = {
  equity: 'border-chart-1/40 bg-chart-1/10 text-chart-1',
  debt: 'border-chart-2/40 bg-chart-2/10 text-chart-2',
  funds_lp: 'border-chart-3/40 bg-chart-3/10 text-chart-3',
  real_estate: 'border-chart-4/40 bg-chart-4/10 text-chart-4',
  royalties: 'border-chart-5/40 bg-chart-5/10 text-chart-5',
  // management revenue (fees + carried) reuses the income-green token —
  // it's income, like placement, so the same positive family fits.
  management: 'border-positive/40 bg-positive/10 text-positive',
  placement: 'border-positive/40 bg-positive/10 text-positive',
  unassigned: 'text-muted-foreground',
}

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
 * Props every custom panel receives. `received` (inbound transactions sum),
 * `transactions` (the dated flows, for realized indicators) and `onEdit`
 * (opens the shared deal edit dialog) are threaded from the page. `notesSlot`
 * lets the page inject the deal notes inside the panel (royalty ordering:
 * parameters → notes → realized → table).
 */
export type CustomPanelProps = {
  deal: Doc<'deals'>
  received?: number
  transactions?: Array<PanelTransaction>
  notesSlot?: ReactNode
  onEdit?: () => void
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

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
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
  const gain = (deal.currentValue ?? 0) - (deal.paidAmount ?? 0)
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
}: {
  deal: Doc<'deals'>
  instrumentKind: InstrumentKind
  archetype: Archetype
  formatField: (field: string) => string
}) {
  const { t } = useTranslation('participations')
  const fields = INSTRUMENT_FIELDS[instrumentKind] ?? []
  const splitIdx = fields.indexOf(SAFE_SPLIT_FIELD)
  const isSafe = splitIdx >= 0

  // Default conversion state derived from the presence of post-conversion
  // data: filled `conversionValuation` ⇒ post, otherwise pre.
  const [post, setPost] = useState(deal.conversionValuation != null)

  const visible = isSafe ? (post ? fields : fields.slice(0, splitIdx)) : fields

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

      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
        {visible.map((field) => (
          <FieldRow
            key={field}
            label={t(`field.${field}`, { defaultValue: field })}
            value={formatField(field)}
          />
        ))}
      </div>

      {archetype === 'placement' && deal.currentValue != null && (
        <LatentGain deal={deal} />
      )}
    </div>
  )
}

export function InstrumentBlock({
  deal,
  instrumentKind,
  received,
  transactions,
  notesSlot,
  onEdit,
}: {
  deal: Doc<'deals'>
  instrumentKind: InstrumentKind
  received?: number
  transactions?: Array<PanelTransaction>
  notesSlot?: ReactNode
  onEdit?: () => void
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

  const archetype = INSTRUMENT_ARCHETYPE[instrumentKind]
  const render = INSTRUMENT_RENDER[instrumentKind]

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('fiche.instrumentTitle')}
        </h2>
        <Badge variant="outline" className={cn(ARCHETYPE_BADGE[archetype])}>
          {t(`archetype.${archetype}`)}
        </Badge>
      </div>

      {render === 'custom' ? (
        (() => {
          const Panel = CUSTOM_PANELS[instrumentKind]
          return Panel ? (
            <Panel
              deal={deal}
              received={received}
              transactions={transactions}
              notesSlot={notesSlot}
              onEdit={onEdit}
            />
          ) : (
            // render='custom' but no panel registered yet — neutral fallback
            // (none today: lead_spv + royalty both have panels).
            <Placeholder text={t('fiche.cto.placeholder')} />
          )
        })()
      ) : render === 'placeholder' ? (
        <Placeholder text={t('fiche.cto.placeholder')} />
      ) : (
        <FieldsView
          deal={deal}
          instrumentKind={instrumentKind}
          archetype={archetype}
          formatField={formatField}
        />
      )}
    </section>
  )
}
