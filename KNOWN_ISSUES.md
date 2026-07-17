# Known issues

Pinned versions, workarounds, and rough edges. Update this file as upstream
fixes land so renovate (which respects `pnpm.overrides`) can be unblocked.

## Account linking & verified email (anti-doublon)

### What went wrong (the trap)

Initial config in `convex/auth.ts` had:

- `emailAndPassword.requireEmailVerification: false` — password sign-up
  produced an **untrusted** BA account (BA can't confirm the user owns
  the mailbox).
- `magicLink` plugin — produced a **trusted** account on first click.
- **No `account.accountLinking`** — BA's default is `enabled: false`.

When a single human signed up via `/register` (password) then later
clicked a magic link with the same email, BA created **two distinct BA
users** (different `betterAuthId`). Our `provisionAppUser` then inserted
**two `users` rows** into Convex with the same email, because it
dedup'd only by `betterAuthId`.

Result : prod had two duplicate `users` rows for one human.

### The rule (anti-récidive)

**Before adding or modifying any auth method in `convex/auth.ts`**, check
all three :

1. **All enabled methods must be trusted.** A method is trusted when BA
   marks `emailVerified: true` after the first sign-in. Sources of
   trust : magic link, OAuth (Google/GitHub/…), or email/password with
   `requireEmailVerification: true`. **Never enable email/password with
   verification off if any other method is enabled.**
2. **`account.accountLinking.enabled: true` in `createAuth(...)`.**
   Without it, two trusted methods with the same email still produce
   two BA users. With it, BA auto-links on the second sign-in.
3. **Convex-side dedup**: `provisionAppUser` in `convex/lib/auth.ts`
   already falls back from `betterAuthId` lookup to email lookup, and
   re-points the existing row's `betterAuthId` instead of inserting.
   If you ever write a new "create app user" code path, copy that
   pattern — don't dedup on `betterAuthId` alone.
4. **Magic link must not auto-sign-up**:
   `magicLink({ disableSignUp: true })` is mandatory. Our only legit
   entry point is `/register` (password + verification). Without it,
   any random email gets a verified BA account on first link click,
   bypassing the `/register` flow and leaving password-less accounts
   that later 500 on `signIn.email`.

### Security coupling

Conditions (1) and (2) are coupled. If you enable account linking but
let one method stay untrusted, an attacker can register
`victim@example.com` with their own password (no verification needed),
wait for the victim to OAuth/magic-link with the same email, and BA
will silently link the attacker's password account to the victim's
session → account takeover.

Verified email closes the hole : the attacker's password account stays
unverified, so BA refuses to link it.

### Legacy users

Comptes prod créés avant ce fix ont `emailVerified: false` côté BA. Au
prochain `signIn.email`, ils seront bloqués — l'écran `/login` détecte
`EMAIL_NOT_VERIFIED` et propose "Resend verification email" pour
débloquer. Pas de migration automatique.

Pour les doublons `users` déjà créés en prod, `provisionAppUser` les
convergera vers une seule rangée au prochain login du user, mais le
second BA user reste en base. Cleanup manuel via dashboard Convex.

## Invitation : signup sans vérification email (token-gated)

Un invité qui suit le lien signé `/accept-invite/<token>` a déjà prouvé la
possession de sa boîte mail. On lui évite donc l'écran « vérifie ton email ».
Trois pièges, dans l'ordre où on s'y est cogné :

1. **`emailVerified: true` ne suffit PAS à ouvrir une session au signup.**
   Avec `requireEmailVerification: true` (global), better-auth calcule
   `shouldSkipAutoSignIn = autoSignIn === false || requireEmailVerification`
   (`sign-up.mjs`), donc `signUp.email` renvoie **toujours** `token: null`
   (pas de session), **quelle que soit** la valeur de `emailVerified`. Le hook
   `databaseHooks.user.create.before` (`convex/auth.ts`) peut bien forcer
   `emailVerified` à la création (il enveloppe l'écriture de l'adapter), mais
   ça ne déclenche pas l'auto-sign-in. **Le front doit enchaîner
   `signUp → signIn` lui-même** : une fois l'utilisateur vérifié, `signIn.email`
   passe (`sign-in.mjs` ne bloque que `requireEmailVerification && !verified`)
   et crée la session, puis l'effet d'auto-accept de la page accept-invite
   tire `invitations.accept`.

2. **Token-gated, pas email-gated.** Le hook ne pose `emailVerified` que si le
   signup porte un **token d'invitation valide** pour cet email exact
   (`internal.invitations.validateInviteForSignup`). Connaître un email invité
   ne suffit pas → on ne peut pas pré-enregistrer un compte vérifié sans le
   token. Défaut sûr : token absent/invalide/expiré/déjà utilisé → vérification
   email normale, **sans throw** (le signup suit son cours). Conséquence : ne
   **jamais** rendre le hook email-gated (il rouvrirait ce trou).

3. **Le token transite dans le body du signup.** Le front passe `inviteToken`
   en plus des champs BA déclarés ; le client better-auth forwarde tout le
   premier argument (sauf `fetchOptions`/`query`) dans le body (`proxy.mjs`),
   et `sign-up.mjs` conserve `ctx.body` intact (les champs inconnus ne sont pas
   persistés sur le user, juste lisibles par le hook). Comme `inviteToken`
   n'est pas un champ BA déclaré, l'objet littéral passé à `signUp.email` exige
   un cast `as Parameters<typeof authClient.signUp.email>[0]` (l'excess property
   check frappe les littéraux ; un spread, comme dans `register.tsx`, n'en a pas
   besoin). On joint aussi `callbackURL=/accept-invite/<token>` comme **filet** :
   si le bypass ne s'applique pas, le lien de vérification ramène quand même sur
   la page d'accept et l'invitation est honorée au retour.

Logique pure isolée dans `convex/lib/invitations.ts` (`isInviteLiveForSignup`,
`emailsMatch`) et testée dans `tests/invitations.test.ts` ; le parcours complet
(signup → signin → accept) se valide à la main via TESTING.md (M3, I5, I9–I12).

## Google OAuth (template — opt-in)

Google social login is wired but **off by default** so the repo stays a clean
template. It activates only when **both** `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set in the Convex env. The `socialProviders` block in
`convex/auth.ts` is spread conditionally on that, and the frontend hides the
button via `api.publicConfig.enabledSocialProviders` (a boolean query — env
presence, never the secret). Pattern: a missing provider must render _nothing_,
not a dead/broken button.

### Enabling it

1. Create an OAuth client in Google Cloud Console → Credentials.
2. **Authorized redirect URI** = `${SITE_URL}/api/auth/callback/google` (the BA
   default; the request flows through the TanStack proxy `src/routes/api/auth/$.ts`
   → Convex handler). Register both the dev (`http://localhost:3000/...`) and the
   prod URL.
3. `pnpm exec convex env set GOOGLE_CLIENT_ID …` / `… GOOGLE_CLIENT_SECRET …`
   (or answer the optional prompt in `pnpm run setup`).
4. **Prod**: `pnpm run setup:prod` mirrors the dev `GOOGLE_*` creds to the prod
   deployment automatically (same OAuth client). The prod redirect URI is _not_
   set for you — add `https://<prod-domain>/api/auth/callback/google` to the same
   Google client by hand (step 2), or sign-in fails with `redirect_uri_mismatch`.

### Why it's safe vs the account-linking trap

Google returns a **verified** email on first sign-in, so it satisfies rule (1)
of "Account linking & verified email" above (all enabled methods trusted). With
`accountLinking.enabled: true` (already set) plus `provisionAppUser`'s email
fallback, a Google sign-in whose email matches an existing password user **links**
to the same Convex `users` row instead of creating a duplicate. No new
provisioning code — the existing `/app` route trigger
(`src/routes/app/route.tsx`) handles it. If you add GitHub/Apple later, the same
trusted-email reasoning applies; flip the scaffold in `linked-accounts.tsx`.

## Auth hardening (Phase 0)

### `sendChangeEmailConfirmation`, pas `sendChangeEmailVerification`

The handler that fires on **email-change** lives under
`user.changeEmail.sendChangeEmailConfirmation` in Better Auth (verified
in `node_modules/better-auth/dist/api/routes/update-user.mjs:427`). An
earlier revision used `sendChangeEmailVerification`, which **does not
exist** — BA silently swallowed the callback and only sent the
verification email to the _new_ address. A hijacked session could
change the email to attacker@evil.com without the legitimate owner of
the current inbox ever being notified.

Rule: if you rename or relocate the change-email handler, grep BA
source for the exact key BA reads (`ctx.context.options.user.changeEmail.<…>`)
and match it byte-for-byte. The TypeScript types here are permissive
(extra keys are accepted), so a typo compiles but ships broken.

### Anti-enumeration on `/register`

When a signup hits `USER_ALREADY_EXISTS`, the UI renders the _exact
same_ "Check your inbox" screen as a successful new signup
(`src/routes/register.tsx`). No verification email is actually sent in
the duplicate case — BA aborts at 422. An attacker can no longer
enumerate registered emails by watching the signup response.

Trade-off : a legit user who signs up twice (e.g. forgot they already
have an account) gets the success screen but no email, then bounces.
The "try a different email" link on that screen and the
`/forgot-password` flow are the recovery paths. Accepted cost for
closing the enumeration leak — same pattern shipped by Linear and
Stripe.

### Cookie attributes are explicit, secure flag is APP_ENV-gated

`convex/auth.ts` pins:

```
advanced: {
  useSecureCookies: APP_ENV === 'production',
  cookiePrefix: 'albo',
  defaultCookieAttributes: { sameSite: 'lax', secure: APP_ENV === 'production', httpOnly: true },
}
```

`secure: true` is required in prod but breaks local dev over plain
`http://localhost` (the cookie is set but the browser refuses to send
it back). The `APP_ENV === 'production'` check keeps localhost working
in dev while forcing the flag everywhere else. If you ever spin up a
staging deploy, set `APP_ENV=production` so the cookie hardening
applies — same trap as the `SITE_URL` guard below.

### Per-endpoint rate-limit storage

BA's built-in `rateLimit` block with `storage: 'database'` is wired
into the Convex adapter — no separate component to install. BA writes
to an auto-created `rateLimit` table on the BA-side schema. We rely
on it for `/sign-in/email`, `/sign-up/email`, `/forgot-password`,
`/reset-password`, `/sign-in/magic-link`, `/email-verification/send`,
`/change-email`, `/change-password`, `/delete-user`.

`convex/rateLimiters.ts` (the `@convex-dev/rate-limiter` component) is
_separate_ — it covers application-level limits (invitations, chat,
email-send wrappers). Do not confuse the two : BA's limiter is on the
auth HTTP edge, ours is on Convex mutations/actions.

### Password policy (Phase 1)

- BA: `minPasswordLength: 12`, `maxPasswordLength: 128`.
- Zod schemas in `/register`, `/reset-password`, `/me` mirror the
  minimum. Both layers must agree — if you tighten the Convex side,
  bump the Zod min in the same commit or signup passes client
  validation and 400s on submit.
- HIBP k-anonymity check on every new-password field (`onBlurAsync`
  validator). `src/lib/hibp.ts` soft-fails on network errors so an
  outage at api.pwnedpasswords.com doesn't block signups; the
  server-side minimum still applies.
- zxcvbn-ts strength meter is indicative, not blocking. The wordlist
  is ~1.2 MB but lazy-loaded only when a password field mounts.

### eslint must be a direct devDependency

`eslint.config.mjs` does `import { defineConfig } from 'eslint/config'`,
which requires `eslint` to be resolvable from the project root. pnpm
10's strict isolation does not hoist transitive devDeps, so without
`"eslint": "^10"` in `devDependencies` the lint script fails with
`Cannot find package 'eslint'`.

This was silently broken before Phase 1 (the `| tail -40` wrapper in
the lint script swallowed the failing exit code). Adding `eslint` to
`devDependencies` fixes the run; it also surfaces ~240 pre-existing
lint errors (`sort-imports`, `import/order`, `@typescript-eslint/array-type`)
across non-auth routes that pre-date Phase 0/1 and want a separate
cleanup PR. The new Phase 1 files (`hibp.ts`, `auth-errors.ts`,
`password-input.tsx`, `password-strength.tsx`) lint clean.

## Production deploy is wired into the Vercel build

`vercel.json` runs `npx convex deploy --cmd 'pnpm build'`, so every
`main` push that lands on Vercel **also** deploys Convex functions and
schema in lockstep. You should never run `pnpm exec convex deploy --prod`
by hand for a normal release — the Vercel deployment is the source of
truth.

**Required Vercel env vars** (set in Project Settings → Environment
Variables, scoped to **Production** only) :

- `CONVEX_DEPLOY_KEY` — generated from the Convex dashboard
  (Project → Settings → URL & Deploy Key → "Generate Production Deploy
  Key"). Vercel forwards it to the build step ; the Convex CLI uses it
  to push functions/schema to the prod deployment.

The shell guard in `package.json` → `build:vercel` requires **both**
`VERCEL_ENV = production` and `CONVEX_DEPLOY_KEY` before running
`convex deploy`. Falls back to plain `pnpm build` otherwise. Effects :

- **Why `VERCEL_ENV`, not `VERCEL=1`** : `CONVEX_DEPLOY_KEY` is a
  _production_ key and, in practice, Vercel forwards it to **Preview**
  builds too (env-var scoping in the dashboard is not always honored).
  A `VERCEL=1` guard therefore let preview/branch builds (PRs) run
  `convex deploy` with a prod key from a non-prod
  env → Convex aborts with _"non-production build environment and
  CONVEX_DEPLOY_KEY for a production deployment"_ → build exits 1.
  Gating on `VERCEL_ENV = production` is what actually keeps previews
  off the prod deploy path.
- Preview/branch deployments → skip `convex deploy`, just `pnpm build`.
  The frontend builds **green** but runs against the current prod
  Convex backend. Fine for read-only UI review ; **never ship preview
  deploys that depend on un-deployed schema/function changes**. If you
  need preview-isolated Convex, generate a Preview Deploy Key and add
  `CONVEX_DEPLOY_KEY` scoped to Preview in Vercel (and relax the guard).
- Local `pnpm build:vercel` → `$VERCEL_ENV` is empty, so the script
  always skips `convex deploy` even if a dev happens to have a deploy
  key in their shell env. Safe to run locally for build smoke-tests.

**When you DO need the manual command** :

- Local dev (`pnpm exec convex dev` — different command, runs the dev
  deployment with hot reload).
- Emergency hotfix where Vercel is broken : `pnpm exec convex deploy
--prod` works but is a footgun (frontend still pointing at old
  code). Prefer reverting the bad commit and letting Vercel redeploy.

## pnpm.overrides

No active overrides. History of past pins (TanStack router-core duplication
breaking `server.handlers` type augmentation; `better-call@1.3.5` shipping
broken) lives in git — pattern to reuse if a dep breaks upstream: pin in
`pnpm.overrides`, disable it in `renovate.json`, document the unblock
condition here, and remove all three together when upstream fixes land.

## Zod v4 required for Better Auth 1.6.10

Better Auth's `better-call` subdependency uses `.meta()` on Zod schemas,
which is **v4-only**. The install warning is the only signal — runtime
errors otherwise look like opaque schema failures.

We ship `zod ^4.4.3`. If you must downgrade, also pin `better-auth` to a
release that supports zod v3.

## Resend test-mode trap

`new Resend(component, { testMode: <bool> })` defaults to `true`. We pass
`testMode: process.env.RESEND_TEST_MODE !== 'false'` so production emails
actually fly. Symptom of the wrong setting: "Test mode is enabled, but
email address is not a valid resend test address".

## macOS Finder duplicates

Any `* 2.ts` / `* 2.tsx` file (created by Finder copy/paste or "Save as"
sidebars) will be picked up by Convex AND Vite and break the build with
ambiguous module errors. After heavy file-move ops, run:

```
find . \( -path ./node_modules -o -path ./.output \) -prune -o \
  -type f \( -name '* 2.ts' -o -name '* 2.tsx' \) -print
```

## Modèle de l'agent (OpenRouter / DeepSeek)

L'agent IA a tourné sur Anthropic Claude (≤ v1.5.1), puis Mistral Medium 3.5,
et tourne désormais sur **`deepseek/deepseek-v4-pro` servi via OpenRouter**.

- **Provider abstrait.** `getModel()` dans `convex/agent.ts` isole le
  provider : `createOpenRouter({ apiKey })` puis `openrouter.chat(AGENT_MODEL)`.
  OpenRouter est une gateway OpenAI-compatible — changer de modèle (DeepSeek,
  Mistral, Claude…) ne touche qu'`AGENT_MODEL` ; changer de provider ne
  touche que cette fonction. Pas un one-way door.
- **Id du modèle.** Source unique `convex/lib/instructions.ts:AGENT_MODEL`,
  défaut `deepseek/deepseek-v4-pro`. Override via la var d'env Convex
  `OPENROUTER_MODEL` (n'importe quel slug du catalogue OpenRouter, ex.
  `deepseek/deepseek-v4-flash` pour moins cher). La clé vit dans l'env Convex
  sous `OPENROUTER_API_KEY`.
- **L'agent qui prétend être un autre modèle n'est PAS une preuve.** Les LLM
  ne connaissent pas leur deployment id : interrogé « quel modèle es-tu ? »,
  il invente. Le system prompt (`convex/lib/instructions.ts`) injecte l'id
  configuré pour qu'il réponde juste. Pour vérifier le modèle réellement
  servi en prod, regarder l'env (`pnpm exec convex env list --prod` →
  `OPENROUTER_MODEL`) ou le dashboard OpenRouter (activité par modèle), pas
  l'auto-description de l'agent.
