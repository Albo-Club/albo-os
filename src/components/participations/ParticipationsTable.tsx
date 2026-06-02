import { useMemo, useState } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { normalizeSearch } from '~/lib/searchText'

/** Forme minimale d'un deal enrichi, commune aux vues par-org et agrégée. */
export type DealRow = {
  _id: string
  targetCompanyId: string
  target: { _id: string; name: string; sector?: string | null } | null
  investor: { name: string } | null
  spv: { name: string } | null
  instrumentKind: string
  status: string
  committedAmount?: number | null
  /** Versé : somme des transactions sortantes rattachées (calculé serveur). */
  paidActual?: number | null
  /** Reçu : somme des transactions entrantes rattachées (calculé serveur). */
  received?: number | null
  signedDate?: number | null
  org?: { name: string; slug: string } | null // présent en vue agrégée
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

/** Formateurs €/date localisés, partagés par les composants ci-dessous. */
export function useFormatters() {
  const { i18n } = useTranslation('participations')
  const lang = i18n.language
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
  return { fmtEur, fmtDate }
}

/**
 * Liste détaillée de deals (un bloc par deal). Réutilisée par l'accordéon
 * de la table par-société et par la page détail d'une participation.
 */
export function DealsList({
  deals,
  orgSlug,
}: {
  deals: Array<DealRow>
  orgSlug?: string
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtDate } = useFormatters()
  const cellClass =
    'grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-3 text-sm sm:grid-cols-5'
  return (
    <div className="divide-y">
      {deals.map((dl) => {
        const body = (
          <>
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
            <Field label={t('deal.paid')}>{fmtEur(dl.paidActual ?? 0)}</Field>
            <Field label={t('deal.received')}>{fmtEur(dl.received ?? 0)}</Field>
            <Field label={t('deal.status')}>
              <Badge variant={statusVariant(dl.status)}>
                {t(`status.${dl.status}`, { defaultValue: dl.status })}
              </Badge>
            </Field>
            <Field label={t('deal.signed')}>{fmtDate(dl.signedDate)}</Field>
          </>
        )
        return orgSlug ? (
          <Link
            key={dl._id}
            to="/app/$orgSlug/deals/$dealId"
            params={{ orgSlug, dealId: dl._id }}
            className={`${cellClass} hover:bg-accent/60 transition-colors`}
          >
            {body}
          </Link>
        ) : (
          <div key={dl._id} className={cellClass}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Table des participations regroupée PAR SOCIÉTÉ (une ligne = une boîte,
 * dépliable → ses deals). `showOrg` ajoute une colonne de badges d'org
 * (vue agrégée cross-org). `orgSlug` (vue par-org) cible le lien de détail ;
 * en vue agrégée, le slug est dérivé de l'org de chaque deal.
 */
export function ParticipationsTable({
  deals,
  showOrg = false,
  orgSlug,
}: {
  deals: Array<DealRow> | undefined
  showOrg?: boolean
  orgSlug?: string
}) {
  const { t } = useTranslation('participations')
  const { fmtEur } = useFormatters()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Recherche client (volumes faibles) : nom de société, instrument (clé brute
  // + libellé traduit), investisseur, secteur — insensible casse/accents.
  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

  const filtered = useMemo(() => {
    if (!deals || !term) return deals
    return deals.filter((d) =>
      [
        d.target?.name,
        d.target?.sector,
        d.investor?.name,
        d.instrumentKind,
        t(`instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
      ].some((s) => s && normalizeSearch(s).includes(term)),
    )
  }, [deals, term, t])

  const groups = useMemo(() => {
    if (!filtered) return undefined
    const map = new Map<
      string,
      {
        name: string
        orgs: Set<string>
        slug: string | undefined
        deals: Array<DealRow>
        committed: number
        paid: number
        received: number
      }
    >()
    for (const d of filtered) {
      const key = d.target?._id ?? d.targetCompanyId
      const g = map.get(key) ?? {
        name: d.target?.name ?? '—',
        orgs: new Set<string>(),
        slug: orgSlug ?? d.org?.slug,
        deals: [],
        committed: 0,
        paid: 0,
        received: 0,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      g.committed += d.committedAmount ?? 0
      g.paid += d.paidActual ?? 0
      g.received += d.received ?? 0
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({ id, ...g }))
  }, [filtered, orgSlug])

  const colSpan = showOrg ? 6 : 5

  // Barre de recherche affichée dès qu'il y a des deals — y compris quand la
  // recherche courante ne matche rien (sinon impossible de l'effacer).
  const searchBar = deals && deals.length > 0 && (
    <Input
      type="search"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder={t('search.placeholder')}
      className="max-w-sm"
    />
  )

  if (groups && groups.length === 0) {
    return (
      <div className="space-y-3">
        {searchBar}
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {term ? t('search.noResults') : t('empty')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {searchBar}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.company')}</TableHead>
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <TableHead className="text-right">{t('col.deals')}</TableHead>
              <TableHead className="text-right">{t('col.committed')}</TableHead>
              <TableHead className="text-right">{t('col.paid')}</TableHead>
              <TableHead className="text-right">{t('col.received')}</TableHead>
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
                  />
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
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
}: {
  group: {
    id: string
    name: string
    orgs: Set<string>
    slug: string | undefined
    deals: Array<DealRow>
    committed: number
    paid: number
    received: number
  }
  isOpen: boolean
  onToggle: () => void
  showOrg: boolean
  colSpan: number
  fmtEur: (c?: number | null) => string
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
            {group.slug && (
              <Button asChild variant="outline" size="sm" className="ml-2">
                <Link
                  to="/app/$orgSlug/participations/$companyId"
                  params={{ orgSlug: group.slug, companyId: group.id }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArrowUpRight className="size-4" />
                  {t('openDetail')}
                </Link>
              </Button>
            )}
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
        <TableCell className="text-right tabular-nums">
          {fmtEur(group.received)}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/30 p-0">
            <DealsList deals={group.deals} orgSlug={group.slug} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
