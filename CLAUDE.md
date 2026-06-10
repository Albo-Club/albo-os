# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Keep the Docs and Skills Fresh

**Tidy-room rule** : every doc line earns its keep, every fact lives in exactly
one file. Surface non-obvious knowledge ; drift kills future you.

### Pre-PR doc audit (run it yourself, every PR, without being prompted)

Before pushing the final commit, walk through these five questions. If none
fire, write nothing — the diff and commit message already document the *what*.
Docs are for the *why* and the *trap*.

1. **Touched a route, page, env var, or workflow listed in `TESTING.md`** ?
   → update the matching row in the same PR.
2. **Hit a non-obvious gotcha that'd cost the next dev > 30 min** (SSR trap,
   pinned version, bundler quirk, API edge case) ? → add a section to
   `KNOWN_ISSUES.md`. Include the *why* and the workaround pattern.
3. **Found a stale claim while reading existing docs** (file path that no
   longer exists, flag that was renamed, API that changed) ? → fix it in the
   same commit as the change that made it stale.
4. **Discovered a behavioral rule worth applying to every future PR** ? → add
   it here in `CLAUDE.md`. Only for *repeatable* guidance, never as a
   changelog of what shipped.
5. **Shipped a change visible to end users** (new feature, UX change,
   behavior change) ? → add/extend the entry in `CHANGELOG_PRODUIT.md` in
   the same PR, in product language (no file paths, no function names).
   Bug fixes and pure refactors don't qualify.

### Where things live (don't duplicate across files)

- `README.md` — how to use, quickstart, public-facing onboarding.
- `TESTING.md` — manual + automated validation steps, organized per route /
  feature. Update when adding or changing a verifiable surface.
- `KNOWN_ISSUES.md` — traps, pinned versions, SSR/bundler/browser gotchas,
  "we tried X, here's why we chose Y". One section per trap.
- `CLAUDE.md` — repeatable behavioral rules for future agents. Never a
  changelog of completed work.
- `CHANGELOG_PRODUIT.md` — user-facing release notes in French, one entry
  per lot/release, product language. Hand-written (distinct from the
  technical `CHANGELOG.md` that release-please generates from commits).
- `AGENTS.md` — pointer to the agent-skill workflow. Static, rarely changes.

If you're about to add the same info to two of these files, you're doing it
wrong — link, don't duplicate.

### Skills

`.agents/skills/` is pulled from upstream — never edit in place
(`pnpm run sync:skills` overwrites). When upstream is wrong or missing,
override here via `CLAUDE.md` / `KNOWN_ISSUES.md`. When
`pnpm run sync:skills:check` reports drift, read the new SKILL.md and
update project overrides if needed — don't mute the check.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project-specific guide

## Domaine métier (Albo OS)

Albo OS = OS de pilotage du family office **CALTE** + holding d'invest
**Albo Club**. Outil interne (2 users : Benjamin + Clément), pas de SaaS public.

**Frontière d'attribution avec Attio** :

- **Attio** = source de vérité **avant** invest (dealflow, sourcing, term
  sheet, notes de call). Albo OS n'écrit pas dans Attio.
- **Albo OS** = source de vérité **après** signature (suivi participation,
  valorisations, KPIs portfolio, et plus tard cash management).
- Ponts conservés en base : `attioCompanyId` / `attioDealId` (strings,
  uniqueness gérée côté mutation, pas au schéma).

**Modèle multi-org (1 véhicule d'invest = 1 organisation)** :

- Chaque véhicule est une **organisation Better Auth distincte** : org `calte`
  (CALTE + Caltimo + RDB + Relais Chapelle + SCIs + Banco 2) et org `albo`
  (Albo Club). Une nouvelle entité d'invest = une **nouvelle org**.
- `companies.kind = "group_*"` = les **entités juridiques** d'une org (sa
  racine `group_root` + sous-entités) ; `portfolio` = les boîtes investies.
  Ne pas confondre l'**org** (le véhicule) avec ses `companies`.
- **Droits par org** via `organizationMembers.role` (owner/admin/member).
- **Vue agrégée cross-org** (`/app/all`, `convex/aggregate.ts`) : union
  **lecture seule** des deals de **toutes** les orgs dont l'user est membre
  (une nouvelle org y apparaît d'office). L'édition se fait dans la vue
  par-org. ⚠️ Il n'y a **plus** de champ `holdingScope` : le « scope » est
  désormais l'org elle-même.
- L'investisseur d'un deal est toujours une entité `group_*` de l'org (jamais
  une `portfolio`) — `assertInvestorIsGroupEntity` dans `convex/deals.ts`.

