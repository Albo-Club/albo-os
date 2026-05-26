import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Forme minimale d'un deal enrichi, commune aux vues par-org et agrégée. */
export type DealRow = {
  _id: string
  targetCompanyId: string
  target: { _id: string; name: string } | null
  investor: { name: string } | null
  spv: { name: string } | null
  instrumentKind: string
  status: string
  committedAmount?: number | null
  paidAmount?: number | null
  signedDate?: number | null
  org?: { name: string } | null // présent en vue agrégée
}

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (s === 'written_off') return 'destructive'
  if (s === 'active') return 'default'
  return 'secondary'
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  )
}

/**
 * Table des participations regroupée PAR SOCIÉTÉ (une ligne = une boîte,
 * dépliable → ses deals). `showOrg` ajoute une colonne de badges d'org
 * (vue agrégée cross-org).
 */
export function ParticipationsTable({
  deals,
  showOrg = false,
}: {
  deals: Array<DealRow> | undefined
  showOrg?: boolean
}) {
  const { t, i18n } = useTranslation('participations')
  const lang = i18n.language
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const fmtEur = (cents?: number | null) =>
    cents == null
      ? '—'
      : new Intl.NumberFormat(lang, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(cents / 100)
  const fmtDate = (ms?: number | null) =>
    ms == null
      ? '—'
      : new Date(ms).toLocaleDateString(lang, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })

  const groups = useMemo(() => {
    if (!deals) return undefined
    const map = new Map<
      string,
      {
        name: string
        orgs: Set<string>
        deals: Array<DealRow>
        committed: number
        paid: number
      }
    >()
    for (const d of deals) {
      const key = d.target?._id ?? d.targetCompanyId
      const g = map.get(key) ?? {
        name: d.target?.name ?? '—',
        orgs: new Set<string>(),
        deals: [],
        committed: 0,
        paid: 0,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      g.committed += d.committedAmount ?? 0
      g.paid += d.paidAmount ?? 0
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({ id, ...g }))
  }, [deals])

  const colSpan = showOrg ? 5 : 4

  if (groups && groups.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        {t('empty')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.company')}</TableHead>
            {showOrg && <TableHead>{t('col.org')}</TableHead>}
            <TableHead className="text-right">{t('col.deals')}</TableHead>
            <TableHead className="text-right">{t('col.committed')}</TableHead>
            <TableHead className="text-right">{t('col.paid')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!groups ? (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="text-muted-foreground text-center"
              >
                {t('loading')}
              </TableCell>
            </TableRow>
          ) : (
            groups.map((g) => {
              const isOpen = expanded.has(g.id)
              return (
                <CompanyRows
                  key={g.id}
                  group={g}
                  isOpen={isOpen}
                  onToggle={() => toggle(g.id)}
                  showOrg={showOrg}
                  colSpan={colSpan}
                  fmtEur={fmtEur}
                  fmtDate={fmtDate}
                />
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function CompanyRows({
  group,
  isOpen,
  onToggle,
  showOrg,
  colSpan,
  fmtEur,
  fmtDate,
}: {
  group: {
    id: string
    name: string
    orgs: Set<string>
    deals: Array<DealRow>
    committed: number
    paid: number
  }
  isOpen: boolean
  onToggle: () => void
  showOrg: boolean
  colSpan: number
  fmtEur: (c?: number | null) => string
  fmtDate: (m?: number | null) => string
}) {
  const { t } = useTranslation('participations')
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="font-medium">
          <span className="flex items-center gap-2">
            <ChevronRight
              className={`text-muted-foreground size-4 transition-transform ${
                isOpen ? 'rotate-90' : ''
              }`}
            />
            {group.name}
          </span>
        </TableCell>
        {showOrg && (
          <TableCell>
            <span className="flex flex-wrap gap-1">
              {Array.from(group.orgs).map((o) => (
                <Badge key={o} variant="outline">
                  {o}
                </Badge>
              ))}
            </span>
          </TableCell>
        )}
        <TableCell className="text-right tabular-nums">
          {t('dealsCount', { count: group.deals.length })}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {fmtEur(group.committed)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {fmtEur(group.paid)}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/30 p-0">
            <div className="divide-y">
              {group.deals.map((dl) => (
                <div
                  key={dl._id}
                  className="grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-3 text-sm sm:grid-cols-5"
                >
                  <Field label={t('deal.instrument')}>
                    {t(`instrument.${dl.instrumentKind}`, {
                      defaultValue: dl.instrumentKind,
                    })}
                  </Field>
                  <Field label={t('deal.investor')}>
                    {dl.investor?.name ?? '—'}
                    {dl.spv ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {t('deal.viaSpv')} {dl.spv.name}
                      </span>
                    ) : null}
                  </Field>
                  <Field label={t('deal.committed')}>
                    {fmtEur(dl.committedAmount)}
                  </Field>
                  <Field label={t('deal.paid')}>{fmtEur(dl.paidAmount)}</Field>
                  <Field label={t('deal.status')}>
                    <Badge variant={statusVariant(dl.status)}>
                      {t(`status.${dl.status}`, { defaultValue: dl.status })}
                    </Badge>
                  </Field>
                  <Field label={t('deal.signed')}>
                    {fmtDate(dl.signedDate)}
                  </Field>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
