# albo-os — l'ouvre-boîte

Opinionated B2B SaaS MVP starter: **TanStack Start + Convex + Better Auth + Resend + Anthropic + Tailwind v4**.

Multi-tenant by default (orgs, members, invitations, roles), with an AI chat
sidebar wired in, transactional emails, rate-limiting, and CI/CD on day one.

## Stack

| Layer        | Choice                                                          |
| ------------ | --------------------------------------------------------------- |
| Front-end    | React 19 · TanStack Start v1 · TanStack Router (file-based)     |
| State / data | TanStack Query · Convex (real-time queries, mutations, HTTP)    |
| Forms        | TanStack Form · Zod                                             |
| Styling      | Tailwind v4 (CSS-first) · shadcn/ui · Inter · tokens in oklch   |
| Auth         | Better Auth (email/password + magic link) + `organization()`    |
| Email        | Resend (HTML + plain text templates)                            |
| AI           | Convex Agent + Anthropic Claude (Haiku 4.5 default, with tools) |
| Limiter      | `@convex-dev/rate-limiter`                                      |
| Observ.      | Sentry (front-end), Convex built-in logs                        |

## Getting started

**Prerequisites**

- **Node 20+** (LTS recommended)
- **pnpm** — enable it once via Corepack (bundled with Node): `corepack enable`
- **git**

**1. Get the code**

This repo is a GitHub template. Either click **"Use this template"** on
GitHub to create your own repo, or clone it directly:

```bash
git clone https://github.com/Albo-Club/albo-os.git my-project
cd my-project
```

**2. Configure everything**

One interactive command. It installs dependencies (if needed), logs you into
Convex, provisions your backend, and collects your API keys:

```bash
pnpm run setup
```

> Use `pnpm run setup`, **not** `pnpm setup` — `setup` is a reserved pnpm
> built-in (it configures `PNPM_HOME`), so the bare form never reaches this
> project's script.
>
> The Convex step opens a browser to log you in and asks you to create a
> project (pick **cloud deployment**). It pushes your functions once and
> returns to the wizard automatically — no Ctrl-C needed.

**3. Start the app**

Run this in its own terminal — it stays in the foreground (Vite + Convex
together):

```bash
pnpm dev
```

Then open **http://localhost:3000** and create your first account.

`pnpm run setup` walks you through everything :

1. **Dependencies** — runs `pnpm install` if `node_modules` is missing.
2. **Project name** — rebrands page titles, agent identity, cookie prefix.
3. **Convex backend** — opens a browser to log in, provisions your dev
   deployment, writes `CONVEX_DEPLOYMENT` + `VITE_CONVEX_URL` to `.env.local`.
4. **API keys** — prompts for Anthropic + Resend with direct dashboard links
   so you don't have to hunt for the URLs.
5. **Better Auth secret** — auto-generated.
6. **Google OAuth** _(optional)_ — prompts for `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`; press Enter to skip. When set, a "Continue with
   Google" button appears on `/login` and `/register`; otherwise it stays
   hidden. Authorized redirect URI: `${SITE_URL}/api/auth/callback/google`.
   See `KNOWN_ISSUES.md` § "Google OAuth (template — opt-in)".

It's idempotent — re-run any time, each step skips if already done.

The first user across the deployment becomes `superAdmin: true` automatically.

If you'd rather rebrand without touching Convex, `pnpm run init my-project
--reset-git` runs just the rename step.

## Project layout

```
convex/                Convex backend
  auth.ts              Better Auth config (email + magic link)
  schema.ts            users · organizations · members · invitations
  organizations.ts     org CRUD, members, role helpers
  invitations.ts       invite, accept, revoke (with email send)
  users.ts             me, provisionMe, updateProfile
  admin.ts             super-admin queries + purgeExcept (dev cleanup)
  agent.ts             AI agent instance (Anthropic, default Haiku 4.5)
  chat.ts              threads, sendMessage, listMessages, HTTP /api/chat
  rateLimiters.ts      named limits + consumeLimit helper
  lib/auth.ts          requireAppUser, requireOrgMember, requireOrgRole, …
  emailTemplates.ts    inline-styled HTML + plain text
