# Known issues

Pinned versions, workarounds, and rough edges. Update this file as upstream
fixes land so the weekly `update-deps` workflow can be unblocked.

## Panneau latéral figé : `position: sticky` + `bottom` ne marche PAS

**Le piège** : pour un panneau plus haut que l'écran qu'on veut voir défiler
puis se figer une fois arrivé en bas, le réflexe est `position: sticky` +
`bottom: 0`. **Ça ne fige rien** — le panneau sort de l'écran par le haut
comme s'il n'y avait pas de sticky du tout.

Vérifié au navigateur (Chromium, scrollport de 700 px, panneau de 1100 px) :

| Offset                | Comportement                                             |
| --------------------- | -------------------------------------------------------- |
| `bottom: 24px` seul   | aucun figement, le panneau part par le haut              |
| `top: 24px` seul      | figé en haut — le bas du panneau reste **inatteignable** |
| `top` **et** `bottom` | identique à `top` seul (la contrainte haute gagne)       |

**Pourquoi** : un offset `bottom` ne retient pas une boîte qui remonte, il
_tire vers le haut_ une boîte dont la position naturelle est sous la ligne de
flottaison (cas du pied de page collant). Il n'a donc aucun effet sur un
panneau qui commence en haut de page.

**La solution** : un `top` **négatif** égal au débordement du panneau,
c'est-à-dire `-(hauteurPanneau - hauteurScrollport) - gap`. Le panneau défile
avec la page jusqu'à ce que son bas arrive à `gap` px du bas du scrollport,
puis se fige. Comme la valeur dépend de la hauteur rendue, elle se calcule en
JS : `src/hooks/useStickyBottom.ts` (ResizeObserver sur le panneau **et** sur
le scrollport). Quand le panneau tient dans l'écran, le hook retombe sur un
`top` positif — sinon il serait figé trop bas, avec un blanc au-dessus.

**Deuxième piège, spécifique à l'app** : le scroll n'est pas celui de la
fenêtre. Le shell est `h-svh overflow-hidden` et le défilement vit dans
`<div class="min-h-0 flex-1 overflow-y-auto">` (`src/routes/app/$orgSlug/route.tsx`).
Tout calcul basé sur `window.innerHeight` ou `100vh` est donc faux — d'où la
remontée d'ancêtres `scrollParent()` dans le hook plutôt qu'une constante.

Enfin, le parent flex doit rester en `items-start` : en `stretch` (défaut), le
panneau est étiré à la hauteur de la colonne principale et il n'a plus aucune
marge pour coller.

## Texte extrait d'un document : pourquoi une table à part, clé sur le blob

### Le piège

Le réflexe est de coller le texte OCRisé dans un champ `documents.extractedText`
(le champ existait d'ailleurs, déclaré et jamais écrit). Deux raisons de ne
pas le faire, et la seconde est la vraie :

1. **La ligne Convex est plafonnée à 1 Mo**, tous champs confondus (cf.
   `convex/_generated/ai/guidelines.md`). Un pacte de 350 pages en français
   (~900 000 caractères, ~1,05 octet/caractère en UTF-8) sature la ligne à
   lui seul.
2. **Convex lit toujours la ligne entière.** `documents:listByCompany` charge
   jusqu'à 200 lignes à chaque ouverture de la liste « Documents & rapports »
   d'une fiche société. Avec le texte
   sur la ligne, c'est des dizaines de Mo relus à chaque affichage, pour
   afficher un titre et une taille.

### Le pattern retenu

Table `documentTexts`, **une ligne par blob de storage** (`storageId`), pas
par document :

- la liste ne lit que l'état (`ocrState` / `ocrDetail` / `ocrChars`, petits
  champs restés sur `documents`), le texte n'est lu que par
  `documents:getExtractedText` quand l'utilisateur l'ouvre ;
- le **fan-out multi-org** du pipeline report crée N lignes `documents`
  autour d'**un seul** blob : la clé sur `storageId` fait que l'extraction
  est partagée, écrite une fois, jamais recalculée par entité ;
- corollaire utile : `documentsExtract:run` commence par regarder si le blob
  a déjà un texte. C'est ce qui évite de **payer Mistral deux fois** pour une
  pièce jointe déjà lue par `reportExtract` (brique 4).

Donc : un nouveau chemin d'ingestion de fichiers doit écrire son texte via
`documentsExtract:saveStorageText` (clé blob) et poser l'état sur sa ligne
`documents` — jamais l'inverse.

### Le champ legacy `documents.extractedText`

Le champ existe encore au schéma. Il est écrit par **rien** dans ce repo et lu
par **rien** — mais des lignes de prod le portent (le texte y a été mis
hors du repo, avant `documentTexts`). Le retirer **casse `convex deploy`** :
la validation de schéma refuse les lignes existantes (« Object contains extra
field `extractedText` that is not in the validator »), et le build Vercel de
prod échoue après le push des fonctions. Vérifié à la dure sur la PR #307.

Un `grep` du code ne suffit donc pas à conclure qu'un champ est mort : il dit
qu'aucun code **actuel** ne l'écrit, pas qu'aucune **donnée** ne le porte.
Avant de retirer un champ, regarder la prod. Le chantier de retrait
(reprise du texte puis purge) est dans `MIGRATIONS.md`.

### Le corollaire qui mord

`documents:remove` supprime le blob **et** sa ligne `documentTexts`. Sur un
document issu du fan-out, ça vaut aussi pour les lignes sœurs des autres
entités, qui perdent le fichier — comportement **préexistant** (la
suppression du blob était déjà inconditionnelle), simplement étendu au
texte pour rester cohérent. À traiter le jour où le fan-out multi-org
devient courant.

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

5. **Toute mutation d'identité côté BA doit se répercuter sur la ligne
   `users`.** `databaseHooks.user.update.after` (dans `createAuth`) appelle
   `internal.users.syncFromBetterAuth`, qui retrouve la ligne **par
   `betterAuthId`** et recopie `email` / `name`. Ne jamais retrouver la ligne
   par email dans ce hook : c'est précisément l'adresse qui vient de changer.

### Reprise de compte via email périmé

Le fallback email de `provisionAppUser` (règle 3) et `user.changeEmail`
(activé dans `convex/auth.ts`) sont **couplés**. Sans le hook de la règle 5 :

1. La victime change son email de `old@x.com` vers `new@x.com`. BA met à jour
   son user ; la ligne Convex, elle, reste sur `old@x.com`.
2. L'attaquant reprend `old@x.com` (domaine expiré, adresse recyclée chez le
   fournisseur, alias libéré) et s'inscrit avec.
3. Son nouveau BA user n'a pas de ligne `users`. `provisionAppUser` tombe dans
   le fallback email, trouve la ligne périmée de la victime, et **repointe son
   `betterAuthId` dessus** — l'attaquant hérite des orgs, du rôle owner et du
   flag `superAdmin`.

Le hook ferme la fenêtre en gardant `users.email` aligné : après le
changement, plus aucune ligne ne porte `old@x.com`, donc le fallback ne matche
plus rien et l'attaquant obtient une ligne neuve, vide.

La mutation ne patche que si une valeur a réellement changé — la ligne `users`
est chaude (cf. § « Hot `users` row »), un write inutile invaliderait toutes
les souscriptions ouvertes. À noter : `update.after` se déclenche aussi sur les
updates sans rapport (`emailVerified`, changement de nom), d'où le garde.

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

## Return-URL `?redirect=` : pourquoi un regex est FAUX

`/login` et `/register` acceptent un `?redirect=` qui finit dans
`window.location.replace()` après une authentification réussie. Tant que la
valeur n'était qu'un `z.string().optional()`, `/login?redirect=https://evil.com`
expédiait la victime hors du site **au moment précis où elle venait de prouver
qu'elle faisait confiance à la page**. Better Auth ne couvrait pas ce chemin :
son `trustedOrigins` valide `callbackURL` / `redirectTo`, or `signIn.email` n'en
reçoit aucun ici — c'est notre code qui navigue.

Le correctif vit dans `src/lib/safe-redirect.ts` (`isInternalPath` +
`internalRedirectSearch`), appliqué au champ Zod des deux routes.

**Le piège.** Le prédicat qui vient naturellement — « commence par `/` mais pas
`//` » — est contournable :

```js
const isInternalPath = (v) => /^\/(?![/\\])/.test(v) // ← BYPASSABLE
```

Il laisse passer `/<TAB>/evil.com`. Par la spec WHATWG URL, les navigateurs
**suppriment** tab/LF/CR en parsant : la chaîne devient `//evil.com`,
protocol-relative, hors site — _après_ avoir passé un contrôle qui lisait les
octets bruts. À reproduire soi-même :

```sh
node -e "console.log(new URL('/\t/evil.com','https://x.com').origin)"
# → https://evil.com
```

D'où la validation par **résolution contre une origine bidon** : on délègue la
normalisation au parseur que la navigation utilisera de toute façon.

```ts
value.startsWith('/') && new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
```

Le `startsWith('/')` reste nécessaire (un `app` nu résout sur l'origine bidon
sans être un chemin absolu interne). Le champ Zod finit par `.catch(undefined)`
et non un throw : une valeur hostile retombe sur « pas de redirect » et la page
s'affiche normalement — un écran d'erreur signalerait la tentative à
l'attaquant.

Couvert par `tests/safeRedirect.test.ts` (24 vecteurs). Tout nouveau paramètre
de retour (`next`, `returnTo`, `from`…) doit passer par le même helper.

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

Pattern: pin in `pnpm.overrides`, document the unblock condition here, and
remove both together when upstream fixes land. (`pnpm update` in
`scripts/update-deps.mjs` respects `pnpm.overrides`, so a pin is enough to hold
the weekly bump back — there is no separate bot config to disable since
`renovate.json` was removed.) History of past pins (TanStack router-core
duplication breaking `server.handlers` type augmentation; `better-call@1.3.5`
shipping broken) lives in git.

### `unstorage: 2.0.0-alpha.7` — alpha.8 imports `destr` without declaring it

```json
"pnpm": { "overrides": { "unstorage": "2.0.0-alpha.7" } }
```

`unstorage@2.0.0-alpha.8` is a **broken publish**: its `dist/index.mjs` imports
`destr` five times, and its manifest declares **no dependencies at all**. On a
clean install nothing else pulls `destr` into the tree, so the build dies
before it starts:

```
failed to load config from vite.config.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'destr'
  imported from node_modules/.pnpm/unstorage@2.0.0-alpha.8/node_modules/unstorage/dist/index.mjs
```

Why it reaches us: `nitro@3.0.260429-beta` depends on `unstorage: ^2.0.0-alpha.7`,
and a caret on a **prerelease** accepts later prereleases of the same version —
`^2.0.0-alpha.7` therefore lets `alpha.8` through. We cannot fall back to the
stable line (`1.17.5`, which *does* declare `destr`): it is outside nitro's
range. Staying on `alpha.7` is the only option.

⚠️ The whole `2.0.0-alpha.*` line declares zero dependencies (`.6`, `.7`, `.8`
all checked against the registry), so `alpha.7` works by luck — it simply does
not import `destr` yet. Any future alpha can reintroduce the problem.

**Unblock condition**: an `unstorage` 2.0.0 alpha (or the 2.0.0 release) whose
manifest actually declares its runtime dependencies. Check with
`npm view unstorage@<version> dependencies` — if it prints nothing, do not lift
the pin. Verify by removing the override, running `pnpm update`, then
`rm -rf node_modules && pnpm install && pnpm build`.

> **Verify on a clean tree.** This class of bug is invisible on a warm
> `node_modules`: a leftover copy of the missing package from an earlier
> install resolves the import and the build passes locally while CI fails.
> That happened here — a local "build green" was reported before CI caught the
> real state. For any dependency change, the build check is
> `rm -rf node_modules && pnpm install && pnpm build`, never a plain rebuild.

## `@convex-dev/better-auth` : fenêtre de versions verrouillée

**Ne pas « débloquer » ces deux versions sans lire cette section.** Le pin a
coûté un bisect complet et il protège d'une régression de typage **et** d'une
régression de perf, tout en gardant un correctif de sécurité.

```json
"@convex-dev/better-auth": "0.12.2",   // exact, pas ^ ni ~
"better-auth": "~1.6.30"               // 1.6.x seulement, jamais 1.7
```

**Pourquoi `better-auth` doit rester ≥ 1.6.22** : `GHSA-qq9h-g4jm-xgf3`
(sévérité **high**) — *Account takeover via pre-account hijacking on
magic-link and email-OTP sign-in*, plage `>= 1.1.3, < 1.6.22`. `convex/auth.ts`
charge `magicLink()`, donc le projet est dans la surface d'attaque. Toute
opération qui ferait redescendre `better-auth` sous 1.6.22 réintroduit la
faille.

**Pourquoi `better-auth` ne doit pas atteindre 1.7** : l'adapter déclare le
peer `>=1.6.9 <1.7.0`, et 1.7 supprime l'export `mcp` de `better-auth/plugins`
dont `convex/auth.ts` dépend (`TS2305`). Le `~` est là pour ça — un `^` laisse
passer 1.7.x et c'est exactement ce qui cassait le job hebdomadaire.

**Pourquoi l'adapter est épinglé en exact `0.12.2`** — bisect (adapter ×
better-auth, `tsc` + `pnpm test:convex`) :

| adapter | better-auth | `tsc`         | `test:convex`      |
| ------- | ----------- | ------------- | ------------------ |
| 0.12.2  | 1.6.16      | ✅            | ✅ 120/120         |
| 0.12.2  | **1.6.30**  | ✅            | ✅ 120/120 (×3)    |
| 0.12.3  | 1.6.30      | ✅            | ❌ 2 à 4 timeouts  |
| 0.12.4  | 1.6.30      | ❌ `TS2322`   | —                  |
| 0.12.5  | 1.6.30      | ❌ `TS2322`   | —                  |

- **0.12.4 / 0.12.5** : `useSession().data` s'effondre en `never`, donc
  `ReactAuthClient<…>` n'est plus assignable à `AuthClient` sur la prop
  `authClient` de `ConvexBetterAuthProvider` (`src/routes/__root.tsx:111`).
  Cause : better-auth ≥ 1.6.18 nomme ses types de retour (`ReactAuthClient`)
  au lieu d'un type structurel anonyme, et le `AuthClient` de l'adapter — bâti
  sur `Omit<BetterAuthClientPlugin, "$InferServerPlugin" | "getActions">` dans
  `dist/plugins/cross-domain/client.d.ts` — ne s'unifie plus. Le diff
  0.12.3 → 0.12.4 est **exactement** ce passage à un `CrossDomainClientPlugin`
  nommé, avec l'import qui bascule de `better-auth` vers `better-auth/client`.
- **0.12.3** : typecheck, mais ralentit le harness `convex-test` au point de
  faire expirer 2 à 4 tests sur 120 (timeout 5 s), avec un nombre variable
  d'un run à l'autre. Le contrôle a été fait : `main` en 0.12.2 passe 120/120
  deux fois d'affilée sur la même machine, 0.12.3 échoue deux fois. Ce n'est
  pas de la charge machine.

⚠️ Un `^0.12.2` ou un `~0.12.2` **ne protège pas** : sur une version `0.x`, les
deux se lisent `>=0.12.2 <0.13.0` et laissent donc passer 0.12.3, 0.12.4 et
0.12.5. Seule la version exacte tient.

