import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  queryTerms,
  searchProductDocs,
  splitByTerms,
} from '../../../convex/lib/productDocs'

/**
 * Hits of the documentation search, rendered in place of the page under
 * `/app/<org>/docs`. Synchronous: the search is a pure function over the
 * bundled pages, no query involved.
 */
export function DocsSearchResults({
  term,
  orgSlug,
  onNavigate,
}: {
  term: string
  orgSlug: string
  /** A hit was clicked — the layout clears the search to reveal the page. */
  onNavigate: () => void
}) {
  const { t } = useTranslation('nav')
  const hits = useMemo(() => searchProductDocs(term), [term])
  const terms = useMemo(() => queryTerms(term), [term])

  if (hits.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('docsPage.searchEmpty')}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {hits.map((hit) => (
        <li key={hit.slug}>
          <Link
            to="/app/$orgSlug/docs/$page"
            params={{ orgSlug, page: hit.slug }}
            onClick={onNavigate}
            className="hover:bg-muted/50 block rounded-md border px-4 py-3 transition-colors"
          >
            <div className="text-sm font-medium">
              {hit.title}
              {hit.heading && (
                <span className="text-muted-foreground font-normal">
                  {' › '}
                  {hit.heading}
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {splitByTerms(hit.excerpt, terms).map((segment, index) =>
                segment.match ? (
                  <mark
                    // Segments are positional runs of one string: the index
                    // is the identity.
                    key={index}
                    className="bg-primary/15 text-foreground rounded-sm"
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
