import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { documentMarkdownComponents } from './markdown'
import type { Components } from 'react-markdown'
import { getDocPage } from '~/lib/produitDocs'

/** `05-deals.md` or `05-deals.md#annuler-un-deal` — a sibling page. */
const SIBLING_PAGE = /^([A-Za-z0-9_-]+)\.md(?:#.*)?$/

/** The one link the folder makes outside itself (`docs/produit/README.md`). */
const CHANGELOG_LINK = '../../CHANGELOG_PRODUIT.md'

/**
 * Renders a page of `docs/produit`, resolving its relative links to in-app
 * routes — the same rewriting `scripts/sync-linear-docs.mjs` does towards
 * Linear, so the folder reads correctly on GitHub, in Linear and here.
 *
 * A link whose target is outside the folder (other than the changelog) keeps
 * its text and loses its target, again like the Linear mirror: pointing a
 * reader at a repo file they cannot open would be worse than plain text.
 */
export function DocMarkdown({
  markdown,
  orgSlug,
}: {
  markdown: string
  orgSlug: string
}) {
  const components: Components = useMemo(
    () => ({
      ...documentMarkdownComponents,
      a: ({ href, children }) => {
        if (href === CHANGELOG_LINK) {
          return (
            <Link
              to="/app/$orgSlug/changelog"
              params={{ orgSlug }}
              className="text-primary underline underline-offset-2"
            >
              {children}
            </Link>
          )
        }

        const sibling = href?.match(SIBLING_PAGE)?.[1]
        if (sibling === 'README') {
          return (
            <Link
              to="/app/$orgSlug/docs"
              params={{ orgSlug }}
              className="text-primary underline underline-offset-2"
            >
              {children}
            </Link>
          )
        }
        if (sibling && getDocPage(sibling)) {
          return (
            <Link
              to="/app/$orgSlug/docs/$page"
              params={{ orgSlug, page: sibling }}
              className="text-primary underline underline-offset-2"
            >
              {children}
            </Link>
          )
        }

        if (href?.startsWith('http')) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          )
        }

        return <>{children}</>
      },
      table: ({ children }) => (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border-border border-b px-3 py-2 text-left font-semibold">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-border/60 border-b px-3 py-2 align-top">
          {children}
        </td>
      ),
    }),
    [orgSlug],
  )

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}