src/
  routes/              File-based routes (TanStack Router)
    api/auth/$.ts      Better Auth proxy
    app/               Authenticated area
      route.tsx        auth gate + lazy provisioning
      $orgSlug/        Org-scoped routes
        route.tsx      Top app bar + AI chat sidebar mount point
        settings/      General · Members · Invitations
        participations.tsx  Portfolio view (placeholder — built in V0)
        cash.tsx       Cash management (placeholder — phase 2)
      admin.tsx        Super-admin
      me.tsx           Profile + change password
    login.tsx / register.tsx / accept-invite.$token.tsx
  components/
    AiChat.tsx         Slide-over chat panel using Convex Agent React hooks
    Logo.tsx
    ui/                shadcn primitives
  lib/
    auth-client.ts     Better Auth client (+ plugins)
    sentry.ts          Front-end Sentry init (no-op if VITE_SENTRY_DSN unset)
scripts/
  sync-skills.mjs      Pull SKILL.md files from upstream GitHub
  init.mjs             Rebrand the template
  upgrade-template.mjs Pull non-conflicting updates from upstream
```

## Routes at a glance

| Path                                                   | What it does                              |
| ------------------------------------------------------ | ----------------------------------------- |
| `/`                                                    | Redirect to `/app` (no marketing landing) |
| `/login`, `/register`                                  | Email/password + redirect support         |
| `/accept-invite/:token`                                | Token-as-credential state machine         |
| `/app`                                                 | Org switcher / onboarding redirect        |
| `/app/onboarding`                                      | First-org creation                        |
| `/app/me`                                              | Profile, password, sign-out               |
| `/app/admin`                                           | Super-admin overview                      |
| `/app/:orgSlug`                                        | Org dashboard                             |
| `/app/:orgSlug/participations`                         | Portfolio view (placeholder)              |
| `/app/:orgSlug/cash`                                   | Cash management (placeholder)             |
| `/app/:orgSlug/settings/{general,members,invitations}` | Settings UI                               |

## Auth model

- `users.superAdmin: boolean` for deployment-wide privileges.
- `organizationMembers.role`: `owner` > `admin` > `member`.
- Roles are **never** stored on the Better Auth user table.
- Every Convex query/mutation reads roles via `requireAppUser` / `requireOrgRole` / `requireSuperAdmin`.
- Invitations: 7-day expiry, token _is_ the credential; UI never bounces the
  invitee through sign-in unless the email already has an account.
- Last-owner protection on every demote/remove path.

## AI chat

The `AiChat` slide-over uses the Convex Agent's React hooks
(`useUIMessages`) so streaming deltas arrive via WebSocket — no manual SSE
plumbing. Threads are keyed by `${orgId}:${userId}`.

The chat agent ships with **DB-acting tools** (`convex/agentTools.ts`) scoped
to the org: `listCompanies` / `listDeals`, `createCompany` (portfolio only),
`createDeal` (scope derived from the investor), and `updateDeal`. Membership
is re-checked inside every tool via the thread's scope key
(`${orgId}:${userId}`). Tool calls cap out at 5 rounds per turn
(`stepCountIs(5)`).

There's also an HTTP streaming endpoint at `<convex-site-url>/api/chat` for
clients that prefer plain HTTP streaming (curl, custom clients).

## Deploy to Vercel

The frontend runs on Vercel (serverless via Nitro's Vercel preset); the
Convex backend deploys to Convex Cloud separately.

**Project setup (one-time)**

1. Install the Vercel CLI on the fly: `pnpm dlx vercel@latest login`.
2. From the repo root: `pnpm dlx vercel@latest link` — pick the team and
   project (creates `.vercel/project.json`, gitignored).
3. Verify the framework override is in place: `vercel.json` must contain
   `"framework": null`. Vercel's auto-detection lands on the **Vite**
   preset (which expects `dist/`), but Nitro outputs the Build Output API
   layout in `.vercel/output/`. The override is what kills the 404.
4. Make sure `vite.config.ts` loads `nitro()` from `nitro/vite` in the
   plugin chain — without it the build emits a plain Node server that
   Vercel can't serve.

**Per-environment env vars (Production at minimum)**

```bash
# client-exposed Convex endpoints (build-time inlined into the bundle)
pnpm dlx vercel@latest env add VITE_CONVEX_URL production
pnpm dlx vercel@latest env add VITE_CONVEX_SITE_URL production
# optional: same two for `preview` if you use PR preview deploys
```

For a real production setup, also provision a separate Convex prod
deployment instead of pointing at your `dev:` one:

```bash
pnpm exec convex deploy                            # creates prod
# grab the prod Deploy Key from the Convex dashboard, then:
pnpm dlx vercel@latest env add CONVEX_DEPLOY_KEY production
```

Then set the Vercel build command to
`pnpm exec convex deploy --cmd "pnpm build"` — Convex deploys the
backend and injects `VITE_CONVEX_URL` automatically (the manual VITE\_\*
env vars become unnecessary).

**Convex prod env** — one command, instead of pasting 8 `convex env set`:

```bash
pnpm run setup:prod
```

The script prompts for your prod domain, reads your dev env, mirrors the
secrets (Resend, Anthropic, optional Sentry, and the Google OAuth credentials
if you set them in dev) to prod, generates a **fresh** `BETTER_AUTH_SECRET`
(never reused from dev — same secret across envs would let a dev session token
unlock prod), sets `APP_ENV=production`, `SITE_URL`, `BETTER_AUTH_URL`,
`RESEND_TEST_MODE=false`, and runs `convex deploy`.

If Google OAuth is mirrored, the script reminds you to register the prod
redirect URI (`https://<your-domain>/api/auth/callback/google`) on the **same**
Google Cloud OAuth client you use for dev — the credentials are mirrored
automatically, but the redirect URI must be added by hand in the Google
console, or Google sign-in returns `redirect_uri_mismatch`.