**Condition de déblocage** : suivi amont `get-convex/better-auth#420` (ouvert,
reproduit par deux tiers jusqu'en better-auth 1.6.25). Quand une version de
l'adapter publie le correctif de typage, dérouler la matrice ci-dessus avant
d'élargir la contrainte — `tsc` **et** `pnpm test:convex` en trois passes, la
régression de perf de 0.12.3 ne se voit pas au typecheck.

## Une alerte qui marche n'est pas une alerte qui arrive

Trois automatismes de ce dépôt ont échoué **bruyamment et correctement**, sans
que personne ne le voie. Ce n'est pas un bug d'émission, c'est un problème de
destination — et c'est le mode de défaillance le plus coûteux du répertoire,
parce qu'il se déguise en « tout va bien ».

- **`prod-smoke`** : la variable de dépôt `PROD_URL` a été mise à
  `https://os.alboteam.com/zz-nexiste-pas` le 30/07, vraisemblablement pour
  vérifier que l'alerte fonctionnait, puis jamais remise. Le contrôle quotidien
  de la prod a donc interrogé une 404 **du 31/07 au 24/08**, concluant chaque
  matin que la prod était morte. Son mécanisme d'alerte a parfaitement joué :
  l'issue #342 a accumulé **24 commentaires en 25 jours**. Lus par personne. Le
  filet de sécurité runtime était aveugle pendant tout ce temps.
- **`update-deps`** : rouge tous les lundis pendant plus d'un mois, sans
  notification d'aucune sorte jusqu'à ce qu'on lui en ajoute une.
- **Les pull requests** : cinq sont restées ouvertes 39 à 53 jours, alors que
  leur auteur *recevait* les notifications GitHub.

**La leçon, à appliquer à tout nouvel automatisme** : se demander non pas
« est-ce que ça alerte ? » mais « **où atterrit l'alerte, et est-ce que
quelqu'un passe par là ?** ». Un ticket GitHub n'est pas une destination si
personne n'ouvre l'onglet Issues.

D'où le hook `SessionStart` (`scripts/session-status.mjs`) : il remonte les
workflows rouges et les PR ouvertes **au démarrage d'une session Claude Code**,
c'est-à-dire à l'endroit où le travail se fait réellement. Deux propriétés le
rendent utilisable dans la durée, et il faut les préserver :

1. **Il se tait quand tout va bien.** Une alerte qui parle à chaque session
   devient du papier peint — exactement le mécanisme qui a rendu les 24
   commentaires de #342 invisibles.
2. **Il ne peut pas faire échouer une session.** `gh` absent, hors ligne ou
   déconnecté : sortie 0, sans rien afficher. Perdre le rapport est acceptable,
   bloquer le démarrage ne l'est pas.

⚠️ Corollaire pour le hook voisin `sync:skills:check` : tant qu'il sort en
erreur à chaque session pour une dérive non traitée, il entraîne à ignorer la
sortie des hooks — et emporte celui-ci avec lui.

## `update-deps` et l'ouverture de PR par GitHub Actions — résolu

**Résolu le 24/08/2026.** Conservé parce que le symptôme est déroutant et que
le réglage peut être remis à zéro.

Le job validait tout (`lint`, `test:unit`, `build` verts) puis échouait à la
dernière étape :

```
GitHub Actions is not permitted to create or approve pull requests.
```

Ce n'est pas du code, c'est un réglage — et il se lit à **deux** niveaux.
Basculer le drapeau du dépôt seul renvoie un `409` :

```
gh api -X PUT repos/Albo-Club/albo-os/actions/permissions/workflow -F can_approve_pull_request_reviews=true
→ 409 The organization does not allow GitHub Actions to create or approve pull requests
```

La politique de l'org `Albo-Club` prime, et c'est le **défaut de GitHub** pour
les organisations — pas nécessairement un choix délibéré. Il a fallu la lever
côté org (owner requis, *Settings → Actions → Workflow permissions*) **puis**
basculer le drapeau du dépôt, les deux étant nécessaires.

Conséquence à connaître : ce workflow **n'avait jamais réussi à ouvrir une PR
depuis sa création** le 21/07/2026. Les échecs antérieurs s'arrêtaient plus
tôt, sur `pnpm lint`, ce qui a masqué le problème jusqu'à ce que les blocages
amont soient levés. Le premier passage complet a produit la PR #398.

État attendu aujourd'hui :

```
gh api repos/Albo-Club/albo-os/actions/permissions/workflow
→ { "default_workflow_permissions": "read",
    "can_approve_pull_request_reviews": true }
```

`default_workflow_permissions` reste volontairement à `read` : chaque workflow
déclare ses propres `permissions:`, ce qui est plus étroit qu'un défaut
permissif.

Si le symptôme réapparaît, vérifier l'org **avant** le dépôt. Deux
contournements restent possibles sans toucher à la politique : un PAT
fine-grained en secret pour le step `create-pull-request`, ou laisser le
workflow pousser la branche (permis par `contents: write`, hors du champ de la
politique) et ouvrir la PR à la main.

## Version de pnpm : trois pins, dont un invisible

**Le piège** : `pnpm-lock.yaml` ne dit pas quel pnpm l'a écrit —
`lockfileVersion: 9.0` est commun à pnpm 9, 10 et 11. Rien dans le repo ne
contraignait le gestionnaire, et trois environnements avaient dérivé :

| Environnement | Version  | D'où elle venait                                    |
| ------------- | -------- | --------------------------------------------------- |
| Local         | 11.22.0  | corepack, sans instruction du repo                  |
| CI            | 10.x     | `version: 10` codé en dur dans 3 workflows          |
| **Vercel**    | 10.28.0  | **heuristique Vercel, hors du repo** (voir ci-après) |

Le log de build prod dit littéralement :

```
Detected `pnpm-lock.yaml` 9 which may be generated by pnpm@9.x or pnpm@10.x
Using pnpm@10.x based on project creation date
Done in 1.9s using pnpm v10.28.0
```

« based on project creation date » : la version de prod dépend de la date de
création du projet Vercel, pas d'une ligne versionnée. Elle peut bouger sans
qu'un commit la touche.

**Ce que ça a coûté** : `pnpm-workspace.yaml` avait gardé les placeholders du
template dans `allowBuilds` (`esbuild: set this to true or false`). pnpm 11
lit `allowBuilds` et **ignore** `onlyBuiltDependencies` ; une valeur non
booléenne = build refusé = `ERR_PNPM_IGNORED_BUILDS` en **exit 1**. Et comme
pnpm 11 lance un `runDepsStatusCheck` avant chaque script, **tout
`pnpm <script>` sortait en 1 en local** — install, typecheck, et le hook
`SessionStart`. La CI sur pnpm 10 lisait `onlyBuiltDependencies` et restait
verte : rouge en local, vert en CI, sans que rien ne l'explique.

**La règle** :

1. `packageManager` dans `package.json` est **la** source de vérité. Les
   workflows n'écrivent pas de `version:` — `pnpm/action-setup@v4` lit le
   champ tout seul.
2. Le pin suit **ce que Vercel exécutait déjà** (10.28.0), ce qui rend son
   introduction sans effet observable tout en supprimant l'heuristique. Vérifié
   sur un build de PR : le log passe de

   ```
   Using pnpm@10.x based on project creation date
   ```

   à

   ```
   Detected `pnpm-lock.yaml` version 9 generated by pnpm@10.x
   with package.json#packageManager pnpm@10.28.0
   ```

   Autrement dit **Vercel lit bien `packageManager`** (CLI ≥ 59) — pas besoin
   d'`ENABLE_EXPERIMENTAL_COREPACK`, contrairement à ce que laisse croire leur
   page Corepack. Conséquence à retenir : le champ **n'est pas décoratif côté
   prod**, il pilote la version du build. Le bumper vers pnpm 11 déplacera donc
   la prod pour de bon — à faire comme un changement à part entière, sur une PR
   dédiée dont on regarde le build preview, pas en passant.
3. **Aucun champ `engines` dans `package.json`.** Les deux sont des pièges
   distincts, et aucun n'apporte quoi que ce soit que `packageManager` ne
   couvre déjà :
   - `engines.pnpm` → la doc Vercel documente `ERR_PNPM_UNSUPPORTED_ENGINE`
     quand il ne colle pas au pnpm réellement choisi. Comme Vercel choisit
     par heuristique, l'ajouter arme une panne de build au prochain patch de
     leur côté.
   - `engines.node` → il **écrase le réglage Node du projet Vercel**
     (`nodeVersion`, aujourd'hui `24.x`). Le déclarer déplace le runtime de
     prod en silence : un `">=22"` bien intentionné aurait fait retomber la
     prod de Node 24 à Node 22. Vercel attend en plus le format `"24.x"`, pas
     une plage semver.
4. `pnpm-workspace.yaml` déclare **les deux clés** (`allowBuilds` pour 11+,
   `onlyBuiltDependencies` pour 10), tenues synchronisées. Une seule des deux
   = un des deux majeurs casse.

**Node, lui, reste désaligné** et ce n'est pas traité ici : local 22.23,
CI `node-version: 22` dans les workflows, Vercel `24.x` côté projet. Aligner
suppose de choisir une cible et de bouger le runtime de prod — un chantier
à part, à ne pas embarquer dans un changement d'outillage.

**Au changement de majeur**, pnpm veut purger `node_modules` et demande
confirmation ; sans TTY (agent, script) il s'arrête sur
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. `CI=true pnpm install` accepte
la purge. C'est un coût unique, pas un symptôme.

## `node_modules` dans N worktrees : `du` ment d'un facteur 10 à 25

**Le piège** : `du -sh node_modules` affiche 674 Mo. Avec une dizaine de
worktrees Conductor ouverts, on en déduit ~7,4 Go et on part supprimer des
`node_modules` pour faire de la place. **C'est faux, et le ménage ne rend
presque rien.**

Sur APFS, pnpm importe les paquets en **clone copy-on-write** depuis le store
(`package-import-method` vaut `auto` par défaut = clone si le FS le permet).
`du` additionne des blocs *partagés* : il mesure une taille logique, pas
l'occupation réelle. À noter, ce ne sont **pas** des hardlinks — `nlink` vaut
1 partout, ce qui fait croire à des copies indépendantes.

Mesuré sur ce repo (751 paquets, 54 096 fichiers, `du` = 674,1 Mo) :

| Opération                            | Durée  | `du`     | Espace **réellement** consommé |
| ------------------------------------ | ------ | -------- | ------------------------------- |
| `cp -R` (copie réelle)               | 20,4 s | 674,1 Mo | **−700 Mo**                     |
| `cp -Rc` (clone APFS)                | 13,5 s | 674,1 Mo | **−65 Mo**                      |
| `pnpm install` depuis le store       | 12,4 s | 674,1 Mo | **~25 Mo**                      |
| `rm -rf node_modules`                | 9,4 s  | —        | **+23,5 Mo libérés seulement**  |

Le même arbre, avec le même `du`, coûte 700 Mo en copie et 65 Mo en clone.

**Conséquences pratiques** :

- Le worktree marginal coûte **~25 à 65 Mo**, pas 674. Onze worktrees, c'est
  ~1,6 Go de store (payé **une fois**, partagé par tous les repos) + ~0,3 à
  0,7 Go — soit ~2 Go, pas 7,4.
- Supprimer un `node_modules` libère ~23 Mo et coûte 12 s à reconstruire. Le
  geste ne vaut pas la peine, dans un sens comme dans l'autre.
- **Ne jamais déplacer le store pnpm sur un autre volume** (disque externe,
  image disque) : le CoW ne traverse pas les volumes, pnpm retomberait en
  copie réelle et là, ce serait vraiment 700 Mo par worktree. Même chose si
  on forçait `package-import-method=copy`.
- `pnpm store prune` ne libère pas les blocs déjà clonés dans les worktrees
  (le refcount CoW les maintient vivants) — ce n'est pas un levier d'espace
  tant que des worktrees existent.

Pour mesurer, `du` ne sert à rien : seul un `df -k /System/Volumes/Data`
avant/après tranche. Prévoir du bruit — macOS reclaime du purgeable en
arrière-plan, on a vu ~500 Mo bouger pendant une mesure.

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
puis DeepSeek V4 Pro, et tourne désormais sur
**`~deepseek/deepseek-v4-flash-latest` servi via OpenRouter**.

- **Provider abstrait.** `getModel()` dans `convex/agent.ts` isole le
  provider : `createOpenRouter({ apiKey })` puis `openrouter.chat(AGENT_MODEL)`.
  OpenRouter est une gateway OpenAI-compatible — changer de modèle (DeepSeek,
  Mistral, Claude…) ne touche qu'`AGENT_MODEL` ; changer de provider ne
  touche que cette fonction. Pas un one-way door.
- **Id du modèle.** Source unique `convex/lib/instructions.ts:AGENT_MODEL`,
  défaut `~deepseek/deepseek-v4-flash-latest`. Override via la var d'env Convex
  `OPENROUTER_MODEL` (n'importe quel slug du catalogue OpenRouter, ex.
  `deepseek/deepseek-v4-pro` pour un modèle plus capable et ~9× plus cher). La
  clé vit dans l'env Convex sous `OPENROUTER_API_KEY`.
- **Le `~` du défaut n'est pas une coquille : c'est un alias mouvant.** Chez
  OpenRouter, un slug préfixé `~` (`~deepseek/deepseek-v4-flash-latest`) est
  une redirection vers la dernière version de la famille — aujourd'hui
  `deepseek/deepseek-v4-flash-0731`, demain sa remplaçante, **sans commit chez
  nous**. Deux conséquences à connaître avant de débugger un comportement qui
  « a changé tout seul » :
  - `getModel()` ne sert pas que le chat : l'extraction de métriques des
    reports (`reportStore.ts`), l'enrichissement de sociétés
    (`companyEnrichment.ts`), l'identification d'expéditeur
    (`reportIdentify.ts`) et l'intelligence société (`intelligence.ts`) tapent
    le même modèle. Une bascule d'alias peut donc déplacer la qualité d'une
    extraction sans qu'aucune ligne du repo n'ait bougé.
  - Le system prompt annonce l'alias comme id du modèle, donc l'agent répond
    `~deepseek/deepseek-v4-flash-latest` — ce qui n'est **pas** un deployment
    id. Le modèle réellement servi se lit dans le champ `model` des lignes
    `llm_usage` (logs Convex) ou sur le dashboard OpenRouter.

  Si un jour on veut figer : poser le slug daté en env
  (`pnpm exec convex env set --prod OPENROUTER_MODEL "deepseek/deepseek-v4-flash-0731"`).
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

- le `computedHash`). `pnpm run sync:skills:check` repasse alors vert. Relire le
  diff de contenu du SKILL.md avant de committer (obligation CLAUDE.md), et ne
  bumper que le(s) skill(s) réellement dérivé(s) — laisser les autres `pinnedRef`
  en place est sans risque (pas de drift de contenu = check vert).

## Skills vendorisées : liens inter-familles, et pourquoi `..` est interdit dans `references`

Les repos upstream shippent de plus en plus des _arbres_ de skills
(`TanStack/router` : `packages/<pkg>/skills/<skill>/[<sous>/]SKILL.md`). On
vendorise **à plat**, une clé de lock par famille : `.agents/skills/<nom>/`.
Deux conséquences :

- **Les liens frères à l'intérieur d'une famille résolvent, ceux qui en sortent
  non.** Une sous-skill vendorisée en `reference` garde sa position relative à
  son parent, donc `./middleware/SKILL.md` et `../server-functions/SKILL.md`
  marchent. Mais upstream lie aussi _entre packages_
  (`../../../../router-core/skills/router-core/auth-and-guards/SKILL.md`), et ce
  préfixe n'existe pas en local — **18 liens** pendouillent aujourd'hui (audit :
  43 liens résolvent, 0 cassé à l'intérieur d'une famille). On ne les réécrit
  **pas** à la vendorisation : `computedHash` porte sur les octets récupérés, donc
  patcher les liens à l'écriture ferait diverger l'arbre du hash pour toujours et
  chaque `--check` ressemblerait à une dérive. La table de traduction vit dans
  `CLAUDE.md` § Skills.
- **Une entrée `references` ne doit jamais commencer par `..`.** Ça a l'air de
  marcher — `raw.githubusercontent.com` normalise le chemin et renvoie 200 —
  mais `vendor()` résout la même chaîne contre `.agents/skills/<nom>/` et écrit
  **hors** du répertoire de la skill. C'est pour ça que
  `compositions/router-query`, pourtant _frère_ de `react-router` upstream, est
  sa propre entrée de lock (`tanstack-router-query`) plutôt qu'une référence en
  `../`.

Règle : une entrée de lock par répertoire upstream où l'on veut enraciner un
arbre ; `references` ne vise que des descendants de ce répertoire.

**Reste hors périmètre** : **3** fichiers non-Markdown vendorisés à la main ne
sont dans aucun `references`, donc ni rafraîchis ni drift-checkés —
`convex-create-component/agents/openai.yaml` (manifeste OpenAI),
`convex-create-component/assets/icon.svg` (icône) et
`frontend-design/LICENSE.txt` (Apache 2.0). Ils étaient 11 : #399 a emporté les
8 autres avec les anciennes skills Convex, et les fiches régénérées en amont
n'ont plus ni `agents/` ni `assets/`. Les nommer un par un plutôt que par glob
est délibéré — c'est le glob `convex-*/…` qui avait rendu le décompte
invérifiable, et donc faux pendant des semaines.

L'arbitrage tient : ce ne sont pas des instructions lues par un agent, et les
déclarer ferait diverger nos hashes de ceux du template pour zéro gain. Il
tient **aussi parce qu'on l'a vérifié** : les trois sont aujourd'hui
byte-identiques à l'upstream aux `pinnedRef` du lock. À rouvrir si l'un d'eux
devient une instruction lue par un agent — techniquement c'est trivial (ce sont
des descendants du répertoire du `SKILL.md`, donc ni `../`, ni seconde entrée
de lock, ni `MAX_IN_FLIGHT` à toucher, et ce sont des fichiers texte, ce
qu'exige un vendor qui passe par `res.text()`).

## `sync:skills --check` a besoin d'un plafond de fetchs simultanés

`runCheck` part en parallèle sur toutes les skills d'un coup, et chaque skill avec des
`references` multiplie son propre nombre de fichiers. Vendoriser l'arbre
TanStack a fait passer le check de ~30 à **62 fichiers**. Au-delà d'environ 30
handshakes TLS en parallèle, `raw.githubusercontent.com` cesse de répondre,
undici brûle ses 10 s de connect timeout et le script meurt sur
`TypeError: fetch failed`. Ça casse le hook `SessionStart` de
`.claude/settings.json`, qui a un budget de 10 s — et ça rougissait le job CI
`skills-drift`, avant que la CI ne bascule sur `--verify` (hors-ligne, section
suivante).

Corrigé dans `scripts/sync-skills.mjs` par un sémaphore à 8 slots autour de
`fetch` (`MAX_IN_FLIGHT`). Contre-intuitivement le check est devenu **plus
rapide** qu'avant (~0,8 s mesuré ici), parce que ≤ 8 sockets sont réutilisées au
lieu de se marcher dessus. Si on ajoute beaucoup de skills, augmenter librement
leur nombre — **ne pas** augmenter `MAX_IN_FLIGHT`.

## `--check` ne voit pas l'état du disque — d'où `--verify`

`--check` et le mode par défaut comparaient tous deux **le hash du lock à
l'upstream**, jamais **le lock au disque** : `isVendored()` ne testait que
l'_existence_ des fichiers. Conséquence, un fichier vendorisé édité à la main,
tronqué ou simplement périmé était invisible des deux côtés. Démontré en
ajoutant une ligne de garbage dans un `SKILL.md` : `--check` restait vert,
exit 0.

Ce n'est pas théorique — c'est la cause racine des trois fichiers `references/`
Convex périmés découverts en portant les PR #50/#51 du template, dont
`migrations-component.md` avec 54 lignes de retard. Rien ne pouvait sonner.

Deux modes, deux questions, à ne pas confondre :

| Mode       | Question                      | Réseau | Où                                      |
| ---------- | ----------------------------- | ------ | --------------------------------------- |
| `--verify` | « mon arbre est-il intact ? » | non    | **CI, chaque PR** (job `skills-verify`) |
| `--check`  | « l'upstream a-t-il bougé ? » | oui    | hook `SessionStart` + cron hebdo        |

La CI ne fait plus que le check local : il est déterministe, instantané et ne
peut pas rougir à cause d'un hoquet de `raw.githubusercontent.com` sur une PR
qui n'a rien à voir. La dérive upstream n'est pas un défaut de la PR en cours —
elle est traitée par le hook de session (elle remonte au moment où quelqu'un
code, le seul moment où des skills fraîches comptent) et par le cron hebdo qui
ouvre une PR de bump.

Le mode par défaut est aussi devenu **auto-réparateur** : il réécrit un fichier
qui ne correspond plus au `computedHash`, donc un `pnpm run sync:skills` répare
un arbre corrompu. `--force` n'est plus nécessaire pour ça (il reste utile pour
tout re-télécharger sans condition).

## Skills vendorisées : quand l'amont supprime ou renomme une skill

`sync:skills:check` a deux vocabulaires d'échec, et `--update` n'en traite
qu'un :

- `~ <skill>: main moved since pinned <sha>` → dérive **nominale**, l'original
  a bougé au même chemin. `pnpm run sync:skills:update` répare.
- `✗ <skill>: 404 https://raw.githubusercontent.com/…` → le `skillPath`
  **n'existe plus** en amont. `--update` ne répare rien : il avance le
  `pinnedRef` puis refetche exactement le même chemin mort, et ressort 404.

Le second cas veut dire que l'amont a restructuré son arbre. Retrouver où la
skill est passée — le message du commit de suppression le dit souvent
explicitement — puis corriger l'entrée du lock à la main : nouvelle clé,
nouveau `skillPath`, et **retirer `references`** si la nouvelle version n'a
plus de fichiers annexes.

Deux pièges à ce moment-là :

1. **`--update` re-pinne tout le monde.** Il résout le tip de chaque
   `trackingRef` du lock, pas seulement celui qui t'intéresse : les familles
   sans dérive voient quand même leur `pinnedRef` sauter, ce qui noie le diff
   qu'on est justement censé relire. Pour rester chirurgical, écrire le SHA
   cible à la main dans les seules entrées concernées puis lancer le
   `pnpm run sync:skills` par défaut — il est auto-réparateur, re-vendorise et
   réécrit les `computedHash` tout seul.
2. **Le script ne fait pas le ménage.** `vendor()` écrit, ne supprime jamais,
   et `--verify` n'itère que sur les clés du lock. Un dossier
   `.agents/skills/<ancien-nom>/` retiré du lock reste sur le disque **et
   reste chargé par Claude Code**, tout en étant invisible des deux
   garde-fous. Le supprimer à la main, avec son symlink
   `.claude/skills/<ancien-nom>`.

Cas vécu : le 01/08/2026, `get-convex/agent-skills` est passé de 6 skills
écrites à la main à ~33 fiches générées depuis un hub interne (commit
`90ae2c3`). Trois de nos cinq skills Convex ont disparu d'un coup, et avec
elles ~1 550 lignes de `references/` rédigées. Les remplaçantes font 23 à
36 lignes : le fond Convex ne vit plus dans les skills mais dans
`convex/_generated/ai/guidelines.md` (régénéré par `convex dev`, et qui prime
sur tout) et dans le catalogue servi en ligne par le routeur `convex`.

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

Le serveur MCP (`convex/mcp/`) expose 28 outils aux clients MCP externes :
24 en lecture, 4 en écriture (cf. point 6). Architecture : resource server = httpAction `/mcp`
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
   `oauthApplication` à la main et utiliser les _Advanced settings_ du
   connector claude.ai (client_id pré-enregistré, pas de DCR) ; (b) local
   install du composant avec schéma régénéré ; (c) mini-AS maison.
2. **Pas de binding d'audience RFC 8707** : les tokens BA sont opaques et
   le paramètre `resource` n'est pas validé. Accepté pour un outil interne
   à 2 users. Depuis l'ouverture des écritures (point 6), un token volé
   n'est plus seulement une fuite de lecture — la limite de dégât reste
   qu'aucun outil MCP ne supprime, et que tout écrit est visible et
   corrigeable dans l'app.
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
6. **Écritures : où vit la validation humaine.** Le serveur expose 4 outils
   d'écriture (`createCompany`, `updateCompany`, `createDeal`, `updateDeal`)
   pour saisir une entité depuis une phrase dictée, hors app. MCP n'a
   **pas** d'équivalent de `needsApproval` : le flag du chat in-app arrête
   la génération et attend un clic sur nos boutons, mécanique qui n'existe
   pas hors du panneau. Le point de contrôle est donc l'annotation MCP
   `readOnlyHint: false` (spec 2025-06-18), émise dans `tools/list` et
   calculée depuis le flag `write` de `defineTool` — c'est elle qui fait
   demander confirmation au client. **Tout nouvel outil MCP qui écrit DOIT
   porter `write: true`** ; sans lui il s'annonce en lecture seule et
   s'exécute sans confirmation. Conséquences assumées :
   - **Aucun blocage sur doublon**, seulement des avertissements
     (`possibleDuplicates`, `convex/lib/duplicates.ts`). Sans écran de
     revue, bloquer une création sur une heuristique de nom coûterait plus
     cher que la corriger. Seule exception : `assertSirenFree`, invariant
     de données déjà appliqué partout ailleurs — le chemin MCP ne doit pas
     ouvrir de porte dérobée autour.
   - **Pas de mutation dupliquée** : les internes de `convex/agentTools.ts`
     sont élargis en champs optionnels plutôt que recopiés côté MCP, pour
     garder une seule implémentation des garde-fous
     (`assertInvestorIsGroupEntity`, `assertSameOrg`, normalisation domaine
     et SIREN). Corollaire : élargir un interne modifie aussi ce que voit
     l'agent in-app — les valeurs de retour sont additives (`similar`), les
     schémas zod du chat restent inchangés.
   - **Suppressions hors périmètre.** Aucun outil MCP ne supprime, et cette
     limite est ce qui rend l'écriture directe acceptable.
7. **Registre de schémas séparé.** Les outils agent sont en `zod/v3`
   (inline), incompatibles `z.toJSONSchema()` → `convex/mcp/registry.ts`
   re-déclare les schémas en zod v4. Si les args d'un internal changent,
   tenir les deux en phase.
8. **claude.ai ne charge qu'un sous-ensemble des outils par conversation**
   (sélection dynamique côté Anthropic, ~5 sur 26 observés). Conséquence :
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
9. **Lecture des documents : jamais un texte entier d'un coup.** Un
   `documentTexts.text` monte à `MAX_DOCUMENT_CHARS` (900 000 caractères) —
   le renvoyer tel quel ferait une réponse JSON-RPC de ~900 ko, hors de
   portée de la fenêtre de contexte du client comme du budget de la
   httpAction. `getDocumentText` renvoie donc une **fenêtre de 40 000
   caractères** et un `nextOffset` que l'appelant rappelle jusqu'à `null`
   (`getDocumentTextInternal`, `convex/agentTools.ts`). Ne pas confondre les
   deux troncatures : `truncated: true` dit que le **fichier** a été coupé à
   l'extraction (la fin n'a jamais été stockée, aucun offset ne l'atteindra),
   `nextOffset` dit seulement qu'il reste du texte à lire. L'entrée normale
   dans la doc reste `searchDocuments` (sémantique, extraits sourcés) : la
   lecture intégrale est le recours quand un extrait ne suffit pas.

