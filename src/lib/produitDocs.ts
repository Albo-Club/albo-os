/**
 * The product documentation (`docs/produit/*.md`), bundled at build time.
 *
 * The folder is globbed rather than listed: a page added to `docs/produit`
 * shows up in the app on the next build with nothing to register here. That
 * mirrors how `scripts/sync-linear-docs.mjs` reads the folder — except the
 * script needs a hand-kept map (a Linear document has to exist first), which
 * is exactly the drift we don't want to repeat in the front-end.
 *
 * `README.md` is the summary; it is the index page, not an entry of the list.
 */

const RAW = import.meta.glob<string>('../../docs/produit/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export type DocPage = {
  /** File name without extension, e.g. `05-deals` — the URL param. */
  slug: string
  /** The page's H1, e.g. « Deals ». */
  title: string
  markdown: string
}

/** `.../docs/produit/05-deals.md` → `05-deals`. */
function slugOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}

/** First `# …` line, falling back to the slug when a page has no H1. */
function titleOf(markdown: string, slug: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1].trim() ?? slug
}

const entries = Object.entries(RAW)
  .map(([path, markdown]) => {
    const slug = slugOf(path)
    return { slug, title: titleOf(markdown, slug), markdown }
  })
  // Pages are numbered (`01-…`, `20-…`), so the file name is the reading order.
  .sort((a, b) => a.slug.localeCompare(b.slug))

/** The summary page (`README.md`), rendered at `/app/<org>/docs`. */
export const docsSummary: DocPage = entries.find(
  (entry) => entry.slug === 'README',
) ?? { slug: 'README', title: 'Documentation', markdown: '' }

/** Every page except the summary, in reading order. */
export const docPages: Array<DocPage> = entries.filter(
  (entry) => entry.slug !== 'README',
)

export function getDocPage(slug: string): DocPage | undefined {
  return docPages.find((page) => page.slug === slug)
}
