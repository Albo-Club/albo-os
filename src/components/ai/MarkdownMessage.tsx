import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Rendu markdown des réponses de l'agent. Styles explicites par élément
 * (pas de plugin typography) — tokens Tailwind uniquement.
 */
export function MarkdownMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
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
        h1: ({ children }) => (
          <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h4 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
            {children}
          </h4>
        ),
        h3: ({ children }) => (
          <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">
            {children}
          </h5>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-border mb-2 border-l-2 pl-3 italic last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-border my-3" />,
        code: ({ className, children }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="bg-muted-foreground/15 rounded px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre className="bg-muted-foreground/10 mb-2 overflow-x-auto rounded-md p-3 font-mono text-xs last:mb-0">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-border border-b px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-border/50 border-b px-2 py-1 align-top">
            {children}
          </td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