## Serveur MCP du CLI Convex : le déploiement est figé au démarrage du process

**Trois « MCP » cohabitent dans ce repo, et ce ne sont pas les mêmes.**
(1) `convex/mcp/` — le serveur que **l'app** expose à des clients externes
(section juste au-dessus). (2) `npx convex mcp start` — l'outillage **de dev**
du CLI Convex, dont Claude Code tire les outils `mcp__…convex__*` (`status`,
`data`, `tables`, `runOneoffQuery`, `logs`…) : c'est celui-ci le sujet.
(3) Les MCP tiers (resend, context7, shadcn). Un problème sur l'un ne dit
strictement rien des deux autres.

**Le piège** : le MCP et le CLI ne voient pas le même déploiement, et c'est le
MCP qui a tort. `convex run --prod` renvoie les vraies données pendant que
`tables` / `data` via MCP décrivent une base vide. Aucune erreur, aucun
avertissement — juste des tables absentes et des chiffres qui ne correspondent
à rien. On croit à un bug applicatif ; c'est un problème d'adressage.

**Pourquoi** (vérifié dans `convex@1.42.3`, sous `node_modules/convex/dist/esm/`) :

- Le serveur MCP est un **process long-vivant** — `cli/mcp.js:47` bloque sur
  `await new Promise(() => {})`. Le CLI en ligne de commande, lui, est un
  process **neuf à chaque invocation**. Toute l'asymétrie est là.
- `cli/lib/deploymentSelection.js:360-361` fait `dotenv.config({ path:
  '.env.local' })` puis `dotenv.config()`. Or **`dotenv` n'écrase jamais une
  clé déjà présente dans `process.env`** : la toute première lecture de
  `CONVEX_DEPLOYMENT` est donc figée pour la vie du process. Éditer
  `.env.local` ensuite ne change rien tant que Claude Code n'a pas redémarré.
- `cli/lib/mcp/tools/status.js:66` fait un `process.chdir(projectDir)` à chaque
  appel, ce qui **donne l'illusion** que le projet est re-résolu. Le `chdir` a
  bien lieu ; la relecture d'env, non.
- La description du tool `status` (`status.js:40-42`) pousse explicitement
  l'agent vers le dev : « Generally default to using the development deployment
  unless you'd specifically like to debug issues in production. » Sur ce repo
  **prod-only** (cf. `CLAUDE.md` § « Workflow déploiement »), c'est le pire
  conseil possible : le déploiement dev existe bel et bien, mais ce n'est qu'un
  vestige vide.
- Le `deploymentSelector` est un **jeton opaque** —
  `${kind}:${btoa(JSON.stringify({ projectDir, deployment }))}`
  (`requestContext.js:96-101`) — que les autres outils décodent **sans
  revalider**. Un sélecteur récupéré au tour précédent, ou copié depuis un
  autre workspace, reste « valide » et continue de viser l'ancien couple.
- La prod est de toute façon **fermée par défaut** : `requestContext.js:69-73`
  refuse `data` / `logs` / `runOneoffQuery` sur un déploiement `prod` tant que
  ni `--cautiously-allow-production-pii` (lecture) ni
  `--dangerously-enable-production-deployments` (lecture + écriture) n'est posé.

**Facteur aggravant : le plugin ne passe aucun flag.** Le serveur vient du
plugin `convex@claude-plugins-official`, installé au **scope user**, dont le
`.mcp.json` se réduit à `npx -y convex@latest mcp start` — ni `--prod`, ni
`--project-dir`, ni `cwd`. (Et `convex@latest` est résolu par npx, donc pas
forcément la version du repo.) Les options existent pourtant : `mcp.js:41`
appelle `addDeploymentSelectionOptions`, qui apporte `--prod`,
`--deployment <ref>` et `--env-file <path>`.

**Facteur aggravant : Conductor.** `.env.local` est gitignored et n'est pas
toujours recopié dans le workspace — quand il manque, `status` répond
`No CONVEX_DEPLOYMENT set`, ou pire, le process retombe sur ce qu'il a hérité
d'ailleurs.

**La solution**, du moins cher au plus engageant :

1. **Le CLI fait foi.** `convex run --prod`, `convex export --prod` : c'est
   déjà la convention du repo, et c'est exactement pour ça qu'ils voient juste.
   En cas de doute sur un chiffre, trancher au CLI, pas au MCP.
2. **Croiser l'URL avant de lire.** `status` renvoie l'URL du déploiement qu'il
   vise ; la comparer au `VITE_CONVEX_URL` de `.env.local`. Contrôle en cinq
   secondes qui attrape le cas à tous les coups.
3. **Redémarrer Claude Code** — nouveau process MCP, nouvelle lecture d'env.
   C'est le seul moyen de dégeler la valeur sans toucher à la config.
4. **Viser la prod depuis le MCP** demande `--prod` **plus**
   `--cautiously-allow-production-pii`. Ce second flag n'est pas une case de
   confort : c'est la levée explicite du garde-fou PII de Convex. Ne pas le
   committer à la légère.
5. `--env-file <path>` est le **seul** mécanisme qui court-circuite vraiment le
   gel : il est lu en amont (`deploymentSelection.js:335-337`, via `ctx.fs`) et
   ne passe donc pas par le `process.env` figé.

Même famille, vue d'un autre angle : `vercel link` wipes `CONVEX_DEPLOYMENT`
from `.env.local` (plus haut) et sa règle finale — `CONVEX_DEPLOYMENT` est un
binding dev **par développeur**, pas une cible de déploiement.

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

**Figer plusieurs colonnes** (Société + Score IA sur la liste Entreprises) :
`left-0` ne marche que pour la première — les suivantes ont besoin de leur
**décalage `left` explicite**, égal à la somme des largeurs des colonnes
figées à leur gauche (`frozenCompany` / `frozenScore` dans le même fichier).
Deux conséquences :

- La colonne **flexible** (celle sans largeur, qui absorbe la place restante)
  doit être la première : au moment où le scroll horizontal se déclenche, la
  table est pile à son `min-width`, donc cette colonne est pile à son minimum
  — c'est ce qui rend l'offset des suivantes constant et calculable. Au-delà
  de cette largeur rien ne défile, donc les offsets ne jouent jamais.
- Les colonnes figées doivent être **contiguës et en tête** de la table : une
  colonne intercalée qu'on ne veut pas figer doit être déplacée à droite (la
  colonne Org de la vue agrégée est passée après Score IA pour cette raison).

**En-tête / pied figés au scroll vertical** (même table) : `sticky` sur
`<thead>`/`<tfoot>` est peu fiable (Safari) — poser le sticky **cellule par
cellule** (`sticky top-0` sur chaque `th`, `sticky bottom-0` sur chaque
cellule du pied de totaux) et **borner la hauteur du conteneur** de
`ui/table.tsx` (`[&>div]:max-h-[70vh]`) pour créer le contexte de scroll.
La cellule de coin (colonne figée × en-tête figé) cumule les deux axes et
prend un `z-30`.

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

## Courbe de solde bicolore (vert au-dessus de zéro, rouge en dessous)

Recharts ne sait pas colorer une série par signe : une `Area`/`Line` prend UN
`stroke`. La seule voie propre est un `<linearGradient>` vertical avec **deux
arrêts au même offset** (rupture franche) — le piège est de calculer cet
offset.

Un gradient SVG utilise par défaut `gradientUnits="objectBoundingBox"` :
`y=0` et `y=1` sont le haut et le bas de la **boîte englobante du path
peint**, PAS de la zone de tracé du graphe. Calculer l'offset depuis le
domaine de l'axe Y place donc la bascule au mauvais endroit dès que la courbe
ne touche pas les bords du graphe. Et passer en `userSpaceOnUse` obligerait à
connaître la hauteur en pixels de la zone de tracé, que recharts n'expose pas
de façon déclarative.

**Solution retenue** (`src/components/cash/ForecastChart.tsx`, fonction
`zeroOffset`) : calculer l'offset sur l'étendue **de la série elle-même**,
`max / (max − min)` de ses valeurs. La boîte englobante du path EST cette
étendue — l'offset tombe donc pile sur le zéro, sans maths en pixels ni
domaine figé sur l'axe.

Trois conditions à respecter si on touche ce fichier :

- **Un gradient par série** (le réel et le projeté n'ont pas la même étendue,
  donc pas le même offset).
- **`type="monotone"`** : l'interpolation monotone ne dépasse jamais les
  extrêmes des points, donc la boîte englobante reste égale à l'étendue des
  données. Un `type="natural"` (spline qui overshoote) décalerait la bascule
  de quelques pixels.
- **`baseValue={0}`** sur l'`Area` : le remplissage est alors borné par la
  ligne de zéro et son path couvre la même étendue verticale que le tracé,
  donc le même offset marche pour le `fill`. Sans lui, l'aire descend jusqu'au
  bas du graphe et le dégradé du remplissage se décale.

Série entièrement positive ou entièrement négative : `zeroOffset` renvoie 1 ou
0, les deux arrêts se confondent et le dégradé devient monochrome — pas de cas
particulier à écrire.

## Report sans période — le dédoublonnage ne peut pas rester sur la période

`companyReports` se dédoublonne sur `(companyId, reportPeriod)` (index
`by_company_period`) : renvoyer le report d'avril met à jour celui d'avril au
lieu d'en créer un second. Correct tant que **tout** report porte une période.

Il n'en porte pas toujours. Un courrier de liquidation, une notification
juridique, une annonce de levée concernent bien la participation mais ne
couvrent aucune période. Le schéma de sortie du LLM
(`convex/reportStore.ts:analysisSchema`) exigeait pourtant `report_period`
(string) et `report_type` (enum de 5 rythmes) : sur ce genre de document le
modèle répondait `report_period: null` et laissait le reste vide, le
`safeParse` échouait, et la ligne partait en `needs_review` /
`analyze_error` — **définitivement**, puisque le contenu ne changera jamais.
« Rattacher » et « Retraiter » relancent la même analyse et rebondissent à
l'identique.

Les deux champs sont donc `nullable` côté LLM, et **facultatifs** au
rangement (le schéma Convex les déclarait déjà `v.optional`). Le piège est
ce qui suit : avec `reportPeriod` absent, `q.eq('reportPeriod', undefined)`
matche **tous** les reports sans période de la société. Un `.first()` naïf
ferait écraser chaque courrier ponctuel par le suivant — perte de données
silencieuse, sans aucune erreur. Un document sans période est donc identifié
par son **message d'origine** (`subject` + `emailDate`, portés aussi bien par
un mail que par un dépôt manuel), pas par le créneau vide.

Règle : **toute nouvelle clé de dédoublonnage sur un champ optionnel doit
dire ce qui se passe quand le champ est absent.** `undefined` n'est pas
« pas de clé », c'est **une** clé — partagée par toutes les lignes qui n'ont
rien. Couvert par `convex/regression.reportStore.test.ts`.

