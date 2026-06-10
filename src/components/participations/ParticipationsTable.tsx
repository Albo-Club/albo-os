import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronRight,
  Download,
} from 'lucide-react'
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
import {
  PAGE_SIZE,
  PaginationFooter,
  usePagination,
} from '~/components/data-table/LocalPagination'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { downloadCsv, toCsv } from '~/lib/csv'
import { normalizeSearch } from '~/lib/searchText'

/** Forme minimale d'un deal enrichi, commune aux vues par-org et agrégée. */
export type DealRow = {
  _id: string
  targetCompanyId: string
  /** Nom personnalisé — affiché à la place du titre dérivé quand présent. */
  name?: string | null
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
  /** Dernière valorisation connue (cents), null si aucune (calculé serveur). */
  lastValuationCents?: number | null
  signedDate?: number | null
  org?: { name: string; slug: string } | null // présent en vue agrégée
}

/**
 * Valeur résiduelle d'un deal pour le TVPI : 0 si sorti/passé en perte,
 * sinon dernière valo connue, à défaut le coût (convention du dashboard —
 * convex/dashboard.ts NAV).
 */
function residualCents(deal: DealRow): number {
  if (deal.status === 'fully_exited' || deal.status === 'written_off') return 0
  return deal.lastValuationCents ?? deal.paidActual ?? 0
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

/** Formateurs €/date/multiple localisés, partagés par les composants ci-dessous. */
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
  const fmtMultiple = (ratio: number | null) =>
    ratio == null
      ? '—'
      : `${new Intl.NumberFormat(lang, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(ratio)}×`
  return { fmtEur, fmtDate, fmtMultiple }
}

/**
 * Titre d'affichage d'un deal : `nom personnalisé · instrument` si un nom
 * existe, sinon le libellé (i18n) de l'instrument seul.
 * `withInstrument: false` n'affiche que le nom (ex. page détail du deal, où
 * l'instrument est déjà dans la grille d'infos).
 */
