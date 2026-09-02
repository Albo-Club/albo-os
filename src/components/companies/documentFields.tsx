import { useTranslation } from 'react-i18next'

import type { api } from '../../../convex/_generated/api'
import type { FunctionArgs } from 'convex/server'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/**
 * The pieces the company documents surface shares between its list and its
 * correction dialog: the kind vocabulary, the date conversions, the kind
 * select. Filing a document asks for none of them (`AddFilesDialog`) — they
 * only serve reading and correcting.
 */

/** Kinds offered on an entity, then the deal-specific ones. `other` sits in
 * the first group only — it is the same value in the schema. */
const COMPANY_KINDS = ['reporting', 'bp', 'legal', 'other'] as const
const DEAL_KINDS = [
  'term_sheet',
  'pacte',
  'subscription',
  'attestation',
] as const

/** Display order of the kinds, used by the filters and the sheet's groups. */
export const KIND_ORDER = [
  ...COMPANY_KINDS,
  ...DEAL_KINDS,
] as ReadonlyArray<string>

export type DocKind = FunctionArgs<typeof api.documents.create>['kind']

/** Deal kinds carry a document date, entity kinds a covered period. */
export function isDealKind(kind: string): boolean {
  return (DEAL_KINDS as ReadonlyArray<string>).includes(kind)
}

export function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** ms epoch → the value shape of an `<input type="month">` / `"date"`. */
export function toDateInput(period: number, dealKind: boolean): string {
  const date = new Date(period)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  if (!dealKind) return `${date.getUTCFullYear()}-${month}`
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

/** "YYYY-MM" or "YYYY-MM-DD" → ms epoch UTC. Empty clears the field. */
export function fromDateInput(value: string): number | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-')
  return Date.UTC(Number(year), Number(month) - 1, day ? Number(day) : 1)
}

/** The 8 kinds, grouped by what they describe: the entity, or one of its
 * deals. Same list on the add and the edit dialog. */
export function KindSelect({
  value,
  onChange,
  canAnalyse,
}: {
  value: string
  onChange: (value: string) => void
  canAnalyse: boolean
}) {
  const { t } = useTranslation('participations')
  const companyKinds = COMPANY_KINDS.filter(
    (k) => k !== 'reporting' || canAnalyse,
  )

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t('documents.group.company')}</SelectLabel>
          {companyKinds.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`documents.kind.${k}`)}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{t('documents.group.deal')}</SelectLabel>
          {DEAL_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`documents.kind.${k}`)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** A deal's own name, or its instrument when it was never named — same
 * fallback as the deals table, so a deal reads the same everywhere. */
export function useDealLabel() {
  const { t } = useTranslation('participations')
  return (deal: { name?: string | null; instrumentKind: string }) =>
    deal.name ??
    t(`instrument.${deal.instrumentKind}`, {
      defaultValue: deal.instrumentKind,
    })
}
