#!/usr/bin/env node
// Mirror docs/produit/*.md into the documents of the Linear project "Albo OS".
//
// The repo folder is the source of truth (CLAUDE.md § Pre-PR doc audit, q.7);
// Linear is a read-only copy for comfortable reading. Keeping that copy in
// sync used to be a manual step an agent was asked to do "after the PR ships"
// — which never happened, because the agent's session ends when it opens the
// PR. This script closes that gap: the "Sync Linear docs" workflow runs it on
// every push to main that touches docs/produit.
//
// What it pushes is not the raw file:
//   - the H1 is dropped (the Linear document carries its own title);
//   - a banner naming the source file is prepended, so a reader who lands in
//     Linear knows where to edit;
//   - relative links between pages (`05-deals.md`) are rewritten to the
//     matching Linear document URL, so they resolve on both sides. A link to
//     a file outside this folder keeps its text and loses its target.
//
// Usage:
//   node scripts/sync-linear-docs.mjs docs/produit/05-deals.md [...]
//   node scripts/sync-linear-docs.mjs --all        # every page (recovery)
//   node scripts/sync-linear-docs.mjs --all --dry-run   # print, call nothing
//
// Env: LINEAR_API_KEY — a personal API key (Linear → Settings → API), stored
// as the `LINEAR_API_KEY` GitHub secret.
//
// Exit codes:
//   0   nothing to do, or everything pushed
//   1   missing key, network/API error
//   2   docs/produit and the DOCS map below disagree (see "the map" note)

import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DOCS_DIR = resolve(ROOT, 'docs/produit')
const API = 'https://api.linear.app/graphql'

// The map: one entry per page, checked against the folder on every run.
// A page on disk with no entry (or an entry with no page) fails the run with
// exit 2 — a new page that silently never reaches Linear is exactly the drift
// this script exists to prevent. Adding a page therefore means creating its
// Linear document first, then pasting its id and url here.
// `id` targets the mutation; `url` is only used to rewrite inter-page links.
const DOCS = {
  'README.md': {
    id: '65e78227-7658-466c-b647-1f384dbd682a',
    url: 'https://linear.app/alboteam/document/00-sommaire-documentation-produit-77db3b4f4259',
  },
  '01-vue-densemble.md': {
    id: 'e57cc875-d674-4538-95ea-4ade7d9ed0ea',
    url: 'https://linear.app/alboteam/document/01-vue-densemble-5f19909646c8',
  },
  '02-concepts-de-base.md': {
    id: 'ad82c4b7-f736-427f-8fbb-7c14a1da447a',
    url: 'https://linear.app/alboteam/document/02-concepts-de-base-6e9a8a80c338',
  },
  '04-participations.md': {
    id: '77e7e65f-4ff6-433a-a614-434f7c394e90',
    url: 'https://linear.app/alboteam/document/04-participations-d9c4a5c3037f',
  },
  '05-deals.md': {
    id: '23135a93-dcfe-4f2b-9ac9-9892d300099a',
    url: 'https://linear.app/alboteam/document/05-deals-25e33393267e',
  },
  '06-valorisations-et-kpis.md': {
    id: '5b12902c-26f8-431c-accf-fe6848cdf855',
    url: 'https://linear.app/alboteam/document/06-valorisations-kpis-et-metriques-a2515c020f53',
  },
  '07-tresorerie.md': {
    id: 'be745be2-c193-443c-9ce8-a4978ec4eadc',
    url: 'https://linear.app/alboteam/document/07-tresorerie-03c380b7758b',
  },
  '08-pointage.md': {
    id: 'df3bc8f4-95f7-4fb2-90bc-f9e119a2e610',
    url: 'https://linear.app/alboteam/document/08-pointage-5fc4270c206e',
  },
  '09-previsionnel.md': {
    id: 'd1979260-22a6-439b-844d-f79e9fa9756a',
    url: 'https://linear.app/alboteam/document/09-previsionnel-de-tresorerie-19e32a0f1020',
  },
  '10-passif.md': {
    id: '91d8bdde-3d08-4591-a1af-87bedbff3d87',
    url: 'https://linear.app/alboteam/document/10-passif-4241486498d7',
  },
  '11-assistant-ia.md': {
    id: 'b0c44fdf-39fc-4fac-8112-d3a17ff207f4',
    url: 'https://linear.app/alboteam/document/11-assistant-ia-295ecf68a851',
  },
  '12-vue-consolidee.md': {
    id: 'c6c86d51-0939-4381-992f-a74e2515ebf4',
    url: 'https://linear.app/alboteam/document/12-vue-consolidee-toutes-les-organisations-2b379c7b4e38',
  },
  '13-compte-et-securite.md': {
    id: '828dc562-a15f-4fbf-b1ed-df68cf01107e',
    url: 'https://linear.app/alboteam/document/13-compte-et-securite-caf017581c86',
  },
  '14-organisations-membres-invitations.md': {
    id: '168fa921-c881-4d7c-a2cc-489b2fb98ece',
    url: 'https://linear.app/alboteam/document/14-organisations-membres-et-invitations-e76c6d91a4e2',
  },
  '15-integrations.md': {
    id: '981ddf1b-fa45-40f5-926b-9028a014f8d0',
    url: 'https://linear.app/alboteam/document/15-integrations-7aebc06c1ad7',
  },
  '16-a-faire.md': {
    id: 'e73cb84e-90c6-4cc9-9e6b-82c947006738',
    url: 'https://linear.app/alboteam/document/16-a-faire-821a7e7c7f2b',
  },
  '17-reports-par-email.md': {
    id: '6d37ad80-3722-487d-a062-7be55d171dad',
    url: 'https://linear.app/alboteam/document/17-reports-par-email-1ede940ce6de',
  },
  '19-placements.md': {
    id: '155997df-f22c-4d82-b914-f7c079f6bd66',
    url: 'https://linear.app/alboteam/document/19-placements-f2a1db1ff3cb',
  },
}