**Conventions de données** (à respecter partout, formatage à l'affichage
seulement) :

- **Montants** : entiers en **cents EUR**. `committedAmount: 100000` = 1 000 €.
- **Taux** : **basis points**. `1100` = 11 %, `10000` = 100 %.
- **Dates** : `number` ms epoch, toujours UTC. `new Date(value)` à l'affichage.
- **Currency** : `"EUR"` par défaut sur tout deal.
- **Uniqueness** (`siren`, `attioDealId`, `attioCompanyId`) : Convex ne
  supporte pas les contraintes unique au schéma → enforcer dans les mutations
  create/update (helpers dans `convex/lib/`).
- **Multi-tenant strict** : aucune query/mutation ne lit/écrit sans avoir
  passé `requireOrgMember(ctx, orgId)`. Pas d'exception.

**État du schéma** : `companies`, `companyRelations`, `deals`, `valuations`,
`kpiSnapshots` (cœur portfolio). `bankAccounts` + `transactions` sont
alimentées (Powens/import) ; le pointage transaction → deal vit dans
`convex/transactions.ts` (`matchStatus` + table `matchingDecisions`
append-only — cf. `KNOWN_ISSUES.md` « Pointage transaction → deal »).
Le prévisionnel de cash vit dans `forecastRules` + `forecastEntries`
(`convex/forecasts.ts` : `expandRules` idempotent, `getForecastBalance`
mensuel, pointage `markEntryRealized` — cf. `KNOWN_ISSUES.md` « Cash flow
forecast »). Le passif vit dans `equityPositions` + `intercompanyLoans`,
avec pointage généralisé `transactions.allocation` et soldes de C/C
**dérivés** des transactions (`convex/liabilities.ts:getLiabilities` —
cf. `KNOWN_ISSUES.md` « Passif »). La table legacy `forecasts` reste
**déclarée mais inerte** (alimentée par l'import Airtable uniquement, lue
par rien).

**Workflow déploiement** : outil interne, **prod-only** (pas de déploiement
dev). Le code part en prod via le build Vercel sur `main` (`build:vercel` →
`convex deploy`). Les seeds/migrations : `convex run --prod` (snapshot
`convex export --prod` avant toute opération destructive ; seeds idempotents).
Changement de schéma cassant (retrait de champ) : purger la donnée d'abord
puis resserrer (cf. `convex/seed.ts` `cleanupLegacy`/`seedAll`).

> Contexte complet (structure du groupe, instruments, comptes bancaires,
> écosystèmes OPRTRS/SIDE) : Notion « Architecture Base de données ».

## Plan de test bout-en-bout

