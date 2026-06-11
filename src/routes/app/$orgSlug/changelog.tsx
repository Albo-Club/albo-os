import { createFileRoute } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import changelogRaw from '../../../../CHANGELOG_PRODUIT.md?raw'
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

/**
 * Renders CHANGELOG_PRODUIT.md (imported at build time via `?raw` — the
 * content tracks deployments, no fetch). Document styling, more spacious
 * than the chat markdown (streamdown in the AI panel).
 */
function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6 pb-16">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-semibold tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-10 border-b pb-2 text-xl font-semibold tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-base font-semibold">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-foreground/90 mt-3 text-sm leading-relaxed">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="text-muted-foreground border-border mt-3 border-l-2 pl-4 text-sm">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border my-8" />,
          code: ({ children }) => (
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
        }}
      >
        {changelogRaw}
      </ReactMarkdown>
    </main>
  )
}