Corollaire d'affichage : `periodSortDate` retombe sur la date de réception
quand il n'y a pas de période, sinon le courrier n'aurait aucun ancrage dans
la timeline de la fiche (l'index `by_company` trie là-dessus).

## Schéma Zod servi à un LLM : `.nullable()` exige la CLÉ, pas seulement la valeur

Suite directe du § ci-dessus. Rendre `report_period` et `report_type`
`nullable()` n'a réglé le problème qu'à moitié : deux reports (GOODVEST,
WIND CAPITAL 2) sont repartis en `analyze_error` sur
`metrics[0].period` — `expected string, received undefined`.

En Zod, `.nullable()` autorise la **valeur** `null` mais laisse la **clé
obligatoire**. Or un modèle qui répond en JSON libre **omet** une clé dont
il n'a rien à dire, il n'écrit pas `"period": null`. Et `metrics[].period`
n'existe que si une métrique couvre une autre période que le report : elle
est absente de la quasi-totalité des métriques. Une clé manquante faisait
donc rejeter le report **entier**, avec les 15 métriques valides qui
l'accompagnaient.

Pourquoi ça ne tombe pas sur tous les reports : le chemin nominal est
`generateObject`, qui contraint le modèle au schéma. Le `safeParse` n'est
atteint que par le **repli** `generateText` (JSON libre), déclenché quand
`generateObject` échoue — et cet échec-là est logé en `console.warn`, donc
invisible côté produit. Deux pannes en cascade sont nécessaires pour perdre
un report, ce qui rend le bug rare et d'autant plus déroutant.

**Règle : dans tout schéma Zod envoyé à un LLM, un champ optionnel s'écrit
`.nullable().default(null)` (ou `.nullish()`), jamais `.nullable()` seul.**
Le `.default(null)` sort la clé du `required` du JSON Schema **et** relit
une clé absente comme `null` — le type de sortie reste `string | null`,
donc le code en aval ne bouge pas.

### Le correctif n'a tenu qu'un tour — et c'est ça, la vraie leçon

Le report suivant est reparti en `analyze_error` sur
`report_type: "half-year"` : le bon rythme, écrit autrement. Clé absente
puis valeur reformulée : deux variantes d'**un seul** défaut de conception,
qui n'est pas dans le schéma mais dans ce qu'on lui demande de faire. On
exigeait d'un générateur de texte l'exactitude d'un formulaire, et au
moindre écart on jetait le report entier. Rustiner la variante du jour
garantit une troisième variante la semaine suivante.

**Deux contrats, pas un.** Les deux chemins ne demandent pas la même chose
et ne doivent pas partager la même sévérité :

- `analysisSchema` (`convex/lib/reportAnalysis.ts`) est le contrat **strict**
  passé à `generateObject`. C'est lui qui contraint le modèle dans le chemin
  nominal, et le JSON Schema qu'on en dérive est la **seule** consigne que
  reçoit le provider — le desserrer (`z.string()` au lieu d'un enum, un
  `.transform()` qui dégrade le schéma en `ZodEffects`) enlèverait la
  contrainte à l'endroit où elle marche.
- `parseLenient` (même fichier) lit le chemin de **repli**, où le modèle
  répond en JSON libre et où **rien** ne le contraint. Là, l'écart est le cas
  normal : les synonymes sont ramenés au canonique (`half-year` →
  `semi-annual`, `k€` → `kEUR`, `"1 200"` → `1200`), l'inconnu devient `null`
  ou `'other'`, et ce qui n'est pas récupérable est **jeté seul**. Une
  métrique illisible ne coûte plus que sa ligne.

La tolérance n'invente jamais : une unité non reconnue devient `'other'`, que
`toCanonical` refuse pour toute clé du catalogue — la métrique reste sur le
snapshot brut au lieu d'entrer dans une série sous une unité devinée. Le seul
échec restant est une réponse sans titre **ni** headline : il n'y a alors pas
de fiche à ranger.

Même principe côté identification (`parseIdentificationLenient`,
`convex/lib/emailIdentify.ts`), avec une règle en plus : `confidence`
retombe sur `'low'` par défaut, qui est la branche **stricte** de
`acceptIdentification` — une confiance illisible resserre le rattachement au
lieu de le relâcher.

C'est le même principe que `normalizePeriodDisplay`, qui accepte « janvier
2026 » et le traduit plutôt que de le refuser. Couvert par
`convex/regression.reportAnalysisSchema.test.ts`.

## Un échec de modèle n'est pas un échec de report

Le même jour, l'autre report est mort sur `The operation was aborted` : la
requête vers le modèle coupée en vol. Rien à voir avec le contenu du mail
(le message ne vient d'aucune de nos dépendances — ni AI SDK, ni provider
OpenRouter : c'est le runtime Convex qui a coupé).

Le pipeline traitait **tout** échec comme définitif : `needs_review`, mail
d'échec, et un « Retraiter » **manuel** comme seule sortie. Un hoquet réseau
de trois secondes coûtait une intervention humaine — c'est ce qui rendait la
file « relou » bien plus que les bugs de schéma.

`convex/lib/modelRetry.ts` sépare les deux natures :

- **Passager** (requête coupée, saturation, 429, 5xx, `fetch failed`) — la
  même entrée réussirait plus tard. `retryAfterTransient`
  (`convex/reportInbox.ts`) repasse la ligne en `received` — le statut que
  réclament déjà les mutations de claim, donc la reprise rentre par la porte
  normale — et replanifie à 1 / 5 / 15 min. **Aucune notification** : un
  hoquet qui se répare ne doit rien coûter à l'utilisateur. Un mail d'échec
  prématuré ne ferait plus taire le récap de succès (`claimNotify` laisse
  passer la réparation, cf. § « `notifiedAt` est un droit de parole »), mais
  il annoncerait un problème qui n'a pas eu lieu, puis se corrigerait :
  deux mails pour un non-événement.
- **Définitif** (réponse illisible) — jamais réessayé : l'entrée ne changera
  pas, et brûler 20 minutes de backoff ne fait que retarder l'information.

Trois pièges, tous payés une fois :

1. **La classification lit le MESSAGE d'erreur**, donc elle ne vaut que sur
   les erreurs qu'on n'a pas écrites soi-même. Un report dont un `raw_label`
   vaut « timeout » se classerait passager. D'où `ModelOutputError` : nos
   propres échecs de lecture portent un type, et le type prime sur les mots.
2. **Le budget est PAR étape** (`retryStep` à côté de `retryAttempts`) :
   identification et analyse appellent toutes deux le modèle, et un mail qui a
   survécu à deux identifications bancales doit garder un budget entier pour
   son analyse. Porter l'étape à côté du compteur évite d'écrire un reset
   quelque part dans le pipeline — et un reset manquant est exactement le
   genre de bug qui ne se voit qu'au troisième incident.
3. **Un `generateObject` coupé ne doit pas déclencher le repli.** Une requête
   coupée ne dit rien sur la sortie structurée : enchaîner une seconde
   génération complète derrière brûle le même échec deux fois. Les deux
   `callModel` relaient donc l'erreur passagère au lieu de replier.

Couvert par `convex/regression.modelRetry.test.ts` et
`convex/regression.reportRetry.test.ts`.

## Prompt de notation : l'exemple JSON fixe la note, et la symétrie forcée l'écrase

Le score de santé de la synthèse IA (`INTELLIGENCE_SYSTEM_PROMPT`,
`convex/lib/reportPrompts.ts`) est sorti sur **4 → 7** pour tout le
portefeuille, dont 8 sociétés sur 10 entre 5 et 7. Wandercraft (Next40,
contrat Renault, 18 M€ non dilutif) et ACT Running (CA divisé par deux, 13 %
du budget annuel après cinq mois) tenaient en **un point d'écart**. Une
colonne qui ne sépare pas ces deux-là ne trie rien.

Trois causes, toutes dans le prompt :

1. **L'exemple JSON ancre.** Le bloc « FORMAT DE SORTIE » portait
   `"score": 6`. C'était le seul chiffre du prompt, et le seul champ de
   l'exemple qu'aucune donnée d'entrée ne contraint (les `good_points` de
   l'exemple, eux, sont forcément réécrits). Le modèle le recopiait. Règle :
   **dans un prompt de notation, un exemple ne porte jamais de note en
   dur** — un placeholder (`<entier 1-10 issu du BARÈME>`) et un barème.
2. **Aucun barème.** La règle disait comment *nommer* la note (« Excellent »
   8-10, « En bonne voie » 6-7…), jamais ce qui la *mérite*. Nommer n'est pas
   noter : sans critères durs (runway, écart au plan, gouvernance) et sans
   règle de plafond par l'axe le plus dégradé, un LLM converge sur le milieu,
   qui n'est jamais franchement faux.
3. **La symétrie forcée.** `good_points` / `bad_points` **exactement 3
   chacun**, plus une posture « toujours montrer le positif ET le négatif ».
   Une boîte qui décroche partout devait produire trois bons points — d'où
   « domaine .com professionnel » — et une boîte qui cartonne trois mauvais.
   L'analyse rendue est mitigée, la note suit. Les compteurs sont passés à
   « 1 à 3 ».

Corollaire, corrigé en même temps : `runAnalysis` ne déclenchait **jamais**
son statut `no_data`. La garde testait `!text`, or `getContext` renvoie
toujours au moins `## Entreprise: <nom>` — branche morte. Une société sans
aucun reporting recevait donc une vraie note (RGOODS : 5/10, bons points
inventés à partir du nom de domaine). La garde porte maintenant sur
`hasReports || vascoBlock`, et le statut `no_data` **efface** l'analyse
précédente : la colonne Score des Participations lit `aiAnalysis` seule
(`deals.aiScoresByCompany`), sans regarder le statut — une synthèse périmée
laissée en base afficherait une note dans la liste pendant que la fiche
annonce « aucune donnée ».

Le barème du prompt et `scoreVerdict` (`src/lib/reportScore.ts`) sont
**alignés bande par bande** (7-10 vert, 5-6 ambre, 1-4 rouge). Déplacer un
seuil d'un côté sans l'autre affiche « En bonne voie » en ambre.

## Reprise d'un historique de reports depuis un autre outil : aucune clé ne tient

Migrer les reportings d'Albo app (Supabase) vers Albo OS a buté sur une
évidence trompeuse : « deux reports de la même société sur la même période
sont le même report ». C'est faux dans les deux sens, et chaque clé
déterministe essayée casse sur des lignes réelles.

- **La période** : l'update Q2 de Goodvest est `June - Q2 2026` côté Albo app
  et `Q2 2026` côté Albo OS — même e-mail, à la seconde près. Le courrier de
  liquidation de Wheelee n'a **aucune** période côté Albo OS. Trois doublons
  passent au travers.
- **`period_sort_date`** : même échec (2026-06-01 vs 2026-04-01 pour Goodvest),
  parce que les deux outils ancrent un bimestriel sur des mois différents.
- **La date d'e-mail** : 79 lignes sur 184 n'en ont aucune, et l'outil
  d'arrivée porte souvent la date du **transfert**, pas celle de l'original
  (65 secondes d'écart sur le même report AZmed). Surtout, une vieille période
  peut arriver tard **des deux côtés** : les rapports annuels 2024 et 2025
  d'AZmed ont atterri dans Albo app le 03/04/2026. Filtrer sur une fenêtre de
  dates est donc un faux ami — c'est l'erreur qu'on a failli commettre.
- **Le `Message-ID` RFC** : présent sur 73 lignes sur 184, et le pipeline
  ingère des **transferts**, qui portent un nouveau `Message-ID`. Il ne
  correspond jamais d'un système à l'autre.

Et la clé se trompe aussi **dans l'autre sens** : Wandercraft a deux reports
distincts en `March 2026` (le mensuel, et l'annonce Renault sur 350 robots) ;
Bleen a deux documents distincts en `July 2026` (l'e-mail informel du 07/07 et
la notification formelle du 30/07 au titre du pacte). Un skip sur collision de
période les jette en silence.

Règle : **pour rapprocher deux bases, comparer les CONTENUS** (headline, key
highlights, métriques), participation par participation, puis **figer les
décisions dans un fichier relu** — jamais recalculer une heuristique à
l'exécution. Les gardes du code (`alboReportId` déjà présent, créneau
`(companyId, reportPeriod)` occupé) restent un filet, pas la décision.
Cf. `convex/migrations/alboReportsImport.ts` et
`scripts/data/albo-reports-albo.json`.

Corollaire : ne **jamais** rejouer un import historique à travers
`reportStore.storeForCompany`. Cette fonction **met à jour sur place** en cas
de collision de période et supprime les `documents` du report avant de les
réécrire — un report de 2024 écraserait la ligne Albo OS courante et ses
pièces jointes. L'import écrit ses lignes lui-même et **saute** au lieu de
patcher. Même raison pour `companyIntelligence.latestReportId`, laissé
intact : un import historique ne doit pas repointer la synthèse courante.

## Détacher un report — l'empreinte à défaire, et le blob qui reste

Ranger un report écrit **cinq** choses par entité rattachée
(`convex/reportStore.ts:storeForCompany`) : la ligne `companyReports`, une
ligne `documents` par pièce jointe, les `kpiSnapshots` taggés
`source: "report:<id>"`, le pointeur `companyIntelligence.latestReportId`, et
une entrée d'index sémantique de clé `report:<id>`. Supprimer la seule ligne
`companyReports` laisserait donc les KPIs dans les séries de la mauvaise boîte
et le texte du report dans sa recherche. `reportInbox.detachCompany` défait les
cinq, pour **une** entité — les autres entités du fan-out gardent la leur.

Ce qu'il ne faut **pas** supprimer : le **blob de storage**. Un même blob est
partagé par les lignes `documents` de toutes les entités du fan-out **et** par
la pièce jointe de `inboundEmails`. Le détacher d'une participation ne doit pas
aveugler les autres. (À l'inverse, `documents.remove` supprime bien le blob :
c'est cohérent pour un document déposé à la main, mais cela reste un piège si
on l'appelait un jour sur la copie d'un report — pré-existant, non touché ici.)

Le second réflexe est de **corriger la ligne de la file** dans la même
transaction (`matchedCompanies` et `reportIds`) : sans ça la file continue de
revendiquer la participation, et surtout un « Retraiter » ultérieur **remettrait
le report** sur l'entité qu'on vient d'en sortir. D'où le back-link
`companyReports.inboundEmailId`, posé au rangement. Les lignes antérieures au
champ sont retrouvées via `agentmailMessageId` (index `by_message_id`) ; un
**dépôt manuel** antérieur, lui, n'a pas de chemin de retour (le rangement met
délibérément `agentmailMessageId: undefined` sur les uploads) — le détachement
marche quand même, seule la ligne de la file garde sa mention périmée.

Couvert par `convex/regression.reportDetach.test.ts`.

## Suite de régression Convex (`pnpm test:convex`) — 3 pièges du harness

La suite (`convex/regression.*.test.ts` + harness `convex/regression.setup.ts`)
tourne sur `convex-test` : backend en mémoire, aucun réseau, aucun déploiement.
Trois choses non évidentes qui coûteraient cher à redécouvrir :

1. **Les tests vivent dans `convex/` sans être déployés.** Le CLI Convex
   ignore tout module dont le _basename_ contient **plus d'un point**
   (cf. `entryPoints()` dans le bundle CLI : « Skipping … that contains
   multiple dots »). `regression.tenancy.test.ts` comme `regression.setup.ts`
   sont donc invisibles pour `convex dev`/`deploy` — c'est la raison du
   préfixe `regression.` sur le fichier de setup aussi. Ne PAS créer de
   helper `setupTests.ts` (un seul point → il partirait en prod et casserait
   le deploy sur l'import vitest).
2. **Auth réelle, pas de mock : composant Better Auth + claims précises.**
   `requireAppUser` passe par `authComponent.safeGetAuthUser`, qui lit
   `identity.sessionId` et `identity.subject` puis résout `session` et `user`
   dans les tables **du composant**. Le harness enregistre le composant via
   l'entrée officielle `@convex-dev/better-auth/test` (`register(t)`), seed
   `user` + `session` par `components.betterAuth.adapter.create`, puis
   authentifie avec `t.withIdentity({ subject: <baUserId>, sessionId:
<sessionId> })`. Un identity sans `sessionId` = utilisateur silencieusement
   anonyme (les tests « rejette un non-membre » passeraient pour de mauvaises
   raisons).
3. **`import.meta.glob` sous vitest = inline deps obligatoires.**
   `convex-test` et `@convex-dev/better-auth/test` utilisent
   `import.meta.glob` (construct Vite) ; servis depuis `node_modules` sans
   transformation, ils explosent. D'où `server.deps.inline: ['convex-test',
'@convex-dev/better-auth']` dans `vitest.config.ts` — et `SITE_URL` y est
   injecté car `convex/auth.ts` le lit au chargement du module (importé par
   `lib/auth.ts`, donc par quasi toutes les fonctions testées).

Le critère d'efficacité de la suite a été vérifié : commenter le
`requireOrgMember` de `deals.list` fait rougir 2 tests (isolation lecture).

## Backfill depuis la doc juridique — 4 pièges

`scripts/backfill-deal-fields.mjs` + `convex/migrations/alboDocBackfill.ts`
remplissent les champs vides des `companies`/`deals` de l'org `albo` à partir
des documents juridiques déjà versés. Trois choses non évidentes.

1. **Un même document contient plusieurs nombres d'actions, tous corrects.**
   Sur Auxicare, le PV du Président porte **480 000** (capital après la seule
   augmentation de capital), **548 943** (après exercice concomitant des BSA
   Air) et le pacte **609 936** (base pleinement diluée, pool BSPCE inclus).
   Les trois sont exacts dans leur contexte, et un extracteur qui prend le
   premier croisé se trompe. Les règles, encodées dans
   `convex/lib/docBackfill.ts` : `companies.totalShares` prend les actions
   **émises** (jamais la base FD — un pool voté et non attribué n'est pas une
   action) ; la base FD sert aux **valorisations** (post-money = FD × prix du
   tour) et part dans les **notes du deal**, pas dans une colonne. Garde-fou :
   quand le pacte imprime le % d'Albo, le script recalcule
   `sharesAcquired / base FD` et flagge `coherence_base_FD_douteuse` si l'écart
   dépasse 0,1 point — une base fausse se voit là, avant d'être multipliée par
   le prix du tour.

2. **`deals.ownershipPct` et le % affiché sur la fiche société ne sont pas le
   même chiffre, et c'est normal.** `ownershipPct` est stocké en base
   **pleinement diluée**, repris tel quel de la table de capitalisation
   (Auxicare : `234` bps = 2,34 %). L'en-tête de
   `src/routes/app/$orgSlug/participations.$companyId.tsx` calcule, lui,
   `somme(deals.sharesAcquired) / companies.totalShares` — donc du **non
   dilué** (Auxicare : 14 286 / 548 943 = 2,6 %). Réalité économique contre
   réalité juridique : deux questions différentes, deux réponses différentes.
   Ne pas « corriger » l'un avec l'autre sans arbitrage explicite ; si un jour
   l'affichage doit changer, c'est une décision produit, pas un bug.

3. **Un nouveau module de `convex/migrations/` ne peut pas s'auto-référencer
   via `internal.…`.** `convex/_generated/api.d.ts` est **commité et périmé**
   (il ne connaît pas les modules ajoutés depuis le dernier `convex dev`), et
   la CI fait tourner `pnpm lint` = `tsc` sur cet état-là : un
   `ctx.runQuery(internal.migrations.monModule.maQuery)` écrit dans
   `monModule` casse le typecheck en CI alors qu'il est correct en prod. Le
   contournement retenu ici est aussi le plus simple : l'action ne lit rien
   elle-même, le script paginate le texte (`getDocText`, fenêtres de 40 000
   caractères) et le passe en argument. Bénéfice collatéral — le cache par
   hash de texte court-circuite le modèle **avant** l'appel, donc une relance
   sur le delta ne coûte que des lectures.

4. **Un modèle saturé revient en SUCCÈS de l'action, pas en exception.** Le SDK
   IA retente trois fois en interne, puis l'action attrape l'échec et **renvoie
   proprement** `{ error: "…temporarily rate-limited upstream…" }`. Donc
   `convex run` sort en code 0, la boucle de retry du script — qui ne se
   déclenche que si le sous-processus plante — ne voit rien, et un run entier
   peut brûler 300 documents en ÉCHEC en quelques secondes contre une limite
   qui se lève en minutes. D'où, côté script : `RATE_LIMITED` reconnaît le
   message, `MODEL_BACKOFFS` attend 30 s → 4 min, `PACE_MS` espace les appels,
   et deux documents d'affilée qui épuisent le backoff **arrêtent le run**,
   avec le même contrat « relancer plus tard reprend où c'était » que
   `vectorize:backfillAll`. Corollaire non négociable : le cache est écrit
   **après chaque document**, jamais en fin de run — sinon un arrêt jette tout
   ce qui a déjà été payé.

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
- **Une reconnexion redistribue de NOUVEAUX ids de compte.** C'est le piège
  central : reconnecter une banque (et surtout repasser par « Connecter une
  banque » plutôt que par « Reconnecter ») crée une nouvelle connexion Powens
  dont les comptes portent de nouveaux `powensAccountId`. Résoudre par le seul
  `powensAccountId` rate donc systématiquement → l'ingestion **créait un
  second compte** pour la même banque, l'ancien restait figé sur son lien mort
  et alertait à vie. D'où `matchExistingAccount`
  (`convex/lib/powensAccounts.ts`, pure et testée) tentée AVANT toute
  création, par ordre de force du signal :
  1. **IBAN** — seul signal assez fort pour reprendre un compte **déjà lié** à
     un ancien id (même IBAN = même compte).
  2. **Même banque + même libellé** (ou `displayName`), parmi les records
     **non liés** — rattrape les comptes livrés sans IBAN (nantissement,
     titres).
  3. **Compte unique d'une banque à record unique** — la connexion ne livre
     qu'un compte pour cette banque et l'org n'a qu'un record libre.
     C'est le cas Qonto (record importé d'Airtable, sans IBAN, dont le libellé
     ne correspond jamais à celui de la banque) ; `linkQonto` a disparu au
     profit de cette règle générique.

  Les règles 2 et 3 ne volent **jamais** un record déjà lié et écartent tout
  candidat dont l'IBAN contredit le payload. Une **égalité** sur la règle 1 ou
  2 renvoie `ambiguous` → **arrêt dur** `account_match_ambiguous`, aucune
  écriture (Powens re-livrera le webhook). Un match repose le lien sur le
  record existant (`powensAccountId`, `powensConnectionId`, backfill IBAN,
  solde) — jamais de doublon.

- **La branche « déjà lié » re-tamponne `powensConnectionId`.** Un compte
  peut garder son id Powens tout en étant désormais livré par une AUTRE
  connexion. Sans ce re-tamponnage il resterait rattaché à une connexion
  morte, qui alerterait indéfiniment. Ne pas la retirer.
- **Qonto n'est jamais créé** (pas d'entrée dans `CONNECTOR_OWNER`) : son
  record vient de l'import Airtable. Aucun match = tous les records Qonto sont
  déjà liés à un autre id (re-sync redondant d'une autre connexion/user) →
  warning `qonto_already_linked` + compte **ignoré** (webhook 200, rien de
  cassé). Le premier lien reste la source de vérité.
- **Limite connue** : un record importé d'Airtable **sans IBAN et au libellé
  différent** de celui de la banque (l'ancien `PALATINE` de calte face à
  « COMPTE COURANT GG21 CALTE ») n'est PAS rapprochable quand la banque livre
  plusieurs comptes — la règle 3 ne s'applique pas. Il faut fusionner les deux
  lignes une fois à la main (`migrations/mergePalatineAccount`, cf.
  `MIGRATIONS.md`) ; l'IBAN repris à la fusion rend les reconnexions
  suivantes automatiques.
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

### Rattrapage après reconnexion (`backfillConnection`)

**Le webhook ne rattrape rien.** `CONNECTION_SYNCED` ne pousse que ce que
Powens a synchronisé à cet instant. Une connexion cassée puis reconnectée deux
semaines plus tard reprend le flux à la date de reconnexion : les mouvements
de l'intervalle ne sont **jamais** repoussés, et aucun `powensTxId` ne les
réclame. C'est ce qui a créé le trou Qonto du 02/06 au 22/07/2026 (~7 semaines,
dont 2 380 000 € de virements entrants recoupés depuis Palatine). D'où un
second chemin d'ingestion, en **pull** : `backfillConnection` (internalAction)
appelle `GET /users/me/accounts/{id}/transactions?min_date=…` avec le token
permanent de l'org.

- **Déclencheur = la transition, pas l'état.** Dans `upsertConnectionStatus`,
  la santé est calculée **avant** le patch (`previousHealth`) puis après ; le
  rattrapage est planifié seulement sur `≠ connected → connected` (ligne
  absente incluse = nouvelle connexion). Se déclencher sur l'état « sain »
  relancerait un pull à chaque webhook.
- **`ctx.scheduler.runAfter(0, …)`** et pas un appel direct : c'est une action
  (réseau), et le report post-commit garantit que les `bankAccounts` de la
  connexion sont déjà reliées quand elle s'exécute (le webhook appelle
  `upsertConnectionStatus` **avant** de résoudre les comptes).
- **Point de reprise = dernière tx détenue**, par compte (index
  `by_account_date`, `.order('desc').first()`), moins `BACKFILL_OVERLAP_MS`
  (7 j) : un mouvement peut arriver daté **avant** une transaction déjà reçue
  (règlement différé). Le recouvrement est gratuit — dédup par `powensTxId`.
- **Le point de reprise ne répare PAS un trou constaté après coup.** Il vaut au
  moment de la reconnexion : la dernière tx détenue précède encore le trou. Dès
  que des transactions fraîches sont arrivées, le point de reprise passe
  **derrière** le trou et le rattrapage l'enjambe. C'est le cas du trou Qonto,
  découvert le 29/07 alors que la reconnexion datait du 23/07 : le point de
  reprise était au 28/07. D'où l'argument **`minDate`** (`YYYY-MM-DD`, usage
  opérateur), qui force la date de départ sur tous les comptes de la connexion.
  Le cutover reste le plancher dur — un `minDate` ne peut pas remonter derrière.
- **`orgSlug` ou `orgId`, au choix** : l'appel schedulé passe l'id qu'il a déjà
  en main, l'opérateur passe `"calte"` (via `orgIdBySlug`) comme dans tous les
  autres runbooks CLI. Aucun des deux → `org_id_or_slug_required` ; les deux
  arguments sont optionnels au validateur, la garde est dans le handler.
- **Pas de plafond d'ancienneté, volontairement.** Un plafond (« 120 j max »)
  recréerait le bug : une panne plus longue perdrait silencieusement ses
  semaines les plus anciennes. Les bornes réelles sont le point de reprise, le
  cutover du compte (`computeCutoff`, plancher dur) et ce que Powens détient.
- **Compte sans aucune transaction → ignoré** (`lastTransactionAt: null`) :
  il n'y a rien d'où reprendre, son historique démarre à son propre cutover.
  Sinon une première connexion réimporterait tout le passé du compte.
- **Écriture mutualisée** : `writeAccountTransactions` est le SEUL endroit qui
  écrit une tx Powens (filtre cutover + dédup + règles apprises à l'insert) —
  webhook et rattrapage l'appellent tous les deux, ils ne peuvent pas diverger.
- **Pagination Powens = liens opaques.** `limit` est obligatoire (max 1000) et
  la suite se lit dans `_links.next.href` (URL **absolue**, à suivre telle
  quelle — pas de `offset` à reconstruire). Garde-fou `BACKFILL_MAX_PAGES`.
- **Un échec par compte n'arrête pas les autres** (try/catch dans la boucle) ;
  le message de log ne contient jamais le token, seulement le libellé du compte.
- **Ce que le rattrapage ne peut PAS faire** : récupérer ce que Powens n'a
  jamais lui-même récupéré (connexion établie sous un user Powens non géré,
  fenêtre d'historique de la banque dépassée). Dans ce cas, le seul recours
  reste l'import CSV de la banque (cf. `importMemoCsvTransactions`).

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
- **État « Obsolète » — une connexion sans compte n'est pas un incident.**
  Une connexion dégradée qui ne dessert **aucun compte actif** est un
  reliquat : tentative de connexion jamais synchronisée, ou comptes repris par
  une connexion plus récente. Elle est dégradée pour toujours et il n'y a rien
  à réparer → `maybeNotifyConnectionHealth` **n'envoie rien**,
  `listConnections` la renvoie en `health: 'obsolete'` (pastille grise, hors
  bannière) et la page Intégrations la montre `inactive` (sans bouton
  « Reconnecter »). C'est ce qui permet à l'alerte de s'éteindre seule après
  une reconnexion réussie. Le poll la ré-insère tant qu'elle existe côté
  Powens — la faire taire ne suffit donc pas à la faire disparaître, d'où le
  bouton ci-dessous.
- **Suppression définitive** : `powens.deleteConnection` (action, rôle admin)
  garde `connection_in_use` si la connexion dessert encore un compte, appelle
  `DELETE /users/me/connections/{id}` puis supprime la ligne de suivi. Un 404
  côté Powens (déjà partie) supprime quand même la ligne — le but est qu'elle
  cesse d'exister. Jamais de suppression de compte ni de transaction.
- **Anti-spam : `notifiedHealth`** mémorise le dernier état dégradé alerté
  par email ; remis à `undefined` au retour au vert. Un incident = un email,
  une aggravation (`stale` → `action_required`) = un second. Pas de cooldown
  temporel — c'est le changement d'état qui déclenche. `notifiedHealth` est
  marqué **même si personne n'a reçu l'email** (tous les membres ont coupé
  l'alerte) : c'est un état d'incident, pas un compteur d'envois — sinon le
  jour où quelqu'un se réabonne, tous les incidents passés lui tombent
  dessus.
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
  comptée dans la bannière). **Réparation opérateur** (cas Qonto) : 0. `convex run --prod powens:diagnoseOrgAccountLinks '{"orgSlug":"calte"}'`
  — vue d'ensemble (IBAN, ids Powens, nb de tx par compte, connexions et
  nombre de comptes desservis). C'est lui qui distingue un vrai second
  compte d'un doublon de reconnexion.
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
- **Pointer une sortie fait basculer un deal en term sheet vers `active`.**
  `applyMatchToDeal` (`convex/lib/pointage.ts`) patche le deal en
  `status: 'active'` quand il est `pending` **et** que la transaction est
  `direction: 'out'`. La **première** sortie suffit : un fonds est actif dès
  son premier appel de capital, bien avant que les appels couvrent
  l'engagement — un seuil « décaissé ≥ engagé » laisserait ces deals en term
  sheet à tort. La règle vit dans le cœur partagé, donc elle couvre aussi le
  pointage fait par l'agent (`agentToolsPointage.ts`). Bascule **en avant
  uniquement**, comme le chemin Attio « Invested » : aucun autre statut n'est
  touché, et `applyUnmatch` ne rétrograde pas (un deal `active` peut
  légitimement n'avoir aucune transaction — import Airtable, webhook Attio, où
  rétrograder serait une régression). Conséquence assumée : **aucun geste UI
  ne ramène un deal en `pending`** — une activation par erreur se répare en
  base (`convex run --prod`). Les deals déjà pointés avant cette règle ne sont
  pas rattrapés : dépointer/repointer la transaction les fait basculer.
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
  d'abord.** Le registre de la Vue d'ensemble Trésorerie (qui absorbe la file
  de pointage : « À pointer » = filtre `unmatched`, et fusionne les échéances
  prévisionnelles via `getUpcomingEntries`) lit `listLedger`, borné aux
  **1000 transactions les plus récentes** par filtre actif (`LEDGER_LIMIT`).
  Au-delà, la queue la plus ancienne est masquée — le browse exhaustif (capé 200) reste sur `/cash/$accountId`. Comme `listUnmatched`, le registre passe
  par l'index `search_text` en mode recherche : une ligne sans `searchText`
  (pré-`backfillSearchText`) reste invisible à la recherche. Pas de pagination
  serveur (`usePaginatedQuery` n'est utilisé que par le chat) : on garde le
  pattern `.take()` + `LocalPagination` partagé avec `PointageTable`. Le
  filtre **montant** (min/max) s'applique côté client sur ces lignes déjà
  chargées : sur une org > 1000 tx il ne « repêche » donc pas la queue
  masquée. Les lignes prévisionnelles n'ont pas de compte bancaire : un
  filtre compte actif les masque.
- **Plus AUCUNE suggestion de rapprochement — suppression délibérée (août
  2026).** Le workflow déterministe de suggestion a été retiré en entier :
  puces de la file (`getPointageSuggestions`), moteurs `lib/suggest.ts` /
  `lib/transferPairs.ts` / `lib/entryMatching.ts` /
  `lib/recurrenceDetection.ts`, carte « Rapprochements suggérés », carte
  « Règles suggérées », outil agent + MCP `suggestMatches`, et le retour
  `pendingEntry` de `matchTransaction`. Motif : le système proposait des
  rapprochements faux **silencieusement**, et son scoring cherchait deux
  inconnues à la fois (quel deal ET quelle échéance) pour une seule
  transaction — complexité multiplicative, impossible à auditer. Décision
  produit : on repart d'une base 100 % manuelle, on collecte les cas réels
  à la main, puis on reconstruit sur cette matière. **Ne pas re-câbler de
  suggestion ici sans cette étape.** `matchingDecisions` (append-only) est
  conservée intacte : c'est le dataset d'entraînement du futur moteur.

## Virements internes (`convex/transfers.ts`, `convex/lib/transfers.ts`)

Un virement interne est un mouvement entre deux comptes de la **même entité
juridique** (`bankAccounts.ownerCompanyId`), éventuellement dans deux banques
différentes. C'est le **seul** cas : un mouvement entre deux entités
différentes se pointe **vers cette entité comme un deal**, et un mouvement
entre deux orgs n'est pas non plus un virement interne.

- **Un virement est un OBJET à deux jambes, pas une étiquette par ligne.**
  C'est le point central, et c'était le bug de conception de la V1 : une
  étiquette isolée ne se contredit jamais, donc rien ne vérifiait rien. Une
  jambe taguée seule sortait de l'analyse en silence, et une vraie charge
  taguée par erreur disparaissait sans trace. La table `transfers` porte
  l'identité du virement ; les deux jambes sont les transactions qui portent
  `allocation = { kind: 'transfer', targetId }`.
- **`transfer` est le SEUL `allocation.kind` qui ne vaut pas `matched`.** Les
  deux jambes restent à `matchStatus: 'internal_transfer'` (sous-type
  d'« écarté »), donc `effectiveCategory` continue de renvoyer `null` et
  l'analyse comme la grille prévisionnelle sont **inchangées**. Ne jamais
  « normaliser » ça en `matched` : ça ferait basculer les deux jambes dans le
  bucket Deals.
- **Rien n'est stocké au-delà de l'identité.** Montant, écart entre les
  jambes (frais bancaires, virement partiel) et délai de transit sont
  **dérivés** à la lecture (`getForTransaction`) — même principe que les
  soldes de C/C. Ne pas ajouter de champ montant sur `transfers` : il
  divergerait des transactions dès la première correction bancaire.
- **L'invariant dur : même `ownerCompanyId`.** `applyPairTransfer` refuse
  deux comptes d'entités différentes (`transfer_wrong_entity`), le même compte
  des deux côtés (`transfer_same_account`) et deux jambes de même sens
  (`transfer_same_direction`). L'**égalité des montants n'est PAS imposée** :
  les frais bancaires et les virements partiels sont réels, l'écart est
  affiché, jamais absorbé.
- **Une jambe seule = un virement incomplet, et c'est voulu.** Le mode de
  panne EST la fonctionnalité : `transfers` avec une seule jambe se lit comme
  incomplet, sans champ ni flag dédié. Filtre `transferState: 'incomplete'` du
  registre + `transferIncomplete` par ligne (badge ambre).
- **Les lignes taguées AVANT la feature n'ont pas d'allocation** → elles sont
  incomplètes par construction (`isIncompleteTransferLeg`), donc visibles dans
  « Virements à apparier ». **Aucun backfill** : deviner la contrepartie d'une
  ligne historique produirait exactement les faux rapprochements silencieux
  qui ont fait supprimer le moteur de suggestion. `pairTransfer` les adopte
  au premier appariement (il ouvre la ligne `transfers` à la volée).
- **Deux moitiés fusionnent.** Taguer les deux jambes séparément (cas normal
  après un tag en masse) crée deux demi-virements ; `applyPairTransfer`
  absorbe et supprime celui de la jambe adverse. Sans ça, l'utilisateur
  tombait dans une impasse.
- **`listPairable` est un FILTRE, pas une suggestion.** Il restreint par règle
  structurelle (autres comptes de la même entité, sens opposé, jambe libre) et
  trie par date décroissante — il ne classe jamais par vraisemblance et ne
  présélectionne rien. C'est la frontière posée par `CLAUDE.md` : un sélecteur
  n'est pas une proposition tant qu'il ne trie pas par vraisemblance. **Ne pas
  y ajouter de score, de tri par montant approchant ni de présélection.**
  Plafond : `PAIRABLE_PER_ACCOUNT` (100) lignes lues par compte — une
  contrepartie plus ancienne se retrouve par la recherche.
- **Détacher passe par `unpairTransfer`, jamais par `unmatch`/`deallocate`.**
  Les deux garde-fous lèvent `allocated_to_transfer` : un dépointage naïf
  laisserait la ligne `transfers` orpheline et la jambe adverse pointant dans
  le vide. `unpairTransfer` remet la jambe en `unmatched` et supprime la ligne
  `transfers` quand elle n'a plus aucune jambe.
- **`internal_transfer` n'est plus une règle apprenable.** Retiré de
  `CategoryRuleStatus` à la **création et à l'application** (`isActiveRule`) —
  même motif qu'`ignored` : rejouer un statut « exclu de l'analyse » par
  motif de libellé fabrique un angle mort silencieux à l'échelle, et un
  libellé ne peut de toute façon pas savoir sur quel compte est la
  contrepartie. La valeur **reste dans l'union du schéma** : la retirer
  invaliderait les lignes `categoryRules` existantes à la lecture. One-shot
  `transactions:dropInternalTransferRules` pour nettoyer la table ; l'union
  pourra se resserrer dans une PR ultérieure.

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
TVA récupérable. Pas un module de déclaration.

> ⚠️ **La TVA n'a plus aucune surface front** (retirée en v1.161.0 : elle
> n'apportait rien au quotidien). Sont partis le sélecteur de taux sur les
> lignes charge/produit du registre, la carte « TVA récupérable » et la carte
> « Échéance TVA estimée », plus le miroir `src/lib/vat.ts`. Le **backend est
> intact et reste la référence** ci-dessous : champ au schéma, `setVatRate`,
> `getVatPosition`, `suggestVatEntry`/`createVatEntry`, outils agent/MCP — les
> taux déjà saisis sont conservés, l'agent sait encore répondre sur la
> position TVA, et re-brancher une UI est une PR d'affichage. **Sans rapport
> avec la TVA des deals** : la dé-TVA ÷1,2 des royalties est portée par
> l'instrument dans `convex/lib/metrics.ts`, elle ne lit jamais `vatRateBps`.

- **Les montants de transaction sont toujours TTC.** Le taux de TVA
  (`vatRateBps` : 0 / 550 / 1000 / 2000) est stocké sur la transaction ; le
  montant de TVA est **toujours dérivé, jamais stocké** :
  `vatCents = round(amount × taux / (10000 + taux))`. La dérivation vit dans
  `convex/lib/vat.ts` (testée par `tests/vat.test.ts`).
- **Invariant : `vatRateBps` n'existe que sur `charge` / `product`.** Tout
  pointage qui fait quitter ces statuts (match deal, allocation passif,
  unmatch, re-catégorisation en ignored/tax/internal_transfer) l'efface —
  enforced dans `convex/lib/pointage.ts`, ne pas contourner.
- **L'historique n'est pas backfillé, exprès.** Une charge sans taux est
  « à qualifier » (un /1,2 global serait faux : salaires, assurances, frais
  bancaires sont exonérés). Depuis le retrait du front, la qualification ne
  passe plus que par l'outil agent `categorizeTransaction` ou `setVatRate`
  appelée à la main — l'UI n'écrit plus de taux du tout (le défaut 20 % des
  catégorisations en charge est parti avec le sélecteur : écrire un taux que
  personne ne peut plus relire ni corriger serait pire que pas de taux).
- **`getVatPosition` est signée par le sens** : une charge `in` (avoir
  fournisseur) se déduit de la TVA déductible, un produit `out` de la TVA
  collectée. Les règlements/remboursements de TVA avec l'État restent en
  statut `tax` et ne sont **pas nettés** contre la position en V1 — elle
  donne la position cumulée, pas le solde restant à récupérer après
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
- **Le passif ne sait pas porter un C/C entre deux entités d'une même org.**
  `intercompanyLoans` relie deux **organisations** (`fromOrgId` / `toOrgId`) et
  `createIntercompanyLoan` rejette explicitement `same_org`. Or les entités du
  groupe (Caltimo, RDB, Relais Chapelle, les SCI, Banco 2) ne sont pas des orgs :
  ce sont des `companies` `group_*` **à l'intérieur** de l'org `calte`. Les
  avances en compte courant que CALTE leur consent — 7,8 M€, la plus grosse
  masse du portefeuille importé — ne peuvent donc pas descendre au passif, et
  restent modélisées en deals `cca` comptés comme des participations. Les porter
  au passif demande d'ouvrir la table aux `companies` (nouveau couple de champs
  + dérivation des soldes + UI), pas un simple déplacement de lignes. Constat
  posé pendant `migrations/cleanupCalteImport.ts` ; la granularité d'actifs au
  31/12/2025 (Drive) les classe bien en créances, distinctes des titres.
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
  `listEntries` et l'expansion). Le choix de la transaction est **100 %
  manuel** depuis août 2026 (cf. « Pointage transaction → deal ») : le
  dialog « Marquer réalisée » du registre (`ForecastSection.tsx`) liste les
  transactions de l'org via `transactions.listLedger` en ordre
  anti-chronologique + recherche libre — **aucun classement, aucune
  présélection**. Ne pas y réintroduire de tri par vraisemblance : c'est
  exactement le mécanisme qui a été retiré. `matchTransaction` ne lit plus
  les entries du tout.
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
  `computeCashHistoryForOrgs` / `computeForecastGridForOrg` bornent leurs
  fenêtres avec `Date.now()`, ce qui
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
  `sendWeeklyDigest` (lundi 07:00 UTC) itèrent toutes les orgs sans
  `requireOrgMember`, comme les backfills. La règle multi-tenant reste
  absolue pour toute fonction **publique**. Un cron raté se rejoue à la
  main (`convex run forecasts:captureSnapshots '{}' --prod`) — idempotent
  par (org, mois). Les snapshots sont **append-only** ; la fiabilité
  affichée compare le snapshot du mois M-1 (pris le 1er de M-1, scénario
  avec prévu) au solde réel de fin M-1 — rien ne s'affiche tant que le
  premier snapshot n'existe pas.
- **Point hebdo : la cadence EST l'anti-spam — plus aucun état de
  déduplication.** `sendWeeklyDigest` (lundi 07:00 UTC) fusionne les deux
  anciens crons quotidiens (`checkCashAlerts`, `checkOverdueEntries`) en un
  seul mail par membre, une section par org. Chaque run est une **photo**
  de ce qui cloche aujourd'hui : ni cooldown de 7 jours sur l'alerte de
  seuil, ni fenêtre « nouvellement en retard » de 24 h sur les échéances.
  Ces deux mécanismes ont été retirés, pas déplacés — les réintroduire
  ferait taire le digest la semaine suivante. Conséquences : (1) déplacer
  le cron ne change que **l'instant de la photo**, plus rien d'autre (le
  couplage fréquence ↔ fenêtre a disparu) ; (2) un run raté = un lundi
  sans mail, le stock complet repart le lundi suivant ; (3)
  `cashAlertSettings.lastNotifiedAt` est encore écrit, mais ne **barre
  plus rien** — c'est une trace du dernier franchissement signalé, et
  `setCashAlert` l'efface toujours à chaque save.
- **Une échéance n'est « en retard » qu'après un jour de grâce**
  (`OVERDUE_GRACE_MS`) : la banque synchronise en ~24 h et le
  rapprochement est un geste manuel, donc pas de rappel sur le loyer
  d'hier. C'est le seul délai qui subsiste dans le digest.
- **Compteur de reports du point hebdo : additionnable dans une org, pas
  entre orgs.** Le bloc compte les `companyReports` créés dans les 7 jours
  via l'index `by_org`, en lisant du plus récent au plus ancien et en
  s'arrêtant au seuil (seules les lignes de la semaine sont touchées). Le
  piège est le **fan-out multi-org** : une société détenue par Calte _et_
  Albo range un report dans chacune, donc un seul mail transféré compte 1
  dans les deux sections. Chaque ligne est juste dans son org ; le total du
  sujet, lui, peut dépasser le nombre de mails réellement transférés — c'est
  assumé, un sujet est une accroche, pas un registre. Ne pas « corriger »
  en dédupliquant sur `agentmailMessageId` : ça casserait la lecture
  par-org, qui est celle qui compte. Enfin, `DIGEST_WINDOW_MS` vaut une
  période de cron : déplacer le cron sans le suivre créerait un trou ou un
  recouvrement dans le comptage — c'est le seul endroit où les deux sont
  couplés.
- **Qui reçoit quoi : opt-out par personne, global, dans `userPrefs`.**
  Les cinq drapeaux `notify*` (`convex/lib/notificationPrefs.ts`) sont des
  **opt-out** — absent = abonné. D'où : aucun backfill à la création d'un
  drapeau, et un nouveau membre est abonné d'office. Ils vivent dans
  `userPrefs` et non sur la ligne `users` (cf. § « Hot `users` row »), et
  s'appliquent à **toutes** les orgs de la personne, même si l'écran de
  réglage est celui d'une org (Réglages → Membres). Corollaire à assumer :
  un admin de l'org A qui décoche une case pour quelqu'un le désabonne
  aussi côté org B. Accepté à 3 users ; à revoir si le périmètre s'élargit.
  Tout nouvel envoi d'email récurrent doit passer par `wantsAlert` /
  `readAlertPrefs` — sinon il devient le seul mail qu'on ne peut pas
  couper. Même règle pour tout **nouveau bloc du point hebdo** : il lui
  faut son propre drapeau, sinon il ré-arme le mail du lundi chez quelqu'un
  qui avait tout coupé.
- **Échéance TVA suggérée : `derivedKey` "vat:{orgId}:{YYYY-Qn}", sans
  `ruleId`.** L'idempotence passe par la clé (créée une fois par trimestre,
  quelle que soit sa vie ensuite : réalisée, annulée, éditée — la
  suggestion ne revient pas). Pas de bouton « Ignorer » en V1 : la carte
  n'apparaît que si la TVA du trimestre clos est à payer, ce qui est rare
  pour des holdings en position récupérable ; pour la faire taire sans
  créer d'échéance au prévisionnel, créer l'échéance puis l'annuler
  (`cancelled` garde la clé).
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
  onglet Cash « Gestion ») filtre `ruleId == null` : les occurrences générées
  par une règle n'y apparaissent jamais. Conséquence : une occurrence de règle
  passée en `overridden` (éditée à la main — aujourd'hui faisable uniquement
  via l'agent IA, `updateForecastEntry`) n'est visible **ni** dans cette table
  (filtre `ruleId == null`), **ni** dans la table des règles (qui liste les
  règles, pas leurs occurrences) — seulement dans la courbe/grille
  `getForecastGrid` et comme ligne prévisionnelle du registre
  (`getUpcomingEntries`, ≤ 90 j). Non corrigé délibérément : la surface
  humaine se limite aux règles récurrentes + aux ponctuelles pures ;
  l'**édition**/override d'une occurrence dérivée reste un geste agent. En
  revanche l'**annulation** est possible en front pour toute échéance
  `pending` (occurrences comprises) : action « Annuler l'échéance » des
  lignes prévisionnelles du registre (`PointageTable` → `cancelEntry`). À
  revoir si l'édition d'occurrence dérivée passe un jour en front.

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
  sur la company chapeau archivée. Rien n'empêche plus de rattacher un SPV à la
  fiche Attio du chapeau à la main (l'ancrage n'est plus unique — cf. § « Fiche
  société » point 6), mais ça reste un raccourci de lecture vers le CRM : la
  synchro continue de viser la première société de l'org portant l'ancrage.
  Leur ancre d'idempotence est
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
  `—` (em-dash entouré d'espaces). C'est garanti par le format imposé dans
  `CLAUDE.md` (`## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre`), et ça couvre aussi les
  4 entrées historiques `## Mois AAAA — …`.
- La **première** section sans `—` démarre le **footer** épinglé (en pratique
  le « Petit lexique » de bas de page, toujours en dernier).

Conséquence à connaître avant d'éditer `CHANGELOG_PRODUIT.md` :

- Un titre d'entrée **sans** `—` serait traité comme footer → toutes les
  entrées suivantes disparaîtraient de la pagination. Garder le format.
- Toute nouvelle section de bas de page (après le lexique) doit rester **sans**
  `—` pour être épinglée, ou elle sera paginée comme une entrée.

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
   un secret » **ne s'applique pas** ici. Absente → fallback icône bâtiment
   partout (aucune image cassée).
   **Depuis ALB-115 elle est aussi nécessaire côté Convex** : les mails de
   confirmation de report affichent le logo, et un template serveur ne voit pas
   l'env Vite du front. `reportNotify.logoUrl()` lit `LOGO_DEV_TOKEN` puis
   `VITE_LOGO_DEV_TOKEN` — poser l'une des deux avec
   `pnpm exec convex env set`. Ce n'est pas une migration : la valeur vit aux
   deux endroits, ce qu'une clé publishable autorise. Absente côté serveur, le
   mail affiche l'initiale de la société.

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
   Airtable, saisie manuelle). **Conséquence** : un deal qui passe _directement_
   en Invested sans jamais passer par Term Sheet ne sera **pas** créé
   automatiquement — le faire transiter par Term Sheet, ou l'ajouter à la main.

2. **Frontière d'attribution (cf. CLAUDE.md).** `pending` = pré-investissement,
   **Attio est la source** → un event Term Sheet rafraîchit les champs du deal.
   `active` (et au-delà) = post-signature, **Albo OS est la source** → l'event
   Invested se contente d'avancer le statut et de confirmer le prévisionnel ;
   il **n'écrase jamais** les montants/instrument.

3. **Statut forward-only.** Un event ne fait jamais **régresser** le cycle de
   vie (`STATUS_RANK` : `pending < active < fully_exited = written_off`). Un
   Invested ne « ressuscite » pas un deal sorti. Un instrument
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
   `attioCompanyId` (ancre réclamée seulement si libre). ⚠️ Le payload deal ne
   porte que la **référence** de la company → la synchro re-fetch la fiche
   company Attio (`fetchCompanyIdentity` : nom + premier domaine) pour créer la
   société avec son vrai nom. Si ce fetch échoue (4xx), fallback stub nommé
   d'après le deal ; un refresh Term Sheet ultérieur **répare le stub**
   (`repairStubTargetCompany` + `companyIdentityPatch`, pur/testé) — il ne
   renomme que les stubs (nom = nom du deal ou placeholder), jamais un nom
   posé par l'utilisateur, et ne remplit le domaine que s'il est vide.

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

2. **Champs d'identité sans stockage — à ne pas inventer.** **Fondateur(s)**,
   **Membres du board**, **Co-investisseurs** sont **stockés (Lot 5a), affichés
   et éditables en place** via le champ `companies.people` (cf. point 3). Une
   section vide n'affiche plus « À renseigner » mais la seule pastille
   « + Ajouter ».

3. **`people` est un champ sur `companies`, pas une table dédiée (Lot 5a).**
   Choix assumé « afficher, pas gérer activement » : `companies.people` est un
   `v.optional(v.array(...))` (cf. `convex/lib/people.ts` pour l'enum `role`
   `founder|board|coinvestor` + le validateur d'objet). Conséquences :
   - **Remplacement total** à chaque édition — `companies.update` reçoit la
     **liste complète** (pas un delta) ; `people` omis = inchangé, `[]` = vide.
     Le merge fin (ajout / renommage / retrait d'une personne) est géré côté UI
     dans `src/components/companies/PeopleEditor.tsx`, qui **préserve
     `attioRecordId`** d'une personne déjà liée au rebuild de la liste (aucune
     UI pour le saisir). Chaque ligne y porte son **index dans le tableau
     stocké** : les trois sections sont un regroupement d'affichage par rôle,
     l'ordre de `people` reste celui du stockage.
   - **`linkedin`/`email` volontairement NON stockés.** Ils sont accessibles
     via le lien Attio de la personne (la flèche ↗ de la pastille → fiche
     Attio), construit par `src/lib/attio.ts:attioPersonUrl` à partir de
     `attioRecordId` + `VITE_ATTIO_WORKSPACE_URL` (`{base}/person/{record_id}`,
     même logique que le lien company du point 4). On ne stocke que le
     `record_id` Attio, jamais de lecture live.
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

5. **Tout le panneau d'identité s'édite inline ; seuls les calculés restent en
   lecture seule.** Secteur / SIREN / domaine / résumé s'éditent **au clic** via
   `InlineField` (`src/components/ui/inline-field.tsx`) câblé sur
   `companies.update` ; les personnes via `PeopleEditor` et la fiche Attio via
   `AttioCompanyField`. Seul le **nom** passe encore par un dialog (il vit dans
   l'en-tête figé, pas dans le panneau). Les champs **calculés** — détention
   globale, nb d'actions consolidé — restent en lecture seule (`IdentityField`).
   Vider SIREN/domaine/résumé puis valider les **efface** (`''`, normalisé côté
   mutation) ; le **secteur** réutilise `SectorCombobox` (props additives
   `defaultOpen` + `onOpenChange` pour l'ouvrir/fermer en inline). Le détail du
   composant partagé : section « Édition inline des fiches ».

6. **L'ancrage `attioCompanyId` se pose à la main, et il n'est PAS unique.**
   La ligne « Fiche Attio » du panneau (`AttioCompanyField`) permet de
   rattacher une société créée à la main à sa fiche CRM : `companies.update`
   accepte `attioCompanyId` (`''` détache). Un même enregistrement Attio peut
   être porté par **plusieurs** sociétés, y compris dans des orgs différentes —
   Attio modélise une plateforme (Parallel Invest, Sezame) comme **une**
   company là où Albo OS a une entité par SPV (cf. § « Split chapeaux Attio →
   SPV »), donc l'unicité rendait ces SPV non rattachables.
   ⚠️ Le piège qui en découle : `by_attio_company_id` est un index **global**,
   et `convex/attioSync.ts:resolveOrCreateTargetCompany` **ne doit jamais** le
   lire en `.unique()` (ça throwait la synchro au premier doublon). Il
   `.collect()` puis prend la **première société de l'org** — l'ordre d'index
   étant l'ordre de création, la cible d'un deal synchronisé reste stable quel
   que soit le nombre de rattachements ajoutés après coup. Corollaire :
   l'ancrage n'arbitre plus rien, il ne fait qu'ouvrir le CRM depuis une fiche
   — pour changer la cible d'un deal, on change son `targetCompanyId`, pas
   l'ancrage. Couvert par `convex/regression.deals.test.ts`. Côté UI, l'ancrage
   ne se **saisit** jamais, il se **choisit** dans les résultats de
   `attio.searchCompanies` — un id inventé enverrait les prochains deals sur la
   mauvaise société, en silence.

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
- **Le `Select` enum doit être CONTRÔLÉ (`value`), jamais `defaultValue`.**
  Piège coûteux, corrigé après coup : `@radix-ui/react-use-controllable-state`
  (≥ 1.2) n'appelle `onValueChange` de façon **synchrone** que si la valeur est
  **contrôlée** ; en non contrôlé (`defaultValue`) il la diffère dans un
  `useEffect`. Or Radix appelle `onValueChange` **puis** `onOpenChange(false)`,
  et notre `onOpenChange` fait `setEditing(false)` → le `Select` est **démonté
  dans le même commit**, l'effet ne s'exécute jamais et le `onCommit` est
  **perdu en silence** : on choisissait « Trimestriel », la ligne se refermait,
  rien n'était écrit (aucune erreur, aucun toast). Les autres formats n'étaient
  pas touchés (ils écrivent dans `commit()`, synchrone), donc **seuls les enums
  ne s'enregistraient pas** (périodicité du coupon, remboursement, durée, tour,
  type de SAFE, type de fonds, type de bien). Règle générale, valable **partout
  dans l'app, pas seulement ici** : **tout contrôle Radix (`Select`, `Tabs`,
  `RadioGroup`, `Checkbox`…) doit être contrôlé dès que sa sélection peut
  démonter le composant** — sinon le callback n'a pas le temps de partir.
  Audit fait au moment du correctif : sur les 34 `<Select>` de `src/`, 33
  étaient déjà contrôlés (`value=`), toutes les `Checkbox` aussi, les deux
  `Tabs` non contrôlés ne déclenchent aucune écriture et restent montés, et les
  combobox (`SectorCombobox`, `CompanyCombobox`, `DealCombobox`) appellent leur
  `onChange` **elles-mêmes**, donc synchronement. Le seul autre non contrôlé
  était le sélecteur de compte bancaire de la fiche placement
  (`placements.$dealId.tsx`, « Enveloppe ») : il **fonctionnait**, mais
  uniquement parce que son démontage attend l'aller-retour de la mutation —
  passé en `value=""` pour ne pas laisser traîner le motif.

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
  déclare au **top-level** du composant, ses props ne sont _spreadées_ que
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
_pull_ integration, distinct from the _push_ AgentMail report pipeline.

### Endpoints & auth

- GraphQL at `https://api.<clientSlug>.vasco.fund/graphql/` (public sibling
  `/public/graphql/`, preprod `api.preprod.<clientSlug>…`). `<clientSlug>` = the
  VASCO client, e.g. `parallel`.
- Auth = `POST /auth/login {username,password}` → `{ token }` (JWT, short-lived,
  re-login on 401). **No machine-to-machine API key** — a login is stored per
  connection in the generic internal-only `externalConnections` table
  (platform `vasco`, `config.clientSlug` + `credentials.username/password`,
  one row per client × org), managed by the connections core
  (`convex/connections.ts` + registry `convex/lib/connectors.ts`), never
  returned to the client (same rule as `powensUsers`). The legacy
  `vascoConnections` table is declared-but-inert after the one-shot
  `migrations/externalConnections:migrateVascoConnections` (cf.
  `MIGRATIONS.md`).

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
  hint) — reactive, reading `vascoCommunicationsCache` **unioned with**
  `vascoPortfolioIssuers` (next bullet), so a held-but-silent SPV is pickable too.
- **Two issuer sources (comms + holdings), reconciled by the issuer Company id.**
  An SPV only emits its first communication around closing, so a held-but-silent
  SPV (e.g. freshly closed) used to be unlinkable — absent from a picker fed by
  communications alone. Second source: the account's **holdings**, via
  `GetAccount.portfolio.active → { issuerId, issuerName }` (`ActiveParticipation`)
  — `GET_PORTFOLIO_ISSUERS` / `pullPortfolioIssuers`, cached in
  `vascoPortfolioIssuers` (atomic replace per `(orgId, clientSlug)`, same
  discipline as the comms cache; pulled best-effort inside
  `refreshVascoCacheForOrg`, isolated so a failure never wipes/blocks the comms
  cache). **Why the ids reconcile:** `ActiveParticipation.issuerId` is the
  issuer's Company id — the same id `Communication.issuer.id` carries — so a link
  made from a holdings-only issuer stores the very id future communications will
  carry, and they surface in the Report section with nothing to redo.
  ⚠️ **Two traps, both verified in prod:** (1) `accountSecurityContracts.security`
  and `security.company` are **masked/empty for the investor persona** (like
  `GetSecurities`) — the first cut used that path and `pullPortfolioIssuers`
  returned **0** (`vasco:probePortfolioIssuers` → `portfolioCount: 0`, no error);
  the direct `portfolio.active` scalars are readable where the nested
  `Security`/`Company` objects are not. (2) `TransactionSecurity.issuerCompany`
  is a DIFFERENT type (`IssuerCompany`, `id: [ID]!`, a "public representation") —
  do NOT key on it, its id may not match the Company id. `issuerId`/`issuerName`
  come back scalar-or-single-element-list (doc renders them `[String]`) →
  normalize (`firstNonEmptyString`). Confirm live with
  `vasco:probePortfolioParticipations` (raw dump: is `portfolio.active` readable?
  does `issuerId` match a communication issuer id?) and `vasco:probePortfolioIssuers`
  (`inBothCount` = ids reconcile; `portfolioOnly` = the newly-linkable silent
  SPVs). Best-effort throughout: a field the persona can't read comes back null
  (nulled + warning, not a top-level error) → skipped.
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
- **Which entities show the communications block / how linking works.**
  `VascoCommunicationsSection` renders ONLY on entities **already linked** to
  an issuer (`vascoClientSlug` + `vascoIssuerId`) — unlinked entities carry
  zero VASCO noise in their Report tab. Linking lives in the entity page's
  menu ⋯ → « Rattacher à une intégration » (`EntityIntegrationsDialog`),
  available on EVERY `kind: 'portfolio'` entity whatever its name: it lists
  the registry platforms with `entityLink: true`, shows the org's connection
  state (via `connections.listIntegrations`), and opens the platform's picker
  (`VascoLinkDialog` → `listCachedVascoIssuers`). The historical name-based
  heuristic (`/parallel/i`, then connected-slug matching) is GONE — it made
  differently-named entities impossible to link from the UI. `group_*` legal
  entities never show the menu entry.
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
  `connections:removeConnection` when convenient.

### Communications → AI synthesis (« Cerveau », étape 2c)

The company AI synthesis (`intelligence.runAnalysis`) folds the linked issuer's
communications into its prompt context, **pulled live on each run** (nothing
new is persisted — the result still lands in `companyIntelligence`).

- **System-context read path.** `runAnalysis` is a scheduled internalAction with
  **no user identity**, so it can't use the org-member-guarded
  `fetchCommunications`. It calls `vasco.pullCommunicationsForSynthesis` (an
  internalAction) which resolves connections via `connections.listActiveForOrg`
  — an **auth-less** internalQuery keyed by orgId (sibling of
  `connections.listActiveByOrgSlug`, do **not** reuse
  `connections.authorizeAndListActive`, which guards). Best-effort: it returns
  `[]` on any VASCO failure so the
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

**Exception : les véhicules d'investissement** (`lib/pitch.ts:isVehicleEntity`).
Un SPV de plateforme porte le domaine de son **sponsor** (les 15 SPV Parallel de
Calte sont tous sur `parallel-invest.com`) alors que chacun est une **opération
distincte** — la règle ci-dessus y produit des résumés faux. Vécu (05/08/2026) :
à sa création, `PARALLEL INVEST SPV24` a hérité mot pour mot du résumé de
`SPV11` (voisin au résumé le plus long), fiche comprise « logé via le SPV
Parallel Invest SPV11 » ; et `Parallel Invest SPV 23` portait la plaquette du
site Parallel. Un véhicule est donc exclu **des trois côtés** : pas
d'enrichissement depuis le domaine (`enrich` s'arrête net), pas d'héritage du
pitch d'un voisin, pas de propagation de son propre résumé au groupe (sinon une
saisie à la main sur un SPV écrase les 14 autres). Sa description vient des
communications VASCO (`enrichFromVasco`, cf. plus haut) ou de la saisie manuelle.
Marqueurs, l'un des trois suffit : `sponsor`, `vascoIssuerId`, ou un jeton
« SPVn » dans le nom (les lignes SPV de Calte n'ont pas de `sponsor` — c'est ce
jeton qui les rattrape ; même jeton que le pont instruments,
`vasco.ts:spvNumberOf`). Rattrapage des deux fiches polluées :
`migrations/fixSpvPitches`.

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

