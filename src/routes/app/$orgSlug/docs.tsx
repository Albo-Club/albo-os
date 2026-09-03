import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

import { DocsSearchResults } from '~/components/docs/DocsSearchResults'
import { Input } from '~/components/ui/input'
import { docPages } from '~/lib/produitDocs'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/app/$orgSlug/docs')({
  component: DocsLayout,
})

/**
 * Reader for `docs/produit` — what the app can do, feature by feature. The
 * pages are the repo's own markdown, bundled at build time, so the reader
 * cannot drift from the source of truth: it renders it.
 */
function DocsLayout() {
  const { t } = useTranslation('nav')
  const { orgSlug } = Route.useParams()
  const location = useLocation()
  const summaryPath = `/app/${orgSlug}/docs`
  // Local state, no URL param: the search is a way to reach a page, not a
  // page. From 2 characters the hits replace the page; the sidebar stays.
  const [query, setQuery] = useState('')
  const term = query.trim()

  return (
    <main className="flex-1 space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('docsPage.title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('docsPage.subtitle')}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('docsPage.searchPlaceholder')}
            aria-label={t('docsPage.searchPlaceholder')}
            className="pl-8"
          />
        </div>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row">
        <nav className="flex flex-col gap-0.5 lg:sticky lg:top-6 lg:h-fit lg:w-64 lg:shrink-0">
          <Link
            to="/app/$orgSlug/docs"
            params={{ orgSlug }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              location.pathname === summaryPath
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {t('docsPage.summary')}
          </Link>
          {docPages.map((page) => (
            <Link
              key={page.slug}
              to="/app/$orgSlug/docs/$page"
              params={{ orgSlug, page: page.slug }}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                location.pathname === `${summaryPath}/${page.slug}`
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {page.title}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 max-w-3xl flex-1 pb-16">
          {term.length >= 2 ? (
            <DocsSearchResults
              term={term}
              orgSlug={orgSlug}
              onNavigate={() => setQuery('')}
            />
          ) : (
            <Outlet />
          )}
        </div>
      </div>
    </main>
  )
}
