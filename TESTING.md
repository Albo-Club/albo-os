# TESTING — plan de validation bout-en-bout

Plan manuel + automatisé pour valider une copie fraîche du template avant
de la dériver en SaaS de prod. Compter ~70 min de bout en bout.

Pré-requis :

- `pnpm install`
- `pnpm exec convex dev` lancé une fois (provisionne le déploiement)
- Variables d'environnement Convex configurées :
  - `BETTER_AUTH_SECRET`
  - `SITE_URL` (`http://localhost:3000` en local)
  - `RESEND_API_KEY` + `RESEND_FROM` + `RESEND_TEST_MODE=true` en dev
  - `ANTHROPIC_API_KEY` (modèle par défaut : `claude-haiku-4-5`)
- `.env.local` rempli (`VITE_CONVEX_URL`, `CONVEX_DEPLOYMENT`)
- 2 navigateurs (ou 1 navigateur + 1 fenêtre incognito) prêts pour les
  tests multi-tenant

## Niveau 1 — Build & smoke (automatisé, 2 min)

| #  | Étape         | Commande                 | Résultat attendu              |
| -- | ------------- | ------------------------ | ----------------------------- |
| B1 | Typecheck     | `pnpm typecheck`         | Exit 0, aucune erreur         |
| B2 | Lint          | `pnpm lint`              | Exit 0, 0 warning             |
| B3 | Build         | `pnpm build`             | Bundle écrit dans `.output/`  |
| B4 | Smoke E2E     | `pnpm test:smoke`        | Tous les scénarios passent    |
| B5 | Cookies prod  | `pnpm test:cookies`      | `albo-os.session_token` a Secure+HttpOnly+SameSite=Lax+Max-Age≈604800 |
| B6 | Skills à jour | `pnpm sync:skills:check` | `0 skills drifted`            |

## Niveau 2 — Auth (6 min)

Les minutiae UI (texte exact, spinners, skeletons, aria-label) ne sont pas
listées ici — elles tombent sous le CI visuel + typecheck. Ce niveau
couvre uniquement les comportements qui peuvent **régresser silencieusement**.

Tester avec un user neuf "Alice" (`alice@test.local`).

| #   | Étape                                                  | Résultat attendu                                                                  |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| A1  | `/register` → submit, onboarding org "Acme"            | Redirige `/app/acme`, user créé, `superAdmin: true` (premier user)                |
| A2  | Sign out → re-sign in correct                          | Redirige `/app/acme` (dernière org via `lastOrgSlug`)                              |
| A3  | Sign in mauvais mdp                                    | Inline `<Alert>` destructive au-dessus du form (pas toast). Pas de session.       |
| A4  | `/app/acme` non authentifié                            | Redirige `/login?redirect=…`                                                       |
| A5  | `/app/me` → change password                            | Toast succès **+ email "Password changed"** (anti-takeover) + autres sessions invalidées |
| A6  | Magic link enregistré + non-enregistré                 | Toast privacy-respecting identique. Aucune `users` row créée pour email inconnu.   |
| A7  | Forgot → reset chain (email → token → nouveau mdp)     | Sign-in avec nouveau mdp marche. Sessions pré-reset toutes invalidées.            |
| A8  | `/reset-password?token=expired` (ou sans token)        | Card "Invalid or expired link" + CTA primary "Send a new reset link"               |
| A9  | `/register` avec email déjà enregistré                 | **Même** écran "Check your inbox" qu'un signup neuf (anti-enumeration), aucun email envoyé |
| A10 | Rate-limit (sign-in 6×, sign-up 4×, magic 4× /60s)     | Toast "Too many attempts…" via classifier (plus de message BA cru)                |
| A11 | `/app/me` → change email                               | Email **d'approbation** arrive à l'adresse **courante** (anti-takeover), pas à la nouvelle |
| A12 | Password constraints (`/register` + `/reset-password`) | <12 chars → Zod block. HIBP leak → "appeared in known data breaches". zxcvbn meter visible. |
| A13 | Password match feedback `/reset-password`              | Identiques → ✓ vert "Passwords match". Différents → rouge case-sensitive hint.    |
| A14 | Resend (verification & reset)                          | 2e email arrive si email existe. Toast neutre privacy-respecting.                  |
| A15 | Network error (offline) sur magic-link + forgot        | Inline `<Alert>` "Network error" (pas de fausse "link sent" trompeuse).            |
| A16 | `/app/me` Sessions → list + Revoke + "Sign out others" | Session courante = badge Current sans bouton Revoke. Revoke autres OK. "Sign out other devices" demande confirm puis invalide tout sauf l'actuelle. |
| A17 | **Cross-tab persistence** (régression localhost)        | Sign-in onglet A → ouvrir onglet B sur `/app/acme` → reste loggé. Hard refresh chaque onglet 3× → toujours loggé. |
| A18 | Onboarding org avec slug réservé (`admin`, `api`, `me`) | Feedback inline "This slug is reserved" sous l'input. Submit toast "slug_reserved". |
| A19 | Onboarding org avec slug déjà pris                      | Feedback inline "This slug is already taken" en temps réel (sans soumettre). Submit toast "slug_taken". |
| A20 | **Google sign-in** — sans `GOOGLE_CLIENT_ID/SECRET`     | `/login` + `/register` : **pas** de bouton "Continue with Google" ni séparateur (template propre, aucune erreur). |
| A21 | **Google sign-in** — avec creds + redirect URI Google Console (`${SITE_URL}/api/auth/callback/google`) | Bouton visible. Nouveau user → redirige `/app`, `users` row créée. Email d'un compte password existant → **pas** de doublon `users` (dédup email). |
| A22 | Échec OAuth Google (annulation / erreur)               | Retour `/login?error=…` → toast "Couldn't sign in with that provider".             |
| A22b | **Google en prod** — après `pnpm run setup:prod` (creds Google présentes en dev) | `convex env list --prod` contient `GOOGLE_CLIENT_ID` ; redirect URI prod ajoutée au même client Google ; bouton visible sur le domaine prod, sign-in OK. |

