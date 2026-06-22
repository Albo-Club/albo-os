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

## Why Mistral (and not Claude)

The AI agent ran on Anthropic Claude until v1.5.1, then switched to Mistral
Medium 3.5. Three reasons, in order:

1. **EU data residency / sovereignty.** The agent reads scoped portfolio data
   (deals, valuations, bank transactions). Keeping inference on an EU provider
   avoids sending family-office financials outside the EU.
2. **Cost.** Each agent turn fans out across ~45 tool schemas over up to ~12
   LLM round-trips; Mistral Medium is materially cheaper than Claude at that
   call volume (see "Mistral prompt caching" for the further 10× input saving).
3. **Reversible by design.** `getModel()` in `convex/agent.ts` abstracts the
   provider — this is a deliberate trial, not a one-way door. To revert, swap
   the provider in `getModel()` and set the matching `MISTRAL_MODEL`/API key.

## Mistral model id

`convex/agent.ts` defaults to `mistral-medium-3.5` (single source:
`convex/lib/instructions.ts:MISTRAL_MODEL`). Override via the
`MISTRAL_MODEL` Convex env var to pick a different model. Mistral also
ships dated aliases (`mistral-medium-2604`) for stability. The key lives
in the Convex env as `MISTRAL_API_KEY`.

**The agent claiming to be another model is NOT proof of the model used.**
LLMs don't know their own deployment id: asked "which model are you?",
Mistral Medium happily answers "Mistral Large 2". The system prompt now
states the configured id (`convex/lib/instructions.ts`) so the agent
answers correctly. To verify the model actually served in prod, check the
env (`pnpm exec convex env list --prod` — make sure `MISTRAL_MODEL` is
unset or set to the intended id), not the agent's self-description.

## Mistral prompt caching — injecté via un `fetch` custom

Mistral facture les tokens de prompt en cache à **10 % du prix input**
quand la requête porte un `prompt_cache_key` (matching de préfixe).
Indispensable ici : chaque message déclenche jusqu'à 12 round-trips LLM
(`stopWhen`), chacun renvoyant system prompt + ~45 schémas d'outils +
historique — les steps 2..N d'un même message sont des hits quasi totaux.

1. **`@ai-sdk/mistral` (3.0.37) ne sait pas envoyer `prompt_cache_key`**
   (schéma de providerOptions fermé, options inconnues strippées). D'où le
   wrapper `fetch` dans `convex/agent.ts` (`createMistral({ fetch })`) qui
   injecte le champ dans le body JSON. **À chaque bump de
   `@ai-sdk/mistral`, vérifier si l'option native a atterri** — si oui,
   retirer le wrapper au profit de la providerOption.
2. **Clé statique volontaire** (`albo-os-chat`) : le matching de préfixe
   fait le vrai travail, la clé ne sert qu'au routage du cache ; une clé
   unique partage le bloc system+tools entre tous les threads (2 users).
3. **Stabilité du préfixe** : le system prompt est fixé pour toute la durée
   d'un `streamText`/`generateText` (route/orgName figés à l'appel) → hits
   intra-message garantis. Un changement de route entre deux messages ne
   coûte qu'un miss sur la fin du system prompt. Ne PAS rendre la liste
   d'outils dynamique (filtrage par route) : ça casserait le préfixe.
4. **Vérification** : le `usageHandler` de `convex/agent.ts` logge une
   ligne `llm_usage` par appel LLM (logs Convex) — `cacheReadTokens > 0`
   attendu dès le step 2 d'un message multi-étapes ; la ligne « cached
   tokens » doit apparaître sur le dashboard Mistral.

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
- **Mistral model default `mistral-medium-3.5`** — remplace l'ancien défaut
  Anthropic (`claude-haiku-4-5`). Override via `MISTRAL_MODEL` env var.
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
`forecastEntries` → `getForecastBalance`. Pièges à connaître avant d'y toucher.

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
- **EUR only.** `getForecastBalance` n'agrège que `currency === 'EUR'`
  (comptes ET entries) ; le reste est compté dans `ignoredNonEur*` pour
  visibilité. `probabilityPct`, `counterpartyOrgId` et `currency` sont des
  champs **réservés non lus** (future couche probabiliste / neutralisation
  inter-entités / FX) — ne pas leur prêter d'effet.
- **Le pointage prévu → réalisé ne touche pas aux transactions.**
  `markEntryRealized` écrit uniquement sur `forecastEntries` (`status` +
  `realizedTransactionId`). Le pointage transaction → deal (`matchStatus`,
  `reconciled`, `matchingDecisions`) reste exclusivement géré par
  `convex/transactions.ts` — ne pas écrire ces champs depuis le code forecast.
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
  `computeCashHistoryForOrgs` / `getForecastBalance` bornent « le mois
  courant » avec `Date.now()`, ce qui re-exécute la query plus souvent que
  nécessaire (audit perf juin 2026). Trade-off assumé : le vrai fix (passer
  l'horodatage arrondi en argument depuis le client) toucherait signatures,
  callsites et outils agent pour un gain nul à l'échelle actuelle — ces
  queries n'apparaissent pas dans le breakdown Usage. À ré-évaluer si elles
  y montent.

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

## Sync Attio → deals (`convex/attioSync.ts`)

Webhook Attio `record.updated` sur l'objet `deals` → re-fetch du record →
`upsertFromDeal`. Quatre choix non-évidents :

1. **`derivedKey` du forecast = `deal:{dealId}` (SANS date).** La clé d'identité
   d'une entrée de prévisionnel liée à un deal ne doit **jamais** contenir la
   date : sinon, au passage Term Sheet (souvent sans date) → Invested (daté), la
   clé change et l'entrée d'origine devient **orpheline** (doublon). La date vit
   dans le champ `date` ; la clé reste stable, un seul lookup `by_derivedKey`.
   `forecastEntries` n'a volontairement pas d'index `by_deal`.

2. **`dateMissing` exclut l'entrée du calcul de balance, pas des listes.** Un
   deal Term Sheet sans `date_de_l_investissement` crée une entrée avec un
   `date` **placeholder** + `dateMissing: true`. L'exclusion se fait en **un
   seul point** : `convex/forecasts.ts:computeForecastBalanceForOrgs`
   (`.filter(e => !e.dateMissing)`). `buildMonthlyBalance` (pur, testé) est
   intouché. `updateEntry` remet `dateMissing` à `false` dès qu'un `patch.date`
   arrive — sans ça, une date saisie plus tard ne réactiverait jamais l'entrée.

3. **Statut et instrument sont forward-only au patch.** Un événement Invested
   (`status:'active'`) ne doit pas **régresser** un deal déjà `fully_exited`
   (cas des 2 deals sortis importés d'Airtable) → on garde le rang le plus
   avancé (`STATUS_RANK`). De même, un `type_d_invest` Attio absent (→ `unknown`)
   n'**écrase pas** un instrument déjà connu sur un deal existant. Ces deux
   garde-fous protègent les deals Airtable/manuels lors du backfill.

4. **Politique de retry du webhook = anti-tempête.** Erreur de **config**
   (`ATTIO_WEBHOOK_SECRET` / `ATTIO_API_KEY` manquant) ou erreur de **donnée non
   rejouable** (org absente, mapping…) → **200 + log** : un retry n'y changerait
   rien, inutile de déclencher la file de retries Attio. Seul un échec de
   re-fetch **transitoire** (réseau / 5xx Attio, classe `RetryableError`) → **503**
   pour qu'Attio rejoue. Signature invalide → 401, JSON malformé → 400.
