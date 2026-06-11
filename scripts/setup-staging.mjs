#!/usr/bin/env node
/**
 * Provision the STAGING Convex deployment for this app.
 *
 * Staging = a SEPARATE Convex project (its "production" deployment is the
 * staging database) + a separate Vercel project whose Production Branch is
 * `staging`. Full runbook: README.md § "Staging environment".
 *
 * Usage:
 *   node scripts/setup-staging.mjs
 *
 * What it does:
 *   1. Prompts for the staging project's Production Deploy Key (generated
 *      in the Convex dashboard on the *staging* project) and the staging
 *      domain (e.g. https://albo-os-staging.vercel.app).
 *   2. Reads your dev Convex env vars (`convex env list`).
 *   3. Mirrors RESEND_*, ANTHROPIC_* and optional Google OAuth credentials
 *      onto the staging deployment, sets APP_ENV=production (staging runs
 *      on https — secure cookies + the SITE_URL boot guard both apply),
 *      SITE_URL + BETTER_AUTH_URL to the staging domain, generates a FRESH
 *      BETTER_AUTH_SECRET (never shared with dev or prod), and
 *      RESEND_TEST_MODE=false (magic links must actually arrive to log in).
 *   4. Asks for confirmation, then runs `convex env set` and
 *      `convex deploy` against the staging deployment via CONVEX_DEPLOY_KEY.
 *
 * What it deliberately does NOT mirror:
 *   - POWENS_* / AIRTABLE_API_KEY — Powens webhooks are registered per
 *     Powens domain; connecting banks from staging would route real events
 *     across environments. Staging gets bank data via snapshot import.
 *   - SENTRY_DSN — keep staging noise out of the prod Sentry project.
 *
 * What it does NOT do:
 *   - Touch Vercel. The staging Vercel project (Production Branch =
 *     `staging`, env vars) is set up by hand — steps printed at the end.
 */

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const rl = readline.createInterface({ input, output })
const ask = (q) => rl.question(q)