Avant de dériver le template en projet de prod, dérouler `TESTING.md`
(niveaux 1 → 6, ~70 min). Le niveau 1 est automatisé (`pnpm typecheck`,
`pnpm lint`, `pnpm build`, `pnpm test:smoke`, `pnpm sync:skills:check`),
le reste est manuel — checklist de signoff pour valider auth, multi-tenant,
invitations, uploads, account lifecycle, super-admin, AI chat, sécurité.
(Le CRUD métier companies/deals s'ajoute à TESTING.md avec la V0.)

## Stack

- **Frontend** : React 19 + TypeScript strict, TanStack Start v1 (Node server target), TanStack Router (file-based, `src/routes/`), TanStack Query, TanStack Form + Zod, Vite.
- **Styling** : Tailwind CSS v4 (CSS-first, no `tailwind.config.js`), shadcn/ui (neutral theme, `src/components/ui/`), Inter, radius `0.5rem`, tokens in `src/styles/brand.css` (oklch).
- **Backend** : Convex (`^1.x`) — queries, mutations, actions, HTTP routes, file storage, components.
- **Auth** : Better Auth via `@convex-dev/better-auth` with `magicLink()` + `convex()`. Multi-tenant (orgs/members/invitations/roles) is implemented **natively in the Convex schema** (`organizations`, `organizationMembers`, `invitations` tables). The BA `organization()` plugin is deliberately **not loaded** — its tables aren't first-class Convex (no `withIndex` joins). See `KNOWN_ISSUES.md` for trade-offs.
- **Emails** : `@convex-dev/resend` for transactional.
- **AI** : `@convex-dev/agent` backend (default model `claude-haiku-4-5`, override via `ANTHROPIC_MODEL`) + front maison sur `useUIMessages` de `@convex-dev/agent/react` (panneau latéral persistant `src/components/ai/AiPanel.tsx`, markdown via `react-markdown`, threads/rename/stop). Streaming in-app via mutation `sendMessage` + query `listMessages` (la route HTTP `/api/chat` est un one-shot annexe). Provider abstracted via `getModel()` in `convex/agent.ts` ; system prompt par message via `buildInstructions` (`convex/lib/instructions.ts`, contexte route + org). L'agent expose des **outils DB scopés à l'org** (`convex/agentTools.ts`) : `listCompanies` / `listDeals`, `createCompany` (portfolio uniquement), `createDeal` (scope dérivé de l'investisseur via `resolveScope`), `updateDeal`. Chaque outil re-vérifie l'appartenance via la scope key `${orgId}:${userId}` du thread (l'action de stream n'a pas d'identité auth → `actorUserId` passé explicitement).
- **File storage** : Convex native (`ctx.storage.generateUploadUrl()`), 20 MB cap.
- **Observability** : Sentry (front + Convex actions). CORS strict, security headers, HMAC verify on webhooks.

## Skills (READ BEFORE CODING)

**Obligation** : avant d'écrire ou de modifier du code touchant un des
domaines ci-dessous, lis la skill correspondante dans `.agents/skills/`
(symlinkée dans `.claude/skills/`). Elle remplace tes connaissances
d'entraînement, qui sont périmées sur ces libs.

Manifest : `skills-lock.json` (source, chemin upstream, hash SHA-256).
Sync hebdo via GitHub Action (`.github/workflows/sync-skills.yml`,
lundi 06:00 UTC) + manuel via `pnpm run sync:skills`.
Vérifier la dérive : `pnpm run sync:skills:check`.

| Skill                                     | Domaine                                | Source upstream                            | Officiel ? |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------ | ---------- |
| `convex`                                  | Routeur entre skills Convex            | `get-convex/agent-skills`                  | ✅ officiel |
| `convex-quickstart`                       | Bootstrap Convex                       | `get-convex/agent-skills`                  | ✅ officiel |
| `convex-setup-auth`                       | Auth Convex + identité + RBAC          | `get-convex/agent-skills`                  | ✅ officiel |
| `convex-create-component`                 | Construire un composant Convex         | `get-convex/agent-skills`                  | ✅ officiel |
| `convex-migration-helper`                 | Migrations de schéma / data            | `get-convex/agent-skills`                  | ✅ officiel |
| `convex-performance-audit`                | Audit perf reads/subscriptions/OCC     | `get-convex/agent-skills`                  | ✅ officiel |
| `better-auth-best-practices`              | Config Better Auth générale            | `better-auth/skills`                       | ✅ officiel |
| `better-auth-security-best-practices`     | Hardening (rate-limit, CSRF, sessions) | `better-auth/skills`                       | ✅ officiel |
| `email-and-password-best-practices`       | Email/password BA                      | `better-auth/skills`                       | ✅ officiel |
| `two-factor-authentication-best-practices`| 2FA / TOTP / backup codes              | `better-auth/skills`                       | ✅ officiel |
| `organization-best-practices`             | Plugin `organization()` BA             | `better-auth/skills`                       | ✅ officiel ⚠️ |
| `create-auth-skill`                       | Scaffolding auth BA                    | `better-auth/skills`                       | ✅ officiel |
| `tanstack-start-best-practices`           | SSR, server functions, middleware      | `deckardger/tanstack-agent-skills`         | ⚠️ communauté |

**⚠️ `organization-best-practices`** : skill officielle BA, mais le plugin
`organization()` est **désactivé** dans ce projet (voir `KNOWN_ISSUES.md`).
Lis-la pour comprendre les concepts ; n'applique pas le code BA tel quel —
nos orgs/membres vivent dans le schéma Convex maison.

**⚠️ TanStack Start (`deckardger/tanstack-agent-skills`)** : TanStack ne
publie pas (encore) de skill officielle. La meilleure source communautaire est
le repo de Deckardger. Stratégie de maintenance :
1. Vérifier le repo upstream tous les 1–2 mois (le sync hebdo détecte la dérive).
2. Si la qualité se dégrade ou si TanStack publie un repo officiel, changer le
   `source` + `skillPath` dans `skills-lock.json` et relancer `pnpm run sync:skills`.
3. À défaut, fallback sur le MCP `context7` (`mcp__…__query-docs`) pour
   `/tanstack/start` à la demande.

**shadcn/ui** : pas de skill agent à ce jour. Les conventions vivent dans
`components.json` (alias `@/components`, neutral theme, radius 0.5rem, tokens
oklch dans `src/styles/brand.css`). Pour générer/maj un composant, utilise le
CLI `pnpm dlx shadcn@latest add <component>` ou le MCP shadcn si configuré.
Ne JAMAIS modifier `src/components/ui/*` à la main pour le restyler — passer
par les tokens CSS.

**Better Auth UI** (`better-auth-ui.com`, `daveyplate/better-auth-ui`,
shadcn registry, v1.6.x, actif) : kit drop-in officieux pour Better Auth qui
shippe `<SignIn>`, `<SignUp>`, `<ForgotPassword>`, `<ResetPassword>`,
`<SignOut>`, `<Settings>`, `<AccountSettings>`, `<ChangeEmail>`,
`<ChangePassword>`, `<SecuritySettings>`, `<ActiveSessions>`,
`<LinkedAccounts>`, `<UserButton>`, `<UserAvatar>`, plus des hooks React
(`useSession`, `useListSessions`, `useChangePassword`, …) et des templates
email (`<EmailVerificationEmail>`, `<MagicLinkEmail>`, `<PasswordChangedEmail>`,
`<NewDeviceEmail>`, …). Install via `pnpm dlx shadcn@latest add
https://better-auth-ui.com/r/auth.json`. Inventaire complet :
`better-auth-ui.com/llms.txt`.

**Quand consulter** : nouveaux projets ou nouvelles surfaces auth (passkey,
multi-session, OAuth providers, OTP, sessions actives, captcha). Ne **pas**
migrer rétroactivement `/login`, `/register`, `/forgot-password`,
`/reset-password` : on a déjà du custom au-dessus (anti-enum, classifier
d'erreurs, HIBP, zxcvbn meter, FieldDescription, inline alert) que le kit
ne couvre pas. Pour les **gaps** identifiés vs Better Auth UI (sessions
actives, notifs post-event, linked accounts), évaluer au cas par cas si on
adopte les composants drop-in ou si on roule à la main pour rester
cohérent avec le reste du projet.

**Guidelines Convex spécifiques projet** : `convex/_generated/ai/guidelines.md`
(régénéré par `convex dev`). Lecture obligatoire avant patterns Convex non
triviaux — il override tout, y compris les skills upstream.

## Routing conventions

- Imports from `@tanstack/react-router`, never `react-router-dom`.
- No trailing slash in paths.
- Every route with a loader must define `errorComponent` AND `notFoundComponent`.
- Shareable routes must have their own `head()` with title, description, og:\*.
- Anchors `#section` only for intra-page (TOC, long FAQ).
- Naming convention: flat with dots (`posts.$postId.tsx`).

## Server functions vs Convex

- **Live data (read/write DB)** → `useQuery(api.foo.bar)` / `useMutation(api.foo.create)` client-side (Convex real-time auto).
- **Server business logic + LLM calls** → Convex `action` with `"use node"` if Node-only deps.
- **Transactional email** → Convex `action` + `@convex-dev/resend`.
- **Incoming webhook** → Convex HTTP route in `convex/http.ts`.
- **Auth proxy** → `createServerFn` or TanStack route `server.handlers`.
- **Read a secret + complex logic** → `createServerFn`.

## Multi-tenant recipes

### Query data scoped to an org

```ts
// convex/deals.ts
export const list = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const user = await requireAppUser(ctx)
    await requireOrgMember(ctx, { orgId, userId: user._id })
    return ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
  },
})
```

### Mutation with role check

```ts
export const remove = mutation({
  args: { dealId: v.id('deals') },
  handler: async (ctx, { dealId }) => {
    const user = await requireAppUser(ctx)
    const deal = await ctx.db.get(dealId)
    if (!deal) throw new ConvexError('not_found')
    await requireOrgRole(ctx, {
      orgId: deal.orgId,
      userId: user._id,
      minRole: 'admin',
    })
    await ctx.db.delete(dealId)
  },
})
```

### Protect a route by org membership

`/app/$orgSlug/route.tsx` :

- Auth guard (redirect `/login` if no session).
- Resolve `orgSlug` → `orgId` via Convex.
- Check membership; otherwise redirect `/app`.
- Store `orgId` in child router context.

## Anti-patterns

- ❌ `process.env.X` at top-level of a file imported client-side.
- ❌ `VITE_` prefix on a secret.
- ❌ DB / secret key directly in a `loader` (loaders are isomorphic).
- ❌ `react-router-dom` instead of `@tanstack/react-router`.
- ❌ Hard-coded color in `className`.
- ❌ User role stored on BA user table (use `users.superAdmin` or `organizationMembers.role`).
- ❌ Role check via `localStorage`.
- ❌ `await prefetchQuery(...)` (blocks navigation).
- ❌ `QueryClient` as module-level singleton.
- ❌ `ConvexReactClient` recreated each render.
- ❌ Loading BA plugin `admin()` (breaks signup validator).
- ❌ Inline BA triggers (TS inference cycle with `internal.users.*`).
- ❌ Enabling a new BA auth method without checking **both** conditions:
  (1) the method produces a verified email on first use (magic link,
  OAuth, or email/password with `requireEmailVerification: true`), and
  (2) `account.accountLinking.enabled: true` is set in `createAuth`.
  Skipping either creates duplicate BA users — and therefore duplicate
  Convex `users` rows — for the same email. See `KNOWN_ISSUES.md`
  "Account linking & verified email".
- ❌ Dedup users by `betterAuthId` only in any new code path. Always
  also fall back to email via `withIndex('by_email', ...)` — pattern in
  `convex/lib/auth.ts:provisionAppUser`.
- ❌ Surfacing Better Auth errors via `error.message` (or worse, a regex
  on it) in any new client code. Always classify through
  `classifyAuthError()` + `formatAuthError(code, ctx)` from
  `src/lib/auth-errors.ts`. Reason: BA codes are granular (USER_NOT_FOUND
  vs INVALID_PASSWORD vs INVALID_EMAIL_OR_PASSWORD) and surfacing them raw
  leaks enumeration. Raw `error.message` is also locale-fragile and may
  change between BA versions. The classifier collapses safe equivalence
  classes and centralises the user-facing copy.
- ❌ Anchor `#section` for nav between major sections.
- ❌ Unrequested dark/light toggle.
- ❌ `tailwind.config.js` (Tailwind v4 is CSS-first).
- ❌ Editing `routeTree.gen.ts` or `convex/_generated/*` manually.
- ❌ Hardcoding a user-facing string anywhere (UI **or** transactional
  email). All user-facing copy goes through i18n: `t()` from react-i18next
  with namespaced keys in `src/locales/{en,fr}/<ns>.json`, or the bilingual
  templates in `convex/emailTemplates.ts`. **Dev-facing** strings stay in
  English and are never translated: internal error codes
  (`ConvexError('not_found')`, `AuthErrorCode` values), logs, comments,
  i18n key names. New strings need both an `en` and a `fr` entry. See
  `KNOWN_ISSUES.md` "i18n (react-i18next) SSR" for the no-flash rules.
- ❌ Module-level Zod schema carrying a hardcoded user-facing message. Build
  the schema inside the component via `useMemo(() => z.object({...}), [t])`
  so messages resolve from the `validation` namespace.
- ❌ A hardcoded page `<title>` in a route `head()`. `head()` runs outside
  React — resolve titles with
  `getI18n(getLocale()).getFixedT(null, '<ns>')('key')`.
- ❌ Surfacing an auth error via raw copy. Classify with `classifyAuthError`,
  then `formatAuthError(code, ctx, t)` where `t` resolves the `errors`
  namespace (pass `(k) => t(\`errors:${k}\`)`).

## Security

- Application roles in `users.superAdmin` and `organizationMembers.role`, NEVER in the BA user table.
- Auth checks always server-side via helpers (`requireAppUser`, `requireOrgMember`, `requireOrgRole`, `requireSuperAdmin`).
- Secrets via `pnpm exec convex env set X <value>` or `.env.local` (never committed).
- No `VITE_` prefix on secrets.
- HMAC verify on every incoming webhook (`crypto.timingSafeEqual`).
- Better Auth CORS reduced to origins allowed in `BETTER_AUTH_URL`.

## Dev workflow

- `pnpm add <pkg>` BEFORE writing the import (otherwise Vite hard-fails).
- Create the target file BEFORE writing a local import.
- `pnpm dev` runs Vite + `convex dev` in parallel (via `concurrently`).
- Before commit: `pnpm typecheck` must pass + Convex log must show `ready`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