> **A23+ (gaps connues)** : pas d'email "Password changed" sur le flow
> `/forgot-password → /reset-password` ni NewDeviceEmail — voir
> `KNOWN_ISSUES.md` § "Post-event notification coverage" pour la roadmap.

## Niveau 2 — Internationalisation i18n (8 min)

App bilingue FR/EN. Anglais par défaut, français si le navigateur/les prefs le
demandent. Détails archi : `KNOWN_ISSUES.md` § "i18n (react-i18next) SSR".

| #   | Étape                                                                 | Résultat attendu                                                                                   |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| I1  | Navigateur en `en-US`, cookie `lang` effacé, visiter `/`              | Tout en anglais. `<html lang="en">`. Pas de flash.                                                 |
| I2  | Forcer `Accept-Language: fr-CA` (DevTools ou `curl -H`), cookie effacé, recharger `/` | **Dès le HTML source SSR** (View Source, JS désactivé) tout est en français. `<html lang="fr">`. |
| I3  | Recharger en FR plusieurs fois                                        | Console **sans** warning "Text content does not match" (pas de hydration mismatch).                |
| I4  | Switcher de langue (footer sidebar connecté, ou coin de `/`)          | Bascule FR↔EN immédiate. Cookie `lang` mis à jour. Survit au reload.                               |
| I5  | Connecté, changer la langue                                           | `users.preferredLanguage` patché (vérifier dashboard Convex).                                      |
| I6  | Variante `fr-BE` / `fr-FR` / `fr`                                     | Toutes → français (n'importe quelle variante fr).                                                  |
| I7  | Emails (reset password, invitation) pour un user `preferredLanguage=fr` | Sujet + corps en français ; pour un user EN/sans préf → anglais.                                  |
| I8  | Mauvais credentials en FR / formulaire invalide en FR                 | Message d'erreur auth FR (via classifier) ; messages Zod FR.                                       |
| I9  | Grep régression : `git grep -nE "\"[A-Z][a-z]+ " src/routes src/components` | Aucune string UI codée en dur hors `src/components/ui/*` (chrome shadcn).                       |

## Niveau 2 — App shell UI (10 min)

Connecté en tant qu'Alice sur `/app/acme/`.

| #    | Étape                                                          | Résultat attendu                                                  |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| SH1  | Sidebar `inset` (carte flottante arrondie) : groupe Platform (Dashboard / Participations / Cash) en haut ; Members / Invitations / Settings épinglés en bas (nav secondaire `mt-auto`, sans label) | OK ; entrées admin-only masquées si rôle "member" (plus de badge "demo" sur Cash, vue fonctionnelle) |
| SH2  | Clic sur `SidebarTrigger` (header) OU sur la `SidebarRail` (bande fine au bord droit de la sidebar) | Sidebar collapse en `icon` ; cookie `sidebar_state` persiste ; icônes orga/profil non écrasées en mode `icon` |
| SH3  | Redimensionner < 768px                                         | Sidebar passe en `Sheet` mobile, ouverture via burger              |
| SH4  | Naviguer Dashboard → Participations → Cash                     | Breadcrumb du header se met à jour à chaque route ; Cash affiche les soldes par compte (cf. Niveau 3 — Vue Cash) |
| SH5  | Dashboard : 4 KPI cards (membres, invitations, Participations —, Trésorerie —) | Counts membres/invitations cohérents avec listMembers réels ; cartes Participations/Cash en placeholder "—" |
| SH6  | Toggle dark mode (icône soleil/lune dans header)               | Page bascule light ↔ dark, sidebar + charts adaptés                |
| SH7  | Theme picker (footer sidebar) → choisir Blue / Emerald / Violet| Primary + chart-1 changent ; survit au reload (localStorage)       |
| SH8  | Org switcher (header sidebar), orga **sans** logo             | Initiale (1ʳᵉ lettre) centrée dans le carré arrondi ; liste les orgs ; clic switch route + persiste `lastOrgSlug` |
| SH9  | NavUser (footer sidebar) → profile / switch org / sign out     | Avatar **rond** ; sans photo, initiales prénom+nom (ex. `BB`) ; mêmes destinations qu'avant refonte |
| SH10 | Bouton AI dans header                                          | Ouvre le modal chat existant (non-régression)                      |
| SH11 | Ouvrir une page au contenu plus haut que l'écran (liste longue) | Le cadre `inset` reste calé sur la hauteur du viewport ; le scroll se fait **dans** le cadre, bord bas arrondi toujours visible |

## Niveau 2 — Multi-tenant (15 min)

Toujours connecté en tant qu'Alice. Préparer un 2e navigateur pour Bob.

| #   | Étape                                                       | Résultat attendu                                                    |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| M1  | `/app/acme/settings/invitations` → invite `bob@test.local`  | Email envoyé, listée en pending                                     |
| M2  | Browser 2 (incognito) → ouvrir le lien d'invitation         | Page `/accept-invite/<token>` accessible non-authentifié            |
| M3  | Sign up Bob via le flow d'invitation                        | Bob créé, automatiquement membre d'Acme avec rôle "member"          |
| M4  | Bob visite `/app/acme`                                      | Voit le dashboard de l'org en tant que membre                       |
| M5  | Alice change rôle Bob → "admin"                             | Persiste, Bob voit le badge mis à jour                              |
| M6  | Bob crée une 2e org "Beta"                                  | Switch vers `/app/beta`, Alice n'est PAS membre                      |
| M7  | Alice tente `/app/beta` directement                         | Redirige vers `/app` ou 403                                          |
| M8  | Switch org via dropdown top bar                             | Routes recalculées, scope org rechargé                              |

> **Isolation des données métier** (companies/deals scopés `orgId`, override
> admin sur les deletes) : à valider en V0 quand les mutations CRUD existent.
> Cf. `KNOWN_ISSUES.md` / la mission V0.

## Niveau 3 — Vue Cash (lecture seule, 5 min)

Route `/app/$orgSlug/cash` (`src/routes/app/$orgSlug/cash.tsx`). Lecture seule :
pas d'ingestion encore (Powens en cible). Pour tester avec des données, insérer
temporairement via le dashboard Convex 1–2 `bankAccounts` (`ownerCompanyId` =
une entité `group_*` de l'org, `currentBalance` en cents) et quelques
`transactions` (certaines avec `dealId` pointant un deal existant). Nettoyer après.

| #   | Étape                                                              | Résultat attendu                                                                 |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| CA1 | Ouvrir `/app/<org>/cash` sans aucun `bankAccounts`                  | Total à 0 € + encart pointillé "Aucun compte bancaire…" (état vide propre)        |
| CA2 | Avec comptes : soldes regroupés par entité propriétaire (`group_*`) | Une section par entité (titre = nom entité) ; carte "Solde total" = somme des soldes |
| CA3 | Compte sans `currentBalance`                                        | Affiche "Solde inconnu" ; `balanceAsOf` rendu en sous-texte si présent            |
| CA4 | Clic sur **la ligne du compte** (n'importe où)                       | Navigue vers la page `/cash/$accountId` (en-tête banque · libellé + entité / solde / IBAN, lien retour) listant **toutes** les transactions du compte, antéchrono ; les rattachées à un deal sont labellisées par la boîte investie, les autres affichent « — » en colonne Deal |
| CA5 | Transaction `direction: "out"`                                      | Montant en négatif, couleur `text-destructive` ; `in` en positif                  |
| CA6 | Compte sans transaction liée à un deal                             | Sheet affiche l'état vide "Aucune transaction liée à un deal…"                    |
| CA7 | i18n EN/FR sur la page + le Sheet                                   | Tous les libellés traduits (namespace `cash`), titre d'onglet = `cash:metaTitle`  |

## Niveau 3 — Invitations edge cases (8 min)

| #  | Étape                                                      | Résultat attendu                                                    |
| -- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| I1 | Inviter un email déjà membre                               | Erreur "already_member", pas de doublon                              |
| I2 | Inviter le même email 2× (en pending)                      | Refusé ou remplace l'invitation, pas de doublon                      |
| I3 | Accepter une invitation expirée (forcer `expiresAt` passé) | Erreur "invitation_expired", pas d'ajout                             |
| I4 | Accepter une invitation déjà acceptée                      | Erreur "already_accepted"                                            |
| I5 | Accepter invitation avec un autre compte que celui invité  | Refus ("wrong_account") OU rejet selon politique                     |
| I6 | Spammer 25 invitations en < 1h                             | Rate-limit déclenche → "rate_limited" après seuil                    |
| I7 | Révoquer une invitation pending                            | Disparaît de la liste, lien devient invalide                         |
| I8 | Vérifier que `RESEND_TEST_MODE=true` n'envoie pas d'email réel | Logs Convex montrent "skipped (test mode)"                       |

> **Niveau 3 — CRUD métier (companies / deals)** : ce niveau sera écrit en
> V0 quand les mutations `companies.*` / `deals.*` existeront (real-time
> Convex, validation serveur titre/montants, isolation par `orgId`, override
> admin sur les deletes, scope `holdingScope`). Cf. la mission V0.

## Niveau 4 — Uploads (5 min)

| #  | Étape                                                   | Résultat attendu                                                  |
| -- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| U1 | `/app/me` → drag/drop avatar (PNG < 5 MB)               | Upload OK, avatar visible top bar                                 |
| U2 | Avatar > 20 MB                                          | Refusé (cap Convex)                                               |
| U3 | `/app/acme/settings/general` → upload logo org          | Logo visible dans le top bar et la liste des membres              |
| U4 | Remplacer un logo existant                              | Ancien remplacé, pas d'orphelin (vérifier `_storage`)             |

## Niveau 4 — Account lifecycle (8 min)

| #  | Étape                                                   | Résultat attendu                                                  |
| -- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| L1 | `/app/me` → change email                                | Email de vérif envoyé à l'ancienne adresse                         |
| L2 | Clic lien de vérif                                      | Email mis à jour, sessions toujours valides                        |
| L3 | `/app/me` → delete account                              | Email de confirmation envoyé                                       |
| L4 | Clic lien dans email delete                             | User Convex purgé, memberships supprimées, BA user supprimé        |
| L5 | Le user supprimé tente `/login`                         | Auth échoue                                                       |

## Niveau 4 — Super-admin (5 min)

| #   | Étape                                              | Résultat attendu                                                  |
| --- | -------------------------------------------------- | ----------------------------------------------------------------- |
| SA1 | `/app/admin` accessible uniquement pour `superAdmin: true` | Bob (non-SA) → 403/redirect                                        |
| SA2 | Lister tous les users de tous les tenants         | Liste exhaustive, pagination OK                                    |
| SA3 | Toggle `superAdmin` sur un autre user              | Persiste, l'autre user voit `/app/admin`                           |
| SA4 | Last-SA guard : retirer son propre flag SA si seul SA | Erreur "cannot_demote_last_superadmin"                          |
| SA5 | `purgeExcept` (dev cleanup) — uniquement en dev    | Conserve uniquement l'email indiqué, supprime le reste             |

## Niveau 5 — AI chat (8 min)

| #  | Étape                                                   | Résultat attendu                                                  |
| -- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| C1 | Ouvrir le slide-over chat depuis `/app/acme`            | Premier thread créé automatiquement                                |
| C2 | Envoyer un message simple ("ping")                      | Stream visible token par token, pas de blocage UI                  |
| C3 | "liste mes participations Albo"                         | Tool `listDeals`/`listCompanies` appelé, réponse scopée à l'org    |
| C4 | "crée un deal Albo Club dans Sezame, share, 50 000 €, signé le 15 janvier 2026" | L'agent confirme puis appelle `createCompany` (si absente) + `createDeal` ; le deal apparaît dans `/participations` (scope Albo + Consolidé, pas Calte) |
| C5 | Demander un deal avec un investisseur portfolio (non groupe) | Refusé (`investor_must_be_group_entity`) — l'agent explique qu'il faut une entité du groupe |
| C6 | Spammer 30 messages en 1 min                            | Rate-limit `chatSend` se déclenche                                |
| C7 | Depuis `/app/beta`, vérifier que les threads d'Acme ne sont PAS listés | Isolation org confirmée (scope `${orgId}:${userId}`) |
| C8 | "crée un compte bancaire Qonto pour CALTE, solde 12 000 €"               | L'agent résout CALTE via `listCompanies` puis appelle `createBankAccount` avec `currentBalanceCents: 1200000` ; le compte apparaît dans `/cash` sous CALTE avec un solde de 12 000 € (pas "Solde inconnu") |
| C9 | "ajoute une transaction de sortie 5 000 € liée au deal Sezame le 3 février 2026" | L'agent appelle `listBankAccounts`/`listDeals` puis `createTransaction` (dealId rempli) ; visible dans le Sheet du compte (sortie négative) ; le solde affiché reste inchangé (champ manuel) |
| C10 | Demander un compte bancaire rattaché à une société portfolio            | Refusé (`owner_must_be_group_entity`) — l'agent explique qu'il faut une entité du groupe |

## Niveau 6 — Sécurité + déploiement (5 min)

| #  | Étape                                              | Résultat attendu                                                  |
| -- | -------------------------------------------------- | ----------------------------------------------------------------- |
| S1 | Aucun secret avec préfixe `VITE_`                  | `grep -r "VITE_.*SECRET\|VITE_.*KEY"` → vide                       |
| S2 | Aucun `process.env.X` top-level dans `src/`        | Vérifier client-side bundle                                       |
| S3 | Headers de sécurité présents (CSP, HSTS, etc.)     | `curl -I http://localhost:3000` → headers attendus                 |
| S4 | CORS Better Auth limité à `BETTER_AUTH_URL`        | Requête depuis un autre origin → bloquée                          |
| S5 | Webhooks HMAC : payload modifié → rejeté          | `POST /powens/webhook` avec `BI-Signature` invalide → `401`, rien écrit (cf. Powens ci-dessous) |
| S6 | `pnpm build` + `pnpm start` (prod local)           | Le bundle prod tourne sans warning                                 |

## Seed dev rapide

Pour gagner ~2 min de setup, un seed dev (à appeler via `convex run`)
peut créer Alice (SA), Bob (member) et une org "acme". À écrire dans
`convex/admin.ts` sous un `internalMutation` `seedDev`, gated derrière
`process.env.CONVEX_DEPLOYMENT !== 'production'`. Le seed des 9 entités du
groupe Calte vit séparément dans `convex/seed.ts` (`seedGroup`, mission V0).

## Import Attio → Convex (portefeuille Albo Club, one-shot)

Migration figée des deals/companies Attio (label Albo, stages Invested/Exit Win)
vers l'org `albo`. Prérequis : org `albo` + company `group_root` « Albo Club »
seedées (`convex run --prod seed:seedAll`). Le schéma doit être déployé (champ
`deals.exitProceeds`).

| #  | Étape                                                       | Résultat attendu                                            |
| -- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| A1 | `convex export --prod`                                      | Snapshot de sécurité avant écriture                         |
| A2 | `convex run --prod migrations/attioAlboImport:run`          | `{ companiesInserted: 34, dealsInserted: 43, ... }`          |
| A3 | `convex run --prod migrations/attioAlboImport:verify`       | `portfolioCompanies: 34`, `deals: 43`, `exited: 2`          |
| A4 | Re-lancer `:run` (idempotence)                              | `…Inserted: 0`, `…Patched: 34/43` — aucun doublon            |
| A5 | Échantillon `verify.sample`                                 | Chaque `attioDealId` pointe sur la bonne `target`           |

## Ingestion Powens (webhook → bankAccounts + transactions)

Webhook `CONNECTION_SYNCED` → `/powens/webhook` (HMAC) → `ingestConnectionSync`.
Prérequis : `POWENS_WEBHOOK_SECRET` posé en prod ; provider HMAC + URL webhook
`https://mellow-curlew-738.convex.site/powens/webhook` configurés chez Powens
(activer `CONNECTION_SYNCED`) ; orgs `calte`/`albo` + entités group seedées.
La connexion des banques se fait par l'opérateur via le Powens Webview.

| #  | Étape                                                              | Résultat attendu                                                                 |
| -- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1 | `convex export --prod`                                            | Snapshot de sécurité avant le 1ᵉʳ run                                            |
| P2 | Connecter un compte **neuf** (Palatine/Wormser/Neuflize) via Webview | `cash.listAccounts` (calte) montre le compte sous **CALTE** ; `source='powens'`, montants en centimes positifs, `direction` correcte |
| P3 | Neuflize (plusieurs comptes sous 1 connexion)                     | Un `bankAccounts` par compte Powens distinct (courants + comptes à terme)         |
| P4 | Mémo Bank via Webview                                              | Compte sous **Albo Club** (org `albo`)                                            |
| P5 | Cutover compte neuf                                                | Aucune tx antérieure à `_creationTime` du compte (l'historique du 1ᵉʳ lot ignoré) |
| P6 | Connecter le **Qonto**                                            | Le record Qonto **existant** est lié (powensConnectionId/AccountId remplis, IBAN backfillé) — **aucun** nouveau compte créé |
| P7 | Cutover Qonto                                                     | Aucune tx Powens antérieure à la dernière tx Airtable du Qonto (pas de doublon du passé) |
| P8 | Rejouer le même payload (idempotence)                            | Aucun doublon (`by_powens_id`) ; `{ inserted: 0, patched: N }`                    |
| P9 | Signature falsifiée                                              | `401`, rien écrit (cf. S5)                                                        |
| P10 | Nettoyage Qonto — `convex run --prod powens:listQontoTestTransactions` | Liste les tx `source='manual'` sans `airtableId` ; si vide → ne rien supprimer    |
| P11 | `convex export --prod` puis `powens:deleteTransactionsByIds '{"ids":[…]}'` | Supprime **uniquement** les ids validés (garde-fou : manual + sans airtableId + compte Qonto) ; retourne `{ deleted, skipped }` |

## Émission Powens (bouton « Connecter une banque » → Webview)

Côté émission : `startBankConnection` (action) crée/réutilise le user Powens
permanent de l'org, génère un code temporaire, renvoie l'URL du Webview.
Prérequis : env vars `POWENS_CLIENT_ID/SECRET/DOMAIN/REDIRECT_URI` posées ;
`redirect_uri` whitelistée chez Powens ; webhook d'ingestion déjà en place.

| #  | Étape                                                              | Résultat attendu                                                                 |
| -- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| E1 | `/app/calte/cash` en tant qu'**admin** → clic « Connecter une banque » | Redirection vers `webview.powens.com/connect?…` (domain, client_id, redirect_uri, code) |
| E2 | Même page en tant que **member** (non-admin)                       | L'action refuse (`insufficient_role`) → toast « Seuls les admins… » ; pas de Webview |
| E3 | Connecter une banque de test dans le Webview                       | Redirection vers `https://alboteam.com/?connection_id=…` puis webhook `CONNECTION_SYNCED` → compte visible dans `cash.listAccounts` |
| E4 | 2ᵉ clic « Connecter une banque » (même org)                        | **Pas** de nouvel appel `/auth/init` ; un seul enregistrement `powensUsers` pour l'org (dashboard Convex) |
| E5 | Sécurité — inspecter la réponse réseau du clic (DevTools)          | Seul `{ webviewUrl }` revient ; **aucun** `authToken`/`client_secret` dans le payload ni dans les logs Convex |
| E6 | Env var manquante (test : retirer `POWENS_DOMAIN`)                 | Toast « connexion bancaire pas configurée » (`powens_env_missing`) ; aucun appel Powens |

## En cas d'échec

- Smoke échoue → ouvrir `KNOWN_ISSUES.md` (déploiement Convex / `pnpm rebuild esbuild`).
- Auth échoue → vérifier `BETTER_AUTH_SECRET` + `SITE_URL` côté Convex env.
- Emails non reçus → `RESEND_API_KEY` valide + `RESEND_TEST_MODE=false` pour
  recevoir réellement.
- AI ne stream pas → `ANTHROPIC_API_KEY` + vérifier `convex/agent.ts` (modèle
  par défaut `claude-haiku-4-5`).