**Limites connues** : les fichiers _attachés dans_ une page Notion ne sont
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

## Codegen Convex hors-ligne (env distant / CI)

`convex/_generated/api.d.ts` est committé et n'est régénéré que par
`npx convex dev` / `convex deploy` — qui exigent un deployment configuré.
Dans un environnement distant sans `CONVEX_DEPLOYMENT` (agent cloud, CI),
`npx convex codegen` refuse de tourner, et le fallback
`CONVEX_AGENT_MODE=anonymous npx convex dev --once` échoue si le proxy
bloque le téléchargement du binaire `convex-local-backend` depuis GitHub.

Conséquence : **créer un nouveau fichier module dans `convex/`** y casse le
typecheck (`Property 'x' does not exist on type …`), car `api.d.ts` mappe
chaque module par nom. Deux issues :

- **Ajouter l'export à un module existant** : aucune régénération nécessaire
  (le mapping est `moduleName: typeof import`, les exports sont inférés).
- **Nouveau fichier vraiment justifié** : ajouter à la main les deux lignes
  mécaniques dans `api.d.ts` (`import type * as x from "../x.js";` +
  `x: typeof x;`), à l'identique de ce que la codegen produira. C'est la
  seule exception tolérée à la règle « ne jamais éditer `_generated/` » —
  le prochain `convex dev`/`convex deploy` (le build prod regénère) valide
  et écrase par le même contenu. Le signaler dans la PR.

