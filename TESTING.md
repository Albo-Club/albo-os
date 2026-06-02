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
| B7 | Tests unitaires | `pnpm test:unit`       | 28 tests verts (logique forecast pure : récurrence, protection overridden, solde mensuel) |

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
| CA8 | Page `/cash/$accountId` : taper un libellé ou une contrepartie dans la barre de recherche (avec/sans accents, casse différente) | Filtrage serveur (~250 ms de debounce) via le search index `search_text` ; résultats triés date desc, cap 200 ; pas de flash de liste vide entre deux frappes ; terme sans résultat → « Aucune transaction ne correspond… » ; effacer → liste complète. ⚠️ Les tx pré-existantes sont invisibles à la recherche tant que `transactions:backfillSearchText` n'a pas tourné (cf. `KNOWN_ISSUES.md` « Recherche transactions ») |

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

## Pointage transaction → deal (mutations + backfill)

Pointage manuel (MVP 1) : `matchTransaction` / `ignoreTransaction` /
`categorizeAsCharge` / `categorizeAsTax` / `categorizeAsProduct` /
`categorizeAsInternalTransfer` / `unmatchTransaction` + file
`listUnmatched` + consultation `listByStatus`. Chaque action écrit une ligne
append-only dans `matchingDecisions` (dataset agent, phase 2). Prérequis :
schéma déployé (champ `matchStatus` + table `matchingDecisions`). Détails et
pièges : `KNOWN_ISSUES.md` « Pointage transaction → deal ».

