# Template sync (Albo OS → template)

Backlog of **"core"** improvements made in Albo OS that are worth pushing back
into the [`albo-ouvre-boite`](https://github.com/Albo-Club/albo-ouvre-boite)
template. This is the **reverse direction** of [`UPGRADING.md`](UPGRADING.md)
(which pulls template changes *into* Albo OS).

There is no automation here on purpose: the agent only **flags** candidates,
Benjamin/Clément **port** the code into the template by hand when they choose
to. Keeping the human in the loop avoids leaking business logic upstream and
lets us generalise the code before it lands in the starter.

## Workflow

1. **At each PR** (see `CLAUDE.md` § "Pre-PR doc audit", question 6): if the
   change touches reusable core code, the agent adds a row to the backlog
   below **and** a short "Template sync" section to the PR description.
2. **When you want to upstream one**: port the code into `albo-ouvre-boite`
   (de-branding / removing any Albo OS specifics as needed), open the PR
   there, then update the row's **Status** here.
3. **Once landed or dropped**: mark the row `✅ upstreamed (#PR)` or
   `❌ dropped (reason)`. Prune rows that are fully resolved when the table
   gets long — git history keeps the trace.

## What qualifies

✅ **Push to the template** — generic, project-agnostic:

- Auth / Better Auth config, multi-tenant plumbing, `convex/lib/` helpers.
- Security (CORS, headers, HMAC webhook verify, rate limiting).
- Reusable UI primitives in `src/components/ui/*`, i18n / SSR patterns.
- DX & tooling: scripts, CI workflows, config, the skills pipeline.
- Bug fixes in code the template also ships.

❌ **Stays in Albo OS** — business/domain specific:

- Portfolio domain: deals, companies, valuations, KPIs, cash, forecasts,
  liabilities, transaction pointage.
- Domain-specific AI tools (`convex/agentTools*.ts`) and their prompts.
- Anything tied to CALTE / Albo Club org structure or seeds.

When a change is *mostly* generic but carries a domain detail, flag the
generic slice only and note what needs stripping before it goes upstream.

## Backlog

| Date       | Candidate | Files (Albo OS) | Why it's generic | Status |
| ---------- | --------- | --------------- | ---------------- | ------ |
| 2026-07-02 | `InlineField` — click-to-edit field primitive | `src/components/ui/inline-field.tsx` | Generic inline editor (click → format-aware input → Enter/blur save, Esc cancel) usable on any fiche. Ships two resting layouts via `layout`: `stacked` (label above value) and `row` (label left / value right + hairline), the latter being what a narrow side panel needs to keep long labels on one line — both are project-agnostic. **Strip before upstream:** decouple from `~/lib/parse` `FieldFormat`/`parseField`/`rawToInput` (instrument display formats) — make the format/parse layer injectable so it isn't tied to the portfolio domain. | ⏳ flagged |
| 2026-07-14 | `normalizeDomain` — messy-domain → bare hostname | `convex/lib/domain.ts` (+ `tests/domain.test.ts`) | Pure, dependency-free: unwraps markdown links `[…](…)`, strips protocol/path/query/`www.`, lowercases, `null` if irreducible. Useful anywhere a domain feeds a logo hotlink or a fetch. No project coupling — port as-is. | ⏳ flagged |
| 2026-07-20 | External-connections core — registry + generic storage + control-tower UI | `convex/lib/connectors.ts`, `convex/connections.ts`, `externalConnections` table (schema), `src/routes/app/$orgSlug/settings/integrations.tsx` (+ `tests/connectors.test.ts`) | Generic infra for any app talking to external platforms: declarative connector registry (scope / auth kind / required keys), one `externalConnections` table with secrets at rest, shared lifecycle (CLI seed + admin-gated in-app connect/disconnect), per-auth-kind `status`/`listIntegrations`, and a registry-driven Integrations settings page (installed vs available, generic connect form). **Strip before upstream:** the Albo-specific registry entries (powens/vasco/notion/docsend) and the `connectionHealth` import from `powens.ts` — ship the core with an empty registry. | ⏳ flagged |
| 2026-07-20 | SSR warm-up cron — keep the Vercel function hot | `convex/warmup.ts`, cron `warm vercel ssr` in `convex/crons.ts` | Any low-traffic internal tool on Vercel pays a 1-3s cold start on most arrivals. A 5-min Convex cron `fetch(SITE_URL)` (with the localhost guard from `auth.ts`) keeps one instance warm. Zero project coupling — port as-is. | ⏳ flagged |
| 2026-07-21 | Webview connector dispatch + OAuth mailbox pattern | `convex/connections.ts` (per-platform webview dispatch in `listIntegrations`/`status`/`syncNow`), `convex/gmail.ts` (OAuth flow: one-shot anti-CSRF state table, HTTP callback route, token refresh with reauth detection — **file removed with the emails feature, recover it from git history before #288**), `gmailOAuthStates` table (schema, still declared inert) | The external-connections core (flagged 2026-07-20) assumed a single webview platform (Powens); the dispatch generalizes it to N webview connectors. The OAuth round-trip (state mutation → provider consent → HTTP callback → upsert + redirect back in-app) is a reusable pattern for any OAuth-connected platform. **Strip before upstream:** the Gmail-specific sync/matching (portfolio business logic stays in Albo OS). | ⏳ flagged |
| 2026-07-21 | Dependency auto-update workflow — weekly validated `pnpm update` PR | `.github/workflows/update-deps.yml`, `scripts/update-deps.mjs` | Same pattern as `sync-skills.yml`: weekly cron runs `pnpm update` (semver ranges only, no major jumps), runs lint/tests/build in the workflow (auto-PRs made with `GITHUB_TOKEN` don't trigger CI), then opens a validated `chore/update-deps` PR listing the bumped packages. Replaces the dormant Renovate app dependency. **Strip before upstream:** the changelog-entry generation (CHANGELOG_PRODUIT.md is Albo OS-specific). | ⏳ flagged |
| 2026-07-20 | Lazy-loaded AI panel — markdown stack off the critical path | `src/routes/app/$orgSlug/route.tsx` (`React.lazy` + `Suspense` around `AiPanel`) | The static `AiPanel` import drags streamdown/ai-elements (~90 kB gz) into the org layout chunk of every app page. The lazy pattern (named-export `.then`) shrinks the layout chunk ~180 → ~12 kB and applies to the template's identical AiPanel wiring. | ⏳ flagged |
| 2026-07-21 | SSR session preload — `initialToken` wiring for TanStack Start | `src/lib/auth-server.ts`, `src/routes/__root.tsx` (getAuth + beforeLoad + provider), `src/router.tsx` (context), `src/routes/api/auth/$.ts` | Official `@convex-dev/better-auth` react-start pattern: server reads the BA cookie on the document request and hands the Convex JWT to `ConvexBetterAuthProvider` via `initialToken`, collapsing the client-side get-session → token → WS-auth waterfall. The `typeof window` guard in beforeLoad (dehydrated context, no per-SPA-nav round trip) is the non-obvious part — port with the KNOWN_ISSUES « Préchargement de session SSR » notes. Zero business coupling. | ⏳ flagged |
| 2026-07-26 | `sync:skills --verify` — offline integrity gate + self-healing sync | `scripts/sync-skills.mjs` (`hashLocal`, `runVerify`, self-heal in `runSync`), `.github/workflows/ci.yml` (job `skills-verify` replaces `skills-drift`), `package.json` | **The template has this exact bug** — its own `sync-skills.mjs` (which we vendored verbatim in #281) compares the lock to *upstream* and never re-hashes what's on disk; `isVendored()` only checks existence. A vendored file edited, truncated or left stale is invisible to both `--check` and the default sync. Demonstrated: appending a line to a `SKILL.md` leaves `--check` green, exit 0. It is what let three Convex `references/` files rot (one 54 lines behind). Fix is ~40 lines: `hashLocal()` mirrors `fetchSkillAt()` against the working tree, `--verify` compares to `computedHash` (no network → can't flake CI), and `runSync` rewrites on local mismatch so a plain `sync:skills` repairs itself. CI split: `--verify` blocks every PR, upstream drift moves to the SessionStart hook + weekly cron. Zero project coupling — port as-is. | ⏳ flagged |
| 2026-07-27 | `--info` color token — blue sibling of `--warning`/`--positive` | `src/styles/brand.css` (`--info` + `--color-info` mapping, light/dark) | Any status system needs a neutral-positive "active/in progress" blue next to the green/red/amber trio; defined once as an oklch token pair, theme-aware. Port as-is. | ⏳ flagged |
| 2026-07-28 | Semantic-search socle — `@convex-dev/rag` + OpenRouter embeddings, org-scoped | `convex/vectorize.ts`, `convex/convex.config.ts` (rag), `convex/agentToolsDocuments.ts` | Generic RAG wiring for any multi-tenant app: one namespace per org, key-based idempotent ingestion (`add` replaces by key), pinned embedding model via the OpenRouter provider already used for chat, membership re-check before every search, delete-on-remove scheduling, per-org backfill. **Strip before upstream:** the `documents`/`companyReports` bindings and the OCR/excel extraction (business pipeline) — ship the RAG instance + search tool + backfill skeleton. | ⏳ flagged |
