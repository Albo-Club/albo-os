#!/usr/bin/env node
// Update all dependencies within their declared semver ranges (`pnpm update`,
// so no major jumps). If anything moved, prepend the mandatory
// CHANGELOG_PRODUIT.md entry (CLAUDE.md § Pre-PR doc audit, q.5) listing the
// direct dependencies that changed, so the automated PR ships with its
// changelog line. Used by .github/workflows/update-deps.yml; safe locally.

import { execSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const directDeps = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]

const installedVersions = () => {
  const versions = {}
  for (const name of directDeps) {
    try {
      versions[name] = JSON.parse(
        readFileSync(`node_modules/${name}/package.json`, 'utf8'),
      ).version
    } catch {
      // Not installed (e.g. skipped optional dep) — ignore.
    }
  }
  return versions
}

// Expose step outputs when running inside GitHub Actions.
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

const before = installedVersions()
execSync('pnpm update', { stdio: 'inherit' })
const after = installedVersions()

const changed = directDeps
  .filter((name) => before[name] && after[name] && before[name] !== after[name])
  .map((name) => ({ name, from: before[name], to: after[name] }))

const lockfileMoved =
  execSync('git status --porcelain pnpm-lock.yaml package.json')
    .toString()
    .trim() !== ''

if (!lockfileMoved) {
  console.log('All dependencies already up to date, nothing to do.')
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

const changedList = changed
  .map((c) => `> - \`${c.name}\` ${c.from} → ${c.to}`)
  .join('\n')
const detail = changed.length
  ? `${changed.length} brique(s) logicielle(s) mises à jour`
  : 'dépendances internes uniquement'

const entry = `## v${next} — ${stamp} — Mise à jour des dépendances

Mise à jour technique hebdomadaire des briques logicielles de l'app
(${detail}). Aucun changement visible dans l'app.

> **🔧 Notes techniques**
>
> - \`pnpm update\` (dans les plages semver déclarées — jamais de saut de
>   version majeure) via \`.github/workflows/update-deps.yml\` ;
>   \`pnpm lint\`, \`pnpm test:unit\` et \`pnpm build\` sont passés dans le run
>   avant ouverture de la PR.
${changedList ? changedList + '\n' : ''}`

const insertAt = md.search(/^## v/m)
writeFileSync(file, md.slice(0, insertAt) + entry + '\n' + md.slice(insertAt))
console.log(
  `${changed.length} direct dependency(ies) updated; changelog entry v${next} added.`,
)
for (const c of changed) console.log(`  ${c.name} ${c.from} → ${c.to}`)
output('updated', 'true')
output('count', String(changed.length))
