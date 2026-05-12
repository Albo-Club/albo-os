#!/usr/bin/env node
// Sync skills declared in skills-lock.json from their upstream GitHub repos.
// Each skill is described by { source, sourceType, skillPath, computedHash }.
// We fetch the raw file from github.com/<source>/main/<skillPath>, hash it
// with SHA-256, and only write/update when it's missing or changed.
//
// Folder layout produced:
//   .agents/skills/<name>/SKILL.md           (canonical content)
//   .claude/skills/<name> -> ../../.agents/skills/<name>   (symlink)
//
// Run:
//   pnpm run sync:skills
//   pnpm run sync:skills -- --force   # ignore hash, re-download everything
//
// Exit codes:
//   0   nothing to do, or successful sync
//   1   network or filesystem error
//   2   skill drift detected and not synced (when run with --check)

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LOCK_PATH = resolve(ROOT, 'skills-lock.json')
const AGENTS_DIR = resolve(ROOT, '.agents/skills')
const CLAUDE_DIR = resolve(ROOT, '.claude/skills')

const force = process.argv.includes('--force')
const checkOnly = process.argv.includes('--check')

async function fetchSkill(name, info) {
  const url = `https://raw.githubusercontent.com/${info.source}/main/${info.skillPath}`
  const res = await fetch(url)
  if (!res.ok) {
    return { name, info, error: `${res.status} ${url}` }
  }
  const content = await res.text()
  const hash = createHash('sha256').update(content).digest('hex')
  return { name, info, content, hash }
}

async function main() {
  const lockRaw = await readFile(LOCK_PATH, 'utf8')
  const lock = JSON.parse(lockRaw)

  const fetches = Object.entries(lock.skills)
    .filter(([, info]) => info.sourceType === 'github')
    .map(([name, info]) => fetchSkill(name, info))

  const results = await Promise.all(fetches)
  let drift = 0
  let synced = 0

  for (const r of results) {
    if (r.error) {
      console.error(`✗ ${r.name}: ${r.error}`)
      process.exitCode = 1
      continue
    }
    const filePath = resolve(AGENTS_DIR, r.name, 'SKILL.md')
    const needsWrite =
      force || r.hash !== r.info.computedHash || !existsSync(filePath)
    if (!needsWrite) continue

    if (checkOnly) {
      console.log(`~ ${r.name}: would update`)
      drift += 1
      continue
    }

    const dir = resolve(AGENTS_DIR, r.name)
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, r.content)

    const linkPath = resolve(CLAUDE_DIR, r.name)
    if (!existsSync(linkPath)) {
      await mkdir(CLAUDE_DIR, { recursive: true })
      const target = relative(CLAUDE_DIR, dir)
      await symlink(target, linkPath, 'dir')
    }

    r.info.computedHash = r.hash
    synced += 1
    console.log(`✓ ${r.name}`)
  }

  if (checkOnly) {
    if (drift > 0) {
      console.log(
        `${drift} skill${drift > 1 ? 's' : ''} drifted. Run \`pnpm run sync:skills\`.`,
      )
    }
    process.exit(drift > 0 ? 2 : 0)
  }

  if (synced > 0) {
    await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')
    console.log(
      `Updated skills-lock.json (${synced} skill${synced > 1 ? 's' : ''})`,
    )
  } else {
    console.log('Skills up to date.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