## Préchargement de session SSR (initialToken)

Le chargement initial passait par une cascade séquentielle côté client :
hydratation → `get-session` (Better Auth) → `convex/token` → auth du
WebSocket Convex → queries. Depuis v1.111.5, le serveur lit le cookie de
session sur la requête document et transmet le JWT Convex à la page
(pattern officiel `@convex-dev/better-auth` pour TanStack Start) :

- `src/lib/auth-server.ts` : `convexBetterAuthReactStart` partagé entre le
  proxy `/api/auth/$` et le `getAuth` server function de `__root.tsx`.
- `beforeLoad` racine : récupère le token côté serveur, le retourne dans le
  contexte, et authentifie `convexQueryClient.serverHttpClient` (utile le
  jour où des loaders préchargeront des queries Convex en SSR).
- `ConvexBetterAuthProvider` vit dans `__root.tsx` (pas dans un `Wrap` de
  `router.tsx`) : c'est le seul endroit qui peut lire `context.token` pour
  le prop `initialToken`.

Pièges si on retouche cette zone :

- **Ne pas retirer la garde `typeof window !== 'undefined'`** du
  `beforeLoad` racine. Le contexte retourné par `beforeLoad` est
  **déshydraté** par le serveur et réhydraté tel quel (`__beforeLoadContext`
  dans `@tanstack/router-core`) : au premier mount client le token est déjà
  là, sans re-exécution. Mais `beforeLoad` re-tourne à **chaque navigation
  SPA** — sans la garde, chaque navigation paierait un aller-retour serveur
  bloquant (et, derrière, un hop serveur → Convex).
- `initialToken` n'est consommé **qu'au tout premier mount** du provider
  (flag module + `useState` initial dans `@convex-dev/better-auth/react`) :
  le `token: null` renvoyé par les navigations client est sans effet.
- Le JWT (15 min) transite dans le HTML déshydraté de la réponse document —
  même classe d'exposition que le flux client normal (`authClient.convex.token()`
  le remet à JS de toute façon), réponse servie uniquement au porteur du
  cookie de session.
- Visiteur anonyme : `getToken` fait quand même un hop serveur → Convex qui
  revient vide (~100 ms sur la requête document des pages publiques).
  Optimisable via l'option `jwtCache` (cookie `albo-os.convex_jwt` déjà posé
  par le plugin) si ça devient gênant.
- `useAuthState` (`src/lib/auth-state.ts`) reste la source de vérité des
  guards — le préchargement ne fait qu'accélérer `useConvexAuth()`, il ne
  court-circuite pas la logique anti-flash.

## Tables Gmail inertes (`gmailAccounts`, `gmailOAuthStates`, `companyEmails`, `companyEmailLinks`)

La feature « emails du portfolio » (connecteur Gmail OAuth, timeline
d'emails par participation, page `/emails`) a été **entièrement retirée**
(UI + backend `convex/gmail.ts`) — décision produit : à repenser à froid
plutôt que de laisser traîner une version non satisfaisante. Le code reste
dans l'historique git si besoin de s'en inspirer.

- Les 4 tables ci-dessus restent **déclarées mais inertes** au schéma
  (même stance que la table legacy `forecasts`) : aucune purge de la
  donnée prod n'a été faite. Les retirer = purger d'abord, puis resserrer
  (widen-migrate-narrow).
- Le pipeline **reports** (AgentMail → `inboundEmails`) est indépendant et
  reste actif : seules les lignes `inboundEmails` historiques à provenance
  synthétique `gmail:<id>` (ancien pont « Extraire le report ») lisent
  encore leurs PJ depuis le storage Convex via `storageId` — chemin
  conservé dans `reportExtract.run`.
- Les emails transactionnels (magic link, invitations, alertes) n'ont
  jamais fait partie de la feature et sont intacts.

## Vectorisation documents & reports — RAG par org (`convex/vectorize.ts`)

Recherche sémantique sur le contenu des documents et des reports via le
composant `@convex-dev/rag`, exposée à l'assistant par l'outil
`searchDocuments` (`convex/agentToolsDocuments.ts` → `vectorize:searchInternal`).
Embeddings `qwen/qwen3-embedding-8b` via OpenRouter (même clé/facturation que
le chat), dimension 4096 — **le max du vector index Convex**, ne pas prendre
un modèle au-dessus. Routage **épinglé sur le provider `nebius`** (Nebius
Token Factory, NL) avec `allow_fallbacks: false` — décision souveraineté : le
texte des documents ne doit transiter que par cet hébergeur UE. Conséquence
assumée : une saturation/panne Nebius fait échouer l'indexation (retries
espacés puis email, cf. ci-dessous) et la recherche, au lieu de basculer vers
un host US ; ne ré-élargir le routage qu'en connaissance de cause.

**⚠️ Le quota Nebius est partagé, pas à nous.** On passe par la clé
OpenRouter, qui appelle Nebius avec **ses** identifiants : le plafond de
tokens du modèle est mutualisé entre tous les clients OpenRouter qui routent
vers ce provider. Un `429 "You exceeded your tokens quota"` peut donc tomber
**sans rapport avec notre volume** (vécu le 31/07/2026 : trafic mondial du
modèle ×2 en dix jours, backfill bloqué à froid). Inutile de « demander plus
de quota » chez Nebius (on n'a pas de compte) ; si ça devient chronique, la
sortie propre est une clé Nebius en direct (même DC néerlandais, quota à
nous).

**Trace & échecs — même mécanique que `ocrState`, une couche plus bas.**
Chaque soumission finit par écrire `vectorState` + `vectorDetail` sur sa
ligne (`documents` **et** `companyReports`) : `indexed`, `skipped` (verdict
normal : doc email couvert par son report, image inline, pas de texte),
`failed`, `pending` pendant la file/les retries. Jamais d'échec silencieux :

- **Au fil de l'eau** : échec transitoire → 3 tentatives espacées
  (+1 min, +5 min — `MAX_INDEX_ATTEMPTS`/`RETRY_DELAYS_MS`) ; après la
  dernière, **email aux membres de l'org** (`vectorizeFailureEmail`) et état
  `failed` avec le bouton de relance dans l'UI (`documents:reindex`, jumeau
  de `reextract` — il garde le texte extrait, seule l'entrée d'index est
  reconstruite). Un échec permanent (4xx ≠ 408/429) saute les retries.
- **`vectorDetail` nomme la couche fautive** (`convex/lib/vectorizeErrors.ts:
classifyIndexError`, testé dans `tests/vectorizeErrors.test.ts`) :
  `provider_http_<status>` (le provider a répondu une erreur — `_429` =
  quota partagé saturé), `provider_unreachable` (jamais atteint),
  `provider_bad_response` (200 inexploitable), `index_write_failed` (notre
  écriture après embedding). Le classifieur déplie `AI_RetryError.lastError`
  et les `cause` imbriquées — ne pas matcher `err.message`.
- **Le backfill est séquentiel et reprenable** : une ligne à la fois, saute
  ce qui est déjà `indexed`/`skipped` (re-run gratuit), s'arrête proprement
  au premier échec transitoire (quota) avec un résumé « STOPPED … run again
  later to resume » — relancer plus tard reprend où c'était. Pas d'email ici
  (opération manuelle, le résumé EST le feedback). Pas de cron de rattrapage
  **par choix** (un seul moteur, celui de la trace OCR) : un échec est
  visible, notifié, relançable — pas re-tenté en boucle par un second
  mécanisme.

