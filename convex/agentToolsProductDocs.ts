/**
 * Agent tools over the PRODUCT documentation (`docs/produit`, bundled by
 * scripts/gen-product-docs.mjs) — how the app itself works. Not to be
 * confused with searchDocuments (convex/agentToolsDocuments.ts), which reads
 * the org's own documents.
 *
 * Deliberately NO parseScope / readMembership here, unlike every other tool
 * file: these two touch no table and no org data. They read a build-time
 * constant identical for every org — the same pages any member can open
 * under /app/<org>/docs.
 */

import { createTool } from '@convex-dev/agent'
import { z } from 'zod/v3'

import {
  getProductDoc,
  productDocs,
  searchProductDocs,
} from './lib/productDocs'

const searchProductDocsTool = createTool({
  description:
    'Keyword search in the PRODUCT DOCUMENTATION of Albo OS — how the app ' +
    'itself works: features, workflows, rules, what a screen does. Use it ' +
    'for "how do I…" / "comment marche…" questions about the app when no ' +
    'page of the documentation index in your instructions obviously ' +
    'matches; otherwise call getProductDoc with the slug directly. NOT for ' +
    "the content of the org's own documents (pactes, reportings) — that is " +
    'searchDocuments. Accents are optional. Returns pages ranked by ' +
    'relevance, each with the nearest heading and an excerpt; read the full ' +
    'page with getProductDoc before answering.',
  inputSchema: z.object({
    query: z.string().describe('Keywords, French or English'),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  execute: (_ctx, input): Promise<unknown> =>
    Promise.resolve({ results: searchProductDocs(input.query, input.limit) }),
})

const getProductDocTool = createTool({
  description:
    'Read one page of the product documentation of Albo OS in full ' +
    '(markdown, in French), by slug — the slugs are listed in your ' +
    'instructions and returned by searchProductDocs. Answer from the page ' +
    'and name it; the user can open it at /app/<org>/docs/<slug>.',
  inputSchema: z.object({
    slug: z.string().describe('Page slug, e.g. "08-pointage"'),
  }),
  execute: (_ctx, input): Promise<unknown> => {
    const doc = getProductDoc(input.slug)
    if (!doc) {
      return Promise.resolve({
        error: 'unknown_slug',
        availableSlugs: productDocs.map((page) => page.slug),
      })
    }
    return Promise.resolve({
      slug: doc.slug,
      title: doc.title,
      markdown: doc.markdown,
    })
  },
})

export const productDocTools = {
  searchProductDocs: searchProductDocsTool,
  getProductDoc: getProductDocTool,
}
