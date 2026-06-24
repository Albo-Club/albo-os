import { Fragment } from 'react'
import { Link, useLocation, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../convex/_generated/api'
import { ThemeToggle } from './ThemeToggle'
import type { TFunction } from 'i18next'

import type { Id } from '../../../convex/_generated/dataModel'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { SidebarTrigger } from '~/components/ui/sidebar'
import { UserButton } from '~/components/auth/user-button'
import { useDealTitle } from '~/components/participations/ParticipationsTable'

type Crumb = { label: string; href?: string }

/** Minimal deal shape the deal-page breadcrumb needs (from `deals.getById`). */
type DealCrumbData = {
  name?: string | null
  instrumentKind: string
  target: { _id: string; name: string } | null
}

const CRUMB_SEGMENTS = [
  'participations',
  'cash',
  'pointage',
  'passif',
  'settings',
  'members',
  'invitations',
  'general',
  'changelog',
] as const

function buildCrumbs(
  pathname: string,
  orgSlug: string,
  orgName: string,
  t: TFunction<['nav']>,
): Array<Crumb> {
  const base = `/app/${orgSlug}`
  const tail = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, '')
    : ''
  const segments = tail ? tail.split('/') : []
  const crumbs: Array<Crumb> = [{ label: orgName, href: base }]
  let acc = base
  for (let i = 0; i < segments.length; i += 1) {
    acc += `/${segments[i]}`
    const segment = segments[i]
    const label = (CRUMB_SEGMENTS as ReadonlyArray<string>).includes(segment)
      ? t(`nav:appShell.breadcrumb.${segment}`)
      : segment.charAt(0).toUpperCase() + segment.slice(1)
    crumbs.push({
      label,
      href: i === segments.length - 1 ? undefined : acc,
    })
  }
  return crumbs
}

/**
 * Breadcrumb for the deal sheet (`/app/$orgSlug/deals/$dealId`). The generic
 * builder would emit a dead "Deals" crumb (no `/app/$orgSlug/deals` route) and
 * a raw Convex id as the leaf, so this route is handled on its own:
 * `Org › Companies › <company> › <deal>`. The "Companies" label reuses the
 * existing `nav:appShell.breadcrumb.participations` key. While the deal is
 * loading or not found (`deal` undefined) we stop at the Companies crumb — never
 * a raw id, never a broken entity link, in any state. A deal with no target
 * degrades to `Org › Companies › <deal>`.
 */
function buildDealCrumbs(
  orgSlug: string,
  orgName: string,
  t: TFunction<['nav']>,
  deal: DealCrumbData | undefined,
  dealTitle: (
    deal: { name?: string | null; instrumentKind: string },
    opts?: { withInstrument?: boolean },
  ) => string,
): Array<Crumb> {
  const base = `/app/${orgSlug}`
  const companiesLabel = t('nav:appShell.breadcrumb.participations')
  const crumbs: Array<Crumb> = [{ label: orgName, href: base }]
  if (!deal) {
    crumbs.push({ label: companiesLabel })
    return crumbs
  }
  crumbs.push({ label: companiesLabel, href: `${base}/participations` })
  if (deal.target) {
    crumbs.push({
      label: deal.target.name,
      href: `${base}/participations/${deal.target._id}`,
    })
  }
  crumbs.push({ label: dealTitle(deal, { withInstrument: false }) })
  return crumbs
}

/**
 * Breadcrumb for the company sheet (`/app/$orgSlug/participations/$companyId`).
 * The generic builder would emit a raw Convex id as the leaf, so this route is
 * handled on its own: `Org › Companies › <company>`. The "Companies" label
 * reuses the existing `nav:appShell.breadcrumb.participations` key. While the
 * company is loading or not found (`company` undefined) we stop at the Companies
 * crumb — never a raw id, in any state.
 */
function buildCompanyCrumbs(
  orgSlug: string,
  orgName: string,
  t: TFunction<['nav']>,
  company: { name: string } | undefined,
): Array<Crumb> {
  const base = `/app/${orgSlug}`
  const companiesLabel = t('nav:appShell.breadcrumb.participations')
  const crumbs: Array<Crumb> = [{ label: orgName, href: base }]
  if (!company) {
    crumbs.push({ label: companiesLabel })
    return crumbs
  }
  crumbs.push({ label: companiesLabel, href: `${base}/participations` })
  crumbs.push({ label: company.name })
  return crumbs
}

export function AppHeader({
  orgSlug,
  orgName,
  aiPanelOpen,
  onToggleAiPanel,
}: {
  orgSlug: string
  orgName: string
  aiPanelOpen?: boolean
  onToggleAiPanel?: () => void
}) {
  const location = useLocation()
  const { t } = useTranslation(['nav'])
  // Deal sheet gets a bespoke breadcrumb (Org › Companies › company › deal).
  // `strict: false` reads `dealId` from whichever route matched (undefined off
  // the deal route). `useQuery(convexQuery(...))` is used over `useConvexQuery`
  // on purpose: it surfaces errors via state instead of throwing, so an invalid
  // dealId can't crash this shared header through the parent route boundary.
  const params = useParams({ strict: false })
  const dealId = typeof params.dealId === 'string' ? params.dealId : undefined
  const { data: deal } = useQuery({
    ...convexQuery(api.deals.getById, { id: (dealId ?? '') as Id<'deals'> }),
    enabled: dealId != null,
  })
  // Company sheet gets the same bespoke treatment (Org › Companies › company):
  // same non-throwing query so an invalid companyId degrades the breadcrumb
  // instead of crashing this shared header through the parent route boundary.
  const companyId =
    typeof params.companyId === 'string' ? params.companyId : undefined
  const { data: company } = useQuery({
    ...convexQuery(api.companies.getById, {
      id: (companyId ?? '') as Id<'companies'>,
    }),
    enabled: companyId != null,
  })
  const dealTitle = useDealTitle()
  const crumbs =
    dealId != null
      ? buildDealCrumbs(orgSlug, orgName, t, deal, dealTitle)
      : companyId != null
        ? buildCompanyCrumbs(orgSlug, orgName, t, company)
        : buildCrumbs(location.pathname, orgSlug, orgName, t)

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, i) => (
            <Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbItem className={i === 0 ? 'hidden md:block' : ''}>
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {i < crumbs.length - 1 && (
                <BreadcrumbSeparator
                  className={i === 0 ? 'hidden md:block' : ''}
                />
              )}
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        {onToggleAiPanel && (
          <Button
            variant={aiPanelOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleAiPanel}
            aria-pressed={aiPanelOpen}
            title={t('nav:appShell.aiShortcut')}
          >
            <Sparkles className="mr-1.5 size-4" />
            {t('nav:appShell.ai')}
          </Button>
        )}
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
  )
}