**⚠️ La fenêtre de Nebius est de 32 000 tokens, et un dépassement remonte en
`provider_http_404`.** Le client RAG remet les chunks à l'embedder **par
paquets de 100** (`makeBatches(…, 100)`, en dur, non configurable), et
`@openrouter/ai-sdk-provider` laisse `maxEmbeddingsPerCall` à `undefined` :
`embedMany` envoyait donc les 100 chunks (~100 k caractères) dans **une seule
requête HTTP**. Soit ~27 k tokens en prose — 15 % de marge — et bien au-delà
sur du texte dense (tableaux, chiffres). Au-dessus de la fenêtre, OpenRouter
n'a plus aucun endpoint où router (`allow_fallbacks: false`, un seul provider)
et répond **404, pas le 400 `context_length_exceeded`** qu'on aurait sans
épinglage : c'est un refus de _routage_, pas une réponse du modèle. Vécu le
05/08/2026 sur un classeur de 363 k caractères, juste après que le budget
Excel soit passé de 40 k à `MAX_DOCUMENT_CHARS` (#350). Parade :
`MAX_EMBEDDINGS_PER_CALL = 16` via `wrapEmbeddingModel` — chaque requête
tombe à ~6 k tokens. Le wrapper **ne touche ni `modelId` ni `provider`**,
donc l'identité du namespace ne bouge pas et aucun backfill n'est nécessaire ;
si un jour on override l'un des deux, c'est une bascule de namespace (cf. plus
bas). Piège de diagnostic : un 404 est classé **permanent** — zéro retry — et
l'email d'échec parle quand même de « plusieurs tentatives espacées ».

**Les tableurs ne sont pas indexés** (`documentSkipReason` → `'spreadsheet'`,
via `isSpreadsheet` de `lib/fileText.ts`, xlsx/xls/xlsm/csv par extension ou
content-type). Ce n'est pas un contournement du point précédent, c'est que le
vectoriel ne marche pas sur du tabulaire : le découpage arrache les lignes à
leur en-tête, et des colonnes de chiffres n'ont pas de voisinage sémantique —
l'entrée coûte un embedding sans jamais être un hit utile. Le texte reste
extrait, stocké et lisible sur la fiche ; seule l'entrée d'index disparaît.
**Un tableur en pièce jointe d'un report reste indexé** dans l'entrée de son
report (majoritairement de la prose) — décision assumée, le pipeline reports
n'est pas touché. Si on veut un jour interroger un BP, la bonne réponse est un
outil d'agent « lis ce document » (aucun n'existe : `agentToolsDocuments.ts`
n'expose que la recherche sémantique, et `listCompanyDocuments` ne rend que
des métadonnées), pas de la vectorisation.

- **Un namespace RAG = une org** (`namespace = orgId`) : l'isolation
  multi-tenant est structurelle côté index, mais le namespace **isole sans
  autoriser** — toute surface de recherche re-vérifie l'appartenance
  (`assertMemberInternal`) avant `rag.search`, même discipline que les
  autres outils d'agent.
- **Ce qui est indexé** (du texte, jamais les octets du fichier) : les
  `documents` en `source: 'upload'` via le texte de leur blob dans
  `documentTexts`, et les `companyReports` via leur `rawContent`.
  **Aucune extraction ici** : elle appartient à `documentsExtract.ts`, qui
  schedule `vectorize:indexDocument` en fin de run (les deux chemins :
  adoption d'un texte existant et extraction fraîche) — donc une
  re-extraction (`documents:reextract`) ré-indexe d'office. Les `documents`
  issus d'email ne sont **pas** indexés individuellement : leur texte est
  déjà dans l'entrée du report (l'indexer aussi créerait des doublons de
  résultats).
- **Clés d'entrée** `doc:<documentId>` / `report:<reportId>` : ré-ajouter la
  même clé **remplace** l'entrée (ingestion idempotente, backfill re-runnable,
  re-import d'une période de report aligné sur la dedup de `storeForCompany`).
  Suppression d'un document → `removeEntry` schedulé (no-op si jamais
  indexé), depuis `documents:remove` **et** le cascade de `deals:remove` —
  tout nouveau chemin de suppression de `documents` doit faire pareil.