`APP_ENV=production` activates a boot-time guard in `convex/auth.ts` that
refuses to start if `SITE_URL` still points at `localhost` — this is what
prevents shipping magic-link / invitation emails with broken `localhost`
links.

If you prefer the manual route:

```bash
pnpm exec convex env set --prod BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
pnpm exec convex env set --prod BETTER_AUTH_URL https://<your-domain>
pnpm exec convex env set --prod SITE_URL https://<your-domain>
pnpm exec convex env set --prod ANTHROPIC_API_KEY sk-ant-...
pnpm exec convex env set --prod RESEND_API_KEY re_...
pnpm exec convex env set --prod RESEND_FROM "hello@yourdomain.com"
pnpm exec convex env set --prod RESEND_TEST_MODE false
pnpm exec convex env set --prod APP_ENV production
# optional — only if you use Google social login
pnpm exec convex env set --prod GOOGLE_CLIENT_ID <id>
pnpm exec convex env set --prod GOOGLE_CLIENT_SECRET <secret>
pnpm exec convex deploy
```

**Verify a deploy**

```bash
pnpm dlx vercel@latest ls --prod                   # latest deployments
pnpm dlx vercel@latest inspect <url> --wait        # block until Ready
curl -sI https://<your-vercel-domain>/             # expect HTTP 200
```

## Staging environment

A persistent test environment with its own Convex database and its own
Vercel frontend, isolated from prod. Architecture:

