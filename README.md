# albo-os — l'ouvre-boîte

Opinionated B2B SaaS MVP starter: **TanStack Start + Convex + Better Auth + Resend + OpenRouter + Tailwind v4**.

Multi-tenant by default (orgs, members, invitations, roles), with an AI chat
sidebar wired in, transactional emails, rate-limiting, and CI/CD on day one.

## Stack

| Layer        | Choice                                                        |
| ------------ | ------------------------------------------------------------- |
| Front-end    | React 19 · TanStack Start v1 · TanStack Router (file-based)   |
| State / data | TanStack Query · Convex (real-time queries, mutations, HTTP)  |
| Forms        | TanStack Form · Zod                                           |
| Styling      | Tailwind v4 (CSS-first) · shadcn/ui · Inter · tokens in oklch |
| Auth         | Better Auth (email/password + magic link) + `organization()`  |
| Email        | Resend (HTML + plain text templates)                          |
| AI           | Convex Agent + OpenRouter (DeepSeek V4 Pro default, with tools) |
| Limiter      | `@convex-dev/rate-limiter`                                    |
| Observ.      | Sentry (front-end), Convex built-in logs                      |

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
4. **API keys** — prompts for OpenRouter + Resend with direct dashboard links
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
  agent.ts             AI agent instance (OpenRouter, default DeepSeek V4 Pro)
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
(`${orgId}:${userId}`). Tool calls cap out at 12 rounds per turn
(`stepCountIs(12)`).

There's also an HTTP streaming endpoint at `<convex-site-url>/api/chat` for
clients that prefer plain HTTP streaming (curl, custom clients).

## Telegram bot

The same agent (same tools, same org scoping, same write approvals) is
reachable from Telegram (`convex/telegram.ts`, webhook at
`<convex-site-url>/telegram/webhook`). Write tools show inline
**Confirmer / Refuser** buttons. Commands: `/new` (fresh thread),
`/org <slug>` (switch the current org, membership re-checked).

**One-time setup**

1. Create the bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and
   grab the token.
2. ```bash
   pnpm exec convex env set --prod TELEGRAM_BOT_TOKEN <token>
   pnpm exec convex env set --prod TELEGRAM_WEBHOOK_SECRET <random-string>
   ```
3. Register the webhook (secret echoed by Telegram on every update, verified
   by the handler):
   ```bash
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -d "url=<convex-site-url>/telegram/webhook" \
     -d "secret_token=<random-string>"
   ```
4. Link each user (one-shot code, valid 24h):
   ```bash
   pnpm exec convex run --prod telegram:createLinkCode \
     '{"email":"<user email>","orgSlug":"<org>"}'
   ```
   The user opens `https://t.me/<bot>?start=<code>` (or sends
   `/start <code>` to the bot).

## MCP server (claude.ai connector)

A remote MCP server (`convex/mcp/`, Streamable HTTP endpoint at
`<convex-site-url>/mcp`) exposes the **read-only** portfolio tools (~18:
deals, cash, pointage, liabilities, forecasts, valuations, KPIs) to external
MCP clients. No write tools on this surface. Auth is OAuth 2.1 (PKCE +
dynamic client registration) provided by the Better Auth `mcp` plugin — the
flow goes through the regular `/login` page, and each user only sees the
orgs they are a member of.

**Connect from claude.ai**

1. claude.ai → Settings → Connectors → *Add custom connector*.
2. URL: `<convex-site-url>/mcp`
   (e.g. `https://<deployment>.convex.site/mcp`).
3. Complete the OAuth sign-in with your Albo OS account.

**Testing without OAuth** (curl / MCP Inspector): set both env vars, then
send `Authorization: Bearer <random-string>`. Unset them when done — never
leave them in prod outside a test session.

```bash
pnpm exec convex env set --prod MCP_DEV_TOKEN <random-string>
pnpm exec convex env set --prod MCP_DEV_EMAIL <user email>
```

Validation checklist: `TESTING.md` « Serveur MCP » ; OAuth gotchas and
fallbacks: `KNOWN_ISSUES.md` « Serveur MCP distant ».

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
secrets (Resend, OpenRouter, optional Sentry, and the Google OAuth credentials
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
pnpm exec convex env set --prod OPENROUTER_API_KEY <key>...
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