- **Changer de modèle d'embedding est une bascule atomique** : un namespace
  RAG est identifié par (namespace, modelId, dimension, filterNames). Changer
  `EMBEDDING_MODEL`/`EMBEDDING_DIMENSION` fait pointer recherche ET ingestion
  vers un namespace **neuf et vide** — la recherche ne tombe jamais sur des
  vecteurs de l'ancien modèle (incompatibles par construction), mais elle ne
  voit **plus rien** tant que `vectorize:backfillAll` n'a pas re-vectorisé le
  corpus. Séquence : changer la constante → deploy → backfill immédiat.
  Le modèle est épinglé (pas d'alias `latest`) pour qu'aucune release
  upstream ne déclenche cette bascule silencieusement.
- Le cron/les webhooks n'interviennent pas : l'ingestion au fil de l'eau est
  schedulée en fin d'extraction (`documentsExtract.run`) et de pipeline
  report (`reportStore:storeForCompany`), jamais bloquante pour l'upload ni
  le pipeline. Le backfill envoie d'abord à l'extraction les documents
  uploadés **jamais lus** (sans `ocrState`) — l'indexation suit toute seule.

## `inboundEmails` contient des lignes qui ne sont PAS des emails

Le dépôt manuel d'un report depuis la fiche société
(`reportInbox.createFromUpload`) réutilise tout le pipeline d'ingestion :
il insère une ligne `inboundEmails` avec `origin: 'upload'`, la
participation déjà matchée, et enchaîne directement sur
`reportExtract.run`. C'est ce qui évite de dupliquer les briques 4 et 5
(routeur de contenu, fiche + métriques, fan-out, `kpiSnapshots`,
synthèse) pour un second point d'entrée.

Le prix à payer : **les champs AgentMail de ces lignes sont des
placeholders** (`agentmailInboxId: 'manual-upload'`,
`agentmailMessageId: 'upload:<storageId>'`). Tout code qui les passe à
l'API AgentMail échoue — c'est la raison de la sortie anticipée en tête de
`reportNotify.send` (`if (row.origin === 'upload') return`). Un nouveau
chemin sortant (relance, notification, réponse) doit refaire ce test ; se
fier au fait que `senderUserId` est rempli ne suffit pas, il l'est aussi
pour un upload.

Corollaire côté lecture : `origin` est **optionnel** (absent = email, les
lignes d'avant la fonctionnalité n'ont rien). Tester `=== 'upload'`, jamais
`!== 'email'`.

## Un domaine n'identifie une participation que s'il n'en porte qu'une

Le rattachement d'un report croise deux preuves : le domaine de l'auteur et
le nom de la société écrit dans le mail. Le piège (ALB-110) : un **sponsor**
héberge tous ses véhicules sur un seul domaine — `hellosezame.com` porte
Sezame Immo 1/2/6, `parallel-invest.com` une vingtaine de SPV, idem
`anaxago.com`, `rewatt.fr`, `wearevirgil.com`, `laviedequartier.fr`… Le
domaine prouve alors **qui écrit**, jamais **de quel véhicule il parle**.

La règle est portée par une seule notion, `identityKey`
(`convex/lib/emailIdentify.ts`) : **le domaine identifie quand il ne porte
qu'une participation, sinon c'est le nom normalisé**. `sharedDomains`
calcule la liste des domaines disqualifiés sur l'ensemble des candidats
(toutes orgs confondues). Trois conséquences, toutes dans le même fichier :

- **Corroboration** (`resolveOnSharedDomains`) : sur un domaine partagé, les
  candidats corroborés **par le nom** l'emportent ; si aucun ne l'est, la
  sélection est remplacée par **tout le domaine** — ce qui produit ≥ 2 clés
  d'identité, donc `ambiguous`, donc la file `/app/all/reports`. Le but est
  qu'un pick LLM corroboré par le seul domaine ne soit **jamais** entériné :
  c'est exactement comme ça qu'un report Sezame atterrissait sur le mauvais
  véhicule.
- **Ambiguïté et fan-out** (`reportIdentify.run`) : les deux se calculent sur
  `identityKey`, plus sur `domain ?? name`. Le fan-out multi-org continue de
  marcher — deux entités d'une même boîte partagent leur clé (domaine propre,
  ou nom identique quand le domaine est celui d'un sponsor).
- **Rattachement manuel** (`reportInbox.sameParticipation`, utilisé par
  `assignCompany` et `createFromUpload`) : même helper, sinon choisir Sezame
  Immo 6 à la main ré-arrosait Immo 2.

**Ne pas confondre avec `isVehicleEntity`** (`convex/lib/pitch.ts`), qui règle
le problème voisin du _pitch_ : là, la question est « cette entité mérite-t-elle
sa propre description ? » et se tranche entité par entité (sponsor renseigné,
lien VASCO, jeton « SPVn »). Ici la question est « ce domaine désigne-t-il une
participation ? » et ne se tranche qu'en regardant **les voisins** : un domaine
sans doublon reste un identifiant parfaitement bon, et `laviedequartier.fr` —
qui ne porte aucun de ces trois marqueurs — doit quand même être disqualifié.
Deux questions, deux prédicats.

Deux limites assumées :

- Le seul discriminant accepté est le **nom** de l'entité, écrit en entier
  (`nameAppearsInText`, mot entier, recherche de sous-chaîne). Un mail qui ne
  dit que « SPV 6 » n'accroche pas → file d'attente. Choix délibéré : pas de
  faux rattachement silencieux, au prix de lignes à traiter à la main.
  Deux tolérances, et deux seulement (`matchableName`) : un groupe entre
  **parenthèses en fin de nom** est retiré — c'est notre annotation
  (« (Fund n°2) », « (ex:YEASTY) »), jamais un mot que le sponsor écrit — et
  les espaces multiples sont réduits des deux côtés. D'où la **règle de
  nommage** : la fiche porte le libellé que le sponsor écrit lui-même
  (« Batch Ventures 2025 »), l'annotation maison va en fin de nom entre
  parenthèses. `identityKey` garde le nom **complet** : deux entités qui ne
  diffèrent que par leur annotation restent deux participations, et un mail
  qui nommerait les deux part en revue au lieu d'atterrir sur l'une. Une
  seule collision dans le portefeuille au 26/08/2026 — les trois fiches
  `Banco (…)`, sans domaine, qui n'accrochaient déjà rien.
- Deux entités d'une **même boîte** nommées différemment sur un domaine de
  sponsor ne fanent plus ensemble (`Oprtrs & Co` côté Albo vs `OPRTRS CLUB`
  côté Calte ; `Parallel Invest SPV 13 (Bernay)` vs `Parallel Invest SPV13`).
  Aligner les noms règle le cas, mais ce n'est pas toujours souhaitable — une
  org a le droit de nommer ses lignes comme elle veut. D'où le geste manuel
  assisté ci-dessous.

### Le fonds peut être la participation, pas seulement l'expéditeur

Un fonds qui transmet le reporting d'une de ses boîtes (`is_fund_forward`)
se lit de deux façons, et le prompt s'était figé sur une seule : « la
participation cherchée est la CIBLE du report ». Vrai pour un véhicule de
side (Asterion, SIDE) où c'est bien la boîte qu'on détient ; faux pour un
fonds dont on est LP — Batch Ventures écrivant « ZeroEntropy acquired by
Notion », où ZeroEntropy n'est nulle part au portefeuille et le
fonds si. Le prompt tranche désormais sur la liste des candidats, les deux
lectures étant exclusives : la cible si elle y figure, sinon le fonds.

Corollaire sur la corroboration : sur un transfert de fonds, le domaine de
l'auteur est celui du **fonds** — il ne peut donc corroborer qu'un pick qui
EST le fonds, jamais la boîte dont le report parle. On ne le neutralise
plus (il l'était, ce qui rendait le cas LP structurellement inaccessible).
Et la protection tient toute seule quand le fonds a plusieurs millésimes
sur son domaine : `batch.ventures` en porte quatre, c'est donc un domaine
partagé, et le nom du véhicule reste obligatoire.

### Le domaine ne décide pas, mais il suggère

Corollaire produit de la règle ci-dessus : ce que le domaine ne peut pas
trancher, l'utilisateur le tranche — mais il faut le lui **proposer**, sinon
il ne saura jamais qu'une fiche jumelle existe ailleurs.

- `assignCompany` prend **1..n** sociétés et devient **additif** sur une ligne
  `processed` (union avec `matchedCompanies`, jamais remplacement) : c'est la
  seule façon de servir une boîte détenue par les deux orgs sous deux noms.
  Rejouer `reportStore.run` est sûr — il upsert par (société, période), donc
  les entités déjà servies sont mises à jour en place. `notifiedAt` est
  **conservé** dans ce cas : pas de second accusé au transféreur.
- `list` renvoie `relatedOrgNames` : les orgs qui n'ont **rien** reçu du
  report alors qu'elles portent une société sur un des domaines rattachés.
  Nommer l'**org** et non compter les entités est délibéré — sur
  `parallel-invest.com`, l'autre org en héberge une quinzaine sans rapport, et
  un « +15 » permanent ne voudrait rien dire. Un report déjà rangé des deux
  côtés n'affiche donc rien.
- Le tri du bloc de suggestion (`nameProximity`, Dice sur bigrammes, front)
  **ne décide de rien**. La proximité de nom est un mauvais juge ici, et c'est
  mesuré : les seules paires de noms proches entre orgs sont
  `Sezame Immo 2/6` ↔ `SEZAME IMMO 4` (0,92) — soit exactement les mauvaises
  réponses. Elle sert à faire remonter le bon candidat dans une liste, rien de
  plus. Ne jamais la promouvoir en critère de rattachement.
- Une fiche **sans domaine** ne peut rien suggérer (82 des 275 fiches Calte au
  05/08/2026) : seul le sélecteur principal les atteint.

## Reports par email : canal, contenu, audience — trois axes, pas un

Le routage des récaps (`convex/lib/reportRouting.ts:routeRecap`, appliqué
par `reportNotify.send`) croise **trois axes indépendants**. Les confondre
est l'erreur naturelle, et c'est ce qui casse la promesse faite au
transféreur :

- **Le canal** dépend du geste : un membre qui a transféré reçoit la
  réponse **dans son propre fil** ; tous les autres reçoivent un **mail
  neuf**.
- **Le contenu** dépend du rôle : qui gère la file (abonné `reportIssues`)
  reçoit en plus le **bloc contrôle qualité** (sources lues, KPIs cibles,
  valeurs inhabituelles) et la cause exacte quand ça coince ; qui ne fait
  que transférer reçoit la même confirmation **sans ce bloc**, et un avis
  d'échec **sans cause, sans lien, sans détail technique**.
- **L'audience** dépend de l'événement : un report qui se range pour la
  **première fois** est une nouvelle pour l'organisation, donc les autres
  membres sont prévenus (`broadcast`). Un doublon, un retraitement ou un
  échec n'en est pas une : personne d'autre n'entend parler.

### Ce qui a changé en août 2026, et pourquoi

Jusqu'à ALB-115, le transféreur non-gestionnaire recevait un accusé
**identique au caractère près, succès comme échec** (`reportReceiptHtml()`,
sans argument). L'intention était bonne — ne pas faire lire un diagnostic à
qui ne le traitera pas — mais le prix était trop élevé : quand ça coinçait,
il lisait « bien reçu, ça suit son cours » pendant que rien ne se rangeait.
Un accusé qui ment n'est pas de la discrétion.

Le partage est désormais : **le verdict oui, le diagnostic non.** Il sait
si c'est passé ou pas ; il ne sait ni pourquoi, ni où, ni quoi faire.

### Les pièges à ne pas redécouvrir

- **L'avis d'échec ne nomme jamais la société.** Dans une bonne moitié des
  cas, l'échec EST le circuit qui n'a pas su l'identifier. Il ne porte que
  l'objet du mail transféré et sa date.
- **« L'équipe Albo OS a été prévenue » n'est vrai que par construction.**
  `organizations.setMemberAlertPref` refuse de décocher le **dernier**
  abonné à `reportIssues` (`ConvexError('last_report_recipient')`, helper
  `lib/reportRecipients.ts`). Retirer ce garde-fou remet la phrase en
  situation de mentir — et fait disparaître les échecs sans témoin. C'est
  le remplacement de la limite assumée d'avant, qui laissait la liste se
  vider.
- **La diffusion à l'org est débrayable, l'accusé du transféreur non.**
  `reportAdded` est une notification qui arrive sans qu'on l'ait demandée,
  donc opt-out (Réglages → Membres). La réponse au transféreur répond à son
  geste : elle n'a pas d'interrupteur, et ne doit pas en gagner un.
- **Un doublon ne diffuse pas.** `reportStore.storeForCompany` remonte
  `created`; une fan-out où **rien** n'a été créé bascule en
  `kind: 'duplicate'`. Rebrancher la diffusion dessus renverrait un « nouveau
  report » à toute l'équipe pour un report qu'elle a déjà lu — le retour
  exact du bug ALB-145, par une autre porte.
- **« Rafraîchi », pas « ignoré ».** Rien ne distingue un second transfert
  du même mail d'une **version corrigée** de la même période : les deux
  mettent à jour le report rangé. Le texte du doublon reste donc vrai dans
  les deux cas. Comparer les contenus pour trancher serait fragile et
  inexplicable en cas d'erreur.
- **Un nouveau membre est abonné d'office** (opt-out). Ajouter quelqu'un
  qui ne doit voir que ses accusés demande de décocher « Problèmes de
  reports » sur sa ligne, Réglages → Membres.

Le garde-fou anti-énumération reste par-dessus tout ça : **jamais** de
réponse à un expéditeur non membre, quoi qu'il arrive — et jamais de
diffusion non plus, puisque rien n'a été rangé.

## Le chiffre de la fiche dans un mail : le versé, jamais l'engagé

La ligne de fiche du mail de confirmation affiche le **Versé** — la somme des
sorties bancaires rapprochées sur les deals de la société
(`deals.transactionTotals`, la définition de l'app) — et **pas**
`committedAmount`.

La raison est dans la donnée : **275 des 280 deals de CALTE n'ont pas de
`committedAmount`**. Le champ n'est renseigné que côté Albo. Une ligne calée
dessus restait donc vide sur la quasi-totalité des reports Calte — c'est le
premier report réel qui l'a montré, pas un test.

Trois conséquences à ne pas défaire :

- **Le montant est affiché au centime.** Un versé vient d'un mouvement
  bancaire, donc « l'actuel au centime, l'estimé arrondi » (CLAUDE.md)
  s'applique : `EUR_CENTS_FMT`, pas `EUR_FMT`. Un engagement, lui, aurait été
  arrondi à l'euro — ce n'en est pas un.
- **Les entrées ne sont jamais nettées.** `transactionTotals` sépare
  Versé (sorties) et Reçu (entrées) ; une distribution qui revient ne réduit
  pas le versé. Netter donnerait un chiffre qui ne correspond à aucune colonne
  de l'app.
- **Zéro n'est pas affiché.** Un deal signé mais non financé fait disparaître
  la ligne plutôt qu'annoncer « Versé : 0 € », qui se lirait comme une
  anomalie alors que c'est un état normal (`paid > 0 ? paid : undefined`).

## Le mail de confirmation attend l'analyse, et ne l'attend pas indéfiniment

La confirmation porte la carte « où en est la boîte », qui vient de
`companyIntelligence.aiAnalysis`. Or cette analyse est **relancée par
l'arrivée du report** : à la seconde où le rangement se termine, la dernière
analyse *terminée* est celle du report **précédent**. Envoyer le mail à ce
moment-là, c'est annoncer le report de juillet en décrivant la boîte en juin.

D'où `intelligence.runAnalysisBatch` : `reportStore` ne planifie plus l'envoi
lui-même, il planifie le batch d'analyses **qui déclenche l'envoi à la fin**.
Le mail arrive quelques dizaines de secondes plus tard et dit vrai.

Deux propriétés à ne pas casser :

- **Une analyse en échec ne retient pas le mail.** `runAnalysis` avale ses
  propres erreurs, donc le batch va au bout dans tous les cas et la
  confirmation part **sans la carte de synthèse** plutôt que jamais. Ajouter
  un `throw` dans `runAnalysis` supprimerait silencieusement des accusés.
- **Un seul batch pour toute la fan-out.** Relancer `runAnalysis` par entité
  en fire-and-forget *et* planifier l'envoi à côté, c'est la course qu'on
  vient d'enlever : le premier terminé enverrait le mail avec les analyses
  des autres encore en vol.

## Logo d'entité dans un email : hotlink logo.dev, repli sur l'initiale

`reportNotify.logoUrl()` construit la même URL que `CompanyLogo.tsx` côté
front, mais lit `LOGO_DEV_TOKEN` (ou `VITE_LOGO_DEV_TOKEN`) **dans
l'environnement Convex** — la variable `VITE_` du front n'existe pas côté
serveur. Sans token ou sans domaine, la fonction rend `null` et le template
affiche l'initiale de la société : une variable manquante coûte une lettre,
jamais une image cassée.

Deux contraintes de client mail assumées dans `emailTemplates.ts` :

- **Pas de SVG.** L'anneau de score de la fiche (`ScoreRing`) est un cercle
  SVG ; Gmail le supprime des mails reçus. Le mail affiche un carré arrondi
  bordé de la couleur du verdict, avec le chiffre dedans. Les seuils
  (`≥7` vert, `5-6` ambre, `≤4` rouge) sont dupliqués dans
  `emailTemplates.scoreColor` : bouger `src/lib/reportScore.ts` sans bouger
  l'autre fait lire « En bonne voie » en ambre dans le mail.
- **Pas de variables CSS ni d'oklch.** Les tokens de marque sont convertis
  en hex en dur : `--positive` → `#009966`, `--destructive` → `#e7000b`,
  `--warning` → `#d27c1b`.

## `notifiedAt` est un droit de parole, pas un compteur d'envois (ALB-145)

`inboundEmails.notifiedAt` est la **seule** barrière anti-doublon des récaps,
et elle est posée **par ligne**. Deux mutations la remettaient à zéro —
`reportInbox.reprocess` (« Retraiter ») et `assignCompany` sur une ligne pas
encore traitée (« Rattacher ») — ce qui paraît logique : on rejoue le
pipeline, donc on ré-arme la notification. C'est le bug. Chaque clic renvoyait
un accusé au transféreur, sans plafond : quatre accusés sur un seul transfert
Corma (17→21/08/2026), trois en deux minutes sur un mail Sant Roch, et ~40
mails pour une série de lignes retraitées en lot.

La règle est une règle **produit**, pas une optimisation : **un transfert, une
réponse**. La boîte du transféreur n'est pas un journal de bord ; ce qui se
passe ensuite dans la file est notre travail, pas le sien.

D'où la mécanique actuelle (`reportNotify.claimNotify`) :

- La claim n'est **jamais** relâchée. `reprocess` et `assignCompany` ne
  touchent plus à `notifiedAt` — le pipeline se rejoue en silence, le statut
  de la ligne dans la file EST le retour utilisateur.
- `notifiedKind` mémorise **ce que le dernier mail a annoncé**. Une ligne dont
  le dernier mot était un problème (`failure` / `quarantine`) a droit à **un**
  mail de plus, et uniquement pour dire que c'est passé (`success`). C'est le
  seul cas où une relance parle.
- Un second problème après un premier est **muet**. Le tenter serait la
  régression naturelle (« il faut bien le prévenir que ça coince encore ») :
  non — la file l'affiche, et c'est exactement ce qui produisait le spam.
- Une ligne notifiée **avant** l'existence de `notifiedKind` porte un
  `notifiedAt` sans genre : traitée comme définitive. Un report ancien réparé
  à la main n'enverra donc rien. Biais assumé vers le silence — le bug corrigé
  était un excès de mails, pas un manque.

Piège symétrique à ne pas réintroduire : **ré-armer la claim ailleurs**. Toute
nouvelle action de la file qui « repart de zéro » doit laisser `notifiedAt` en
place ; si elle a besoin d'un mail, il passe par `claimNotify` avec son `kind`
et se fait arbitrer là, jamais par un reset. Épinglé par
`convex/regression.reportNotifyReplay.test.ts` (8 cas), vérifié rouge contre
l'ancien code.

## `companyReports.metrics` — des nombres nus, unité stockée ailleurs

`companyReports.metrics` est un `Record<string, number>` : `{ revenue:
8600000, ebitda_margin_pct: 1100, headcount: 23 }`. **L'unité de chaque
clé ne vit pas dans la donnée** mais dans `METRIC_CATALOG`
(`convex/lib/metricCatalog.ts`) : `eur` → centimes, `percent` → points de
base, `count` et `months` bruts. Un lecteur qui affiche la valeur telle
quelle annonce 8,6 M€ là où le report disait 86 k€ — erreur d'un facteur
100, silencieuse, et d'autant plus traître que les clés cohabitent dans le
même dictionnaire (le `1100` d'à côté, lui, est bien 11 %).

Le front s'en tire en affichant la valeur brute en `font-mono` sans
prétendre à une unité (`CompanyReportsSection.tsx`) — c'est un choix
d'affichage, pas une solution.

**Règle** : tout nouveau consommateur de `metrics` joint l'unité via
`storageUnitFor(key)` avant de formater ou de raisonner. C'est ce que fait
`describeMetrics` dans `convex/companyReports.ts:getInternal`, qui sert
aux outils IA/MCP un tableau `{ key, value, unit }` plutôt que la map nue —
sans quoi le modèle invente l'unité (et se trompe).

Corollaire : `metrics` ne contient **que** des clés du catalogue. Tout ce
que le LLM d'extraction a vu sans savoir le rattacher reste dans
`rawMetrics` (snapshot d'audit, non servi aux outils). Une métrique absente
n'est pas un zéro.

## Outils reports vs `searchDocuments` — deux portes, deux usages

Depuis la vectorisation (§ ci-dessus), deux familles d'outils lisent la
matière des reportings, et le modèle doit choisir la bonne :

- `listCompanyReports` / `getCompanyReport` (`convex/agentToolsReports.ts`)
  servent le **structuré** d'un report identifié : headline, points clés,
  métriques canoniques avec leur unité. Déterministe, scopé à une société,
  c'est la source pour un chiffre ou un résumé de période.
- `searchDocuments` (`convex/agentToolsDocuments.ts`) sert des **extraits
  par le sens** sur tout le corpus de l'org. C'est la source pour « qu'est-ce
  qui est dit sur X », jamais pour un chiffre exact.

`getCompanyReport` ne renvoie **volontairement pas** `rawContent`
(jusqu'à 150k caractères) : le texte intégral est déjà indexé et se lit par
`searchDocuments`. Ne pas rajouter ce champ « pour dépanner » — ce serait
dupliquer le corpus dans la fenêtre de contexte.

## Miroir Linear de `docs/produit/` — pourquoi la sync suit le `git diff`

`scripts/sync-linear-docs.mjs` pousse une page **parce qu'elle a changé dans
le commit**, jamais parce que son contenu diffère de ce que Linear stocke. La
distinction est contre-intuitive et coûte une demi-journée à qui essaie
« d'optimiser » en comparant les contenus.

Linear **normalise le markdown à l'écriture**. On envoie `- item`, on relit
`* item` ; on envoie `| --- |`, on relit `| -- |`. Le contenu stocké n'est
donc jamais égal à ce qu'on a envoyé, même juste après l'avoir envoyé. Un
`if (stored !== desired) update()` renverrait les 18 pages à chaque exécution
— ce qui bouscule `updatedAt` sur tout le dossier et détruit précisément le
signal qui sert à repérer une dérive (c'est en lisant les `updatedAt` qu'on a
vu que le miroir avait 12 jours de retard).

Deux conséquences à ne pas défaire :

- pas de « skip if unchanged » basé sur le contenu (il faudrait réimplémenter
  le normaliseur de Linear, qui n'est pas documenté et peut bouger) ;
- une retouche faite **directement dans Linear** n'est pas détectée et sera
  écrasée au prochain merge touchant la page. C'est voulu : le repo fait foi.
  `workflow_dispatch` (ou `pnpm sync:linear-docs --all`) force un réalignement
  complet quand un run a échoué.

La map `DOCS` du script est volontairement vérifiée dans les deux sens à
chaque run : une page sans document Linear, ou un document sans page,
sort en exit 2. Une page ajoutée sans son entrée ne partirait jamais dans
Linear — un échec silencieux exactement de la nature de celui que ce
script corrige.

## Positions Powens Wealth (« Contenu de l'enveloppe » des placements)

Les positions des comptes d'investissement (titres d'un CTO, supports d'un
contrat de capitalisation) viennent du produit Powens **Wealth & Loans** —
un produit **distinct** de l'agrégation bancaire déjà branchée, qui doit
être **activé par l'Account Manager Powens sur le domaine** (pas un flag
self-service). Tant qu'il ne l'est pas, `GET /users/me/investments` répond
403/404 : le code le traite comme un état normal (`ConvexError
'powens_wealth_unavailable'` sur le refresh manuel, cron silencieux), et la
fiche placement affiche simplement « aucune position ». Si l'enveloppe
reste vide alors qu'un compte est bien lié : vérifier l'activation du
produit AVANT de déboguer le code.

Décisions de design à connaître avant de toucher `convex/investments.ts` :

- **Remplacement en bloc par compte** : chaque sync efface puis réinsère les
  lignes `investmentPositions` du compte présent dans le payload — pas
  d'upsert ligne à ligne, pas de contrainte d'unicité à maintenir. Un compte
  absent du payload garde ses dernières positions (photo du dernier sync).
- **Résolution par `powensAccountId`** : un investissement est rattaché via
  `id_account` → `bankAccounts.by_powens_account`, scopé org. Les comptes
  non résolus sont comptés (`skipped`) et ignorés — même famille de pièges
  que « Ingestion Powens » ci-dessus (une reconnexion change les ids).
- **Lien deal ↔ compte explicite** : `deals.bankAccountId` (optionnel,
  posé depuis la fiche placement). Pas de rattachement heuristique par
  transactions — un compte peut porter plusieurs deals et vice-versa.
- Montants stockés en **cents** (arrondi de floats EUR Powens),
  `quantity` reste un float (nombre de parts).

## Budget de texte : un cap global mange les onglets suivants (`convex/lib/excel.ts`)

Un classeur Excel est dumpé onglet par onglet, et la boucle a **toujours**
parcouru `wb.SheetNames` en entier. Pourtant, jusqu'à ALB-114, un classeur
multi-onglets ne rendait que son premier onglet. Le piège n'est pas dans la
boucle, il est **après** : le plafond de taille était appliqué au texte
concaténé (`text.slice(0, MAX_CHARS)`), avec un `MAX_CHARS` de 40 000. Un
onglet de P&L dense (600 lignes × 15 colonnes ≈ 90k caractères) consommait
donc tout le budget à lui seul, et la coupe tombait avant que les onglets
suivants soient écrits. Symptôme côté produit : « l'OCR ne prend que le
premier onglet » — alors qu'ils avaient tous été lus, puis jetés.

**La règle à retenir** : un budget de caractères réparti _après_
concaténation n'est pas un plafond, c'est un ordre de priorité déguisé — le
premier élément sert, les suivants disparaissent. Dès qu'une sortie agrège
plusieurs sources (onglets, pièces jointes, sections), le budget doit être
**alloué avant** le rendu, source par source.

Ce que fait le code aujourd'hui :

- Budget = celui du document (`MAX_DOCUMENT_CHARS`), plus de constante locale
  — un second plafond 22× plus bas que le vrai n'avait aucune justification.
- Répartition **max-min fair** (`fairShares`) : chaque onglet reçoit une part
  égale, ceux qui en utilisent moins libèrent le reste pour les gros. Un
  classeur « un énorme onglet + cinq petits » dépense donc presque tout sur le
  gros, au lieu de le brider à budget/6.
- En-tête et marqueur de coupe **payés d'avance** (`MARKER_RESERVE`) : un
  onglet non vide apparaît toujours, avec son nombre de lignes **réel** (pas
  le nombre rendu). C'est ce qui rend le problème visible si jamais il revient.
- Plus de `MAX_ROWS_PER_SHEET` : la coupe est pilotée par le budget, jamais
  par un nombre de lignes arbitraire (un export de transactions ou un FEC
  dépasse 300 lignes sans être anormal).
- Toute coupe est écrite dans le texte (`[...N lignes tronquées]`), en plus du
  flag `truncated` de la ligne `documentTexts` que l'UI affiche déjà.

⚠️ `csvToText` partageait ces constantes et coupait donc à 300 lignes : il est
passé sur le même mécanisme. Ne pas réintroduire de plafond local ici.

## Trois plafonds de texte, trois raisons différentes — ne pas les confondre

Le pipeline empile trois bornes qui portent des noms proches et qu'on est
tenté d'aligner. Elles ne se négocient pas de la même façon :

| Constante                                  | Valeur | Ce qui la contraint                                                   |
| ------------------------------------------ | ------ | --------------------------------------------------------------------- |
| `MAX_DOCUMENT_CHARS` (`lib/fileText.ts`)   | 900k   | **Convex** : 1 Mo par document, tous champs confondus. Non négociable |
| `MAX_EXTRACTED_CHARS` (`reportExtract.ts`) | 300k   | **Le modèle** : ce texte part entier dans `callModel`                 |
| `BODY_SNAPSHOT_MAX` (`reportInbox.ts`)     | 100k   | Corps d'email brut, partage la ligne avec `rawContent`                |

Deux erreurs classiques :

1. **Croire que 900k est un réglage de confort.** C'est la limite dure de la
   plateforme, et le dépassement ne tronque pas : l'écriture **échoue**. Le
   document part en `ocrState: 'failed'` et on n'a plus rien du tout au lieu
   d'avoir beaucoup. `boundText()` est un pare-chocs, pas une restriction.
2. **Monter `MAX_EXTRACTED_CHARS` jusqu'à 900k** « puisque la ligne Convex
   tient ». Ce n'est pas Convex qui borne ici mais la **fenêtre de contexte**
   du modèle, elle-même pilotée par `OPENROUTER_MODEL` (`lib/instructions.ts`)
   — donc modifiable sans toucher au code. À ~3,7 caractères par token en
   français, 300k ≈ 80k tokens : confortable sous les 128k qui sont le
   dénominateur commun des modèles susceptibles d'être configurés. Au-delà,
   l'appel ne tronque pas, il **plante**, et le report part en `needs_review`.
   Toute hausse se raisonne contre cette fenêtre, jamais contre la taille de
   la ligne Convex (qui, elle, a de la marge : ~420 Ko sur 1 Mo).

## Database I/O : un gros champ texte sur une ligne lue en liste

Convex facture les **octets** lus (compteur « Database I/O »), et lire une
ligne veut dire lire la ligne **entière** — il n'existe pas de projection
côté serveur. Le `.map()` qui ne renvoie que trois champs au client réduit
l'egress, jamais l'I/O : la ligne complète a déjà été lue et facturée.

Conséquence : **un champ texte volumineux transforme toute requête de liste
sur sa table en pompe à octets.** Le cas vécu (5 août 2026) : la détection
des participations silencieuses scannait `companyReports` par org pour en
extraire deux dates par société. Chaque ligne traînant `rawContent` (jusqu'à
300k caractères) et `cleanedHtml` (100k), la requête de la liste des
participations — la page d'accueil de l'outil, souscrite en réactif — lisait
~15 Mo à chaque exécution. 600 Mo en une journée, sur un quota mensuel d'1 Go.

Le réflexe qui ne marche pas : « lire moins souvent » (cron, cache, TTL). Ça
ajoute du code, une table, une invalidation, et ça rend la donnée fausse
entre deux passages.

Les deux vrais remèdes, dans cet ordre :

1. **Dénormaliser l'agrégat sur une ligne déjà lue.** Si la requête n'a
   besoin que de N nombres par entité, les écrire sur l'entité au moment de
   l'ingestion. C'est ce que font `companies.lastReportAt` /
   `lastReportCoverageAt` (helper `recordReportOnCompany`,
   `lib/reportFreshness.ts`) : la liste lit déjà les `companies`, donc le
   scan disparaît pour un coût de lecture **nul**, et la valeur reste exacte.
   Praticable uniquement si la table source a **peu de sites de mutation**, et
   il faut les couvrir **tous** — création _et_ suppression. Le piège vécu :
   l'agrégat écrit en monotone (max) ne sait pas reculer, donc
   `reportInbox.detachCompany`, qui supprime une ligne `companyReports`,
   laissait la société plus fraîche qu'elle ne l'est — silencieusement
   dispensée d'alerte pour toujours. D'où `recomputeReportFreshness`, qui
   reconstruit depuis ce qui reste, appelé sur ce seul geste (rare, humain,
   jamais sur un chemin de lecture). Prévoir aussi la migration de
   reconstruction (`migrations/backfillReportFreshness`), à la fois pour le
   rattrapage et comme outil de réparation en cas de dérive.

   Le réflexe à garder : avant de dénormaliser, `grep` les
   `insert`/`patch`/`delete` de la table source et vérifier que chacun met
   l'agrégat à jour. Un chemin oublié ne casse rien tout de suite — il produit
   une donnée fausse des semaines plus tard.

2. **Sortir le texte dans une table annexe**, une ligne par blob, lue
   seulement quand quelqu'un ouvre vraiment le contenu. Pattern déjà en place
   pour `documentTexts` (cf. le commentaire de la table dans `schema.ts`).

Le contrôle avant d'écrire une requête de liste : _est-ce qu'une des lignes
que je collecte porte un champ qui peut peser des dizaines de Ko ?_ Si oui,
un des deux remèdes ci-dessus, jamais un `.map()` de façade.

**Restent à traiter** (mêmes symptômes, moindre volume) : `documents` et son
champ legacy `extractedText` (chantier de purge déjà ouvert dans
`MIGRATIONS.md`), lu à chaque ouverture de fiche société ; `reportInbox.list`
qui prend 100 `inboundEmails` avec `bodyText` + `bodyHtml` + `extractedText` ;
et `companyReports.listByCompany` qui prend 200 lignes avec `rawContent` pour
n'afficher que titre et période.

Pour instrumenter : dashboard Convex → **Functions**, colonne _Database
bandwidth_, triée décroissante. Elle nomme le coupable en une minute.

---

## Un état d'attente que personne ne balaie (`documents.ocrState: 'pending'`)

`documentsExtract.run` est écrit comme un monde clos : quelle que soit l'issue
— texte obtenu, format non lisible, OCR en échec — il se termine **toujours**
en inscrivant `extracted`, `skipped` ou `failed`. Il ne peut pas se terminer
sur `pending`.

D'où la lecture d'un `pending` qui traîne : ce n'est pas « la lecture est
lente », c'est **l'action n'est jamais allée au bout** — timeout, plantage,
annulation. L'état initial de la ligne n'a jamais été remplacé.

Le piège n'est pas la panne, c'est ce qui vient après : **rien ne repassait**.
Le seul geste de relance est le bouton « Relancer la lecture », qui vit *sur*
le document — il faut donc déjà savoir lequel regarder. Aucune vue n'agrège
les `pending`, aucun cron ne les ramassait. Un document pouvait rester
invisible à la recherche sémantique indéfiniment, et **silencieusement** : dans
la liste il a l'air parfaitement normal, il se télécharge, rien ne signale que
son texte n'a jamais été lu. Le cas fondateur (ALB-127) : le PV d'AG signé
d'Hectarea, bloqué quatre mois, pendant lesquels toute question sur cette AG
était répondue depuis l'**extrait caviardé** du même PV — pas « un document en
moins », la mauvaise version qui fait autorité.

`documentsExtract.sweepStalePending` (cron horaire) est le trajet retour
manquant. Deux étapes, pour qu'un document qui tue le lecteur à chaque passage
ne boucle pas éternellement sur un appel OCR facturé :

1. premier passage → relance la lecture, estampille `ocrDetail: 'sweep_retry'` ;
2. toujours `pending` au passage suivant → abandon sur `failed` /
   `stuck_pending`, que le front affiche en rouge avec son ↻ manuel.

Deux détails d'implémentation qui ont l'air arbitraires et ne le sont pas :

- **L'estampille vit dans `ocrDetail`**, pas dans une colonne à elle. Le front
  ignore `ocrDetail` tant que l'état est `pending` (elle est donc invisible),
  et `documents:reextract` le remet déjà à `undefined` — une relance humaine
  ré-arme donc gratuitement la reprise automatique.
- **L'ancienneté se lit sur `uploadedAt`**, qu'une relance ne déplace pas. Un ↻
  manuel sur un vieux document paraît donc périmé immédiatement, et un passage
  du cron tombant pendant une lecture longue peut la relancer une seconde fois.
  Sans conséquence : `run` adopte le texte déjà stocké au lieu de repayer un
  OCR, et les deux passes écrivent le même verdict. Une colonne
  `ocrStartedAt` supprimerait la course ; elle ne valait pas son prix.

Pas de notification : l'abandon se voit sur la fiche, comme n'importe quelle
lecture en échec. Si un jour ça mérite un email, c'est le modèle de
`vectorize.ts` (échec définitif → mail aux membres) qu'il faut reprendre.

## Détecter un doublon et empêcher un doublon ne veulent pas la même clé

`legalDocsImport.attachBatch` saute une ligne quand la société porte déjà un
document de **même titre et même taille en octets**. Cette clé stricte est la
bonne : quand le garde-fou conclut « doublon », il **supprime le blob qu'il
vient de téléverser**. Un faux positif y détruit un vrai document.

Le détecteur de `verify` utilisait **la même clé**. Conséquence structurelle :
il ne pouvait signaler que les doublons que le garde-fou avait déjà bloqués,
c'est-à-dire aucun. Un détecteur de fumée branché sur le capteur de
l'extincteur.

Le cas réel (ALB-127) : le lot Hectarea est arrivé en deux passes, sous deux
conventions de nommage, et les **deux** moitiés de la clé tombent à côté —
`20260402_-_HECTAREA_-_Pacte_Version_Finale` (1 781 079 o) contre
`20260402 - HECTAREA - Pacte Version Finale` (1 781 084 o). Le même PDF
ré-exporté pèse quelques octets de plus (métadonnées internes). Quatre paires
ainsi, non signalées.

La règle à retenir : **ce qui détruit doit être strict, ce qui signale doit
être lâche**. `groupDuplicateDocuments` (`convex/lib/duplicates.ts`) regroupe
sur société + titre normalisé (casse, accents, `_`/`-`/espaces aplatis) et
**exclut délibérément la taille** — c'est précisément l'exclusion qui rattrape
la classe manquée. Les tailles voyagent dans le rapport, pas dans la clé :
c'est ce qui permet d'arbitrer à l'œil (quelques octets d'écart = un jumeau à
supprimer ; des mégaoctets = deux vraies versions).

Ne pas « corriger » le garde-fou dans l'autre sens en resserrant le détecteur,
ni l'inverse : les deux fonctions répondent à des questions opposées et doivent
diverger.
