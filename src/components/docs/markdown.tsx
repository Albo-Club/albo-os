import type { Components } from 'react-markdown'

/**
 * Document styling for long-form markdown rendered from the repo's `.md`
 * files (the changelog, the product documentation). More spacious than the
 * chat markdown (streamdown).
 *
 * Consumers that need extra elements — internal links, tables — spread this
 * map and override what they add.
 */
export const documentMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
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
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
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
}