function listDevEnv() {
  try {
    const raw = execSync('pnpm exec convex env list', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const map = new Map()
    for (const line of raw.split('\n')) {
      const idx = line.indexOf('=')
      if (idx === -1) continue
      map.set(line.slice(0, idx).trim(), line.slice(idx + 1))
    }
    return map
  } catch (e) {
    console.error(
      '\n❌ Could not read dev env. Run `pnpm exec convex dev` once first ' +
        'to provision the dev deployment, then re-run this script.\n',
    )
    process.exit(1)
  }
}

function runOnStaging(deployKey, args) {
  const r = spawnSync('pnpm', ['exec', 'convex', ...args], {
    stdio: 'inherit',
    // CONVEX_DEPLOY_KEY takes precedence over the CONVEX_DEPLOYMENT in
    // .env.local, so every command below targets the staging deployment.
    env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
  })
  if (r.status !== 0) {
    console.error(`❌ \`convex ${args.join(' ')}\` failed on staging`)
    process.exit(1)
  }
}

async function main() {
  console.log('\n  Convex staging setup\n')
  console.log(
    '  Prerequisite: a separate Convex project for staging (dashboard →\n' +
      '  Create Project, e.g. "albo-os-staging"), with a Production Deploy\n' +
      "  Key generated from that project's Settings → URL & Deploy Key.\n",
  )

  const deployKey = (await ask('Staging Production Deploy Key: ')).trim()
  if (!deployKey.startsWith('prod:')) {
    console.error(
      '❌ Expected a Production Deploy Key (starts with `prod:`). ' +
        'Preview/dev keys cannot target the staging deployment.',
    )
    process.exit(1)
  }
  // Key format is `prod:<deployment-name>|<secret>` — surface the target so
  // pasting the REAL prod project's key by mistake gets caught here.
  const deploymentName = deployKey.slice('prod:'.length).split('|')[0]
  const sure = (
    await ask(
      `\nThis key targets deployment "${deploymentName}".\n` +
        'Confirm this is the STAGING project, NOT the real prod one. [y/N] ',
    )
  )
    .trim()
    .toLowerCase()
  if (sure !== 'y' && sure !== 'yes') {
    console.log('Aborted.')
    rl.close()
    return
  }

  const domain = (
    await ask('\nStaging domain (e.g. https://albo-os-staging.vercel.app): ')
  ).trim()
  if (!/^https:\/\/[^\s/]+$/.test(domain)) {
    console.error('❌ Must be a full `https://...` URL with no trailing slash.')
    process.exit(1)
  }

  console.log('\n  Reading dev env vars…')
  const dev = listDevEnv()

  const missing = ['RESEND_API_KEY', 'RESEND_FROM', 'ANTHROPIC_API_KEY'].filter(
    (k) => !dev.get(k),
  )
  if (missing.length) {
    console.error(
      `\n❌ Missing on dev: ${missing.join(', ')}.\n` +
        'Set them on dev first (so this script can mirror them), e.g.:\n' +
        '  pnpm exec convex env set RESEND_API_KEY re_...\n',
    )
    process.exit(1)
  }

  const plan = {
    APP_ENV: 'production',
    SITE_URL: domain,
    BETTER_AUTH_URL: domain,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    RESEND_API_KEY: dev.get('RESEND_API_KEY'),
    RESEND_FROM: dev.get('RESEND_FROM'),
    RESEND_TEST_MODE: 'false',
    ANTHROPIC_API_KEY: dev.get('ANTHROPIC_API_KEY'),
  }
  for (const k of [
    'ANTHROPIC_MODEL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]) {
    const v = dev.get(k)
    if (v) plan[k] = v
  }
  const googleMirrored = !!plan.GOOGLE_CLIENT_ID

  console.log('\n  Will set on staging:')
  for (const [k, v] of Object.entries(plan)) {
    const sensitive =
      k.includes('SECRET') || k.includes('KEY') || k.includes('TOKEN')
    console.log(`    ${k} = ${sensitive ? '<redacted>' : v}`)
  }
  console.log(
    '\n  (POWENS_*, AIRTABLE_API_KEY and SENTRY_DSN are deliberately NOT\n' +
      '  mirrored — see the header of this script.)',
  )

  const ok = (await ask('\nProceed? [y/N] ')).trim().toLowerCase()
  if (ok !== 'y' && ok !== 'yes') {
    console.log('Aborted.')
    rl.close()
    return
  }
  rl.close()

  console.log('\n  Setting env vars on staging…')
  for (const [k, v] of Object.entries(plan)) {
    runOnStaging(deployKey, ['env', 'set', k, v])
  }

  console.log('\n  Deploying Convex staging (pushes functions + schema)…')
  runOnStaging(deployKey, ['deploy'])

  console.log(`
  ✅ Convex staging is provisioned (deployment "${deploymentName}").

  Next (frontend on Vercel) — one-time, in the Vercel dashboard:

    1. Add New → Project → import this repo AGAIN as a second project
       (e.g. "albo-os-staging").
    2. Settings → Git → Production Branch = "staging".
    3. Settings → Environment Variables (scope: Production):
         CONVEX_DEPLOY_KEY      = <the staging key you just used>
         VITE_CONVEX_SITE_URL   = staging .convex.site URL
       (VITE_CONVEX_URL is injected by \`convex deploy --cmd\` at build time.)
    4. Create and push the branch:
         git push origin main:staging

  Each push to "staging" then deploys front + Convex backend in lockstep
  to ${domain}. Day-to-day process: README.md § "Staging environment".
`)

  if (googleMirrored) {
    console.log(`  ⚠️  Google OAuth was mirrored to staging. In Google Cloud Console,
      on the SAME OAuth client, add:

        Authorized redirect URI:  ${domain}/api/auth/callback/google
        Authorized JS origin:     ${domain}

      Until both are registered, Google sign-in on staging returns
      redirect_uri_mismatch.
`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