- **Convex**: a _separate Convex project_ (e.g. `albo-os-staging`) in the
  same team. Its "production" deployment is the staging database. This is
  the [officially recommended setup](https://docs.convex.dev/production)
  for a permanent staging env (Convex preview deployments are ephemeral
  and their rotating URLs break magic-link auth — `SITE_URL` must be
  stable).
- **Vercel**: a _second Vercel project_ importing the same repo, whose
  **Production Branch is `staging`**. Builds of that branch therefore run
  with `VERCEL_ENV=production`, so the existing `build:vercel` guard and
  the Convex CLI's deploy-key check both pass unchanged — front and
  backend deploy in lockstep, exactly like prod, just against the staging
  Convex project.

**One-time setup**

1. Convex dashboard → Create Project (same team), e.g. `albo-os-staging`.
   Project Settings → URL & Deploy Key → Generate **Production** Deploy
   Key. Keep it: this key is what distinguishes staging from prod
   everywhere below.
2. Provision the staging Convex env in one command:

   ```bash
   pnpm run setup:staging
   ```

   The script prompts for the staging deploy key + staging domain, mirrors
   Resend/Anthropic (and Google OAuth if set) from your dev env, generates
   a **fresh** `BETTER_AUTH_SECRET`, sets `APP_ENV=production`,
   `SITE_URL`/`BETTER_AUTH_URL` to the staging domain and
   `RESEND_TEST_MODE=false`, then runs `convex deploy` against staging.
   It deliberately does **not** mirror `POWENS_*` / `AIRTABLE_API_KEY`
   (Powens webhooks are registered per Powens domain — connecting banks
   from staging would leak real events across environments; staging gets
   bank data via snapshot import) nor `SENTRY_DSN` (keep staging noise out
   of prod Sentry).

3. Vercel dashboard → Add New → Project → import this repo **again** as a
   second project (e.g. `albo-os-staging`). Settings → Git → Production
   Branch = `staging`. Settings → Environment Variables (scope:
   Production):
   - `CONVEX_DEPLOY_KEY` = the staging deploy key from step 1
   - `VITE_CONVEX_SITE_URL` = the staging `.convex.site` URL
     (`VITE_CONVEX_URL` is injected by `convex deploy --cmd` at build
     time.)

   Optional: Settings → Git → Ignored Build Step →
   `[ "$VERCEL_ENV" = "production" ] || exit 0` so the staging project
   doesn't duplicate the PR previews already built by the main project.

4. Create the branch and trigger the first deploy:

   ```bash
   git push origin main:staging
   ```

5. If Google OAuth is enabled: register
   `https://<staging-domain>/api/auth/callback/google` as an extra
   redirect URI on the same OAuth client (see
   [KNOWN_ISSUES.md](KNOWN_ISSUES.md) § Google OAuth).

**Day-to-day process**

```bash
# 1. Develop on a feature branch, open a PR as usual.
# 2. To test on staging, point the staging branch at your branch:
git push origin my-feature-branch:staging --force
# → Vercel builds the staging project: convex deploy (staging) + front,
#   in lockstep, at the stable staging URL.
# 3. Validate by hand (TESTING.md levels 2-6 where relevant).
# 4. Merge the PR into main → prod deploys. Re-align staging when needed:
git push origin main:staging --force
```

`staging` is a throwaway pointer — force-pushing it is the intended
workflow; never base work on it.

**Test data on staging**

All `convex` CLI commands target staging by prefixing the deploy key:

```bash
# Option A — seeds (clean, idempotent):
CONVEX_DEPLOY_KEY="<staging-key>" pnpm exec convex run seed:seedAll '{"ownerEmail":"you@yourco.com"}'

# Option B — realistic copy of prod (snapshot export → import):
pnpm exec convex export --prod --path /tmp/albo-snapshot
CONVEX_DEPLOY_KEY="<staging-key>" pnpm exec convex import --replace /tmp/albo-snapshot/<file>.zip

# Inspect / tweak staging env:
CONVEX_DEPLOY_KEY="<staging-key>" pnpm exec convex env list
```

Accounts: Better Auth credentials live in a Convex component with a
staging-specific `BETTER_AUTH_SECRET`, so prod sessions never work on
staging. If after a snapshot import your email has an app `users` row but
no staging login, just sign up again on `/register` with the **same
email** — provisioning dedups by email and re-links the imported row
(roles and `superAdmin` included).

## CI / Ops

- Renovate: weekly, groups non-majors, automerges devDeps.
- `ci.yml`: install + typecheck on push/PR.
- `sync-skills.yml`: weekly skill freshness PR.
- `cleanup-branches.yml`: manual sweep (Actions → Run workflow) deleting
  branches whose PR is merged.

## Common commands

```bash
pnpm dev                          # vite + convex dev (concurrently)
pnpm typecheck                    # tsc --noEmit
pnpm run sync:skills              # pull latest SKILL.md files
pnpm run sync:skills:check        # exit 2 if any drifted
pnpm run init <name>              # personalize template
pnpm run upgrade-template         # merge upstream template changes
pnpm exec convex env list         # inspect Convex env vars
pnpm exec convex run admin:purgeExcept '{"keepEmail":"you@yourco.com"}'
```

## See also

- [TESTING.md](TESTING.md) — end-to-end test plan (auth, multi-tenant, AI…).
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — pinned versions and why.
- [CLAUDE.md](CLAUDE.md) — guidelines for AI-assisted work in this repo.
