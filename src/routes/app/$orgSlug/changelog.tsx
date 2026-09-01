import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import changelogRaw from '../../../../CHANGELOG_PRODUIT.md?raw'
import { Button } from '~/components/ui/button'
import { documentMarkdownComponents } from '~/components/docs/markdown'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'

export const Route = createFileRoute('/app/$orgSlug/changelog')({
  component: ChangelogPage,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'nav')(
          'changelogPage.metaTitle',
        ),
      },
    ],
  }),
})

/** How many release entries to reveal per "show older" click. */
const PAGE_SIZE = 10

type ParsedChangelog = {
  header: string
  entries: Array<string>
  footer: string
}

/**
 * Splits the raw changelog into its fixed header (title + intro), the list of
 * per-release entries, and the trailing footer (the "Petit lexique" section).
 * Entries are the `## …` sections whose heading carries the ` — ` separator
 * used by every release line (`## vX.Y.Z — …` and the legacy `## Mois AAAA — …`);
 * the first heading without it (the lexicon) starts the footer. This lets the
 * page render only the latest N entries while keeping header and lexicon pinned.
 */
function parseChangelog(raw: string): ParsedChangelog {
  const firstHeading = raw.search(/^## /m)
  if (firstHeading === -1) return { header: raw, entries: [], footer: '' }

  const header = raw.slice(0, firstHeading)
  const chunks = raw.slice(firstHeading).split(/^(?=## )/m)

  const footerStart = chunks.findIndex(
    (chunk) => !chunk.split('\n', 1)[0].includes(' — '),
  )
  if (footerStart === -1) return { header, entries: chunks, footer: '' }

  return {
    header,
    entries: chunks.slice(0, footerStart),
    footer: chunks.slice(footerStart).join(''),
  }
}

// Parsed once at module load — `changelogRaw` is a build-time constant.
const changelog = parseChangelog(changelogRaw)

/**
 * Renders CHANGELOG_PRODUIT.md (imported at build time via `?raw` — the
 * content tracks deployments, no fetch). Only the latest `visibleCount`
 * release entries are rendered; older ones are revealed on demand so the
 * page stays light as the changelog grows (one entry per PR). The intro
 * header and the bottom lexicon stay pinned.
 */
function ChangelogPage() {
  const { t } = useTranslation('nav')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const remaining = changelog.entries.length - visibleCount
  const visibleMarkdown =
    changelog.header + changelog.entries.slice(0, visibleCount).join('')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6 pb-16">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={documentMarkdownComponents}>
        {visibleMarkdown}
      </ReactMarkdown>

      {remaining > 0 && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            {t('changelogPage.showOlder', { remaining })}
          </Button>
        </div>
      )}

      {changelog.footer && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={documentMarkdownComponents}
        >
          {changelog.footer}
        </ReactMarkdown>
      )}
    </main>
  )
}