- **Prompt caching.** DeepSeek cache automatiquement le préfixe partagé
  (system prompt + ~45 schémas d'outils) côté serveur, facturé à tarif
  réduit, **sans clé de cache à injecter** — d'où la suppression du wrapper
  `fetch` qui était nécessaire pour Mistral (`prompt_cache_key`). Le préfixe
  doit rester stable : le system prompt est figé pour toute la durée d'un
  `streamText`/`generateText` (route/orgName figés à l'appel). Ne PAS rendre
  la liste d'outils dynamique (filtrage par route) : ça casserait le cache.
- **Vérification.** Le `usageHandler` de `convex/agent.ts` logge une ligne
  `llm_usage` par appel LLM (logs Convex) ; `cacheReadTokens > 0` est attendu
  dès le step 2 d'un message multi-étapes si OpenRouter remonte le détail de
  cache pour le modèle servi.

## SITE_URL drift in prod = broken email links

`SITE_URL` is the Convex env var that builds every email URL (magic link,
invitation accept, change-email verification, delete-account confirm) and
feeds Better Auth's `baseURL`. If you forget to set it on the prod Convex
deployment, emails ship with `http://localhost:3000/...` links — silent
data loss until a user complains.

`convex/auth.ts` throws at boot if `APP_ENV=production` AND `SITE_URL`
matches `localhost` / `127.0.0.1`. So:

- Set `APP_ENV=development` on dev deployments (no guard, localhost is fine).
- Set `APP_ENV=production` AND a real `SITE_URL` on prod. A `convex deploy`
  with the wrong combo will fail loudly.

```bash
pnpm exec convex env set --prod APP_ENV production
pnpm exec convex env set --prod SITE_URL "https://your-domain"
```

## `vercel link` wipes `CONVEX_DEPLOYMENT` from `.env.local`

The first `pnpm dlx vercel@latest link` follows up with an interactive
"Would you like to pull environment variables now?" prompt. Saying **yes**
makes Vercel overwrite `.env.local` with **only the vars defined on
Vercel** — and since `CONVEX_DEPLOYMENT` is per-developer (never set on
Vercel), it gets stripped. Next `pnpm run setup:prod` / `convex env list`
then fails with `No CONVEX_DEPLOYMENT set`.

**Two fixes**:

- When linking the first time, answer **no** to the env pull prompt.
- If it already happened, re-run `pnpm exec convex dev` once — it
  re-binds your local repo to the existing dev deployment and rewrites
  `CONVEX_DEPLOYMENT=dev:…` into `.env.local`. **Pick the existing
  deployment**, do not let it create a new one.

Never put `CONVEX_DEPLOYMENT` on Vercel: it's a per-developer dev
binding, not a deploy target.

## Vite / Convex dev fails after partial install state

If `pnpm dev` errors with one of:

- `_gensync(...) is not a function`
- `Cannot destructure property 'isCompatTag' of 'react'`
- `esbuild failed: import_esbuild2.default.build is not a function`

…the node_modules tree is in an inconsistent state (typically after a
mid-session `pnpm dedupe` or after pnpm skipped postinstall scripts on
`esbuild`).

**Fix**:

```bash
rm -rf node_modules
pnpm install
pnpm rebuild esbuild   # ensures esbuild's native binary is fetched
```

`pnpm rebuild esbuild` is required because pnpm 10 skips lifecycle scripts
by default, so esbuild's `install.js` doesn't download the platform binary.

## `pnpm lint` après `pnpm build` — faux positifs sur `.output/`

La config eslint (`eslint.config.mjs`) n'ignore que `convex/_generated`. Le
build Nitro émet `.output/` (et `.nitro/`) à la racine : si on lance
`pnpm lint` **après** un `pnpm build`, eslint parcourt les bundles générés et
remonte des centaines d'erreurs fantômes sur ces fichiers. Lancer lint
**avant** build (l'ordre de `TESTING.md` niveau 1), ou supprimer
`.output/`/`.nitro/` avant de relancer lint.

## shadcn CLI inaccessible depuis un environnement réseau restreint

`pnpm dlx shadcn@latest add <component>` télécharge le composant depuis
`ui.shadcn.com` — inaccessible derrière une politique réseau restrictive
(erreur « You are not authorized to access the item »). Fallback : ajouter la
dépendance du composant à la main (ex. `pnpm add cmdk` pour Command), puis
écrire `src/components/ui/<component>.tsx` calqué sur la source shadcn
officielle et le style des composants ui existants (package `radix-ui`/dep
dédiée, alias `~/lib/utils`, attributs `data-slot`, prettier du projet).
Exemple : `command.tsx`. Même topo pour le registry AI Elements
(`elements.ai-sdk.dev` → 403) : les fichiers de `src/components/ai-elements/`
sont vendorés depuis `vercel/ai-elements` `packages/elements/src/` via
`raw.githubusercontent.com` (qui, lui, passe), imports réécrits
(`@repo/shadcn-ui/...` → `~/components/ui/...`).

## `sync:skills:update` échoue dans le sandbox cloud (api.github.com)

`pnpm run sync:skills:check` (détection de drift) et `pnpm run sync:skills`
(vendor au `pinnedRef`) passent par `raw.githubusercontent.com` — accessible
derrière le proxy. Mais `pnpm run sync:skills:update` résout d'abord le tip de
chaque `trackingRef` via **`api.github.com`** (`resolveTip` dans
`scripts/sync-skills.mjs`), et là ça coince en environnement cloud restreint :

- avec le `GITHUB_TOKEN`/`GH_TOKEN` injecté → **401** (token scopé au repo du
  job, pas un PAT github.com valide, envoyé en `Authorization: Bearer`) ;
- sans token (unauth) → **403** dès le 2ᵉ/3ᵉ repo (GitHub flague les appels
  API en rafale ; un appel unauth isolé, lui, passe).

Fallback **chirurgical** quand un seul skill a dérivé (le cas courant) :
récupérer le SHA du tip du repo concerné en **un** appel unauth
(`curl -H "Accept: application/vnd.github.sha" https://api.github.com/repos/<source>/commits/<trackingRef>`),
l'écrire dans le `pinnedRef` de ce skill dans `skills-lock.json`, puis lancer
`pnpm run sync:skills` (mode défaut : vendor via `raw`, met à jour le SKILL.md
+ le `computedHash`). `pnpm run sync:skills:check` repasse alors vert. Relire le
diff de contenu du SKILL.md avant de committer (obligation CLAUDE.md), et ne
bumper que le(s) skill(s) réellement dérivé(s) — laisser les autres `pinnedRef`
en place est sans risque (pas de drift de contenu = check vert).

## Streamdown (panneau AI) — `@source` Tailwind v4, plugins retirés, labels tool

Le markdown du chat AI est rendu par `streamdown` (via `MessageResponse`
de `src/components/ai-elements/message.tsx`). Trois pièges si on touche à
cette zone :

1. **Markdown sans styles** : streamdown style ses éléments avec des classes
   Tailwind internes à `node_modules`. La ligne
   `@source '../../node_modules/streamdown/dist/*.js';` dans
   `src/styles/app.css` est obligatoire — sans elle, Tailwind v4 ne scanne
   pas le paquet et tout le markdown assistant sort brut.
2. **Plugins retirés volontairement** : le `message.tsx` upstream importe
   `@streamdown/{code,math,mermaid,cjk}` (Shiki + KaTeX + Mermaid = des Mo
   de bundle). On les a retirés (le core garde le GFM : tableaux, listes).
   Idem `tool.tsx` : le `CodeBlock` upstream (Shiki) est remplacé par un
   `<pre>` local. **Toute réinstallation/maj depuis le registry AI Elements
   doit re-appliquer ces deux trims** (commentaires en place dans les
   fichiers).
3. **Labels i18n de `tool.tsx`** : les libellés hardcodés anglais upstream
   (Pending/Running/Completed/Parameters/Result) sont exposés en props
   (`statusLabel`, `label`, `errorLabel`) renseignées par `AiPanel` via
   `t('chat:tool.*')`. À re-vérifier après une maj du composant.

## Approbation d'outils (panneau AI) — reprise du stream obligatoire

Les outils d'écriture de l'agent portent `needsApproval: true`
(`createTool` de `@convex-dev/agent`). Quatre pièges :

1. **La génération ne reprend pas toute seule.** `approveToolCall` /
   `denyToolCall` ne font qu'enregistrer la décision et retourner un
   `messageId` ; il FAUT relancer `streamText` avec
   `promptMessageId: messageId`, sinon le thread reste figé sur
   « Confirmation requise ». C'est ce que fait
   `chat.respondToToolApproval` (décision + re-schedule de
   `internal.chat.streamAsync`). Tout nouveau point d'entrée d'approbation
   doit suivre ce pattern.
2. **Version minimum `@convex-dev/agent` 0.6.2** : en dessous, message
   dupliqué après approbation avec `saveStreamDeltas` et step final non
   persisté (get-convex/agent#185, fixé en 0.6.2). On est sur `^0.6.3`.
3. **Auto-deny intégré** : envoyer un nouveau message pendant qu'une
   approbation est en suspens la refuse automatiquement (raison
   `auto-denied: new generation started`). Comportement voulu — l'UI
   affiche « Action refusée » ; ne pas « corriger ».
4. **Les états d'approbation transitent par les tool parts** de
   `useUIMessages` (`approval-requested` → `approval-responded` →
   `output-available`/`output-denied`, champ `part.approval`) — le
   composant `confirmation.tsx` est piloté par ça. `dynamicTool()` ne
   supporte pas l'approbation (vercel/ai#11434) : ne pas convertir nos
   outils en dynamiques.
5. **Second point d'entrée : le bot Telegram** (`convex/telegram.ts`,
   boutons inline Confirmer/Refuser). Même contrat de reprise (décision →
   `generateText` avec `promptMessageId`). Le `callback_data` Telegram est
   un simple `approve`/`deny` (cap 64 bytes) : l'approbation visée est
   résolue côté serveur comme « la seule `approval-requested` du thread »
   — garanti par l'auto-deny du point 3. Boutons obsolètes → réponse
   « plus en attente », rien n'est écrit.

## Serveur MCP distant (connector claude.ai) — OAuth via plugin BA `mcp`

Le serveur MCP (`convex/mcp/`) expose ~18 outils **lecture seule** aux
clients MCP externes. Architecture : resource server = httpAction `/mcp`
(JSON-RPC Streamable HTTP **stateless**, fait main — le SDK
`@modelcontextprotocol/sdk` est Node-only et les httpActions tournent dans
le runtime V8 Convex, sans `"use node"`) ; authorization server = plugin
Better Auth `mcp` dont les endpoints (`/api/auth/mcp/authorize|token|register`)
passent par le proxy app-domain existant — donc same-origin avec `/login`
et ses cookies de session.

Pièges et décisions :

1. **Plugin `mcp` hors liste « supported plugins » du composant
   `@convex-dev/better-auth`.** Ça fonctionne parce que le schéma du
   composant (0.12.x) embarque déjà `oauthApplication`, `oauthAccessToken`,
   `oauthConsent` et `jwks`. À re-vérifier à chaque upgrade du composant.
   Si le plugin casse, fallbacks dans l'ordre : (a) seeder un
   `oauthApplication` à la main et utiliser les *Advanced settings* du
   connector claude.ai (client_id pré-enregistré, pas de DCR) ; (b) local
   install du composant avec schéma régénéré ; (c) mini-AS maison.
2. **Pas de binding d'audience RFC 8707** : les tokens BA sont opaques et
   le paramètre `resource` n'est pas validé. Accepté pour un outil interne
   à 2 users — à revoir si le serveur expose un jour des écritures.
3. **Reprise du flow OAuth après login.** Le plugin redirige les
   non-authentifiés vers `/login?<query OAuth>` et pose un cookie signé
   `oidc_login_prompt` (after-hook de reprise). On ne dépend **pas** de ce
   mécanisme : `/login` reconstruit l'URL `/api/auth/mcp/authorize?…` à
   partir des params et la passe en `callbackURL` — embarquée dans le lien
   magique, elle survit au roundtrip email (méthode de connexion
   principale). Ne pas retirer ce fallback.
4. **Métadonnées de découverte à deux endroits.** RFC 9728
   (`/.well-known/oauth-protected-resource`, + variante `/mcp`) est servie
   sur **convex.site** (l'hôte de la ressource) et pointe vers le domaine
   app ; RFC 8414 (`/.well-known/oauth-authorization-server`) doit être au
   **root du domaine app** (issuer = `SITE_URL`) → route TanStack
   `src/routes/[.]well-known.oauth-authorization-server.ts` qui proxifie la
   route BA. Le 401 du `/mcp` porte `WWW-Authenticate: Bearer
   resource_metadata="…"` — c'est ce qui déclenche le flow côté client.
5. **`MCP_DEV_TOKEN` / `MCP_DEV_EMAIL`** (env Convex) : bypass OAuth pour
   curl et MCP Inspector. Les deux doivent être posés pour être actifs —
   ne jamais les laisser en prod hors session de test.
6. **Écritures interdites par principe (v1).** MCP n'a pas d'équivalent de
   `needsApproval` : une écriture exposée en MCP reposerait sur la
   confirmation du client (Claude), pas sur nos boutons in-app. Si un jour
   on en ajoute, décision explicite + section dédiée ici.
7. **Registre de schémas séparé.** Les outils agent sont en `zod/v3`
   (inline), incompatibles `z.toJSONSchema()` → `convex/mcp/registry.ts`
   re-déclare les schémas en zod v4. Si les args d'un internal changent,
   tenir les deux en phase.
8. **claude.ai ne charge qu'un sous-ensemble des outils par conversation**
   (sélection dynamique côté Anthropic, ~5 sur 18 observés). Conséquence :
   `listOrgs` peut être absent et le modèle devine des slugs erronés.
   Mitigation en place : à `initialize`/`tools/list` (authentifiés), les
   orgs du caller sont injectées en `enum` sur le paramètre `org` de chaque
   outil + dans les `instructions` (`orgAwareSchema`,
   `convex/mcp/server.ts`). Chaque outil doit rester **auto-suffisant** —
   ne jamais concevoir un outil MCP qui dépend du résultat d'un autre pour
   être appelable. ⚠️ claude.ai **fige les schémas d'outils au moment de
   la connexion** : après un déploiement qui les modifie, déconnecter puis
   reconnecter le connecteur (Customize → Connectors → Albo OS), sinon le
   modèle continue de voir les anciens schémas.

## tailwind-merge v3 obligatoire avec les composants shadcn « Tailwind v4 »

Les composants `src/components/ui/*` (générés pour Tailwind v4) utilisent le
modificateur important **suffixe** (`p-0!`, `size-8!`). tailwind-merge **v2**
ne connaît que le préfixe v3 (`!p-0`) : il ne déduplique pas ces classes, donc
deux utilitaires en conflit restent tous les deux dans le `className` et c'est
l'**ordre CSS** qui tranche — pas l'ordre des arguments de `cn()`. Symptôme
historique : dans `sidebar.tsx`, `group-data-[collapsible=icon]:p-2!` (base)
battait `…:p-0!` (variant `size="lg"`) → boutons repliés de 32 px avec 8 px de
padding → logo d'orga et avatar (32 px, `shrink-0`) rognés/déformés en mode
icône. Fix : `tailwind-merge@^3` (aligné Tailwind v4). Ne pas redescendre en
v2.

Piège voisin (non lié à la version) : un utilitaire nu (`h-4`) ne surcharge
**jamais** la même propriété portée par un variant `data-[…]:` du composant
(`data-[orientation=vertical]:h-full` gagne en spécificité). Surcharger avec
le même variant — `data-[orientation=vertical]:h-4` — comme dans les
templates shadcn officiels.

## Colonne figée (`sticky`) dans une table — fond opaque ET hover composité

Pour figer une colonne au scroll horizontal (`sticky left-0` sur les `th`/`td`
de la colonne, le conteneur `overflow-x-auto` vient de `ui/table.tsx`), deux
pièges en cascade :

1. **Fond opaque obligatoire.** Une cellule sticky sans background laisse
   transparaître les colonnes qui glissent dessous. Il faut `bg-background`
   (opaque) + `z-10` sur chaque cellule figée.
2. **Le hover de ligne devient invisible sous la cellule figée.** Le hover de
   `TableRow` est **translucide** (`hover:bg-muted/50`, composité par-dessus le
   fond de page) : le fond opaque du point 1 le masque, et reprendre
   `bg-muted/50` sur la cellule la rendrait à nouveau transparente (elle
   compositerait par-dessus les colonnes qui défilent, pas le fond de page).
   Fix : la cellule figée peint elle-même la couleur **composée équivalente**,
   déclenchée par le survol de la ligne —
   `group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]`
   avec la classe `group` posée sur **toutes** les lignes (pas seulement les
   cliquables).

Implémentation de référence : `stickyHeadClass` / `stickyCellClass` dans
`src/components/participations/ParticipationsTable.tsx`. À réutiliser tel quel
pour figer une colonne d'une autre table (vue Deals…).

## Vercel framework preset traps TanStack Start

Vercel's auto-detection lands on **Vite** the moment it sees `vite.config.ts`,
and the Vite preset serves `dist/` as static files. TanStack Start + Nitro
emit the Build Output API layout in `.vercel/output/` instead — so the
preset and the actual output never meet, and every route returns 404.

Two things must both be true:

1. `vite.config.ts` loads `nitro()` from `nitro/vite` _after_ `tanstackStart()`.
   Without Nitro, `pnpm build` only produces `.output/server/index.mjs`
   (generic Node server) which Vercel cannot serve.
2. `vercel.json` overrides the preset:
   ```json
   {
     "framework": null,
     "buildCommand": "pnpm build",
     "installCommand": "pnpm install --frozen-lockfile=false"
   }
   ```
   Editing the preset in the dashboard works too, but the file is the
   durable answer — survives team handoffs and project re-imports.

**Symptom**: `curl -I https://<your-domain>/` returns `HTTP/2 404` with
`server: Vercel` and a static-looking `cache-control: public, max-age=...`.

## Trade-offs vs PROJECT_BRIEF.md

Choices that diverge from the brief, with rationale. See
`/Users/benjaminbouquet/.claude/plans/glistening-puzzling-kay.md` for the full
audit.

- **Better Auth `organization()` plugin not loaded** — its tables are not Convex
  first-class (no `withIndex` joins). We mirror orgs/members/invitations in our
  own schema. Loss: `leaveOrganization`, session-level active-org, explicit
  reject/cancel invitation states.
- **AI front uses `useUIMessages` from `@convex-dev/agent/react`** instead of
  `@assistant-ui/react`. No Convex adapter exists for assistant-ui; the brief's
  pick would require ~200 lines of glue. Markdown rendering (`react-markdown`),
  compact tool-call display, thread history/rename/delete and stop are now
  hand-rolled in `src/components/ai/AiPanel.tsx`. Remaining loss vs
  assistant-ui: attachments, edit/regenerate.
- **Agent model default `deepseek/deepseek-v4-pro` via OpenRouter** —
  remplace les défauts précédents (Mistral Medium, puis Anthropic). Override
  via `OPENROUTER_MODEL` env var.
- **Rate-limit thresholds** chosen for usable defaults (e.g. invitations 20/h
  burst 5) rather than the brief's tight 3/min example.
- **Super-admin lacks impersonate** — out of scope for MVP, needs a careful
  session-signing flow.
- **Sentry only on the front-end** — Convex Dashboard logs cover errors;
  Sentry-on-Convex would need a fetch-to-envelope helper.

## Color theme picker SSR flash

The 4-theme picker (`ThemePicker.tsx`) reads `localStorage` in a `useEffect`
and applies `data-theme` to `<html>` after mount. Until then, the page
renders with the default neutral theme, which means a brief flash of color
on first paint when the user has a non-default theme saved.

`next-themes` already prevents the dark/light flash via its own pre-mount
script. The color theme is on a separate channel (data-theme attr vs class)
and doesn't get that treatment — acceptable for v1 since only the `--primary`
hue changes, not background colors.

**Fix later**: inject a synchronous `<script>` in `__root.tsx` that reads
the `app-color-theme` localStorage key and sets `data-theme` before React
hydrates. Or migrate to a cookie-based scheme so SSR can render the right
theme directly.

## i18n (react-i18next) SSR — no-flash, per-request instance

The app is bilingual (FR/EN). Three non-obvious decisions keep SSR correct:

1. **One i18next instance per server request, never a shared singleton.**
   `getI18n()` in `src/lib/i18n.ts` caches one read-only instance _per locale_
   on the server and a single mutable instance on the client. A single shared
   server instance whose `lng` we mutate with `changeLanguage` would leak one
   request's locale into another concurrent request (the Node server is
   long-running). The per-locale server cache is safe only because we never
   call `changeLanguage` on the server.

2. **Resources are imported statically (bundled), so init is synchronous.**
   No `i18next-http-backend`, no lazy namespace loading. That means the very
   first render already has the right strings — no Suspense boundary, no flash
   of keys or of the wrong language. The cost is all locales ship in the
   bundle; fine for two languages, revisit if the count grows.

3. **The locale cookie is written on the server during SSR.**
   `getLocale()` (`src/lib/locale.ts`) is a `createIsomorphicFn`: on the server
   it reads the `lang` cookie, else parses `Accept-Language`, then **writes the
   resolved value back into the `lang` cookie**. The client branch reads the
   same cookie (else `navigator.language`). Writing the cookie server-side is
   what guarantees the client reads the _exact_ value the server rendered with —
   without it, `Accept-Language` (server) vs `navigator.language` (client) can
   disagree and cause a hydration mismatch. This is the cookie-based approach
   the "Color theme picker SSR flash" section suggests as the future fix —
   applied here from the start. English is the default; French wins only when a
   French variant is the highest-priority language the client asked for.

**Page `<title>` in `head()`**: `head()` runs outside React, so it can't use
the `useTranslation` hook. Routes resolve titles via
`getI18n(getLocale()).getFixedT(null, '<ns>')('key')` instead. A live language
switch updates the body immediately but the `<title>` only refreshes on the
next navigation — acceptable, titles are low-traffic.

**Cross-device preference**: `users.preferredLanguage` (Convex) is written by
the switcher and drives transactional email locale. We do **not** currently
restore it into the cookie on login, so switching language on device A does not
auto-apply the UI language on device B until the user switches there too (the
cookie is per-browser). The email locale is always correct regardless. Restore
on login is a deliberate follow-up, not a bug.

**zxcvbn feedback strings** (password strength warnings) come from the zxcvbn
English wordlist and are not translated — only our own labels around the meter
are. Translating zxcvbn output would require loading its locale packs.

## Browser-only libs (`window` at module load) need client-only mount

Any library that touches `window`/`document` at module load time (mapping
libs, and charting/viz libs like Mermaid or Three.js — relevant once we add
valuation/KPI charts) crashes SSR with `ReferenceError: window is not
defined` if imported at the top of a route file. TanStack Start renders
routes on the server by default.

**Pattern** — dynamic-import the lib inside `useEffect`, render a skeleton
until it resolves:

```tsx
function ClientOnlyViz() {
  const [mod, setMod] = useState<Mod | null>(null)
  useEffect(() => {
    let cancelled = false
    import('the-browser-only-lib').then((m) => {
      if (!cancelled) setMod(m)
    })
    return () => {
      cancelled = true
    }
  }, [])
  if (!mod) return <Skeleton />
  return <mod.Thing>…</mod.Thing>
}
```

If the lib renders content outside the React tree (e.g. into its own DOM
node), Tailwind theme switching won't reach that container — fall back to
inline styles with explicit values there.

## Convex dev typecheck

`pnpm exec convex dev` runs its own typecheck (`--typecheck=enable`). If
that fails the deploy is rejected. Use `pnpm typecheck` separately to keep
the local feedback loop tight; the Convex check catches the same errors at
deploy time anyway.

## Post-event notification coverage

`notifications.notifyPasswordChanged` fires from the client right after
`authClient.changePassword()` succeeds on `/app/me`. **It does NOT fire on
the `/forgot-password` → `/reset-password` flow** because that path runs
server-side inside Better Auth and we don't have a clean hook (BA exposes
`sendResetPassword` for sending the _link_, not a post-reset callback). The
existing `revokeSessionsOnPasswordReset: true` covers the takeover-mitigation
side (all sessions revoked, user must re-auth) so a hijacker is locked out;
the missing piece is the _informational_ email to the rightful owner.

Two paths if/when this matters:

1. Add `databaseHooks.account.update.after(account)` in `convex/auth.ts` and
   gate on `providerId === 'credential'`. Risk: BA's `databaseHooks` type
   surface is heavy and may trigger the TS inference cycle that CLAUDE.md
   anti-pattern flags. Try in isolation.
2. Add a thin wrapper around `authClient.resetPassword()` that, on success,
   POSTs to a public Convex mutation. Symmetric to the `/me` pattern but
   needs the user's email — derivable from the JWT BA sets on the response,
   or by passing it through the reset-password page state.

**NewDeviceEmail** is not implemented for the same scoping reason: detecting
"new device" requires storing UA fingerprints in our schema (BA's component
tables aren't queryable from `ctx.db` directly). Tracked as Phase 3 work
behind a dedicated PR — needs a `deviceFingerprints` table + a session-create
hook + an action to send the email.

## Hydration & session timing — never re-instantiate `ConvexQueryClient`

### Symptom (dev-only)

In localhost, hard-refreshing `/app/*` redirects to `/login` for a beat,
then snaps back. Opening a second tab to `/app/*` does the same. Prod is
fine (network is fast enough that the gap closes inside React's batching).

### Root cause

`src/router.tsx` is `getRouter()` — TanStack Start calls it on the server
AND again on the client during hydration. If `getRouter()` creates
`new ConvexQueryClient(...)` on every call, each call opens a fresh
WebSocket. The new socket has no JWT yet, so `useConvexAuth()` reports
`{ isLoading: false, isAuthenticated: false }` for the round-trip while
BA's cookieCache already knows the user is signed in. Any guard that
redirects on `!isAuthenticated` will fire during that gap.

### Rule

1. **Memoize `ConvexQueryClient` and `QueryClient` at module scope on the
   client** (`typeof window !== 'undefined'` check). Reuse across all
   `getRouter()` calls. See the `getOrCreateClients()` helper in
   `src/router.tsx`. On the server, always create fresh — the singleton
   would leak state across requests.

2. **Don't redirect on `useConvexAuth()` alone**. Use the `useAuthState()`
   hook in `src/lib/auth-state.ts`, which combines Convex's signal with
   Better Auth's `useSession()`. Only redirect when BA confirms no
   session (`isSignedOut`), not when Convex is mid-refresh.

3. **Anti-pattern** already listed in `CLAUDE.md` (« ❌ `ConvexReactClient`
   recreated each render ») — this is the same bug at the router level.
   If you add a new route guard, prefer `useAuthState()` over
   `useConvexAuth()` directly.

## Entrée `/app` — fast-path cookie `last_org_slug`

La redirection `/app` → `/app/$orgSlug` n'attend plus l'auth Convex :
`src/routes/app/index.tsx` lit le cookie `last_org_slug` dans `beforeLoad`
(isomorphe, même pattern que `getLocale` — `src/lib/lastOrg.ts`) et redirige
immédiatement, côté serveur dès la requête document (et `/` redirige vers
`/app` en `beforeLoad` aussi — plus d'écran « redirection » hydraté).
La table `userPrefs` (Convex, mutation `setLastOrg`) reste la source de
vérité cross-device et le fallback quand le cookie est absent (cf. la
section « Hot `users` row » ci-dessous pour pourquoi ce n'est PAS un champ
de `users`).

Pièges :

- **Boucle de redirection** : le layout d'org renvoie un non-membre sur
  `/app` — il DOIT effacer le cookie avant (`clearLastOrgCookie()`), sinon
  le `beforeLoad` de `/app` renvoie aussitôt sur l'org refusée, en boucle.
  Tout nouveau chemin qui « quitte » une org (suppression d'org, retrait de
  membership) doit penser à ce nettoyage.
- Le contenu du cookie est borné à un slug plausible (`SLUG_RE` dans
  `lastOrg.ts`) avant d'être utilisé comme cible de redirection — ne pas
  relâcher cette validation (un cookie est une entrée non fiable).
- Un visiteur signé-out avec un cookie est redirigé vers l'org **puis** vers
  `/login` par le guard `/app` (inchangé) — ordre voulu, pas un bug.

## Hot `users` row — un write y invalide TOUTES les queries ouvertes

Chaque query/mutation passe par `requireAppUser`/`safeAppUser`
(`convex/lib/auth.ts`), qui lit la ligne `users` de l'appelant. En Convex
réactif, cette ligne fait donc partie du **read set de toutes les
subscriptions ouvertes** : le moindre `patch` dessus ré-exécute toutes les
queries montées (dashboard, listes, chat…), qui relisent leurs tables.

**L'incident (juin 2026)** : `lastOrgSlug` vivait sur `users` et la mutation
`setLastOrg` était déclenchée par un `useEffect` dépendant de `users.me`.
Deux onglets ouverts sur deux orgs différentes se ré-écrivaient mutuellement
la valeur en boucle (ping-pong inter-onglets) : ~16 000 mutations en 10
jours, chacune ré-exécutant toutes les queries ouvertes → **4,83 GB de
Database Bandwidth** (quota Free : 1 GB) pour 2 utilisateurs et 10 MB de
données.

**Les règles (anti-récidive)** :

1. **Aucun champ fréquemment écrit sur `users`.** Tout état par-user qui
   bouge souvent va dans la table `userPrefs` (lue uniquement par
   `users.me`, helpers `convex/lib/userPrefs.ts`) ou dans sa propre table.
   Les writes rares (profil, avatar, locale, superAdmin) restent acceptables.
2. **Jamais de mutation déclenchée par un `useEffect` dépendant d'une query
   Convex qui observe la donnée écrite** — c'est la recette de la boucle
   (la mutation invalide la query, qui re-déclenche l'effect, à l'infini
   dès que deux clients divergent). Garde « write-once par intention »
   via `useRef` : cf. `lastOrgSyncedRef` dans
   `src/routes/app/$orgSlug/route.tsx`.

Historique : le champ legacy `users.lastOrgSlug` a été migré vers
`userPrefs` puis retiré du schéma (purge one-shot
`users:purgeLegacyLastOrgSlug`, juin 2026 — exécutée en prod AVANT le
déploiement du schéma resserré, règle « purger d'abord »).

## Import Airtable one-shot (`convex/airtableImport.ts`)

Migration unique de la base Airtable `appVRf06AHghMkPZG` vers l'org `calte`.
Le code reste en place comme référence/relance (idempotent), pas de sync.

- **Ancre `airtableId`** : champ `v.optional(v.string())` + index
  `by_airtable_id` ajoutés sur `companies`, `deals`, `valuations`,
  `forecasts`, `bankAccounts`, `transactions`. Sert (a) à résoudre les liens
  Airtable (recordId → `Id<>`) en 2 passes, (b) à upserter sans doublon en
  relance. **Volontairement non-unique au schéma** (Convex ne le permet pas) ;
  l'unicité tient parce que chaque upsert lookup `by_airtable_id` d'abord.
- **Sentinelles** : l'entité investisseuse (`deals.investorCompanyId` doit être
  `group_*`, absente d'Airtable) est une company `group_root` créée à la volée
  avec `airtableId = "__import_investor__"`. Les mouvements sans lien banque
  retombent sur un `bankAccounts` `airtableId = "__unassigned_bank__"`. Ces
  deux lignes sont des artefacts d'import, pas des données métier réelles.
- **2 enums `instrumentKind` ajoutés** : `loan` (Airtable « Prêt »),
  `capitalization_account` (« Compte de Capitalisation »). L'union vit dans
  **`convex/lib/instruments.ts`** (source unique : `INSTRUMENTS` +
  `instrumentValidator`), importée par `convex/schema.ts`, `convex/deals.ts`
  et `convex/agentTools.ts` — ne pas la redéclarer.
- **Dérivation deals** : 1 deal = `(Entreprise × instrumentKind)`, clé
  `airtableId = "${entrepriseRecId}:${instrument}"`. Les mouvements
  opérationnels (Cash, Don, Impot, Honoraires, Virement, Nantissement) ne
  produisent **pas** de deal — juste une `transaction` sans `dealId`.
  L'import **throw** `unknown_invest_type:<x>` sur tout `Type d'invest` non
  mappé (jamais de mapping silencieux).
- **Montants** : Airtable est en EUR (décimales) → cents (`round(x*100)`).
- **codegen** : `internal.airtableImport.*` n'existe dans `_generated/api.d.ts`
  qu'après `convex dev`/`convex deploy`. Le `pnpm typecheck` local échoue tant
  que la codegen n'a pas tourné contre un déploiement — c'est attendu, le build
  Vercel (`convex deploy`) régénère l'API.

## Ingestion Powens (`convex/powens.ts`)

Webhook `CONNECTION_SYNCED` → HTTP action (`/powens/webhook`) → mutation interne
`ingestConnectionSync`. La connexion des banques (login + auth forte) se fait
hors-app via le Powens Webview ; le code n'écrit que l'APRÈS (comptes + tx).
Seule env var requise : `POWENS_WEBHOOK_SECRET` (clé du provider HMAC Powens).

- **Filtre par user Powens (anti-pollution).** Seuls les webhooks dont le
  `id_user` correspond à une ligne `powensUsers` (index `by_powens_user_id`)
  sont ingérés. Les connexions d'autres projets / vieux users Powens non gérés
  par Albo OS re-syncent encore : sans ce filtre, elles créaient des comptes
  fantômes. Webhook d'un user inconnu → warning `[powens] webhook ignoré:
id_user inconnu (X)` + réponse 200, **rien n'est écrit**. Conséquence :
  l'**org d'ingestion vient du `powensUsers` matché** (source de vérité), le
  mapping connecteur→entité ne sert qu'à choisir l'entité propriétaire et doit
  concorder avec cette org (`connector_org_mismatch` sinon).

- **HMAC : pas de `crypto.timingSafeEqual` dans le runtime Convex.** L'isolate
  V8 n'expose pas l'API `crypto` de Node ; on vérifie via Web Crypto
  `crypto.subtle.verify('HMAC', …)` (constant-time par construction). Écart
  assumé vs la formulation littérale « `crypto.timingSafeEqual` » de CLAUDE.md.
  Le message signé est `"POST.{path}.{BI-Signature-Date}.{rawBody}"` où `{path}`
  = `WEBHOOK_PATH` (`/powens/webhook`). **Ce chemin doit correspondre EXACTEMENT
  à l'URL configurée chez Powens** (sans slash final, sans query), sinon toutes
  les signatures échouent en `401`. Lire le `rawBody` via `request.text()`
  **avant** tout parse (HMAC sur les octets bruts).
- **Typage Web Crypto** : `crypto.subtle.verify` veut un `BufferSource` adossé à
  un `ArrayBuffer`. Les buffers sont typés `Uint8Array<ArrayBuffer>` (les
  `Uint8Array` génériques sont `ArrayBufferLike` → rejetés par tsc, union
  `SharedArrayBuffer`). Construire via `new Uint8Array(len)` / `new
Uint8Array(enc.encode(s))` produit bien de l'`ArrayBuffer`-backed.
- **Le record Qonto importé d'Airtable n'a pas d'IBAN.** `upsertBankAccounts`
  (`airtableImport.ts`) ne stocke pas l'IBAN → le « match par IBAN » littéral
  ne suffit pas. `linkQonto` rapproche le Qonto existant par **unicité du
  `bankName='Qonto'`** dans calte (sans `powensAccountId`), exige l'égalité
  d'IBAN seulement si le record en a déjà un, puis **backfille** l'IBAN Powens.
  Deux cas de non-match, traités différemment :
  - **0 candidat** (Qonto déjà lié à un autre `powensAccountId` — webhook
    re-sync redondant d'une autre connexion/user Powens) → warning
    `qonto_already_linked` dans les logs + compte **ignoré** (webhook répond
    200, rien n'est cassé). Le premier match reste la source de vérité, pas de
    re-lien automatique.
  - **≥2 candidats** (vraie ambiguïté) → **arrêt dur** `qonto_match_ambiguous`,
    aucune écriture — jamais de doublon.
- **Cutover sans champ au schéma.** Aucune date de connexion n'est stockée.
  Borne par compte dans `computeCutoff` : compte neuf → `_creationTime` (champ
  Convex natif ≈ date de connexion, l'historique antérieur du 1ᵉʳ lot est
  ignoré) ; Qonto (a `airtableId`) → date de sa dernière tx d'origine Airtable.
  On n'ingère que `tx.dateMs > cutoff`.
- **Idempotence par `powensTxId`** (index `by_powens_id`) : `patch` si existe,
  sinon `insert`. Rejouable sans effet de bord. Montants Powens = unité
  monétaire signée → `round(abs(value)*100)` cents + `direction` selon le signe.
- **Mapping connecteur → entité** (constante `CONNECTOR_OWNER`, comptes neufs
  uniquement) : Palatine / Wormser / Neuflize → CALTE (org calte) ; Mémo Bank →
  Albo Club (org albo). Un connecteur non mappé → `unmapped_powens_account`
  (erreur visible, **pas** d'écriture muette dans la mauvaise org). Qonto n'y
  figure pas (toujours résolu par match du record existant).
- **codegen** : comme pour l'import Airtable, `internal.powens.*` n'apparaît
  dans `_generated/api.d.ts` qu'après codegen. L'entrée `powens` y a été ajoutée
  pour passer le `typecheck` local ; `convex deploy` la régénère à l'identique.

## Émission Powens — connexion bancaire depuis l'app (`convex/powens.ts`)

Côté émission du flux Powens : un bouton « Connecter une banque » (page Cash)
appelle l'action `startBankConnection`, qui crée/réutilise un user Powens
permanent par org, génère un code temporaire et renvoie l'URL du Webview.

- **Token permanent par org, en clair, en table INTERNE `powensUsers`.** Convex
  ne chiffre pas nativement les champs ; la protection repose sur l'**isolation**
  (table lue/écrite uniquement par `internalQuery`/`internalMutation` —
  `getOrgPowensToken`, `savePowensUser` — jamais par une fonction publique). Même
  principe de confinement serveur que `POWENS_WEBHOOK_SECRET`. **Ne PAS** mettre
  le token sur `organizations` : `api.organizations.bySlug` fait `return {...org}`
  → il partirait au navigateur.
- **`client_secret` et `authToken` ne quittent jamais le serveur.** L'action ne
  renvoie au front que `{ webviewUrl }` (le `code` temporaire qu'elle contient
  n'est pas sensible). Les `ConvexError` n'incluent que le status HTTP Powens
  (`powens_init_failed:<status>`, `powens_code_failed:<status>`), jamais le
  secret/token. Ne rien logger de ces valeurs.
- **Domaine en env var** (`POWENS_DOMAIN`, sans `https://` ni `/2.0`). Base API
  dérivée en code : `https://${POWENS_DOMAIN}/2.0`. Bascule sandbox→prod en
  changeant l'env var (+ `POWENS_CLIENT_ID`/`POWENS_CLIENT_SECRET` de l'app prod),
  sans recommit. Env vars requises : `POWENS_CLIENT_ID`, `POWENS_CLIENT_SECRET`,
  `POWENS_DOMAIN`, `POWENS_REDIRECT_URI` (+ `POWENS_WEBHOOK_SECRET` pour
  l'ingestion). Toute absente → `ConvexError('powens_env_missing')`.
- **Param `type` de `/auth/token/code`** : la doc le dit « required », mais le
  test manuel sandbox renvoie un code valide **sans aucun param** → on n'en
  envoie pas. Réajout possible **sans recommit** en posant l'env var optionnelle
  `POWENS_CODE_TYPE` (lue par `powensCodeType()`) ; absente → aucun param.
- **`redirect_uri`** doit matcher EXACTEMENT la whitelist Powens
  (`https://alboteam.com/`, slash final compris).
- **Rôle requis** : `startBankConnection` exige `admin` (via `powensAuthProbe` →
  `requireOrgRole(orgId, 'admin')`). Action sensible (ouvre l'accès bancaire de
  l'org). `savePowensUser` est idempotent par org (garde l'enregistrement
  existant) — un double-clic ne crée pas de second user côté Convex (mais deux
  `/auth/init` quasi-simultanés sur une org sans token créeraient un user Powens
  orphelin côté Powens ; risque faible, bouton désactivé pendant l'appel).

## Monitoring des connexions Powens (`convex/powens.ts`, table `powensConnections`)

Santé des connexions bancaires : une ligne par connexion Powens, alimentée en
**double flux** — le webhook `CONNECTION_SYNCED` (push) ET un cron de poll
toutes les 6 h (`pollConnectionsHealth`). Points non évidents :

- **Le webhook seul ne suffit PAS.** Le mode de panne principal est le
  silence : connexion cassée côté banque → Powens n'envoie simplement plus de
  webhook. C'est le poll (`GET /users/me/connections` avec le token permanent
  de chaque org) qui rattrape ce cas — ne jamais retirer le cron en pensant
  que le webhook couvre tout. Symétriquement, `evaluateConnectionsHealth`
  tourne en fin de cron **même si tous les fetchs ont échoué** : la staleness
  doit être détectée sans aucune donnée entrante.
- **Le webhook est ingéré même à 0 compte.** Une synchro en ÉCHEC livre
  typiquement un payload sans comptes mais avec le `state` d'erreur — c'est
  précisément lui qu'on veut. Ne pas remettre le garde
  `accounts.length > 0` d'avant sur l'appel à `ingestConnectionSync`.
- **Santé dérivée, jamais stockée** (`connectionHealth`) : `action_required`
  si `state` ∈ {wrongpass, SCARequired, webauthRequired, actionNeeded,
  passwordExpired, additionalInformationNeeded} (re-auth webview
  obligatoire) ; `stale` si aucun signal (max de `lastSuccessfulSyncAt` /
  `lastWebhookAt` / `_creationTime`) depuis > 48 h (Powens re-synchronise
  toutes les ~24 h) ; sinon `connected`. Les états transitoires
  (websiteUnavailable, rateLimiting, bug…) ne déclenchent PAS d'alerte
  directe — ils finissent en `stale` s'ils durent.
- **Anti-spam : `notifiedHealth`** mémorise le dernier état dégradé alerté
  par email ; remis à `undefined` au retour au vert. Un incident = un email,
  une aggravation (`stale` → `action_required`) = un second. Pas de cooldown
  temporel — c'est le changement d'état qui déclenche.
- **Le poll est autoritaire sur l'existence** : une connexion absente de la
  réponse (supprimée côté Powens) est retirée de `powensConnections` —
  uniquement après un fetch réussi (une liste vide signifie vraiment « zéro
  connexion », pas une erreur).
- **Datetimes Powens sans timezone** (`YYYY-MM-DD HH:MM:SS`) : parsés en UTC
  (`parsePowensDateTime`). Un décalage d'1–2 h est sans effet sur le seuil
  de 48 h — ne pas sur-ingénierer.
- **Reconnexion** : `startReconnect` → webview `/reconnect` avec
  `connection_id` + code temporaire. Même flux de code que
  `startBankConnection` ; Powens refuse un `connection_id` qui n'appartient
  pas au user porteur du code (pas de contrôle d'appartenance à refaire côté
  app au-delà du rôle admin).
- **État « Non suivie » (`untracked`) — le trou Qonto.** Un compte peut être
  lié à Powens (`powensAccountId` posé) alors que sa connexion n'a AUCUNE
  ligne `powensConnections` : connexion établie sous un **user Powens non
  géré** (vieux user temporaire, autre projet) → ses webhooks sont ignorés
  (`id_user` inconnu) et le poll du user géré ne la voit pas. Conséquence
  silencieuse : plus aucune mise à jour de solde/transactions, zéro
  surveillance, mais le compte paraît « connecté ». `listConnections`
  détecte ces orphelins (linked + non archivé + non clôturé + connexion non
  suivie) et les renvoie en `health: 'untracked'` (pastille « Non suivie »,
  comptée dans la bannière). **Réparation opérateur** (cas Qonto) :
  1. `convex run --prod powens:diagnoseQontoMatch` — état des candidats.
  2. `convex run --prod powens:resetQontoPowensLink '{"bankAccountId":"…"}'`
     — délie le record (sinon la nouvelle connexion finit en
     `qonto_already_linked`).
  3. « Connecter une banque » dans l'app (user Powens géré) → `linkQonto`
     re-backfille et la connexion devient suivie. Pas de bouton
     « Reconnecter » sur une ligne `untracked` : il n'y a rien à reconnecter
     sous le user géré, il faut une connexion neuve.

## Pointage transaction → deal (`convex/transactions.ts`)

Le pointage manuel rattache une transaction bancaire à un deal (MVP 1) et
alimente le dataset d'apprentissage de l'agent de rattachement (phase 2).

- **La page Pointage souscrit aux queries `listOptions` (deals + passif),
  jamais aux queries enrichies.** Chaque action de pointage écrit une
  transaction ; toute query souscrite dont le read set touche `transactions`
  (`deals.list` via les totaux par deal, `liabilities.getLiabilities` via
  les transactions allouées) serait re-exécutée et re-téléchargée à CHAQUE
  clic. Les comboboxes n'ont besoin que d'ids + libellés →
  `deals.listOptions` / `liabilities.listOptions` (zéro lecture de
  transactions). Ne pas re-brancher la page sur les queries enrichies.

- **`matchStatus` est la source de vérité, `reconciled` n'est qu'un miroir
  dérivé.** Le boolean `reconciled` (+ `reconciledBy`/`reconciledAt`) prédate
  le pointage et reste lu par l'UI deal, la vue Cash et l'outil agent. Les
  mutations `matchTransaction` / `ignoreTransaction` / `categorizeAsCharge` /
  `categorizeAsTax` / `categorizeAsProduct` / `categorizeAsInternalTransfer` /
  `unmatchTransaction` maintiennent le miroir (matched →
  `true`, sinon `false`). **Ne jamais écrire `reconciled` directement dans du
  nouveau code** — passer par ces mutations, sinon les deux états divergent.
- **Invariant** : `matchStatus === 'matched'` ⟺ `dealId != null`. Les états
  `unmatched` / `ignored` / `charge` / `tax` / `product` / `internal_transfer`
  ont toujours `dealId == null`. `charge`, `tax`, `product` et
  `internal_transfer` sont des sous-types d'« écarté » : même comportement
  qu'`ignored` (hors file de pointage, pas de deal), seul le statut diffère
  pour pouvoir les consulter ensuite (`listByStatus`). `product` (argent
  entrant hors deal) n'affecte jamais le « Reçu » d'un deal.
- **`internal_transfer` est une simple étiquette en V1.** Pas d'appariement
  des deux jambes d'un virement (sortie d'un compte ↔ entrée sur l'autre) :
  chaque transaction est classée indépendamment. L'appariement sera une
  feature dédiée le jour où une trésorerie consolidée l'exploitera.
- **`matchStatus` est optionnel au schéma** (les documents pré-existants n'ont
  pas le champ). Absence = logiquement `unmatched`, mais ces lignes sont
  **invisibles** de l'index `by_org_matchStatus` → la query `listUnmatched` ne
  les retourne pas tant que `transactions:backfillMatchStatus` n'a pas tourné
  (one-shot idempotent, `'{}'` = toutes les orgs, cf. `TESTING.md`). L'import
  CSV Mémo Bank a inséré sans `matchStatus` jusqu'au fix de juin 2026 — les
  lignes albo importées avant nécessitent ce backfill.
- **`matchingDecisions` est append-only.** Une ligne par action de pointage
  (y compris le dé-pointage, signal négatif pour l'agent). Jamais de patch ni
  de delete. Le backfill n'y écrit **rien** (pas une décision humaine — ne pas
  polluer le dataset).
- **La ré-ingestion ne clobbe pas le pointage.** Powens (re-livraison webhook)
  et l'import Airtable (re-run) posent l'état de pointage **à l'insert
  uniquement** ; le patch d'une ligne existante n'écrit ni `matchStatus`, ni
  `dealId`, ni `reconciled`. Avant le pointage, le re-sync Powens remettait
  `reconciled: false` à chaque webhook — ce reset a été retiré exprès.
- **`allocation` cohabite avec `dealId` (pointage généralisé).** Invariant :
  `dealId != null` ⟺ `allocation = { kind: 'deal', targetId: dealId }`. Les
  mutations de pointage maintiennent les deux ensemble (match écrit les deux,
  unmatch/ignore/categorize effacent les deux). Les lignes pré-existantes
  sont alignées par `transactions:backfillAllocation` (one-shot par org,
  idempotent, n'écrit rien dans `matchingDecisions`). Tout nouveau code qui
  écrit `dealId` doit écrire `allocation` dans le même patch.
- **Registre Transactions (`listLedger`) — plafond 1000, plus récent
  d'abord.** L'onglet Transactions de la page Trésorerie (qui absorbe la file
  de pointage : « À pointer » = filtre `unmatched`) lit `listLedger`, borné aux
  **1000 transactions les plus récentes** par filtre actif (`LEDGER_LIMIT`).
  Au-delà, la queue la plus ancienne est masquée — le browse exhaustif (capé
  200) reste sur `/cash/$accountId`. Comme `listUnmatched`, le registre passe
  par l'index `search_text` en mode recherche : une ligne sans `searchText`
  (pré-`backfillSearchText`) reste invisible à la recherche. Pas de pagination
  serveur (`usePaginatedQuery` n'est utilisé que par le chat) : on garde le
  pattern `.take()` + `LocalPagination` partagé avec `PointageTable`.

## Catégories & règles apprenantes (`convex/lib/categories.ts`, `categoryRules`)

Les grandes catégories de trésorerie (analyse entrées/sorties + futur
prévisionnel par catégorie) et leur automatisation « à la Fygr » : un geste
manuel = une règle mémorisée, rejouée sur les transactions suivantes.

- **`category` n'existe que sur `charge` / `product`** — même famille
  d'invariants que `vatRateBps` : tout pointage qui fait quitter ces statuts
  l'efface (enforced dans `convex/lib/pointage.ts`). Les autres statuts
  dérivent leur bucket d'analyse du pointage lui-même
  (`effectiveCategory` : deal → « Deals », allocation passif → « Capitaux
  propres »/« Comptes courants & intercos », tax → « Impôts & taxes »,
  unmatched → « À pointer » ; `ignored` et `internal_transfer` sont
  **exclus** de l'analyse et comptés à part). Ne jamais stocker de
  `category` sur un autre statut.
- **Les listes de slugs sont dupliquées** `convex/lib/categories.ts` ↔
  `src/lib/categories.ts` (convex/ et src/ ne partagent pas de modules
  runtime, même pattern que `searchText`/`vat`) — sync verrouillée par
  `tests/categories.test.ts`. Les libellés user-facing vivent dans
  `common:categories.<slug>` (fr + en).
- **Une règle = un geste mémorisé, upsert par `(orgId, pattern)`.** Le
  pattern est dérivé du libellé (`deriveCategoryPattern` : contrepartie si
  présente, sinon tokens stables du libellé — les tokens majoritairement
  numériques (dates, références) sont retirés, 4 tokens max). Matching par
  sous-ensemble de tokens sur `searchText` (une ligne sans `searchText`,
  pré-backfill, ne matche jamais). Le dernier geste gagne (la règle est
  réécrite). Statuts appris : charge / tax / product / internal_transfer —
  **jamais** `matched` (jugement humain) ni `ignored` (angle mort silencieux
  trop facile). Créées par les gestes **unitaires** seulement (pas le bulk,
  libellés trop variés).
- **Application : à l'insert (webhook Powens + import Mémo CSV) et à la
  demande** (`transactions:applyCategoryRules`, bouton « Appliquer les
  règles » du filtre À pointer). Jamais sur un patch de re-livraison webhook
  (l'état de pointage existant n'est pas réécrit). Une application de règle
  n'écrit **rien** dans `matchingDecisions` (décision machine — même
  principe que les backfills) et ne touche pas `reconciled`.
- **Pas d'édition/suppression de règles en V1** — passer par le dashboard
  Convex (table `categoryRules`) pour corriger une règle trop large. Une
  règle erronée ne casse rien d'irréversible : les lignes classées se
  détachent (« Détacher ») et se reclassent normalement.

## TVA récupérable (`convex/lib/vat.ts`, `transactions:getVatPosition`)

Suivi minimal de la TVA pour fiabiliser les charges réelles et la position de
TVA récupérable (carte sur la page Trésorerie). Pas un module de déclaration.

- **Les montants de transaction sont toujours TTC.** Le taux de TVA
  (`vatRateBps` : 0 / 550 / 1000 / 2000) est stocké sur la transaction ; le
  montant de TVA est **toujours dérivé, jamais stocké** :
  `vatCents = round(amount × taux / (10000 + taux))`. La dérivation vit dans
  `convex/lib/vat.ts`, miroir front `src/lib/vat.ts` (même convention que
  `searchText.ts`) — garder les deux identiques (testé par
  `tests/vat.test.ts`).
- **Invariant : `vatRateBps` n'existe que sur `charge` / `product`.** Tout
  pointage qui fait quitter ces statuts (match deal, allocation passif,
  unmatch, re-catégorisation en ignored/tax/internal_transfer) l'efface —
  enforced dans `convex/lib/pointage.ts`, ne pas contourner.
- **L'historique n'est pas backfillé, exprès.** Une charge sans taux est
  « à qualifier » (un /1,2 global serait faux : salaires, assurances, frais
  bancaires sont exonérés). La qualification se fait ligne à ligne dans les
  onglets Charges/Produits du pointage (`setVatRate`, accepte `null` pour
  revenir à « à qualifier »), ou via l'outil agent `categorizeTransaction`.
  Le défaut 20 % ne s'applique qu'aux **nouvelles** catégorisations en charge
  depuis l'UI (`DEFAULT_VAT_RATE_BPS`, côté front exprès — backend neutre).
- **`getVatPosition` est signée par le sens** : une charge `in` (avoir
  fournisseur) se déduit de la TVA déductible, un produit `out` de la TVA
  collectée. Les règlements/remboursements de TVA avec l'État restent en
  statut `tax` et ne sont **pas nettés** contre la position en V1 — la carte
  montre la position cumulée, pas le solde restant à récupérer après
  déclarations.

## Passif — `equityPositions` / `intercompanyLoans` / soldes dérivés (`convex/liabilities.ts`)

Le passif (capitaux propres + C/C d'associés) est modélisé par deux tables
quasi-statiques ; les **soldes de C/C ne sont jamais stockés**, toujours
dérivés des transactions pointées (`allocation.kind === 'intercompany_loan'`).

- **Chaque org somme SES PROPRES transactions** (index
  `by_org_allocation_target` sur `['orgId', 'allocation.targetId']` — les
  chemins imbriqués sont supportés par les index Convex). Créancier
  (`fromOrgId`) : out = prêt, in = remboursement → solde + = créance.
  Débiteur (`toOrgId`) : in = emprunt, out = remboursement → solde − = dette.
  Si une seule des deux orgs a pointé sa jambe, les deux soldes **divergent** :
  c'est un signal de réconciliation (trou de pointage), pas un bug.
- **`intercompanyLoans` n'a pas d'`orgId`** : le prêt appartient aux deux orgs
  (`fromOrgId` créancier / `toOrgId` débiteur). Toute query doit vérifier que
  l'utilisateur est membre d'au moins une des deux (pattern `getLiabilities` :
  `requireOrgMember` sur l'org regardante, puis lecture par `by_from`/`by_to`).
- **Pointage public : `liabilities:allocateTransaction` / `deallocateTransaction`.**
  Une tx allouée au passif passe en `matchStatus: 'matched'` **sans `dealId`**
  (elle sort de la file de pointage) ; le détachement la repasse `unmatched`.
  `matched` est donc ambigu : rattachée à un deal (`dealId != null`) **ou**
  allouée au passif (`allocation.kind === 'equity' | 'intercompany_loan'`,
  `dealId` null) — toujours discriminer par `dealId` / `allocation.kind`,
  jamais supposer « matched ⟹ deal ». Le front du pointage passif vit dans
  l'**onglet Pointage** (combobox groupé Deals / Capitaux propres / Comptes
  courants, `TargetCombobox`) ; le détachement vit sur la page Passif et dans
  le bandeau « Annuler » du Pointage.
- **Combobox de pointage : ne JAMAIS masquer un groupe vide.** Un groupe
  rendu conditionnellement (`options.length > 0 && …`) rend « absent » et
  « vide » indistinguables — c'est exactement le bug signalé sur le groupe
  Comptes courants (impossible de savoir si le câblage était cassé ou si la
  liste était vide). Règle : les trois groupes sont **toujours** rendus, avec
  un état vide explicite (« Aucun compte courant pour cette organisation »).
  Le câblage cibles → groupes est verrouillé par
  `src/lib/liabilityOptions.ts` (pur) + `tests/liabilityOptions.test.ts` :
  chaque groupe est alimenté **directement** depuis sa source
  (`equityPositions` / `loans`), jamais via une liste aplatie re-filtrée par
  `kind`.
- **Garde-fous croisés deal ⟷ passif.** Allouer une tx déjà rattachée à un
  deal → `ConvexError('already_matched_to_deal')` ; matcher / écarter /
  dé-pointer (unmatch) une tx allouée passif →
  `ConvexError('allocated_to_liability')` (la détacher passe par
  `deallocateTransaction` uniquement, sinon allocation orpheline).
  Le pointage passif n'écrit **jamais** dans `matchingDecisions` (dataset
  réservé au pointage deal) et ne touche jamais `reconciled` (miroir
  deal-only : la vue Cash affiche une tx passif comme « non pointée »).
- **Création depuis l'UI : `createEquityPosition` / `createIntercompanyLoan`**
  (page Passif, boutons « + Capital » / « + Compte courant »). Création
  seule — **l'édition et la suppression restent des follow-ups** (passer par
  le dashboard Convex en attendant). Détenteur d'une equity : org du groupe
  OU libellé libre (`holderPersonId` jamais exposé, pas de table persons).
  C/C : l'utilisateur doit être membre d'au moins une des deux orgs
  (`not_a_party`), `interestRateBps` absent = non rémunéré.

## Recherche transactions — champ dérivé `searchText` (`convex/lib/searchText.ts`)

La recherche full-text des transactions (vues tréso + pointage) passe par le
search index `search_text` sur un champ **dérivé** `searchText`, pas sur
`rawLabel` directement. Pièges :

- **Pourquoi un champ dérivé ?** Le tokenizer du search index Convex ne fait
  **pas** de folding d'accents (`énergie` ≠ `energie`) et un index ne cherche
  que dans **un seul** champ. `searchText` = `rawLabel + counterparty`
  normalisé (minuscules, sans diacritiques) via `buildSearchText`, et la
  saisie utilisateur est normalisée pareil côté query (`normalizeSearch`).
  Le label du compte bancaire est exclu exprès (staleness : renommer un
  compte obligerait à réécrire toutes ses transactions).
- **Tout nouveau point d'écriture de transaction DOIT poser `searchText`**
  via `buildSearchText(rawLabel, counterparty)` — sinon les lignes sont
  invisibles à la recherche (mais visibles dans les listes). Points
  d'écriture actuels : sync Powens, import CSV Mémo (`convex/powens.ts`),
  import Airtable (`convex/airtableImport.ts`), création manuelle agent
  (`convex/agentTools.ts`). Idem si un code futur patche `rawLabel` ou
  `counterparty` : recalculer `searchText` dans le même patch.
- **`searchText` est optionnel au schéma** (même pattern que `matchStatus`) :
  les lignes pré-existantes ne l'ont pas tant que
  `transactions:backfillSearchText` (one-shot idempotent, `'{}'` = toutes les
  orgs) n'a pas tourné en prod. Symptôme typique : transaction visible dans
  les listes mais introuvable par la recherche, côté UI **et** outils agent
  (même index). Concerne toute ligne écrite avant le déploiement du champ
  (02/06/2026) — ex. sync Powens depuis le 31/05, import CSV Mémo albo.
- **`normalizeSearch` existe en double** : `convex/lib/searchText.ts` (queries
  - mutations) et `src/lib/searchText.ts` (filtre client participations,
    normalisation de la saisie). convex/ et src/ ne partagent pas de modules
    runtime — garder les deux copies identiques.
- **Les résultats search sont triés par pertinence**, pas par date — les
  queries re-trient par `transactionDate` desc avant de retourner. La branche
  recherche est bornée (`.take(200)`) ; la branche sans recherche garde son
  comportement historique (`.collect()` pointage, `.take(200)` tréso).

## Cash flow forecast (`convex/forecasts.ts`)

Couche prévisionnelle déterministe : `forecastRules` → `expandRules` →
`forecastEntries` → `getForecastGrid`. Pièges à connaître avant d'y toucher.

- **`status` est la source de vérité du cycle de vie** (`pending` / `realized`
  / `cancelled`), à la manière de `matchStatus` côté transactions. Seules les
  entries `pending` comptent dans le solde projeté.
- **`overridden` protège l'édition manuelle.** `expandRules` ne réécrit JAMAIS
  une entry `overridden: true`, ni une entry `realized`/`cancelled` (décision
  humaine figée). La décision create/update/skip est une fonction pure
  (`entryUpsertAction` dans `convex/lib/recurrence.ts`) — toute modification
  de cette règle doit passer par elle (et ses tests), pas par du code ad hoc
  dans la mutation.
- **Idempotence par `derivedKey`** (`"rule:{ruleId}:{YYYY-MM-DD}"`, index
  `by_derivedKey`). Relancer `expandRules` ne duplique rien. Ne jamais créer
  d'entry dérivée sans `derivedKey`, sinon la prochaine expansion la
  dupliquera.
- **La table legacy `forecasts` coexiste, inerte.** Elle reste alimentée par
  l'import Airtable uniquement et n'est lue par aucune logique forecast. La
  nouvelle couche vit dans `forecastRules` / `forecastEntries`. Ne pas
  mélanger les deux ; le retrait suit le runbook `MIGRATIONS.md` (purge prod
  via `seed:purgeLegacyForecasts` AVANT retrait du schéma).
- **EUR only.** La grille n'agrège que `currency === 'EUR'` (comptes ET
  entries) ; le reste est compté dans `ignoredNonEur*` pour visibilité.
  `probabilityPct`, `counterpartyOrgId` et `currency` sont des champs
  **réservés non lus** (future couche probabiliste / neutralisation
  inter-entités / FX) — ne pas leur prêter d'effet.
- **Le pointage prévu → réalisé ne touche pas aux transactions.**
  `markEntryRealized` écrit uniquement sur `forecastEntries` (`status` +
  `realizedTransactionId`, et le split du reliquat). Le pointage
  transaction → deal (`matchStatus`, `reconciled`, `matchingDecisions`)
  reste exclusivement géré par `convex/transactions.ts` — ne pas écrire ces
  champs depuis le code forecast.
- **Rapprochement échéance ↔ transaction : deux modes, un seul split.**
  `markEntryRealized` (et l'outil agent `markForecastEntryRealized`)
  prennent `mode: 'close' | 'keepRemainder'` via le cœur partagé
  `applyMarkEntryRealized`. `close` (défaut) réalise l'échéance **telle
  quelle** : le montant prévu n'est PAS aligné sur la transaction, l'écart
  reste lisible. `keepRemainder` (paiement partiel, exige une entry
  `pending` et `tx.amount < entry.amountCents`, sinon
  `no_remainder`/`not_pending`) réalise l'entry au montant payé et crée le
  reliquat comme **one-shot pur** (sans `ruleId` ni `derivedKey` — visible
  dans la table des ponctuelles, jamais re-générée par `expandRules` ; ne
  pas lui remettre le `ruleId`, il re-entrerait en collision avec le filtre
  `listEntries` et l'expansion). Les suggestions (`suggestForecastMatches` +
  carte « Rapprochements suggérés ») viennent du moteur pur
  `convex/lib/entryMatching.ts` (fenêtres sens/date/montant + score
  montant/date/libellé, testé par `tests/entryMatching.test.ts`) ; une
  transaction déjà portée par un `realizedTransactionId` n'est jamais
  re-suggérée.
- **Tests purs hors de `convex/`.** La logique (récurrence UTC, clamping fin
  de mois, protection, agrégation mensuelle) vit dans
  `convex/lib/recurrence.ts` (zéro import Node/Convex) et est testée par
  `tests/recurrence.test.ts` via `node:test` + tsx (`pnpm test:unit`). Le
  fichier de test est volontairement **hors** de `convex/` : un import
  `node:test` dans `convex/` ferait échouer le bundle de déploiement Convex.
- **Date-math en UTC uniquement.** `anchorDay: 31` est clampé au dernier jour
  des mois courts (28/29 févr., 30 avr., …) ; hebdo = jour ISO (1 = lundi,
  7 = dimanche). Toute nouvelle logique de date doit passer par
  `convex/lib/recurrence.ts`, pas par `new Date()` local (fuseau serveur).
- **`Date.now()` dans les queries de solde = cache Convex défait — accepté.**
  `computeCashHistoryForOrgs` / `computeForecastGridForOrg` /
  `suggestForecastMatches` bornent leurs fenêtres avec `Date.now()`, ce qui
  re-exécute la query plus souvent que nécessaire (audit perf juin 2026).
  Trade-off assumé : le vrai fix (passer l'horodatage arrondi en argument
  depuis le client) toucherait signatures, callsites et outils agent pour
  un gain nul à l'échelle actuelle — ces queries n'apparaissent pas dans le
  breakdown Usage. À ré-évaluer si elles y montent.
- **Une seule sémantique de projection : la consommation.** UI
  (`getForecastGrid`) et outil agent + MCP `getForecastBalance` partagent
  le cœur `forecasts.ts:computeForecastGridForOrg` (consommation par
  cellule direction × catégorie sur le mois courant, rollover des échéances
  en retard, périmètre comptes **disponibles** — logique pure
  `lib/recurrence.ts:buildForecastGrid`, testée par
  `tests/forecastGrid.test.ts`). L'agent le lance avec `historyMonths: 0`
  (le réalisé du mois courant est quand même lu, sinon la consommation
  tombe) et re-projette les cellules en `inflow/outflow` mensuels ;
  `minConfidence: 'confirmed'` = scénario engagé seul, tout le reste =
  scénario avec prévu (`expected` et `probable` sont le même « prévu »).
  L'ancienne sémantique fenêtrée (`buildMonthlyBalance`, query publique
  `getForecastBalance`) a été **supprimée** en phase 2b — ne pas la
  réintroduire pour un nouveau besoin, brancher le cœur grille.
- **La consommation prévu/réalisé est par cellule (direction × catégorie),
  pas par échéance.** Une échéance sans catégorie n'est consommée que par
  du réalisé « À qualifier » (`uncategorized`) ; une grosse entrée
  unmatched ne consomme rien (bucket `unmatched`, hors catégories de
  prévision). D'où l'intérêt de catégoriser règles ET transactions avec
  les mêmes slugs. Pour sortir une échéance précise du prévisionnel dès
  que son flux est passé en banque, passer par le rapprochement unitaire
  (cf. le point rapprochement ci-dessus) — c'est lui qui fige l'échéance,
  la consommation par cellule n'est qu'un anti-double-comptage d'affichage.
- **Crons (`convex/crons.ts`) = fonctions internal SANS auth — exception,
  pas un précédent.** `captureSnapshots` (mensuel, 1er 05:00 UTC) et
  `checkCashAlerts` (quotidien 07:00 UTC) itèrent toutes les orgs sans
  `requireOrgMember`, comme les backfills. La règle multi-tenant reste
  absolue pour toute fonction **publique**. Un cron raté se rejoue à la
  main (`convex run forecasts:captureSnapshots '{}' --prod`) — idempotent
  par (org, mois). Les snapshots sont **append-only** ; la fiabilité
  affichée compare le snapshot du mois M-1 (pris le 1er de M-1, scénario
  avec prévu) au solde réel de fin M-1 — rien ne s'affiche tant que le
  premier snapshot n'existe pas.
- **Alerte de seuil : cooldown 7 jours, remis à zéro à chaque save.**
  `setCashAlert` efface `lastNotifiedAt` pour qu'un nouveau seuil puisse
  notifier immédiatement ; en contrepartie, re-sauvegarder sans rien
  changer ré-arme aussi l'alerte (accepté, 2 users).
- **Digest « échéances en retard » : anti-spam SANS état, couplé à la
  cadence quotidienne du cron.** `checkOverdueEntries` (quotidien
  07:10 UTC) considère en retard une échéance `pending` EUR dépassée de
  plus d'**un jour de grâce** (`OVERDUE_GRACE_MS` — la banque synchronise
  en ~24 h et le rapprochement est un geste manuel), et n'envoie le digest
  que si au moins une échéance a **franchi la limite depuis le run
  précédent** (`OVERDUE_NEW_WINDOW_MS` = 1 jour). Aucun champ
  `lastNotifiedAt` : c'est la fenêtre qui déduplique. Conséquences : (1)
  **ne pas changer la fréquence du cron** sans ajuster la fenêtre — un cron
  toutes les 6 h enverrait 4 digests pour la même échéance, un cron
  hebdomadaire raterait les échéances des jours intermédiaires ; (2) un
  run de cron raté = digest de ce jour-là perdu (pas de rattrapage) —
  accepté, le stock complet repart dans le digest suivant dès qu'une
  nouvelle échéance passe en retard.
- **Échéance TVA suggérée : `derivedKey` "vat:{orgId}:{YYYY-Qn}", sans
  `ruleId`.** L'idempotence passe par la clé (créée une fois par trimestre,
  quelle que soit sa vie ensuite : réalisée, annulée, éditée — la
  suggestion ne revient pas). Pas de bouton « Ignorer » en V1 : la carte
  n'apparaît que si la TVA du trimestre clos est à payer, ce qui est rare
  pour des holdings en position récupérable ; pour la faire taire sans
  créer d'échéance au prévisionnel, créer l'échéance puis l'annuler
  (`cancelled` garde la clé).
- **La détection de récurrences ne crée JAMAIS de règle seule.**
  `forecasts.suggestRules` (moteur pur `lib/recurrenceDetection.ts`, testé)
  propose des règles depuis l'historique 12 mois ; la création passe
  toujours par le dialog prérempli (geste humain, `createRule` +
  `expandRules` habituels). Le groupement réutilise la MÊME clé de pattern
  que les règles apprenantes de catégorie (`deriveCategoryPattern`) — si le
  pattern d'un libellé change, les deux mécanismes bougent ensemble.
  « Ignorer » écrit dans `dismissedRuleSuggestions` (org, pattern,
  direction) et est définitif côté UI — pour ré-afficher une suggestion,
  supprimer la ligne via le dashboard Convex (même stance V1 que
  `categoryRules`).
- **Lien deal ↔ prévisionnel : le `dealId` d'une règle est resynchronisé
  sur ses occurrences non protégées.** `expandRules` propage `rule.dealId`
  à l'insert ET au resync — changer le deal d'une règle re-pointe donc ses
  occurrences pending non `overridden` (les réalisées/annulées/éditées
  gardent le leur, comme pour le montant). Le deal doit appartenir à l'org
  (`assertDealInOrg` → `deal_wrong_org`) sur toutes les écritures, agent
  compris. Le reliquat d'un paiement partiel hérite du `dealId`. Ce lien
  n'affecte NI la grille (le bucket reste la catégorie), NI le pointage
  (`transactions.dealId` reste géré par `convex/transactions.ts` — le
  toast « Pointer sur le deal » appelle `matchTransaction`, jamais le code
  forecast).
- **La table front des échéances ne liste que les one-shot pures — limitation
  V1 assumée.** `forecasts.listEntries` (consommée par `ForecastEntriesSection`,
  onglet Cash « Règles & échéances ») filtre `ruleId == null` : les occurrences générées
  par une règle n'y apparaissent jamais. Conséquence : une occurrence de règle
  passée en `overridden` (éditée à la main — aujourd'hui faisable uniquement
  via l'agent IA, `updateForecastEntry`) n'est visible **ni** dans cette table
  (filtre `ruleId == null`), **ni** dans la table des règles (qui liste les
  règles, pas leurs occurrences) — seulement dans la courbe/grille
  `getForecastGrid`. Non corrigé délibérément : la surface humaine se limite
  aux règles récurrentes + aux ponctuelles pures ; l'override d'une occurrence
  dérivée reste un geste agent. À revoir si l'édition d'occurrence dérivée
  passe un jour en front.

## Split chapeaux Attio → SPV, org albo (`convex/migrations/splitAlboSponsorSpvs.ts`)

Attio modélise les plateformes de dette immo (Parallel Invest, Sezame) comme
**une** company avec un deal par SPV. Le modèle Albo OS est « 1 entité
juridique = 1 company » : la migration crée une company par SPV
(`kind: 'portfolio'`, `sponsor` = "Parallel"/"Sezame"), re-pointe
`deals.targetCompanyId` dessus et archive les chapeaux. Rewatt est
volontairement hors scope (deals laissés sur le chapeau).

- **Re-lancer `attioAlboImport:run` annule le split.** L'import upserte les
  deals par `attioDealId` et re-patche `targetCompanyId` vers les companies
  chapeaux. Procédure : après tout re-run de l'import Attio, re-lancer
  `splitAlboSponsorSpvs:apply` (les deux sont idempotents, l'ordre suffit).
- **Les companies SPV n'ont pas d'`attioCompanyId`.** Elles n'existent pas
  comme companies dans Attio (ce sont des deals là-bas) ; le pont Attio reste
  sur la company chapeau archivée. Leur ancre d'idempotence est
  `airtableId = "split:attio:{attioDealId}"` (réutilisation du champ ancre
  d'import + index `by_airtable_id` — même pattern que l'import Airtable,
  malgré le nom).
- **Aucun re-rattachement de transactions/valuations.** Elles sont liées par
  `dealId`, qui ne change pas. Seul `targetCompanyId` bouge.
- **Workflow prod en 3 temps, validation humaine obligatoire** :
  `dryRun` (internalQuery, lecture seule) → relire le rapport → `apply`
  (internalMutation) → `verify`. Jamais de hard delete : archivage via
  `archivedAt`, et uniquement si plus aucune référence (deals, relations,
  KPIs, comptes, viaSpv) ne pointe vers le chapeau.

## Upgrade depuis le template (albo-ouvre-boite)

Le repo partage l'historique git du template : `pnpm run upgrade-template`
fait un merge 3-way normal. Le graft `.template-version` décrit dans
`UPGRADING.md` ne concerne que les snapshots « Use this template » sans
historique commun — pas nous.

Le raccord initial (merge du 11/06/2026) a été fait en `-s ours` :
le lien de parenté est enregistré, mais **aucun code du template n'a été
adopté**. Tout ce que le template avait shippé entre le point de fork (#28)
et v0.2.0+ était soit déjà refait ici indépendamment (traduction EN des
commentaires, retrait des démos, nettoyage lint, job CI skills-drift), soit
non voulu :

- `WhatsNew.tsx` + `src/lib/changelog.ts` — on a notre propre page
  changelog (`CHANGELOG_PRODUIT.md` rendu sur `/app/$orgSlug/changelog`).
- `README.product.md`, `release-tag.yml`, `scripts/release.mjs` —
  machinerie de release du template lui-même, sans objet dans un dérivé.
- Notification dev au signup (`DEV_NOTIFY_EMAIL`, template #33) — valeur
  ~nulle à 2 utilisateurs sur invitation.
- Bumps de majors (template #34) — Renovate s'en charge ici.

Conséquence : un futur `upgrade-template` ne re-proposera **pas** ces
éléments (ils sont considérés mergés). Si l'un devient pertinent,
cherry-picker depuis `template/main`.

## Pagination « Nouveautés » (couplage format ↔ parser)

La page `/app/$orgSlug/changelog` (`src/routes/app/$orgSlug/changelog.tsx`)
n'affiche que les 10 dernières entrées et révèle le reste par paliers. Pour
ça, `parseChangelog()` découpe l'import `?raw` de `CHANGELOG_PRODUIT.md` sur
les frontières `^## ` et **classe chaque section par son titre** :

- Une section est une **entrée** (paginée) si son titre contient le séparateur
  ` — ` (em-dash entouré d'espaces). C'est garanti par le format imposé dans
  `CLAUDE.md` (`## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre`), et ça couvre aussi les
  4 entrées historiques `## Mois AAAA — …`.
- La **première** section sans ` — ` démarre le **footer** épinglé (en pratique
  le « Petit lexique » de bas de page, toujours en dernier).

Conséquence à connaître avant d'éditer `CHANGELOG_PRODUIT.md` :

- Un titre d'entrée **sans** ` — ` serait traité comme footer → toutes les
  entrées suivantes disparaîtraient de la pagination. Garder le format.
- Toute nouvelle section de bas de page (après le lexique) doit rester **sans**
  ` — ` pour être épinglée, ou elle sera paginée comme une entrée.

Le découpage est sans perte (roundtrip `header + entries + footer === raw`).

## Resend: two integrations (runtime Convex vs Claude Code plugin)

There are **two unrelated Resend setups** here and they read the same env var
name from **different places** — don't conflate them.

1. **Runtime email** (`@convex-dev/resend`, `convex/email.ts`). Sends the app's
   transactional mail (auth, invitations, notifications). Its `RESEND_API_KEY`
   and `RESEND_FROM` live in the **Convex deployment env** (`pnpm exec convex
   env set …`). Nothing here touches your shell.

2. **Dev tooling** (the `resend@claude-plugins-official` Claude Code plugin,
   enabled in `.claude/settings.json`). Its bundled MCP server runs
   `npx -y resend-mcp` and reads `RESEND_API_KEY` from the environment Claude
   Code passes it — **not** the Convex env. Put it in the gitignored
   `.claude/settings.local.json` `env` block (never committed); **restart
   Claude Code** to apply. A shell-profile `export` also works.

So a missing/incorrect key produces different symptoms depending on which
side: app emails failing → check the **Convex** env; the Claude Code Resend
tools failing → check `.claude/settings.local.json` and restart. The plugin's
skills auto-update via the marketplace and are deliberately **not** vendored
in `skills-lock.json`.

## Logos d'entreprises (logo.dev) — hotlink, pas de stockage

`src/components/CompanyLogo.tsx` affiche les logos des boîtes du portefeuille
(liste participations, vue `/app/all`, en-tête fiche société). Trois choix
non-évidents :

1. **Pas de stockage en base, ni Convex file storage.** La doc logo.dev
   recommande explicitement de hotlinker l'URL CDN
   (`https://img.logo.dev/:domain?token=…`) — _« a global CDN serves every
   logo, you never host a logo file yourself »_. On construit donc l'URL côté
   client à la volée ; pas de champ `logoUrl`/`logoStorageId` sur `companies`.
   N'ajoute pas de pipeline de copie/cache sans raison.

2. **Le token `VITE_LOGO_DEV_TOKEN` est une clé _publishable_ (`pk_…`)**,
   conçue pour être embarquée côté client. L'anti-pattern « pas de `VITE_` sur
   un secret » **ne s'applique pas** ici — ne la migre pas vers la Convex env.
   Absente → fallback icône bâtiment partout (aucune image cassée).

3. **Le `domain` vient d'un snapshot Attio figé**
   (`convex/migrations/attioAlboImport.ts`, 28/05/2026), pas d'une sync live.
   Les ~35 boîtes Albo importées l'ont ; les autres (CALTE, créations manuelles)
   peuvent ne pas l'avoir → fallback, et le champ reste éditable via
   `EditCompanyDialog`. Si un domaine change côté Attio, il faut le ressaisir
   à la main.

## Sync Attio → deals (webhook live, `convex/attioSync.ts` + `convex/lib/attioSync.ts`)

Synchro **stage-driven** : le webhook Attio `record.updated` sur l'objet
`deals` re-fetch le record et n'agit que sur deux stages (par id, jamais le
label) : **📝 Term Sheet** et **Invested**. La logique de décision est **pure et
testée** (`convex/lib/attioSync.ts:decideSyncAction`, `tests/attioSync.test.ts`) ;
le module Convex n'est qu'une coquille DB autour.

1. **Verrou anti-doublon — on ne crée un deal qu'au Term Sheet, jamais sur
   Invested.** Un event Invested sans `attioDealId` correspondant est **skippé**
   (`invested_no_deal`). C'est ce qui permet d'activer la synchro « à partir de
   maintenant » sans réimporter le portefeuille déjà investi (import #184,
   Airtable, saisie manuelle). **Conséquence** : un deal qui passe *directement*
   en Invested sans jamais passer par Term Sheet ne sera **pas** créé
   automatiquement — le faire transiter par Term Sheet, ou l'ajouter à la main.

2. **Frontière d'attribution (cf. CLAUDE.md).** `pending` = pré-investissement,
   **Attio est la source** → un event Term Sheet rafraîchit les champs du deal.
   `active` (et au-delà) = post-signature, **Albo OS est la source** → l'event
   Invested se contente d'avancer le statut et de confirmer le prévisionnel ;
   il **n'écrase jamais** les montants/instrument.

3. **Statut forward-only.** Un event ne fait jamais **régresser** le cycle de
   vie (`STATUS_RANK` : `pending < active < partially_exited < fully_exited =
   written_off`). Un Invested ne « ressuscite » pas un deal sorti. Un instrument
   Attio absent (`unknown`) ne **dégrade** jamais un instrument connu au patch.

4. **Ligne de prévisionnel : une seule par deal, toujours créée.** Dès qu'un
   deal passe en Term Sheet, une sortie anticipée est créée (montant = `value`
   Attio, le **ticket engagé** — pas `montant_levee_6` = taille du tour, ni
   `valorisation_8`). Sans `date_de_l_investissement`, la date est un
   **placeholder** (fin du mois courant) et `forecastEntries.dateMissing: true`
   la **flague** (badge « date à préciser » dans le prévisionnel et sur la fiche
   deal). Le flag saute — et la vraie date se cale — dès qu'Attio en fournit une
   (resync) ou que l'user édite la date (`forecasts.updateEntry`) ; un resync
   Attio sans date ne réécrit jamais une date posée à la main.
   `derivedKey = deal:{dealId}` **stable et sans date** (survit au changement de
   date Term Sheet → Invested), `category: 'deals'` (même ligne que le virement
   réel au pointage). Elle se réalise au pointage (`realizedTransactionId`),
   jamais supprimée par la synchro.

5. **Écriture en mutation interne.** `upsertFromDeal` écrit via `ctx.db` (pas
   `deals.create`, qui exige `requireOrgMember` — le webhook n'a pas d'identité
   auth, il est authentifié par la signature HMAC). Investisseur = `group_root`
   de l'org résolue depuis `albo_or_calte`. Société cible résolue/créée sur
   `attioCompanyId` (stub `portfolio` si absente, ancre réclamée seulement si
   libre).

6. **Robustesse webhook.** Re-fetch transitoire (réseau / 5xx Attio) → **503**
   (Attio rejoue) ; erreur de config (secret/clé absente) → **200** (pas de
   tempête de retries) ; signature invalide → 401, JSON malformé → 400.
   Idempotent (clés `attioDealId` + `derivedKey`), pas de table de dédup.

**Activation** : `pnpm exec convex env set ATTIO_WEBHOOK_SECRET <secret>` +
créer le webhook Attio (`record.updated`, objet `deals`) → `/attio/webhook`.
`ATTIO_API_KEY` est déjà posé (partagé avec la recherche de personnes Attio).

## Archétypes d'instruments (fiches deal — dashboard refonte)

`convex/lib/instrumentMapping.ts` est la **source unique** qui mappe chaque
`instrumentKind` (les 20 valeurs de `convex/lib/instruments.ts`) à un archétype,
un mode de rendu et — pour les types configurés — la liste ordonnée des colonnes
`deals` à afficher. Front et reporting lisent ce module ; ne **jamais** dupliquer
ce mapping ailleurs. Décisions non-évidentes :

1. **`INSTRUMENT_ARCHETYPE` / `INSTRUMENT_RENDER` sont des `Record` totaux**
   (20 clés) → un `instrumentKind` oublié casse la compilation TS. C'est le
   garde-fou : ajouter une valeur à l'enum force à la classer ici.
   `INSTRUMENT_FIELDS` est volontairement **partiel** : les 17 types en render
   `'fields'` **plus** `lead_spv` (custom, mais présent pour que le dialog
   d'édition partagé édite ses 4 paramètres — cf. point 11). `royalty` (custom
   sans panel) et `cto` (placeholder) restent absents.

2. **`placement` = relevé de trésorerie minimal.** `crypto` et
   `capitalization_account` sont configurés en archétype `placement` / render
   `'fields'`, config partagée `PLACEMENT_FIELDS` (`closingDate`, `paidAmount`,
   `currentValue`, `bankName`). La **plus-value latente** se déduit
   `currentValue − paidAmount` **côté front (Lot 2)** — elle n'est **pas**
   stockée en base. Seul `cto` reste en `unassigned` / `placeholder` (pas de
   deal en prod pour cadrer son layout) ; ne lui invente pas de field config
   sans repasser par une décision de design.

3. **`render: 'custom'` = panel dédié** (cf. point 11 pour le routage). `royalty`
   reste réservé (pas de panel → placeholder). `lead_spv` est le **premier vrai
   panel custom** (`LeadSpvPanel`) — modèle du futur `RoyaltiesPanel`.

4. **Valorisations : `preMoneyValuation` / `postMoneyValuation` sont neufs.** On
   n'a **pas** aliasé l'`entryValuation` existant sur `valoPre` : son sens réel
   en prod n'a pas été vérifié (commentaire ambigu « valuation at deal time »).
   `entryValuation` reste donc **dormant et intact**. Un backfill
   `entryValuation → preMoneyValuation` est une **décision future explicite**
   (migration vérifiée, snapshot d'abord), pas un alias posé à l'aveugle.

5. **`couponPeriodicity` (enum) vs `repaymentFrequencyMonths` (number).** La
   config `os` utilise le nouvel enum `couponPeriodicity` ; l'ancien
   `repaymentFrequencyMonths` reste **dormant** (représentations différentes,
   redondance potentielle). Non fusionnés ici — hors périmètre, à arbitrer plus
   tard.

6. **Séparation BSA / OC de la config `safe`.** Depuis la série instruments,
   `safe` et `bsa_air` partagent `SAFE_FIELDS` ; `bsa` a sa propre config
   `BSA_FIELDS` (warrants : `grantDate`, `warrantsCount`, `warrantPrice`,
   `strikePrice`, `warrantParity`, `exerciseDeadlineDate` + post-exercice
   `sharesAcquired`/`ownershipPct`) et `oc` + `convertible_note` partagent
   `OC_FIELDS` (obligation convertible). Décisions :
   - **Réutilisations validées** : l'OC réutilise `interestRate` + `maturityDate`
     (bloc debt, sens identique — taux et maturité de l'OC), et le trio
     post-conversion `conversionValuation` / `sharesAcquired` / `ownershipPct` ;
     le BSA réutilise `sharesAcquired` / `ownershipPct` (titres obtenus à
     l'exercice). 8 colonnes neuves seulement : les 6 BSA + `conversionRatio` /
     `conversionDiscount` (OC). Pas de duplication de `interestRate`/`maturityDate`.
   - **`safeType` — nettoyage différé.** Le validateur `SAFE_TYPES` garde `oc`
     (`safe`/`bsa_air`/`oc`) **en sommeil** : des deals legacy peuvent porter
     `safeType='oc'` et le resserrer les ferait rejeter par Convex. La vérif
     impossible en read-only (le MCP n'expose pas la colonne). Retirer `oc` de
     `SAFE_TYPES` exige d'abord une query prod confirmant qu'aucun deal ne le
     porte. En attendant, seul le **select** est restreint : nouveau
     `SAFE_TYPE_OPTIONS = ['safe','bsa_air']` câblé sur `ENUM_FIELD_VALUES.safeType`.
   - **BSA rendu à plat.** Le split pré/post du bloc central est piloté par le
     marqueur `SAFE_SPLIT_FIELD = 'conversionValuation'` (`InstrumentBlock.tsx`).
     L'OC le contient → onglets pré/post. Le BSA ne l'a pas → il s'affiche à plat
     (8 champs en une grille), ce qui est acceptable (le split a moins de sens
     pour un BSA). **Micro-suite possible** : généraliser `SAFE_SPLIT_FIELD` en
     marqueur par config pour donner des onglets pré/post au BSA.
   - **Format `decimal`.** `warrantParity` et `conversionRatio` peuvent être
     fractionnaires (ex. parité 1,5 ; ratio 1,25) → nouveau `FieldFormat`
     `'decimal'` (parseur `decimalToNumber`, input `step="any"`) plutôt que le
     `'number'` entier (`intToNumber`) qui les aurait tronqués.

7. **`os` reste rattaché à `debt`** sans désambiguïsation (SPV equity vs dette
   obligataire immo) : reportée explicitement, ne pas la traiter dans ce lot.

8. **Colonnes dormantes.** Les 25 colonnes d'archétype ajoutées sur `deals`
   (24 au Lot 1 + `currentValue`) sont toutes `v.optional` et **ne sont écrites
   par aucune mutation** (`deals.ts` non étendu) : elles attendent le câblage
   front + l'extension des args de mutation (Lot 2). Aucune migration de données
   n'est nécessaire (champs optionnels).

9. **`INSTRUMENTS` dupliqué dans la route deal (dette à nettoyer).**
   `src/routes/app/$orgSlug/deals.$dealId.tsx` redéclare en dur sa propre liste
   `INSTRUMENTS` (≈ l.80-100, ordre d'affichage du dropdown) alors que la source
   unique est `convex/lib/instruments.ts`, déjà réimportée ailleurs
   (`participations.$companyId.tsx`, `ParticipationsTable.tsx`). Les deux listes
   couvrent les mêmes `instrumentKind` (hors `unknown`, réservé à la sync) mais
   dans un **ordre différent** (penser à y ajouter tout nouveau kind — `lead_spv`
   puis `carry_vehicle` l'ont été). Laissé tel quel (hors
   périmètre, pas de fix adjacent) : le dialogue d'édition
   (`EditDealDialog`) réutilise la copie locale pour ne pas introniser deux
   sources dans le même fichier. **Risque** : un instrument ajouté dans
   `instruments.ts` n'apparaît pas dans ce dropdown tant que la copie locale n'est
   pas mise à jour (divergence silencieuse). **À faire (lot ultérieur)** :
   supprimer la copie locale, importer `INSTRUMENTS` depuis `instruments.ts`, et y
   porter l'ordre d'affichage souhaité si besoin.

10. **`spv_share` = « Equity via SPV » (reclassé `funds_lp` → `equity`).** Un
    `spv_share` est économiquement de l'equity sur une cible sous-jacente, détenue
    indirectement via un SPV ; le SPV n'est qu'une méthode de détention, **pas une
    entité** (on ne le modélise pas comme `company`). Décisions :
    - **Pas de nouveau kind, pas de migration de la valeur enum.** `spv_share`
      reste la valeur en base (12 deals réels en org `albo`, 0 en `calte`) ; seuls
      changent l'archétype (`equity`, donc badge « Capital »), la config de champs
      et le **libellé affiché** (« Equity via SPV », EN/FR, fiche + vue agent).
    - **Config `SPV_FIELDS`** : `closingDate`, `paidAmount`, `spvName` (neuf),
      `spvOwnershipPct`, `structuringFees`, `preMoneyValuation`,
      `postMoneyValuation`. `spvName v.optional(v.string())` est la **seule colonne
      neuve** (nom du SPV en texte) — on **ne** réutilise **ni** `viaSpvCompanyId`
      (référence entité, exclue par le modèle) **ni** `underlyingTarget` (= la
      cible, pas le SPV).
    - **`underlyingTarget` conservé en base mais retiré de l'affichage** : la cible
      passe déjà par `targetCompanyId` (doublon confirmé). Dormant, non détruit,
      aucune migration.
    - **Incohérence assumée** : l'equity direct (`share`) utilise `ownershipPct`,
      l'equity via SPV utilise `spvOwnershipPct`. On **ne migre pas** les 12 deals
      (leur donnée vit dans `spvOwnershipPct`). Unifier sur `ownershipPct` est une
      **décision future explicite** (migration vérifiée, snapshot d'abord), hors
      périmètre.

11. **`lead_spv` = « Lead SPV (gestion) » + premier panel custom réel.** Le
    pendant gestion d'un SPV dont on est lead (Hectarea, Eben Home) : là où
    `spv_share` suit **l'invest**, `lead_spv` suit les **revenus de gérant**
    (frais + carried). Les deux deals coexistent sur la **même cible**
    (`targetCompanyId`) et s'affichent côte à côte sur la fiche entité — pas de
    lien dur. Décisions :
    - **Archétype neuf `management`** (badge « Gestion » / « Management »,
      réutilise le token `positive` = revenu, comme `placement`) + render
      `'custom'`. Économiquement c'est un revenu de gestion, pas un placement.
    - **Niveau 1, déclaratif.** 4 colonnes neuves `v.optional` : `amountRaised`
      (cents), `managementFeeRate` / `hurdleRate` / `carriedRate` (bps). **Pas**
      de waterfall/projection, **pas** de ventilation frais/carried. Le **perçu à
      date** = `received` (somme brute des flux entrants rattachés, déjà calculée
      par `transactionTotals` / la page deal), **lecture seule, jamais stocké**.
    - **Routage `render: 'custom'` → composant (le point technique central).**
      Avant ce lot, `render === 'custom'` n'affichait qu'un placeholder codé en
      dur (libellé royalty). Désormais un **registre `CUSTOM_PANELS`**
      (`instrumentKind → composant`, `InstrumentBlock.tsx`) dispatche : une entrée
      → le panel (`lead_spv → LeadSpvPanel`), pas d'entrée → fallback placeholder
      (royalty). `InstrumentBlock` reçoit deux props neuves, `received` et
      `onEdit`, transmises aux panels. **Ajouter un futur panel = une ligne dans
      le registre** (`royalty: RoyaltiesPanel`), rien d'autre.
    - **Édition réutilise le dialog existant.** `lead_spv` est listé dans
      `INSTRUMENT_FIELDS` (4 champs) → `EditDealDialog` les édite via
      `FIELD_FORMAT` (€ / %), comme tout type `'fields'`. **Mode de rendu (custom)
      et champs éditables (INSTRUMENT_FIELDS) restent orthogonaux** : un panel
      custom peut s'appuyer sur le dialog générique sans formulaire dédié. Le
      `LeadSpvPanel` n'expose qu'un bouton « Modifier » qui appelle `onEdit`
      (ouvre ce même dialog).

## Fiche entité — identité (édition inline), champs manquants & lien Attio

Le squelette commun des fiches (en-tête → bloc d'identité → Reporting/KPIs →
Documents) vit dans `src/components/companies/EntityFiche.tsx`. Depuis le retrait
de la couche de regroupement (Étape A), il n'est plus utilisé que par la fiche
société (`participations.$companyId.tsx`, nature « Entreprise ») — la page de
consolidation de groupe et ses natures « Sponsor dette » / « Groupe » ont été
supprimées. Les champs `companies.group` / `companies.sponsor`, la table
`portfolioGroupSettings` et `groupKind` **restent déclarés au schéma mais inertes**
(plus aucun code ne les lit/écrit ; nettoyage données + schéma prévu en Étape B).
Pièges non-évidents :

1. **La nature n'est PAS un champ — et il n'y en a plus qu'une.** `EntityNature`
   est figé à `'company'` : une company `kind: 'portfolio'` ouverte par `companyId`
   → **Entreprise**. Le champ libre `companies.sponsor` (« plateforme d'origine »,
   posé par l'import Attio) n'est affiché nulle part et ne pilote rien.

2. **Champs d'identité sans stockage — affichés « À renseigner », à ne pas
   inventer.** **Fondateur(s)**, **Membres du board**, **Co-investisseurs** sont
   **stockés (Lot 5a), affichés et éditables (Lot 5b)** via le champ
   `companies.people` (cf. point 3). L'état « À renseigner » ne s'affiche plus que
   pour une section **vide**.

3. **`people` est un champ sur `companies`, pas une table dédiée (Lot 5a).**
   Choix assumé « afficher, pas gérer activement » : `companies.people` est un
   `v.optional(v.array(...))` (cf. `convex/lib/people.ts` pour l'enum `role`
   `founder|board|coinvestor` + le validateur d'objet). Conséquences :
   - **Remplacement total** à chaque édition — `companies.update` reçoit la
     **liste complète** (pas un delta) ; `people` omis = inchangé, `[]` = vide.
     Le merge fin (ajout/retrait d'une personne) est géré côté UI dans
     `EditCompanyDialog` (Lot 5b), qui **préserve `attioRecordId`** d'une
     personne déjà liée au rebuild de la liste (aucune UI pour le saisir).
   - **`linkedin`/`email` volontairement NON stockés.** Ils sont accessibles
     via le lien Attio de la personne (cliquer le **nom** → fiche Attio),
     construit par `src/lib/attio.ts:attioPersonUrl` à partir de
     `attioRecordId` + `VITE_ATTIO_WORKSPACE_URL` (`{base}/person/{record_id}`,
     même logique que le lien company du point 4). On ne stocke que le
     `record_id` Attio, jamais de lecture live. ⚠️ **`PeopleList` porte encore
     des branches JSX `linkedin`/`email` non alimentées** (design assumé : ces
     infos passent par le lien Attio) — code inerte, à nettoyer ou à brancher
     plus tard.
   - **Réversible** : si un jour on veut gérer les personnes activement
     (dédup cross-company, relations), migrer vers une table `people` dédiée.

4. **Lien Attio = base d'URL configurable, jamais devinée.** La REST Attio ne
   renvoie pas de `web_url`, et le slug d'URL du workspace n'est pas déductible
   de l'`attioCompanyId` seul. `src/lib/attio.ts:attioCompanyUrl` lit la var
   publique `VITE_ATTIO_WORKSPACE_URL` (ex. `https://app.attio.com/albo`) et
   construit `{base}/company/{attioCompanyId}`. **Var absente → pas de lien**
   (mention grisée « Lié à Attio » à la place) : on ne hardcode pas un format
   d'URL potentiellement faux. C'est une base d'URL **publique**, pas un secret
   (l'anti-pattern « pas de `VITE_` sur un secret » ne s'applique pas).

5. **Identité éditable inline (secteur / SIREN / domaine) ; le reste en lecture
   seule.** Ces trois champs s'éditent **au clic** via `InlineField`
   (`src/components/ui/inline-field.tsx`) câblé sur `companies.update` — plus de
   détour par le dialog « Modifier » pour eux (le dialog reste la voie pour nom
   + personnes). Les champs **calculés/dérivés** — détention globale, nb
   d'actions consolidé, lien Attio — **restent en lecture seule** (rendus par
   `IdentityField`). Vider SIREN/domaine puis valider les **efface** (`''`,
   normalisé côté mutation) ; le **secteur** réutilise `SectorCombobox` (props
   additives `defaultOpen` + `onOpenChange` pour l'ouvrir/fermer en inline). Le
   détail du composant partagé : section « Édition inline des fiches ».

## Édition manuelle deals & `manuallyEditedFields`

L'édition des champs d'un deal depuis la fiche (`EditDealDialog`) écrit via
`deals.update`. Le garde-fou contre l'écrasement par le ré-import Airtable est
un **set de noms de champs**, pas un booléen au niveau deal.

### Mécanisme

- Colonne `deals.manuallyEditedFields: v.optional(v.array(v.string()))`
  (additif/optionnel → pas de migration ; absent = `[]`).
- **Côté écriture (uniforme)** : `convex/deals.ts:update` fait l'union du set
  existant avec **toutes** les clés présentes dans le `patch` reçu. Le front
  n'envoie qu'un **diff** (champs réellement modifiés, cf.
  `deals.$dealId.tsx`), donc le set ne grossit que des champs vraiment touchés.
- **Côté import** : `convex/airtableImport.ts:upsertDeals` retire du patch
  toute clé présente dans `existing.manuallyEditedFields` avant
  `ctx.db.patch`. Un champ saisi à la main n'est donc jamais réécrasé.

### Intersection import (le point subtil)

Le set est consulté **uniquement** pour les colonnes que l'import écrit
réellement : `paidAmount`, `sharesAcquired`, `signedDate`, `exitedDate`,
`status`, `instrumentKind`, `targetCompanyId`, `currency`. Tout autre champ
marqué (ex. `interestRate`, `roundType`, `preMoneyValuation`…) est **inerte**
dans le set : sans effet (l'import ne l'écrit pas) et sans risque. C'est
volontaire — marquer uniformément côté écriture garde la mutation simple ; le
filtre import ne « voit » que l'intersection.

### Limite assumée

Une saisie **vide** est traitée comme « pas de changement » (le champ n'est ni
envoyé ni effacé). **Vider** un champ déjà rempli n'est donc pas supporté par
ce lot (on évite la sérialisation de `undefined` côté client Convex). Le `name`
fait exception : `''` le réinitialise (géré serveur, retombe sur le titre
dérivé). `paidActual` (décaissé réel) est **calculé** depuis les transactions
(`transactionTotals`) et n'est jamais éditable — distinct de `paidAmount`
(colonne, « montant contractuel »).

## Édition inline des fiches (`src/components/ui/inline-field.tsx`)

Les blocs **« Détails de l'instrument »** (fiche deal) et **« Identité »** (fiche
société) s'éditent **au clic sur la valeur**, sans passer par le dialog du menu
« … ». Un seul composant partagé, `InlineField`, généralise l'interaction de la
cellule CA royalties (`EditableCa`) — clic → input adapté au format →
**Entrée/blur** valide, **Échap** annule — à une grille de champs multi-formats.
Points non-évidents :

- **Réutilisation, pas réinvention.** `InlineField` est **format-driven** : il
  reçoit un `FieldFormat` (`~/lib/parse`) et rend l'input correspondant (€ via
  `useAmountField`, %/nombre/décimal/année en `number`, `date`, texte, `Select`
  pour les enums). Le parsing/sérialisation vit dans `~/lib/parse`
  (`parseField` / `rawToInput`, **source unique** partagée avec le dialog
  `EditDealDialog` — le `parseField` local de `deals.$dealId.tsx` a été supprimé
  au profit de l'import). Ne pas dupliquer un parseur ailleurs.
- **Deal : édition coupée en aperçu de type.** `InstrumentBlock` reçoit
  `editable = !unsaved` : quand le sélecteur d'en-tête **prévisualise** un autre
  `instrumentKind`, les champs affichés n'appartiennent pas au type enregistré →
  la grille repasse **lecture seule** (on n'écrit jamais un champ d'un type que
  le deal n'a pas). L'écriture est un **patch à un seul champ** sur `deals.update`
  (marque `manuallyEditedFields`, cf. section « Édition manuelle deals »).
- **Vider un champ : sémantique différente deal vs société.** Côté **deal**, une
  saisie vide est un **no-op** (les colonnes ne se vident pas via un `undefined`
  client — cf. « Effacer un champ optional via `deals.update` » et « Limite
  assumée » ci-dessus) : `InlineField` n'appelle `onClear` que si le caller le
  fournit, ce que la grille deal **ne fait pas**. Côté **société**, SIREN/domaine
  fournissent `onClear` → envoient `''` → `companies.update` efface. Une saisie
  **non parsable** (lettres dans un champ €) est toujours un no-op (garde le
  `null` de `parseField`).
- **Enum & secteur ouverts au clic.** Pour un enum, l'éditeur est un `Select`
  rendu **déjà ouvert** (`open`) qui valide au choix ; pour le secteur (combobox
  créable), `renderEditor` branche `SectorCombobox` avec `defaultOpen` +
  `onOpenChange` (props additives, défaut = comportement dialog inchangé) — un
  seul clic ouvre le picker, la fermeture quitte le mode édition.

## Panneau Royalties — listes sur `deals` & collage du BP (`src/components/deals/RoyaltiesPanel.tsx`)

2e panel custom après Lead SPV (même pattern : `CUSTOM_PANELS` dans
`InstrumentBlock.tsx`, props `CustomPanelProps`, 3 scalaires édités via
`EditDealDialog` + `INSTRUMENT_FIELDS['royalty']`). Deux écarts à connaître.

### Indicateurs de réalisé (barre, CoC, TRI) — deux sources à ne pas mélanger

- Le **tableau** est une **projection** (basée sur `actualPoints`, le CA saisi).
  La **barre**, le **CoC** et le **TRI** sont du **réalisé** : ils somment les
  **transactions entrantes** du deal (`transactions.listByDeal`, passées au
  panel via `CustomPanelProps.transactions`), **dé-TVA-ées à 20 %**
  (`amount / 1.2`, HT). Ne **jamais** recalculer la barre/CoC/TRI sur le
  tableau, ni dé-TVA-er le capital (`capitalInvested` est déjà HT) — c'est le
  piège n°1.
- TRI via `src/lib/xirr.ts` (Newton-Raphson + repli bissection, actual/365).
  Flux : un sortant `-capitalInvested` à `investmentDate` + chaque entrant
  `amount/1.2` à sa `transactionDate`. Le `r` renvoyé est **déjà annualisé**
  (exposant en **années**, pas en jours) — ne **jamais** le ré-annualiser.
  Mathématiquement négatif tant que le capital n'est pas récupéré, mais
  hyper-volatile dans cette zone : l'UI **masque** alors le chiffre et affiche
  « n/a — capital non recouvré » (`triNotRecovered`) **tant que CoC < 1**. Le
  calcul reste, il refait surface dès CoC ≥ 1. `xirr()` renvoie `null` (pas de
  changement de signe / pas de convergence) → fallback « — ».
- **À raffiner plus tard.** Ces indicateurs somment **toutes** les transactions
  entrantes du deal. Quand le module trésorerie introduira la distinction
  transactions **prévisionnelles** vs **réalisées**, ils devront ne compter que
  les **réalisées** (les prévisionnelles ne sont pas du cash reçu). À reprendre
  à ce moment-là.

### Listes éditées hors `INSTRUMENT_FIELDS`

- Le BP initial et le réalisé sont **deux listes** sur `deals` —
  `bpPoints: v.array(v.object({ quarter, plannedRevenue }))` et
  `actualPoints: v.array(v.object({ quarter, actualRevenue }))` (cents).
  Déclarées dans `schema.ts` **et** dans `dealFields` (`convex/deals.ts`),
  sinon le validateur de patch de `deals.update` les rejette.
- `INSTRUMENT_FIELDS` ne gère que des **scalaires** (le dialog standard rend un
  input par champ). Les listes ont donc leur UI dédiée dans le panneau, qui
  appelle `deals.update` avec un **patch partiel** (`{ bpPoints }` /
  `{ actualPoints }`). C'est le même `deals.update` que le dialog — il accepte
  n'importe quel sous-ensemble de `dealFields`.
- Effet de bord voulu : chaque patch marque `bpPoints`/`actualPoints` dans
  `manuallyEditedFields` (cf. section ci-dessus). Inerte ici — l'import
  Airtable n'écrit pas ces colonnes.

### Jointure et collage (le point subtil)

- Les lignes du tableau se joignent **sur la clé trimestre** (string). Pour que
  BP et réalisé s'alignent, la clé est normalisée en canonique `"Qn YYYY"` des
  deux côtés : `normalizeQuarter` (collage tolérant `T3`/`Q3`, ordre libre) et
  le picker année+trimestre (`AddQuarterDialog`) produisent **la même forme**.
  Un point réalisé sans BP (ou l'inverse) apparaît quand même, colonnes
  manquantes en `—`.
- Le collage est du **texte tabulé** Excel/Sheets : lignes sur `\n`, colonnes
  sur `\t`, col0 = trimestre, col1 = CA. `parseAmountToCents` est tolérant
  FR/US (€, espaces insécables, `,`/`.`). Les lignes non reconnues sont
  **comptées et affichées** dans l'aperçu, jamais écrites silencieusement.
  Logique pure dans `src/lib/royalties.ts`, testée (`tests/royalties.test.ts`).
- **Heuristique milliers vs décimale (piège FR/US).** Une virgule seule suivie
  de **3 chiffres** est un séparateur de milliers (`12,000` → 12000), sinon une
  décimale (`12,50` → 12,5). **Mais** dès qu'un **espace groupe déjà les
  milliers** (`311 995,152`), la virgule est forcément une **décimale** — un
  espace et une virgule ne peuvent pas être tous deux séparateurs de milliers.
  Sans cette règle, `311 995,152` était lu comme l'entier `311995152` puis ×100
  → un montant absurde (311 995 152 €). Le garde est
  `hadSpaceGroup = /\d\s\d/.test(raw)` **avant** de stripper les espaces (`\s`
  couvre l'insécable et l'insécable fine). Régression couverte par
  `tests/royalties.test.ts`. Le même parseur sert au collage **et** à l'édition
  inline d'une cellule (`EditableCa`) — corriger ici corrige les deux.
- Tout le reste (BP dégradé, royalties, écart, cumuls) est **dérivé à
  l'affichage** (`buildRoyaltyRows`) — rien n'est stocké hors les deux listes
  et les paramètres scalaires. L'écart € est calculé sur les **royalties**
  (réel − dégradé) ; le % est identique qu'on le calcule sur le CA ou les
  royalties (le taux se simplifie).
- **Paramètres génériques (plancher/plafond/dates).** `investmentDate`,
  `floorMultiple`, `capMultiple`, `endDate` sont de simples champs **saisis**
  (aucune règle métier codée). Plancher/plafond sont stockés en **multiple** du
  capital ; le montant euro est **dérivé à l'affichage** (`multiple ×
  capitalInvested`), jamais stocké. La barre de progression compare le cumul
  des royalties réelles (`totals.actualRoyalty`) à ces deux montants — pur
  positionnement, aucune règle d'achèvement. Édités via le dialog partagé
  (`INSTRUMENT_FIELDS['royalty']` + `FIELD_FORMAT`).

### « Deal introuvable » au clic sur une cellule = crash de render masqué

- Symptôme trompeur : cliquer sur une cellule CA éditable (`EditableCa`, BP
  initial ou Réel) faisait afficher **« Deal introuvable »**. Ce n'était pas un
  problème de donnée : la route `deals.$dealId.tsx` utilise **le même**
  composant `NotFound` pour `errorComponent` **et** `notFoundComponent`, donc
  **n'importe quelle** erreur de render dans la fiche remonte à l'error boundary
  et s'affiche comme un deal absent. Devant un « Deal introuvable » inattendu,
  **regarder d'abord la console** (erreur React) avant de suspecter la query.
- Cause : `EditableCa` appelait `useAmountField(draft, setDraft)` **dans** la
  branche `if (editing)`. Passer en édition faisait apparaître un hook qui
  n'existait pas au render précédent → `Rendered more hooks than during the
  previous render` → crash. **Règle** : `useAmountField` (et tout hook) se
  déclare au **top-level** du composant, ses props ne sont *spreadées* que
  quand l'input est rendu. Même pattern déjà appliqué dans `DealFieldInput`
  (`deals.$dealId.tsx`).
- Filet manquant : `eslint-plugin-react-hooks` n'est **pas** dans la config
  (`@tanstack/eslint-config` ne l'embarque pas), donc `rules-of-hooks` ne
  détecte **pas** ce type d'appel conditionnel au lint/CI. Vérifier le
  placement des hooks à la main tant que le plugin n'est pas ajouté.

## TRI société (liste participations) — le TRI/IRR n'est PAS additif

**Le piège n°1.** Le TRI d'une société multi-deals **ne se déduit pas** des TRI
par deal, ni d'un MOIC agrégé annualisé. Il faut le résoudre sur l'**union des
flux datés** de tous les deals de la société. C'est la raison pour laquelle le
calcul vit côté serveur, là où sont les transactions datées.

- **Source des flux = serveur.** `convex/deals.ts:dealRealizedMetrics` lit les
  transactions du deal **une seule fois** et renvoie, en plus de `paidActual` /
  `received` / `moic` / `irr` (XIRR par deal), un tableau `flows` : des flux
  **déjà signés et dé-TVA-és** via `convex/lib/metrics.ts:realizedCashflows`
  (`out` → `−montant`, `in` → `+proceeds`, ÷1,2 uniquement `royalty`). `deals.list`
  et `convex/aggregate.ts` (vue cross-org) exposent ces champs par deal.
- **Le front unionne, ne recalcule pas la convention.** `ParticipationsTable.tsx`
  groupe par société, **concatène** les `flows` des deals du groupe et appelle
  le solveur partagé `xirr(g.flows)` (`~/lib/xirr` → `convex/lib/xirr.ts`). Ne
  **jamais** re-dériver le signe / la TVA côté client, ni tenter de moyenner des
  TRI par deal. Le MOIC société, lui, **reste** client-side car il **est**
  additif (`Σproceeds / Σcapital`) — ne pas confondre les deux.
- **Périmètre = l'ensemble affiché.** Le TRI porte sur exactement les deals du
  groupe visible (donc respecte recherche + filtres à facettes), cohérent avec
  le MOIC société montré à côté. C'est voulu : ne pas déplacer le groupement
  côté serveur (il dépendrait de l'état de filtre client).
- **`xirr` renvoie `null`** sans changement de signe (perte totale sans
  encaissement, ou moins de 2 flux) → affiché « — ». On **n'affiche plus** le
  « −100 % » que produisait l'ancienne approximation `annualizedTri(moic=0)` ;
  le multiple `0,00×` + le badge « perdu » signalent déjà la perte.
- **Ne pas ressusciter `annualizedTri` pour la liste.** Cette fonction (MOIC
  annualisé 2 points sur `signedDate` → `exitedDate`) reste dans `metrics.ts`
  (util testé) mais n'alimente **plus** la liste : elle était une approximation
  (dates de cycle de vie ≠ dates de transaction, non additive). Voir le cas de
  divergence chiffré dans `tests/groupTri.test.ts`.

## Effacer un champ optional via `deals.update` (clear vs leave-untouched)

**Le piège.** Pour vider une colonne optional sur un deal (ici `exitedDate` /
`exitProceeds` quand on annule une sortie), on ne peut PAS s'appuyer sur un
`undefined` envoyé par le client : la sérialisation Convex **strippe** les
`undefined` d'un objet d'arguments, donc le handler ne distingue pas « efface »
de « ne touche pas ». Et le validateur `v.optional(v.number())` **refuse**
`null`.

**Le pattern retenu** (`convex/deals.ts`, mutation `update`) :

- Côté validateur du patch, élargir les champs concernés à
  `v.optional(v.union(v.null(), v.number()))` — `null` devient une valeur
  transmissible et valide.
- Côté handler, traiter `null` comme un clear : on ne ré-injecte la clé dans le
  payload `db.patch` que si elle est **présente** dans le patch reçu
  (`'exitedDate' in patch`), avec `value ?? undefined`. Un `undefined` passé à
  `db.patch` **supprime** la colonne ; une clé absente laisse le champ
  intact (éditer un champ sans rapport ne doit jamais effacer une sortie
  enregistrée).
- Garder les clés d'origine pour `manuallyEditedFields` (le clear compte comme
  une édition manuelle, sinon le ré-import Airtable repeuplerait le champ).

C'est exactement le même mécanisme que le clear de `name` (chaîne vide →
`undefined`), généralisé aux champs numériques nullable. Tout nouveau champ
lifecycle « réversible » doit suivre ce pattern, pas réinventer un sentinel.

## Recherche globale (palette ⌘K) — portée & implémentation

La palette ⌘K (`src/components/search/CommandPalette.tsx` +
`convex/search.ts:global`) a deux limites assumées, à connaître avant de
l'étendre :

- **Deals & sociétés filtrés en mémoire**, pas via un index full-text. Choix
  volontaire : petits volumes (family office, quelques dizaines/centaines de
  deals), et cohérent avec le filtrage déjà en place dans `ParticipationsView` /
  `DealsListView` (substring normalisé, accent-insensible via `normalizeSearch`).
  Les **mouvements** (transactions), eux, peuvent être nombreux → l'index
  `search_text` existant est réutilisé (`.withSearchIndex`). Si le nombre de
  deals/sociétés explose un jour, ajouter un `searchText` dérivé + `searchIndex`
  sur ces tables (comme `transactions`) plutôt que de charger `.collect()`.
- **Palette org-scoped**, montée dans `/app/$orgSlug/route.tsx` uniquement (pas
  dans `/app/all`). `search.global` prend un `orgId` unique ; la vue agrégée
  `/app/all` est en lecture seule et n'a pas d'org courante. Une recherche
  cross-org (union sur toutes les orgs membres, façon `aggregate.listDeals`)
  reste un follow-up — ne pas câbler la palette actuelle sur `/app/all` sans
  cette query dédiée.

Côté cmdk : `shouldFilter={false}` car le filtrage est fait côté serveur — sans
ça, cmdk re-filtrerait les résultats déjà filtrés sur le `value` des items
(`deal-<id>`…) et masquerait tout. `CommandDialog` n'est pas exporté par notre
`command.tsx` → la palette wrappe `Command` dans un `Dialog` maison (avec un
`DialogTitle` `sr-only` pour l'a11y Radix).

## VASCO API (Parallel Invest) — investor scoping, introspection, codegen (`convex/vasco.ts`)

VASCO (`https://vasco.fund`) is the fund-admin platform behind investor portals
like Parallel Invest (`parallel.vasco.fund`). Albo OS pulls the investor-side
data that only lives on the platform (positions, valuations, documents) — a
*pull* integration, distinct from the *push* AgentMail report pipeline.

### Endpoints & auth

- GraphQL at `https://api.<clientSlug>.vasco.fund/graphql/` (public sibling
  `/public/graphql/`, preprod `api.preprod.<clientSlug>…`). `<clientSlug>` = the
  VASCO client, e.g. `parallel`.
- Auth = `POST /auth/login {username,password}` → `{ token }` (JWT, short-lived,
  re-login on 401). **No machine-to-machine API key** — a login is stored per
  connection, in the internal-only `vascoConnections` table (one row per
  `clientSlug × orgId`), never returned to the client (same rule as
  `powensUsers`).

### The investor-scoping trap (this cost the reverse-engineering)

Introspection is **disabled**, and the investor persona
(`ROLE_DISTRIBUTED_CUSTOMER`) only sees a subset. These return
`"Access denied to this field"` — delivered as `extensions.warnings` with
`data: <field> = null`, NOT as a top-level `errors` entry (so a naive "no
errors ⇒ ok" check passes while the field is null):

- `GetAccounts`, `GetSecurities`, `GetParticipationsSummary` (GP/back-office).
- `GetInvestorDashboard` ("not enabled on this environment", BETA).
- `Account.accountComments` → investor **communications are NOT reachable** this
  way; use the top-level `GetCommunications` query (later step).

The **working investor read path** for holdings:

1. `POST /auth/login` → JWT. The user id is the **`id` claim inside the JWT**
   (there is no accountId in the token — decode the payload).
2. `GetUser(id: <jwtId>) { accounts { __typename id label } }` → the user's
   accounts (e.g. one `IndividualAccount`, one `CorporateAccount`; the corporate
   one is the vehicle, labelled "Calte").
3. Holdings **list**: `GetAccount(id) { accountSecurityContracts { id security { id name } } }`.
   ⚠️ Its monetary fields are **masked for the investor persona** — `amount`
   (contract-level), `currentWithdrawalPrice`, `redeemableSecuritiesNumber` and
   `security.latestValue` (NAV) all come back 0/null. Some array elements are
   also `null` (filter them). `amount`/`startAt`/`endAt` live on the concrete
   `RecurrenceContract` (inline fragment), not the `AccountSecurityContract`
   interface.
4. **Invested amounts (the real data): `GetAccount(id) { investments { … } }`.**
   Each `Investment` carries `amount`, `securityName`, `vehicleName`,
   `securitiesNumber`, `priceBySecurity`, `effectiveDate`,
   `capitalCallPercentage` — this is what `pullPositions` uses (verified: 16
   Calte positions, ~4 M€ via Parallel SPVs). Also on `Account`:
   `accountDocuments` (reportings, reachable), `investmentsAndTransfers` (cash),
   `portfolio`.

Field notes: `Amount` is a **scalar** serialized as `{ amountInCents, currency }`
(cents, like Albo OS — no sub-selection). Field suggestions are mostly off
(occasional "Did you mean …") → reconstruct queries from the docs, not by
probing. The docs are a Docusaurus site; enumerate every schema page from
`https://docs.vasco.fund/sitemap.xml` — individual
`/api-reference/authenticated/{queries,types,…}/<kebab>` pages render statically
(readable), unlike the SPA index and `/api-reference/graphql`.

### Communications (investor-reachable) → per-entity Report section (étape 2b)

`GetCommunications(userId | accountId)` **is** reachable by the investor persona
(unlike `accountComments`) — verified in prod via `vasco:probeCommunications`.
`userId=<jwt id>` and `accountId=<the corporate account, "Calte">` both return
the full set; the individual account returns `[]`. Each `Communication` is
**per-issuer** (`issuer { id label }` = a Parallel SPV, e.g. "Parallel Invest
SPV13"), dated (`publishDate`/`period`), with `title`, `htmlContent`, and
`communicationDocuments { document { … downloadUrl } }` (the real reporting PDFs).

- **Entity ↔ issuer mapping.** Issuer labels are opaque ("SPVn") — the human name
  lives in the `title` / position `securityName`. So an Albo OS entity is linked
  to its issuer **by id**, stored on `companies.vascoClientSlug` +
  `companies.vascoIssuerId` (set together via `companies.setVascoLink`; matched
  by id, never by name). The entity's Report section reads the cache query
  `getCachedCommunications({orgId, clientSlug, issuerId})`; the issuer picker is
  fed by `listCachedVascoIssuers` (distinct issuers + latest title as a human
  hint) — both reactive, both reading `vascoCommunicationsCache`.
- **Cached, not live-on-open (the big perf lever).** Reading VASCO live on every
  UI open is slow (login + full `GetCommunications`) and there is **no webhook**
  for the investor persona to push updates (pull-only — verified against the API
  docs). So communications are cached in `vascoCommunicationsCache` and refreshed
  by (a) a cron every 48h (`refreshAllVascoCaches` → `refreshVascoCacheForOrg` →
  `pullCommunications` → `replaceCommunicationsCache`, atomic replace per
  `(orgId, clientSlug)`) and (b) a manual "refresh" button (`refreshVascoCacheNow`,
  org-member-guarded). The UI reads the cache (instant, reactive). First-ever view
  bootstraps by triggering one refresh. A failed pull KEEPS the existing cache
  (never wiped). Only communication metadata is cached — the document BYTES are
  still fetched live on demand.
- **Which entities show the linker.** `VascoCommunicationsSection` renders only on
  `kind: 'portfolio'` entities that look like Parallel investments —
  `/parallel/i` over `name + domain + sponsor + group` — plus any already-linked
  entity. The union is deliberate: the live `domain` isn't reliably filled on
  SPVs (often empty or the parent platform), so keying on it alone would hide the
  block on real Parallel entities (the v1.86.1 regression); the name
  ("PARALLEL INVEST …") backstops it. `group_*` legal entities never show it.
- **Download = server proxy, mandatory.** `document.downloadUrl` is an
  **authenticated** endpoint (`api.<client>.vasco.fund/documents/<id>/download`),
  not a public signed URL → a browser `<a href>` fails.
  `downloadCommunicationDocument` logs in, fetches with the bearer token, stores
  the bytes in Convex storage, and returns a short-lived `getUrl`. (Those stored
  blobs accumulate — a cleanup pass can be added if it ever matters.)
- **`htmlContent` is stripped to plain text** server-side (`stripHtml`) before it
  reaches the client: it's raw HTML from an external source and the in-app
  renderer drops HTML anyway. Full formatting stays in the attached PDF.
- **Positions stay live.** `fetchParticipations` (positions / valuations) is an
  org-member-guarded live read, nothing persisted — actions (login + external
  calls), fetched on mount + Refresh. Communications are the exception: cached
  (above), so their UI is reactive and instant.
- **Stale duplicate connection.** calte still has a second `parallel` connection
  row whose login 401s; the read actions iterate matching active connections and
  use the first that logs in, so it degrades gracefully. Delete it with
  `vasco:deleteConnection` when convenient.

### Communications → AI synthesis (« Cerveau », étape 2c)

The company AI synthesis (`intelligence.runAnalysis`) folds the linked issuer's
communications into its prompt context, **pulled live on each run** (nothing
new is persisted — the result still lands in `companyIntelligence`).

- **System-context read path.** `runAnalysis` is a scheduled internalAction with
  **no user identity**, so it can't use the org-member-guarded
  `fetchCommunications`. It calls `vasco.pullCommunicationsForSynthesis` (an
  internalAction) which resolves connections via `vasco.getActiveConnectionsByOrgId`
  — an **auth-less** internalQuery keyed by orgId (sibling of
  `getConnectionsByOrgSlug`, do **not** reuse `authorizeAndListConnections`,
  which guards). Best-effort: it returns `[]` on any VASCO failure so the
  synthesis still runs on the company/report context alone. The `no_data` guard
  is evaluated on (context **OR** comms), so a bare Parallel entity with only
  communications is still analyzed.
- **Trigger = report mail OR the manual button, never automatic on link.** The
  synthesis auto-runs **only** from the report-mail ingestion fan-out
  (`reportStore`). Parallel/VASCO entities receive no mail report, so they are
  never auto-analyzed. The on-demand path is the public mutation
  `intelligence.rerun` (org-member-guarded, "Relancer l'analyse" button) — it
  sets `processing` and schedules `runAnalysis`. **By design there is no
  auto-trigger** on `companies.setVascoLink` and no cron; the button is the only
  new trigger.

### Communications → entity pitch (one-liner + résumé)

The default pitch enrichment (`companyEnrichment.enrich`) reads the company's
**website** (the `domain` field) — useless for a Parallel SPV, whose domain
points at the platform (SPVs are deliberately excluded from the domain backfill,
cf. MIGRATIONS.md `parallel_spv`). So Parallel entities get their pitch from a
second source: `enrichFromVasco` reads the entity's **cached communications**
(`vascoCommunicationsCache`, by `vascoClientSlug` + `vascoIssuerId`) and asks the
LLM to describe the operation **as pitched** — nature / asset / geography /
structure, **never its progress or status** (`VASCO_PITCH_PROMPT` forbids
dated/performance content; the comms are fed **oldest-first** so the initial deal
presentation dominates the context, not later updates). It then **overwrites**
`oneLiner` + `summary` via `applyVascoPitch` (unlike the additive
`applyEnrichment` — the VASCO description supersedes the domain-derived one).

- **Triggers, org-agnostic (keyed by the VASCO link, not the org).**
  `companies.setVascoLink` schedules `enrichFromVasco` on link; a one-shot
  `backfillVascoPitches` covers existing linked entities across **every** org
  with an active VASCO connection (Calte now, Albo once connected). No cron —
  the pitch isn't re-generated on every cache refresh (so a later hand-edit
  survives until a re-link or a re-run of the backfill).
- **Depends on the cache.** `enrichFromVasco` reads cached comms and skips if the
  issuer has none yet. The picker/dialog bootstrap fills the cache before a link
  happens, so on-link enrichment has data; the backfill refreshes each org's
  cache first.
- **Shared LLM helper.** Both sources use `generatePitch(system, prompt)`
  (structured output + free-text-JSON fallback) — only the system prompt and the
  source text differ (`SYSTEM_PROMPT` + site text vs `VASCO_PITCH_PROMPT` +
  communications).

### `convex codegen` can't run in the remote exec environment

`convex codegen` requires an authenticated deployment (`CONVEX_DEPLOYMENT` +
a call to api.convex.dev), which the remote agent environment lacks. When a new
Convex module is added there, `convex/_generated/api.d.ts` must be **hand-synced**
(add the `import type * as <mod> from "../<mod>.js"` line **and** the
`<mod>: typeof <mod>;` entry in `fullApi`). `convex/_generated/api.js` is a
dynamic `anyApi` proxy — no change. `pnpm dev` regenerates the identical output;
the hand edit only keeps `pnpm lint` (`tsc`) green in CI until then. Note
`Doc<'table'>` / `ctx.db.query('table')` already resolve from the live
`schema.ts` — only the function-reference file (`api.d.ts`) is static and needs
the manual entry.

### Instrument bridge (Parallel positions → SPV deal fiche) — `backfillSpvInstruments`

The write-back counterpart of `pullPositions`: fills the SPV deal fiche's
instrument block from the investor-side Parallel positions. CLI internal action,
`dryRun: true` by default (simulate → returns the full proposal, writes nothing):

    npx convex run --prod vasco:backfillSpvInstruments '{"orgSlug":"calte"}'                    # simulate
    npx convex run --prod vasco:backfillSpvInstruments '{"orgSlug":"calte","dryRun":false}'     # apply

Non-obvious constraints that shaped the conservative design:

- **Only three fields are written.** A Parallel `Investment` carries
  `investedCents`, `vehicleName`, `effectiveDate`, `securitiesNumber`,
  `priceBySecurity`, `capitalCallPercentage`. Only `investedCents → paidAmount`
  (both cents), `vehicleName → spvName` and `effectiveDate → closingDate` map to
  a real `deals` column Parallel fills unambiguously — they are the `spv_share`
  archetype's displayed fields (`INSTRUMENT_FIELDS`). `securitiesNumber` /
  `priceBySecurity` have **no display home** for the equity/`spv_share` kinds
  (they exist only for safe/bsa/scpi) and their units are unconfirmed, so they
  are **reported** (`extraVascoData`), never written.
- **Matching is by SPV number, never by name.** Parallel labels are opaque
  ("SPVn"); the bridge extracts the number token (`spvNumberOf`) from both the
  Parallel `vehicleName`/`securityName` and the target company name and matches
  on it. No number on either side (e.g. "SPV YOUSE") → reported for manual
  mapping, never guessed. A follow-on deal or an SPV holding several securities
  → reported as `ambiguous`, never auto-written.
- **Fill-empty-only.** A populated field that disagrees with Parallel is a
  `discrepancy` in the report, never overwritten. Filled columns are recorded in
  `manuallyEditedFields` (via `applyInstrumentBridgePatch`) so the Airtable
  re-import treats Parallel as authoritative.
- **`instrumentKind` is never touched.** Most Calte SPV deals are typed `os`
  (bond) or `share`, not `spv_share` — an Airtable-import artifact. Under `os`
  only `closingDate` even renders in the instrument block (paidAmount/spvName are
  still written — they feed portfolio math + metadata — but show only once the
  deal is `spv_share`). The `os → spv_share` requalification flips the
  debt/equity archetype (dashboards, MOIC/IRR grouping), so it stays a **human
  decision**, flagged per deal via `needsRequalification`.
- **TS inference-cycle trap.** The action calls `internal.vasco.*` from inside
  `vasco.ts`; without an explicit return type on the handler the self-reference
  makes the whole `internal`/`api` type resolve to `any`, cascading dozens of
  implicit-any errors across the **frontend** (every `useQuery`/`runQuery` result
  turns `any`). Fix: annotate the handler `Promise<BridgeResult>` and the
  intermediate `runQuery` results. Same family as the BA-trigger cycle in
  CLAUDE.md's anti-patterns.

## Domaines corrompus en base (import Calte) → logos + enrichissement KO

`companies.domain` doit être un **hostname nu** (`anaxago.com`) : il sert au
logo (hotlink logo.dev, `https://logo.dev/<domain>`) et à l'auto-enrichissement
one-liner/résumé (`companyEnrichment.enrich` fetch `https://<domain>`).

L'import Calte a stocké un gros paquet de domaines en **lien markdown** ou en
**URL de tracking** — `[www.anaxago.com](https://www.anaxago.com)`,
`monstock.net/fr_fr/?utm_term=…&gclid=…`. Symptômes : logo cassé sur la fiche,
et l'enrichissement échoue en silence (l'URL construite est invalide → `fetch`
throw → champ laissé vide, warn en logs). Découvert via
`backfillCompanyEnrichment:report` (14/07/2026) : ~200 candidats, un seul
rempli, le reste bloqué par des domaines illisibles.

**Correctif** : helper pur `convex/lib/domain.ts:normalizeDomain` (retire le
wrapper markdown `[…](…)`, le protocole, le chemin/query, le `www.`, lowercase ;
`null` si irréductible). Appliqué à trois endroits :

- **à l'écriture** (`companies.create`/`update`, `agentTools.createCompanyInternal`)
  → un domaine collé sale est normalisé avant insertion (garde le brut si
  irréductible, ne perd jamais la saisie) ;
- **défensivement au fetch** (`companyEnrichment.fetchSiteText`) → normalise
  encore avant de construire l'URL ;
- **en rattrapage sur l'existant** : `migrations/normalizeCompanyDomains`
  (`dryRun`/`apply`/`report`), **à lancer AVANT** `backfillCompanyEnrichment`
  (sinon les fiches à domaine corrompu restent vides). Les domaines
  irréductibles remontent dans `needsManualReview` (à corriger à la main).

**Piège adjacent** : `backfillCompanyEnrichment` vise `kind: 'portfolio'`, or le
portefeuille Calte contient beaucoup de **lignes de deal** (SIDE, Anaxago, SPV
Parallel, fonds) qui ne sont pas des sociétés — un résumé n'y a pas de sens.
D'où le filtre `classifyExclusion` (motifs structurels + liste nominative) ; le
`dryRun` sort `willEnrich` vs `excluded` pour relire le tri avant l'`apply`.

## Pitch partagé par domaine (one-liner + résumé)

Règle produit (14/07/2026) : deux entités `companies` qui partagent le même
`domain` (dans une **même org**) doivent porter le **même** `oneLiner` et le
**même** `summary` — sinon on a de la paraphrase incohérente (ex. les 4
« La Vie de Quartier » sur `laviedequartier.fr`). L'invariant est **maintenu à
l'écriture** (pas dérivé au read), en trois points — tout nouveau code qui
écrit `oneLiner`/`summary` doit passer par le helper, sous peine de re-créer de
la dérive :

- **Édition** (`companies.update`) : un `summary` édité est propagé à tout le
  groupe de même domaine via `lib/pitch.ts:applyPitchToDomainGroup(…, 'overwrite')`.
  Un `''` (clear) se propage aussi.
- **Enrichissement auto** (`companyEnrichment`) : `enrich` réutilise le pitch
  d'un voisin de même domaine s'il existe (pas de nouvel appel LLM), sinon
  génère une fois ; `applyEnrichment` remplit en mode `'fill'` (n'écrase pas un
  texte saisi à la main) sur tout le groupe.
- **Existant** : `migrations/unifyDomainPitches` fige rétroactivement (canonique
  = résumé le plus long, cf. `pickCanonicalPitch`).

Portée **par org** (multi-tenant) : on ne propage jamais une édition Albo vers
Calte, même si un domaine était partagé entre les deux. Le `oneLiner` n'a pas
d'éditeur inline aujourd'hui (édité via génération/unif) ; s'il en gagne un,
propager de la même façon (ajouter `'oneLiner' in patch` dans `companies.update`).

## Notion : extraction des pages publiques (API interne morte)

**Symptôme** : tous les liens Notion des reports finissent en
`notion_unreachable`, y compris des pages parfaitement publiques.

**Cause** : depuis ~juillet 2026, Notion a durci son API interne. Vérifié
empiriquement (13/07/2026) : `loadPageChunk` et `loadCachedPageChunkV2`
renvoient 400 « Invalid input » même sur une page publique, aussi bien sur
`www.notion.so` que sur le sous-domaine public de la page ; la lib
communautaire `notion-client` (dernière version npm) casse pareil ; le HTML
public est une coquille SPA sans contenu ; l'accès avec un User-Agent
crawler (Googlebot) est bloqué (403). **Aucune voie sans navigateur ne
fonctionne** — ne pas re-tenter ces pistes.

**Solution en place** (`convex/lib/notion.ts`) : chaîne à trois étages —
(1) l'API interne est toujours tentée en premier (coût quasi nul,
auto-guérison si Notion la rouvre), (2) rendu headless **browserless.io**
(`POST /content`, `waitForSelector: .notion-page-content` +
`waitUntil: networkidle2`, `bestAttempt`) si `BROWSERLESS_TOKEN` est posé —
**free tier 1000 unités/mois** (1 unité = 30 s de navigateur), largement
suffisant à 2-3 reports/jour, (3) sinon **Jina Reader** (`r.jina.ai`,
payant, headers `X-Timeout: 30` + `X-Wait-For-Selector`) si `JINA_API_KEY`
est posé. Dans les deux cas : sans attente du sélecteur, le snapshot part
avant le rendu SPA → coquille vide, détectée par le seuil
`MIN_USEFUL_CHARS`. L'accès anonyme Jina est refusé aux IP datacenter
(vérifié : 401 « bad IP reputation »). Sans aucune clé : comportement
dégradé assumé, échec actionnable dans le récap.

**Limites connues** : les fichiers *attachés dans* une page Notion ne sont
pas téléchargés (le markdown rendu contient leurs liens signés — extraction
dédiée à faire si le besoin réel se confirme) ; une page derrière un mur de
login rend une coquille → échec normal.

## Prompts « Claude Code Remote » (Routines) — non désactivables côté repo

Les outils du serveur MCP **`Claude_Code_Remote`** (`create_trigger`,
`update_trigger`, `delete_trigger`, `send_later` — utilisés par l'auto-watch
de PR et les rappels planifiés) déclenchent, en session web, une fenêtre de
validation **à chaque appel** : « Allow Claude to use delete trigger (Claude
Code Remote)? » avec seulement **Deny / Allow once** (jamais « Allow
always »).

**Ne pas essayer de les auto-autoriser via `.claude/settings.json`.** Ajouter
`mcp__Claude_Code_Remote__*` dans `permissions.allow` **ne les éteint pas** —
testé empiriquement (juillet 2026) : le prompt réapparaît malgré la règle
chargée au démarrage. Ces approbations sont gérées par la couche **Remote
Control de claude.ai**, pas par les réglages du dépôt ; c'est un garde-fou
volontaire de la plateforme (ces outils peuvent lancer des sessions
récurrentes / planifiées — cf. « Routines », `code.claude.com/docs/en/routines`).

Aucun fichier du repo ne les désactive. Seules mitigations : **ne pas
appeler ces outils** (p. ex. ne pas armer de re-vérification `send_later`
d'une PR), ou cliquer « Allow once » au cas par cas.
