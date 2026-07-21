#!/usr/bin/env node
// Bump the `convex` package to its latest release. If it moved, prepend the
// mandatory CHANGELOG_PRODUIT.md entry (CLAUDE.md § Pre-PR doc audit, q.5)
// so the automated PR ships with its changelog line.
// Used by .github/workflows/update-convex.yml; safe to run locally.

import { execSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const installedVersion = () =>
  JSON.parse(readFileSync('node_modules/convex/package.json', 'utf8')).version

// Expose step outputs when running inside GitHub Actions.
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

const before = installedVersion()
execSync('pnpm add convex@latest', { stdio: 'inherit' })
const after = installedVersion()

if (before === after) {
  console.log(`convex already at ${after}, nothing to do.`)
  output('updated', 'false')
  process.exit(0)
}

// Prepend the changelog entry: patch bump over the top entry, Paris wall-clock.
const file = 'CHANGELOG_PRODUIT.md'
const md = readFileSync(file, 'utf8')
const top = md.match(/^## v(\d+)\.(\d+)\.(\d+) /m)
if (!top) throw new Error(`No versioned entry (## vX.Y.Z) found in ${file}`)
const next = `${top[1]}.${top[2]}.${Number(top[3]) + 1}`

const paris = Object.fromEntries(
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(new Date())
    .map((part) => [part.type, part.value]),
)
const stamp = `${paris.day}/${paris.month}/${paris.year} à ${paris.hour}:${paris.minute}`

const entry = `## v${next} — ${stamp} — Mise à jour Convex ${after}

Mise à jour technique du moteur de données de l'app (Convex ${before} →
${after}). Aucun changement visible dans l'app.

> **🔧 Notes techniques**
>
> - \`convex\` ${before} → ${after} via \`pnpm add convex@latest\` (lockfile mis à jour).
> - PR ouverte automatiquement par \`.github/workflows/update-convex.yml\` ;
>   \`pnpm lint\`, \`pnpm test:unit\` et \`pnpm build\` sont passés dans le run
>   avant ouverture.
`

const insertAt = md.search(/^## v/m)
writeFileSync(file, md.slice(0, insertAt) + entry + '\n' + md.slice(insertAt))
console.log(`convex ${before} → ${after}; changelog entry v${next} added.`)
output('updated', 'true')
output('before', before)
output('after', after)