export function useDealTitle() {
  const { t } = useTranslation('participations')
  return (
    deal: { name?: string | null; instrumentKind: string },
    opts?: { withInstrument?: boolean },
  ) => {
    const instrument = t(`instrument.${deal.instrumentKind}`, {
      defaultValue: deal.instrumentKind,
    })
    if (!deal.name) return instrument
    return opts?.withInstrument === false
      ? deal.name
      : `${deal.name} · ${instrument}`
  }
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
  const { fmtEur, fmtDate, fmtMultiple } = useFormatters()
  const dealTitle = useDealTitle()
  const cellClass =
    'grid grid-cols-2 gap-x-6 gap-y-1 px-6 py-3 text-sm sm:grid-cols-5'
  return (
    <div className="divide-y">
      {deals.map((dl) => {
        const paid = dl.paidActual ?? 0
        const tvpi =
          paid > 0 ? ((dl.received ?? 0) + residualCents(dl)) / paid : null
        const body = (
          <>
            <Field label={t('deal.instrument')}>{dealTitle(dl)}</Field>
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
            <Field label={t('deal.tvpi')}>{fmtMultiple(tvpi)}</Field>
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
type SortKey = 'name' | 'committed' | 'paid' | 'received' | 'tvpi'

/** Entête cliquable de colonne triable (asc ⇄ desc). */
function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  className?: string
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {label}
        <Icon className={`size-3.5 ${active ? '' : 'opacity-40'}`} />
      </button>
    </TableHead>
  )
}

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
  const { fmtEur, fmtMultiple } = useFormatters()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Recherche client (volumes faibles) : nom de société, nom personnalisé du
  // deal, instrument (clé brute + libellé traduit), investisseur, secteur —
  // insensible casse/accents.
  const [search, setSearch] = useState('')
  const term = normalizeSearch(useDebouncedValue(search))

  const filtered = useMemo(() => {
    if (!deals || !term) return deals
    return deals.filter((d) =>
      [
        d.target?.name,
        d.name,
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
        residual: number
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
        residual: 0,
      }
      g.deals.push(d)
      if (d.org) g.orgs.add(d.org.name)
      g.committed += d.committedAmount ?? 0
      g.paid += d.paidActual ?? 0
      g.received += d.received ?? 0
      g.residual += residualCents(d)
      map.set(key, g)
    }
    return Array.from(map.entries()).map(([id, g]) => ({
      id,
      ...g,
      tvpi: g.paid > 0 ? (g.received + g.residual) / g.paid : null,
    }))
  }, [filtered, orgSlug])

  // Tri par colonne (client, volumes faibles). null = ordre serveur
  // (signedDate desc). Les TVPI absents passent en fin de liste.
  const [sort, setSort] = useState<{
    key: SortKey
    dir: 'asc' | 'desc'
  } | null>(null)
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )
  const sortedGroups = useMemo(() => {
    if (!groups || !sort) return groups
    const value = (g: NonNullable<typeof groups>[number]) =>
      sort.key === 'name'
        ? g.name
        : sort.key === 'tvpi'
          ? (g.tvpi ?? Number.NEGATIVE_INFINITY)
          : g[sort.key]
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...groups].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      if (typeof va === 'string' && typeof vb === 'string') {
        return sign * va.localeCompare(vb)
      }
      return sign * (Number(va) - Number(vb))
    })
  }, [groups, sort])

  // Pagination locale (par société, après filtre + tri) ; retour page 1 dès
  // que la recherche ou le tri change.
  const { page, pageCount, setPage } = usePagination(
    sortedGroups?.length ?? 0,
    `${term}:${sort ? `${sort.key}:${sort.dir}` : ''}`,
  )
  const pagedGroups = sortedGroups?.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  )

  // Export CSV des deals filtrés (à plat, un deal par ligne).
  function handleExport() {
    if (!filtered) return
    const headers = [
      t('col.company'),
      t('export.col.deal'),
      t('deal.instrument'),
      t('deal.investor'),
      t('deal.status'),
      t('col.committed'),
      t('col.paid'),
      t('col.received'),
      t('export.col.lastValuation'),
      t('col.tvpi'),
      t('deal.signed'),
    ]
    const euros = (cents?: number | null) =>
      cents == null ? null : (cents / 100).toFixed(2)
    const rows = filtered.map((d) => {
      const paid = d.paidActual ?? 0
      const tvpi =
        paid > 0 ? ((d.received ?? 0) + residualCents(d)) / paid : null
      return [
        d.target?.name ?? '',
        d.name ?? '',
        t(`instrument.${d.instrumentKind}`, {
          defaultValue: d.instrumentKind,
        }),
        d.investor?.name ?? '',
        t(`status.${d.status}`, { defaultValue: d.status }),
        euros(d.committedAmount),
        euros(d.paidActual ?? 0),
        euros(d.received ?? 0),
        euros(d.lastValuationCents),
        tvpi == null ? null : tvpi.toFixed(2),
        d.signedDate ? new Date(d.signedDate).toISOString().slice(0, 10) : null,
      ]
    })
    const day = new Date().toISOString().slice(0, 10)
    downloadCsv(`participations-${day}.csv`, toCsv(headers, rows))
  }

  const colSpan = showOrg ? 7 : 6

  // Barre de recherche affichée dès qu'il y a des deals — y compris quand la
  // recherche courante ne matche rien (sinon impossible de l'effacer).
  const searchBar = deals && deals.length > 0 && (
    <div className="flex items-center justify-between gap-3">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('search.placeholder')}
        className="max-w-sm"
      />
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="size-4" />
        {t('export.button')}
      </Button>
    </div>
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
              <SortableHead
                label={t('col.company')}
                active={sort?.key === 'name'}
                dir={sort?.dir ?? 'asc'}
                onClick={() => toggleSort('name')}
              />
              {showOrg && <TableHead>{t('col.org')}</TableHead>}
              <TableHead className="text-right">{t('col.deals')}</TableHead>
              <SortableHead
                label={t('col.committed')}
                active={sort?.key === 'committed'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('committed')}
                className="text-right"
              />
              <SortableHead
                label={t('col.paid')}
                active={sort?.key === 'paid'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('paid')}
                className="text-right"
              />
              <SortableHead
                label={t('col.received')}
                active={sort?.key === 'received'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('received')}
                className="text-right"
              />
              <SortableHead
                label={t('col.tvpi')}
                active={sort?.key === 'tvpi'}
                dir={sort?.dir ?? 'desc'}
                onClick={() => toggleSort('tvpi')}
                className="text-right"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!pagedGroups ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="text-muted-foreground text-center"
                >
                  {t('loading')}
                </TableCell>
              </TableRow>
            ) : (
              pagedGroups.map((g) => {
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
                    fmtMultiple={fmtMultiple}
                  />
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
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
  fmtMultiple,
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
    tvpi: number | null
  }
  isOpen: boolean
  onToggle: () => void
  showOrg: boolean
  colSpan: number
  fmtEur: (c?: number | null) => string
  fmtMultiple: (ratio: number | null) => string
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
        <TableCell className="text-right tabular-nums">
          {fmtMultiple(group.tvpi)}
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
