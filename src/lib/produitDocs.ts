/**
 * The product documentation (`docs/produit/*.md`) — the app-side alias of
 * `convex/lib/productDocs.ts`, so the reader, ⌘K and the AI assistant read
 * the very same text. The folder is bundled once, by
 * `scripts/gen-product-docs.mjs` (see that script for why it is no longer
 * globbed here).
 *
 * `README.md` is the summary; it is the index page, not an entry of the list.
 */

export {
  productDocs as docPages,
  productDocsSummary as docsSummary,
  getProductDoc as getDocPage,
} from '../../convex/lib/productDocs'
