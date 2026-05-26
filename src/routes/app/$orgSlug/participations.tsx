import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../../convex/_generated/api'
import type { ReactNode } from 'react'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
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

type Scope = 'all' | 'albo' | 'calte'
const SCOPES: ReadonlyArray<Scope> = ['all', 'albo', 'calte']

export const Route = createFileRoute('/app/$orgSlug/participations')({
  component: Participations,
  validateSearch: (search: Record<string, unknown>): { scope: Scope } => {
    const s = search.scope
    return { scope: s === 'albo' || s === 'calte' ? s : 'all' }
  },
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('metaTitle'),
      },
    ],
  }),
})

function Participations() {
  const { t, i18n } = useTranslation('participations')
  const lang = i18n.language
  const { orgSlug } = Route.useParams()
  const { scope } = Route.useSearch()
  const navigate = Route.useNavigate()

  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const deals = useConvexQuery(
    api.deals.list,
    org
      ? { orgId: org._id, scope: scope === 'all' ? undefined : scope }
      : 'skip',
  )

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

  // Regroupe les deals par société cible (vue par société).
  const groups = useMemo(() => {
    if (!deals) return undefined
    const map = new Map<
      string,
      {
        name: string
        scopes: Set<string>
        deals: typeof deals
        committed: number
        paid: number
      }
    >()
    for (const d of deals) {
      const key = d.target?._id ?? d.targetCompanyId
      const name = d.target?.name ?? '—'
      const g =
        map.get(key) ??
        { name, scopes: new Set<string>(), deals: [], committed: 0, paid: 0 }
      g.deals.push(d)
      g.scopes.add(d.holdingScope)
      g.committed += d.committedAmount ?? 0
      g.paid += d.paidAmount ?? 0
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({ id, ...g }))
  }, [deals])

  const statusVariant = (s: string) =>
    s === 'written_off'
      ? 'destructive'
      : s === 'active'
        ? 'default'
        : 'secondary'

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          {scope === 'all' && (
            <p className="text-muted-foreground text-sm">
              {t('consolidatedNote')}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {SCOPES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={scope === s ? 'default' : 'outline'}
              onClick={() => void navigate({ search: { scope: s } })}
            >
              {t(`scope.${s}`)}
            </Button>
          ))}
        </div>
      </div>

      {groups && groups.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {t('empty')}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.company')}</TableHead>
                <TableHead>{t('col.scope')}</TableHead>
                <TableHead className="text-right">{t('col.deals')}</TableHead>
                <TableHead className="text-right">
                  {t('col.committed')}
                </TableHead>
                <TableHead className="text-right">{t('col.paid')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!groups ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
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
                      fmtEur={fmtEur}
                      fmtDate={fmtDate}
                      statusVariant={statusVariant}
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  )
}

type Group = {
  id: string
  name: string
  scopes: Set<string>
  deals: Array<{
    _id: string
    instrumentKind: string
    holdingScope: string
    status: string
    committedAmount?: number | null
    paidAmount?: number | null
    signedDate?: number | null
    investor: { name: string } | null
    spv: { name: string } | null
  }>
  committed: number
  paid: number
}

function CompanyRows({
  group,
  isOpen,
  onToggle,
  fmtEur,
  fmtDate,
  statusVariant,
}: {
  group: Group
  isOpen: boolean
  onToggle: () => void
  fmtEur: (c?: number | null) => string
  fmtDate: (m?: number | null) => string
  statusVariant: (s: string) => 'default' | 'secondary' | 'destructive'
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
        <TableCell>
          <span className="flex gap-1">
            {Array.from(group.scopes).map((s) => (
              <Badge key={s} variant="outline" className="capitalize">
                {t(`scope.${s}`)}
              </Badge>
            ))}
          </span>
        </TableCell>
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
          <TableCell colSpan={5} className="bg-muted/30 p-0">
            <div className="divide-y">
              {group.deals.map((d) => (
                <div
                  key={d._id}
                  className="grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-3 text-sm sm:grid-cols-5"
                >
                  <Field label={t('deal.instrument')}>
                    {t(`instrument.${d.instrumentKind}`, {
                      defaultValue: d.instrumentKind,
                    })}
                  </Field>
                  <Field label={t('deal.investor')}>
                    {d.investor?.name ?? '—'}
                    {d.spv ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {t('deal.viaSpv')} {d.spv.name}
                      </span>
                    ) : null}
                  </Field>
                  <Field label={t('deal.committed')}>
                    {fmtEur(d.committedAmount)}
                  </Field>
                  <Field label={t('deal.paid')}>{fmtEur(d.paidAmount)}</Field>
                  <Field label={t('deal.status')}>
                    <Badge variant={statusVariant(d.status)}>
                      {t(`status.${d.status}`, { defaultValue: d.status })}
                    </Badge>
                  </Field>
                  <Field label={t('deal.signed')}>
                    {fmtDate(d.signedDate)}
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

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  )
}