| #  | Étape                                                              | Résultat attendu                                                                 |
| -- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R1 | `convex export --prod`                                            | Snapshot de sécurité avant le backfill                                            |
| R2 | `convex run --prod transactions:backfillMatchStatus '{"orgId":"<id calte>"}'` | `{ matched: N, unmatched: M, skipped: 0 }` — matched = tx `reconciled` + `dealId` |
| R3 | Re-lancer R2 (idempotence)                                        | `{ matched: 0, unmatched: 0, skipped: N+M }` — aucune ré-écriture                 |
| R4 | Idem pour l'org `albo`                                            | Mêmes invariants                                                                  |
| R5 | `transactions:listUnmatched` (dashboard, en tant que membre)      | Les tx `unmatched` de l'org, triées par date desc, enrichies du compte            |
| R6 | `matchTransaction` sur une tx + un deal de la même org            | Tx → `matched` + `dealId` + `reconciled: true` ; 1 ligne `matchingDecisions` (`decision: 'matched'`, snapshot label/montant/date figé) |
| R7 | `matchTransaction` avec un deal d'une **autre** org               | `ConvexError('deal_wrong_org')`, rien écrit                                       |
| R8 | `ignoreTransaction` sur une tx                                    | Tx → `ignored`, `dealId` vidé ; ligne `decision: 'ignored'`                       |
| R9 | `unmatchTransaction` sur la tx de R6                              | Tx → `unmatched`, `dealId` vidé, `reconciled: false` ; ligne `decision: 'unmatched'` (le retour arrière est loggé) |
| R10 | Inspecter `matchingDecisions` après R6–R9                        | Une ligne par action, aucune modifiée/supprimée ; `dealAmountExpected`/`amountDelta`/`dateDelta` remplis si le deal a `committedAmount`/`signedDate` |
| R11 | `categorizeAsCharge` sur une tx                                   | Tx → `charge`, `dealId` vidé, `reconciled: false` ; ligne `decision: 'charge'`     |
| R12 | `categorizeAsTax` sur une tx                                      | Tx → `tax`, `dealId` vidé, `reconciled: false` ; ligne `decision: 'tax'`           |
| R13 | `listByStatus` avec `status: 'charge'` (puis `'tax'`, `'product'`, `'internal_transfer'`) | Les tx classées dans ce statut, triées date desc, enrichies du compte ; les tx de R11/R12/R15/R16 ne sont plus dans `listUnmatched` |
| R14 | `bulkCategorize` avec plusieurs `transactionIds` + `status: 'charge'` (puis `'tax'`, `'product'`, `'internal_transfer'`) | Retour `{ succeeded: [...], failed: [] }` ; chaque tx → même patch que l'unitaire + une ligne `matchingDecisions` par tx ; un id invalide/d'une autre org atterrit dans `failed` sans bloquer les autres |
| R15 | `categorizeAsProduct` sur une tx                                   | Tx → `product`, `dealId` vidé, `reconciled: false` ; ligne `decision: 'product'` ; aucun impact sur les « Reçu » des deals |
| R16 | `categorizeAsInternalTransfer` sur une tx                          | Tx → `internal_transfer`, `dealId` vidé, `reconciled: false` ; ligne `decision: 'internal_transfer'` (simple étiquette, pas d'appariement des deux jambes) |

### UI de pointage (`/app/$orgSlug/pointage`)

Écran de pointage manuel (front des mutations ci-dessus). Lien sidebar
« Pointage » dans le groupe Plateforme.

| #   | Étape                                                            | Résultat attendu                                                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| RU1 | `/app/calte/pointage` en tant que membre                         | Table des tx `unmatched` triées date desc (Date · Libellé · Montant signé · Compte · Actions) + compteur « N à pointer » |
| RU2 | `/app/albo/pointage` (org sans tx unmatched)                     | État vide « Aucune transaction à pointer 🎉 »                                      |
| RU3 | Combobox deal sur une ligne → recherche par nom → « Rattacher »  | Mutation `matchTransaction` ; la ligne affiche « Rattachée à {deal} · Annuler » ~5 s puis disparaît |
| RU4 | Menu « Écarter ▾ » → « Ignorer » sur une ligne                   | Mutation `ignoreTransaction` ; bandeau « Ignorée · Annuler » ~5 s puis la ligne disparaît |
| RU5 | « Annuler » pendant le bandeau (après RU3 ou RU4)                | Mutation `unmatchTransaction` ; la ligne redevient pointable (réactivité Convex)   |
| RU6 | Clic sur une ligne (hors colonne Actions)                        | Sheet de détail lecture seule (date, libellé brut, contrepartie, montant, sens, compte) + mêmes actions |
| RU7 | Basculer la langue EN/FR                                         | Toute la page traduite (titres, colonnes, boutons, bandeaux, onglets, état vide)   |
| RU8 | Menu « Écarter ▾ » → « Charge » (puis « Impôt », « Produit », « Virement interne ») sur une ligne | Mutation `categorizeAsCharge` / `categorizeAsTax` / `categorizeAsProduct` / `categorizeAsInternalTransfer` ; bandeau « Classée en charge/impôt/produit/virement interne · Annuler » ~5 s puis la ligne disparaît |
| RU9 | Onglet « Charges » (puis « Impôts », « Produits », « Virements internes ») | Vue lecture seule des tx classées (`listByStatus`), triées date desc ; bouton « Annuler » par ligne |
| RU10 | « Annuler » dans un onglet Charges/Impôts/Produits/Virements internes | Mutation `unmatchTransaction` ; la tx disparaît de l'onglet et réapparaît dans « À pointer » |
| RU11 | Cocher plusieurs lignes (case en tête de ligne)                  | Barre de sélection « N sélectionnées » au-dessus de la table avec boutons Charge / Impôt / Produit / Virement interne / Désélectionner ; cocher n'ouvre pas le sheet |
| RU12 | Barre de sélection → « Charge » (puis « Impôt », « Produit », « Virement interne ») | Dialog de confirmation « Classer en charge/impôt/produit/virement interne ? N transactions… » ; Confirmer → **un seul** appel `bulkCategorize` (onglet réseau) ; les tx sortent de la file et apparaissent dans l'onglet correspondant ; une ligne `matchingDecisions` par tx |
| RU13 | Toast « N classées en charge/impôt/produit/virement interne · Annuler » après RU12 | Clic « Annuler » → les tx du lot reviennent dans « À pointer » (boucle `unmatchTransaction`) |
| RU14 | « Désélectionner » dans la barre / Annuler dans le dialog        | Sélection vidée / dialog fermé sans aucune mutation |
| RU15 | Barre de recherche (sous les onglets) : taper un libellé/contrepartie, dans chaque onglet | Filtrage serveur (debounce ~250 ms, insensible casse/accents) scopé org + statut de l'onglet ; compteur « N à pointer » = lignes affichées (filtrées) ; terme sans résultat → « Aucune transaction ne correspond… » ; effacer → file complète ; actions (rattacher/écarter/annuler) inchangées sur les lignes filtrées |
| RU16 | Une tx allouée au passif depuis la page Passif (cf. « UI Passif »)  | Elle n'apparaît **plus** dans « À pointer » (elle est `matched`) ; un `matchTransaction` / écartement / `unmatchTransaction` forcé dessus (API) → `ConvexError('allocated_to_liability')`, toast explicite |

### Réattribution depuis la page d'un deal (`/app/$orgSlug/deals/$dealId`)

Réattribuer une transaction déjà `matched` à un autre deal de la même org,
depuis la liste des transactions du deal (clic ligne → sheet → combobox).

| #   | Étape                                                            | Résultat attendu                                                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| RD1 | Clic sur une ligne de la section « Transactions » du deal A      | Sheet de détail (mêmes champs que le pointage) + combobox avec le deal A pré-sélectionné ; bouton « Réattribuer » désactivé |
| RD2 | Choisir un deal B (même org) dans le combobox → « Réattribuer »  | Mutation `matchTransaction` ; toast « Transaction déplacée vers {deal B} » ; la tx quitte la liste de A (réactivité) et apparaît sur la page de B ; 1 nouvelle ligne `matchingDecisions` (`source: 'manual'`) |
| RD3 | Resélectionner le deal A dans le combobox                        | Bouton « Réattribuer » désactivé (no-op)                                          |
| RD4 | Basculer la langue EN/FR                                         | Bouton, toast et sheet traduits                                                   |
| RD5 | En-tête du deal : « Versé » / « Reçu » (calculés, pas saisis)     | « Versé » = somme des transactions `out` rattachées, « Reçu » = somme des `in` ; après RD2 les montants des deals A et B se mettent à jour sans recharger ; deal sans transaction → 0 € / 0 € |
| RD6 | Liste des deals (`/app/$orgSlug/participations`, `/app/all/participations`, fiche participation) : colonnes/champs Engagé · Versé · Reçu | Versé/Reçu calculés serveur (`deals.list` / `aggregate.listDeals` enrichis, pas une query `listByDeal` par ligne) ; valeurs identiques à la page détail du même deal ; deal sans transaction → 0 € / 0 € ; lignes groupe (par société) = sommes des deals |
| RD7 | Barre de recherche des participations (`/app/$orgSlug/participations` et `/app/all/participations`) : taper un nom de société, un nom personnalisé de deal, un instrument (libellé FR/EN ou clé brute `os`), un investisseur, un secteur — avec/sans accents | Filtrage **client** (debounce ~250 ms, insensible casse/accents) ; regroupements et totaux par société recalculés sur le sous-ensemble ; terme sans résultat → « Aucune participation ne correspond… » ; effacer → liste complète |

### Édition de champs (deal / entité / compte bancaire)

Édition front : nom + instrument d'un deal (`/deals/$dealId`), nom + SIREN
d'une entité (`/participations/$companyId`), nom personnalisé d'un compte
(`/cash/$accountId`). Mutations : `deals.update`, `companies.update`,
`cash.updateAccountName`.

| #   | Étape                                                            | Résultat attendu                                                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ED1 | Page deal → « Modifier » → saisir un nom personnalisé → Enregistrer | Toast succès ; le titre devient le nom saisi (réactif, sans reload) ; l'instrument reste visible dans la grille d'infos ; les listes (`/participations`, `/app/all/participations`, fiche entité) affichent aussi ce nom à la place du libellé d'instrument |
| ED2 | Même dialog → vider le nom → Enregistrer                          | Le titre retombe sur le libellé de l'instrument (champ `name` effacé en base)     |
| ED3 | Même dialog → changer l'instrument (dropdown) → Enregistrer       | Étiquette instrument mise à jour (titre si pas de nom, grille, listes) ; **aucun** changement sur les transactions rattachées (Versé/Reçu inchangés) |
| ED4 | Page entité → « Modifier » → renommer + SIREN valide (9 chiffres, espaces tolérés) → Enregistrer | Toast succès ; titre + SIREN de la grille mis à jour ; SIREN stocké normalisé (sans espaces) |
| ED5 | SIREN invalide (ex. `12345`)                                      | Erreur inline sous le champ + bouton Enregistrer désactivé ; côté serveur la mutation rejette (`invalid_siren`) |
| ED6 | SIREN déjà porté par une autre entité de l'org                    | Toast d'erreur « déjà utilisé » (`siren_already_used`), rien n'est écrit          |
| ED7 | Page compte → « Modifier » → saisir un nom personnalisé → Enregistrer | Titre = `banque · nom personnalisé` ; nom d'origine en sous-titre grisé ; la liste `/cash` affiche aussi le nom personnalisé |
| ED8 | Même dialog → vider le nom → Enregistrer                          | Retombe sur le nom d'origine (`label`) ; `label` n'est **jamais** modifié par ce flux |
| ED9 | i18n EN/FR sur les 3 dialogs                                      | Libellés, hints, erreurs et toasts traduits (namespaces `participations` / `cash` / `common`) |

## Cash flow forecast (règles récurrentes → solde projeté)

Couche prévisionnelle : `forecastRules` (causes récurrentes) →
`forecasts:expandRules` (occurrences `forecastEntries`, idempotent) →
`forecasts:getForecastBalance` (solde projeté mensuel par org / consolidé).
La logique pure (récurrence, protection `overridden`, agrégation mensuelle)
est couverte par `pnpm test:unit` ; les étapes ci-dessous valident le glue
Convex (auth, DB, pointage). Détails et pièges : `KNOWN_ISSUES.md`
« Cash flow forecast ».

| #   | Étape                                                                  | Résultat attendu                                                                 |
| --  | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | `forecasts:createRule` (dashboard, membre de l'org) : loyer SCI mensuel, `amountCents: 100000`, `direction: "in"`, `frequency: "monthly"`, `anchorDay: 5`, `startDate: <now>` | Retourne l'id de la règle ; visible dans `forecastRules` |
| F2  | `forecasts:expandRules '{"orgId":"<org>","horizonMonths":12}'`         | `{ rulesProcessed: 1, created: 12, updated: 0, skippedProtected: 0 }` ; 12 entries `pending`/`confirmed` dans `forecastEntries`, une par mois sur le jour 5 |
| F3  | Re-lancer F2 à l'identique (**idempotence**)                            | `{ created: 0, updated: 12, skippedProtected: 0 }` — aucun doublon (compter les rows `forecastEntries`) |
| F4  | `forecasts:updateEntry` sur une entry de F2 : `{"patch":{"amountCents":123456}}` | Entry patchée ET `overridden: true` (dérivée + éditée = protégée) |
| F5  | `forecasts:updateRule` (montant 200000) puis re-lancer F2 (**protection**) | `{ created: 0, updated: 11, skippedProtected: 1 }` — l'entry de F4 garde 123456, les 11 autres passent à 200000 |
| F6  | `forecasts:getForecastBalance '{"orgId":"<org>","horizonMonths":12}'`  | `startingBalanceCents` = Σ `bankAccounts.currentBalance` (EUR, non archivés) ; 13 mois ; solde cumulé croissant de +100000/mois (sauf mois de F4) |
| F7  | Idem avec `"minConfidence":"confirmed"` puis créer une entry manuelle `probable` (`createManualEntry`) et re-query | L'entry `probable` compte sans le filtre, disparaît avec `minConfidence: "confirmed"` |
| F8  | `getForecastBalance` **sans** `orgId` (consolidé)                       | Somme des soldes + flux de toutes les orgs de l'utilisateur                       |
| F9  | `forecasts:markEntryRealized` avec une transaction de la même org      | Entry → `status: "realized"` + `realizedTransactionId` ; elle sort du solde projeté (re-query F6) |
| F10 | `markEntryRealized` avec une transaction d'une **autre** org           | `ConvexError('transaction_wrong_org')`, rien écrit                               |
| F11 | `forecasts:cancelEntry` sur une entry pending                          | `status: "cancelled"` ; sort du solde projeté ; survit à un re-run d'expandRules (`skippedProtected`) |
| F12 | `expandRules` / `getForecastBalance` en tant que **non-membre** de l'org | `ConvexError('not_a_member')`                                                    |

## Passif (equityPositions / C/C inter-entités → getLiabilities)

Modélisation du passif : `equityPositions` (capitaux propres émis) +
`intercompanyLoans` (C/C d'associés, un enregistrement partagé par relation
créancier → débiteur) + pointage généralisé `transactions.allocation`
(deal / equity / intercompany_loan). Les soldes de C/C sont **dérivés** des
transactions pointées, jamais stockés : chaque org somme **ses propres**
transactions. La logique pure est couverte par `pnpm test:unit`
(`tests/liabilities.test.ts`) ; les étapes ci-dessous valident le glue Convex.
Détails et pièges : `KNOWN_ISSUES.md` « Passif ».

| #  | Étape                                                                  | Résultat attendu                                                                 |
| -- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1 | `convex export --prod`                                                 | Snapshot de sécurité avant le backfill                                            |
| P2 | `convex run --prod transactions:backfillAllocation '{"orgId":"<id calte>"}'` | `{ updated: N, skipped: M }` — N = tx avec `dealId` sans `allocation`            |
| P3 | Re-lancer P2 (**idempotence**)                                         | `{ updated: 0, skipped: N+M }` — aucune ré-écriture                               |
| P4 | Idem pour l'org `albo`                                                 | Mêmes invariants                                                                  |
| P5 | Inspecter une tx backfillée (dashboard)                                | `allocation: { kind: 'deal', targetId: <dealId> }` ; `dealId` et `matchStatus` **inchangés** |
| P6 | `liabilities:seedTestScenario '{"fromOrgId":"<calte>","toOrgId":"<albo>"}'` (dev) | 1 equityPosition (calte) + 1 loan calte→albo + 2 tx pointées (out chez calte, in chez albo), ids retournés |
| P7 | `liabilities:getLiabilities '{"orgId":"<calte>"}'` (membre)            | `equityPositions: [1]` ; loan `side: 'creditor'`, `balanceCents: +10000000` (créance) |
| P8 | `liabilities:getLiabilities '{"orgId":"<albo>"}'` (membre)             | `equityPositions: []` ; même loan `side: 'debtor'`, `balanceCents: -10000000` (dette) |
| P9 | `getLiabilities` en tant que **non-membre** de l'org                   | `ConvexError('not_a_member')`                                                     |
| P10 | `liabilities:cleanupTestScenario` (mêmes args que P6)                 | Lignes `[TEST liabilities]` supprimées ; P7/P8 retournent des listes vides        |
| P11 | `liabilities:allocateTransaction` (kind `equity`) sur une tx `unmatched` + une equityPosition de la même org | Tx → `allocation: { kind: 'equity', targetId }` + `matchStatus: 'matched'` ; `dealId` reste null, `reconciled` inchangé ; **aucune** ligne `matchingDecisions` |
| P12 | `allocateTransaction` (kind `intercompany_loan`) sur une tx d'une org partie au prêt | Idem ; le solde du C/C dans `getLiabilities` intègre la tx (re-query)             |
| P13 | `allocateTransaction` avec une equityPosition d'une **autre** org      | `ConvexError('equity_wrong_org')`, rien écrit                                     |
| P14 | `allocateTransaction` (loan) avec une tx dont l'org n'est **ni** créancière **ni** débitrice du C/C | `ConvexError('loan_wrong_org')`, rien écrit                                       |
| P15 | `allocateTransaction` sur une tx déjà rattachée à un **deal**          | `ConvexError('already_matched_to_deal')`, rien écrit                              |
| P16 | `matchTransaction` / `ignoreTransaction` / `categorizeAs*` / `unmatchTransaction` sur une tx allouée passif | `ConvexError('allocated_to_liability')`, rien écrit                               |
| P17 | `liabilities:deallocateTransaction` sur la tx de P11                   | `allocation` vidée + `matchStatus: 'unmatched'` ; relancer = no-op (idempotent)   |

### UI Passif (`/app/$orgSlug/passif`)

Page Passif : lecture des capitaux propres + C/C, et pointage tx → passif
(front des mutations P11–P17). Lien sidebar « Passif » dans le groupe
Plateforme. Pré-requis : données du scénario P6 (`seedTestScenario`).

| #   | Étape                                                            | Résultat attendu                                                                  |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PU1 | `/app/calte/passif` en tant que membre                           | Bloc « Capitaux propres » (type, détenteur, date, montant + total) ; bloc « Comptes courants d'associés » (contrepartie, position, solde) ; panneau « Rattacher une transaction » |
| PU2 | Bloc C/C côté CALTE (créancier, après P6)                        | Badge « Créance », solde **+100 000 €** en vert ; tx pointées en sous-lignes avec « Détacher » |
| PU3 | `/app/albo/passif` (débiteur du même C/C)                        | Badge « Dette », solde **−100 000 €** en rouge                                     |
| PU4 | Panneau « Rattacher » : choisir une cible dans le combobox (groupes Capitaux propres / Comptes courants) sur une tx → « Rattacher » | Mutation `allocateTransaction` ; la tx **disparaît** du panneau ET de la file `/pointage` (elle passe `matched`) ; elle apparaît en sous-ligne de sa cible ; le solde du C/C se recalcule sans recharger |
| PU5 | « Détacher » sur une sous-ligne                                  | Mutation `deallocateTransaction` ; la tx **revient** dans le panneau « Rattacher » ET dans la file `/pointage` ; le solde se recalcule |
| PU6 | Basculer la langue EN/FR                                         | Page entièrement traduite (titres, colonnes, badges, boutons, états vides)         |

## En cas d'échec

- Smoke échoue → ouvrir `KNOWN_ISSUES.md` (déploiement Convex / `pnpm rebuild esbuild`).
- Auth échoue → vérifier `BETTER_AUTH_SECRET` + `SITE_URL` côté Convex env.
- Emails non reçus → `RESEND_API_KEY` valide + `RESEND_TEST_MODE=false` pour
  recevoir réellement.
- AI ne stream pas → `ANTHROPIC_API_KEY` + vérifier `convex/agent.ts` (modèle
  par défaut `claude-haiku-4-5`).