const args = process.argv.slice(2)
const all = args.includes('--all')
const dryRun = args.includes('--dry-run')
const paths = args.filter((a) => !a.startsWith('--'))

const MD_LINK = /\[([^\]]+)\]\(([^)]+\.md)\)/g

// Inter-page links point at Linear; anything else (../../CHANGELOG_PRODUIT.md)
// keeps its text — a relative path would 404 once out of the repo.
function rewriteLinks(markdown) {
  return markdown.replace(MD_LINK, (_whole, text, target) => {
    const entry = DOCS[basename(target)]
    return entry ? `[${text}](${entry.url})` : text
  })
}

function toLinearMarkdown(fileName, source) {
  const lines = source.split('\n')
  const body = lines[0].startsWith('# ')
    ? lines.slice(1).join('\n')
    : `\n${source}`
  const banner = `> Miroir en lecture de \`docs/produit/${fileName}\` (source de vérité : le repo \`albo-os\`).`
  return `${banner}\n${rewriteLinks(body).trimEnd()}\n`
}

async function graphql(query, variables, apiKey) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(
      `Linear API HTTP ${res.status}: ${JSON.stringify(payload ?? {})}`,
    )
  }
  // Linear answers 200 with an `errors` array on a rejected mutation.
  if (payload?.errors?.length) {
    throw new Error(
      `Linear API error: ${payload.errors.map((e) => e.message).join('; ')}`,
    )
  }
  return payload.data
}

const UPDATE = `
  mutation SyncDoc($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) { success }
  }
`

async function main() {
  const onDisk = (await readdir(DOCS_DIR)).filter((f) => f.endsWith('.md'))
  const unmapped = onDisk.filter((f) => !DOCS[f])
  const missing = Object.keys(DOCS).filter((f) => !onDisk.includes(f))
  if (unmapped.length || missing.length) {
    if (unmapped.length) {
      console.error(
        `docs/produit holds pages with no Linear document: ${unmapped.join(', ')}.\n` +
          'Create the document in the Linear project "Albo OS", then add its id and url to DOCS in this script.',
      )
    }
    if (missing.length) {
      console.error(
        `DOCS maps pages that no longer exist: ${missing.join(', ')}.\n` +
          'Remove the entry here, and archive the matching Linear document.',
      )
    }
    process.exit(2)
  }

  // Paths come from a `git diff -- docs/produit`, so anything outside the
  // folder is a hand-typed mistake (a root README.md would otherwise mirror
  // the sommaire, which shares its basename).
  const inFolder = paths.filter((p) =>
    resolve(ROOT, p).startsWith(`${DOCS_DIR}/`),
  )
  const files = all
    ? onDisk
    : [...new Set(inFolder.map((p) => basename(p)))].filter((f) =>
        Boolean(DOCS[f]),
      )

  if (!files.length) {
    console.log('No docs/produit page to mirror.')
    return
  }

  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey && !dryRun) {
    console.error('LINEAR_API_KEY is not set — cannot reach the Linear API.')
    process.exit(1)
  }

  for (const file of files.sort()) {
    const source = await readFile(resolve(DOCS_DIR, file), 'utf8')
    const content = toLinearMarkdown(file, source)
    if (dryRun) {
      console.log(`--- ${file} → ${DOCS[file].id}\n${content}`)
      continue
    }
    await graphql(UPDATE, { id: DOCS[file].id, input: { content } }, apiKey)
    console.log(`Mirrored ${file} → ${DOCS[file].url}`)
  }

  console.log(`${files.length} page(s) mirrored to Linear.`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
