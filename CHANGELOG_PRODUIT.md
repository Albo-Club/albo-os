# Nouveautés

<!--
  Trace en prose des évolutions, une entrée versionnée par PR
  (`## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre`), du plus récent au plus
  ancien. Corps en langage produit (pas de chemins de fichiers ni de
  noms de fonctions) — ce fichier est rendu tel quel dans l'app sur
  /app/$orgSlug/changelog (import ?raw).

  Chaque entrée se termine par un blockquote « 🔧 Notes techniques » :
  synthèse de ce qui a été fait techniquement (fichiers, fonctions,
  décisions), façon description de PR, pour un dev ou un agent qui
  reprend le code. Fichiers et fonctions autorisés ici (et seulement
  ici). Markdown pur uniquement — pas de <details>, le rendu in-app
  (react-markdown sans rehype-raw) ignore le HTML brut.

  Règle d'alimentation : CLAUDE.md § « Pre-PR doc audit » (question 5).
-->

Ce que chaque mise à jour change pour vous, en clair — du plus récent au
plus ancien. Les termes financiers sont expliqués dans le petit lexique en
bas de page.

---

## v1.14.0 — 22/06/2026 à 15:30 — Participations : créer un deal depuis la fiche entité

La fiche d'une société dispose désormais d'un bouton **« Nouveau deal »** dans son
en-tête, qui ouvre un dialog de création d'investissement rattaché à cette société.
Choisissez l'investisseur (une entité du groupe — présélectionné s'il n'y en a
qu'une) et l'instrument parmi la liste complète, et renseignez éventuellement un
montant engagé et une date de signature. À la validation, le deal apparaît
aussitôt dans la liste de la fiche. Les erreurs de cohérence (investisseur invalide,
mauvaise organisation) affichent un message clair.

> **🔧 Notes techniques**
> - Front uniquement, dans `participations.$companyId.tsx` : nouveau
>   `CreateDealDialog` (Dialog shadcn + `Select` investisseur/instrument) ouvert
>   depuis l'en-tête de la fiche. **Aucune mutation backend ajoutée ni modifiée.**
> - Soumission : `deals.create({ orgId, investorCompanyId, targetCompanyId, instrumentKind, committedAmount?, signedDate? })`.
>   `status` ('active') et `currency` ('EUR') gardent leurs défauts backend (non
>   exposés). Montant euros → cents (`Math.round(x * 100)`) ; date → ms epoch
>   (`new Date(v).getTime()`).
> - Investisseur = entités `group_*` via `api.companies.list({ orgId })` filtrées
>   client-side (`kind.startsWith('group_')`, miroir de `assertInvestorIsGroupEntity`) ;
>   présélection si une seule, sinon choix obligatoire (pas de défaut deviné).
> - Instruments importés de la source unique `convex/lib/instruments.ts`
>   (`INSTRUMENTS`), pas de liste recopiée. Erreurs `investor_must_be_group_entity`
>   / `investor_wrong_org` / `target_wrong_org` / `spv_wrong_org` classées via
>   `ConvexError.data`. i18n EN/FR sous `createDeal.*`.

## v1.13.0 — 22/06/2026 à 12:00 — Participations : créer une entité depuis la liste

La page **Participations** dispose désormais d'un bouton **« Nouvelle entité »**
dans son en-tête, qui ouvre un dialog de création. Renseignez le nom (obligatoire),
éventuellement le SIREN (9 chiffres) et un groupe — nouveau ou choisi dans la liste
des groupes existants. À la validation, l'entité est créée et vous êtes redirigé
vers sa fiche. Si le SIREN est invalide ou déjà utilisé, un message clair s'affiche
sans rien créer.

> **🔧 Notes techniques**
> - Front uniquement, dans `participations.index.tsx` : nouveau
>   `CreateCompanyDialog` (calqué sur `EditCompanyDialog` pour le style, la
>   validation SIREN et le `<datalist>` groupe via `api.participations.listGroups`)
>   + bouton « Nouvelle entité » dans l'en-tête de la liste.
> - Soumission : `companies.create({ orgId, name, kind: 'portfolio', siren? })`
>   (`kind` forcé, non exposé), puis `companies.update({ id, patch: { group } })`
>   **conditionnel** si un groupe est saisi (`create` n'accepte pas `group`).
>   **Aucune mutation backend ajoutée ni modifiée.**
> - Cas create OK / update groupe KO : navigation vers la fiche créée + toast
>   d'avertissement explicite (l'entité n'est pas perdue). Erreurs `invalid_siren`
>   / `siren_already_used` classées comme dans l'edit dialog (`ConvexError.data`).
> - i18n EN/FR ajoutée sous `create.*` ; les libellés de champs réutilisent
>   `edit.*`.

## v1.12.1 — 21/06/2026 à 18:30 — Participations : rattacher des entités depuis la page groupe

Sur la **page consolidée d'un groupe**, un bouton **« Ajouter une entité »**
permet désormais de rattacher plusieurs sociétés au groupe en une seule fois,
sans passer par la fiche de chacune. Le sélecteur ne propose que les sociétés
du portefeuille **qui n'appartiennent à aucun groupe** ; cochez-en plusieurs,
validez, et elles rejoignent aussitôt la liste et les KPI consolidés.

> **🔧 Notes techniques**
> - Front uniquement, dans `participations.group.$slug.tsx` : nouveau
>   `AddEntityDialog` (Dialog + liste de `Checkbox`) ouvert depuis l'en-tête de
>   `EntityList` (qui reçoit désormais `orgId`).
> - Source : `api.companies.list({ orgId, kind: 'portfolio' })` filtrée
>   client-side sur `!c.group`. Validation = `Promise.all` de
>   `companies.update({ id, patch: { group } })` (clé logique du groupe courant) —
>   **aucune nouvelle mutation**. La query `getGroup` se rafraîchit seule (Convex
>   réactif).
> - i18n EN/FR ajoutée sous `group.*` (libellés bouton/dialog, état vide, toast
>   pluralisé).

## v1.12.0 — 21/06/2026 à 12:55 — Participations : regrouper plusieurs entités

Vous pouvez désormais **regrouper plusieurs sociétés du portefeuille** sous une
seule ligne dans Participations (par exemple tous les SPV d'une même plateforme,
ou les boutiques d'une même enseigne).

- Depuis la fiche d'une société, un champ **Groupe** permet de l'assigner à un
  groupe existant ou d'en **créer un nouveau** (il suffit de taper son nom).
  Laisser le champ vide retire la société du groupe.
- Dans la liste des participations, les sociétés d'un même groupe se
  **consolident sur une seule ligne** (montants engagés / versés / reçus et TVPI
  additionnés), avec un badge « groupe ». Les sociétés sans groupe ne changent
  pas. Déplier la ligne montre tous les deals du groupe en précisant à quelle
  entité chacun appartient.
- Un bouton **« Voir le groupe »** ouvre une **page consolidée** dédiée : KPI
  agrégés que vous pouvez **réordonner et masquer** selon vos préférences, nom
  d'affichage **renommable**, et la liste des entités cliquables vers leur fiche.
- La vue **toutes organisations** bénéficie aussi de ce regroupement.

> **🔧 Notes techniques**
> - Schéma : champ optionnel `companies.group` (clé logique, distinct de
>   `sponsor`) + index `by_org_group` ; nouvelle table `portfolioGroupSettings`
>   (slug d'URL stable généré une fois, `displayName` renommable, config `blocks`)
>   avec index `by_org_group` / `by_org_slug`.
> - Logique pure testée (`convex/lib/portfolioGroups.ts` + `tests/portfolioGroups.test.ts`) :
>   `aggregateEntities` (TVPI = (reçu+résiduel)/versé, même formule que le reducer
>   client), `resolveBlocks`/`sanitizeBlocks` (catalogue `KPI_BLOCKS` extensible
>   sans migration), `slugify`/`uniqueSlug`. Helpers ctx dans
>   `convex/lib/groupSettings.ts` (`ensureGroupSettings`, `getGroupBySlug`,
>   `buildGroupMeta`).
> - Back : `companies.update` étendu (`group`, trim, upsert settings via
>   `ensureGroupSettings`) ; `convex/participations.ts` (`getGroup`, `listGroups`,
>   `setGroupBlocks`, `setGroupDisplayName`). Les `companyRef` de `deals.ts` et
>   `aggregate.ts` portent `group`/`groupSlug`/`groupDisplayName` (via `buildGroupMeta`,
>   une lecture indexée par org) → la liste consolide dans les deux vues sans
>   requête de rendu supplémentaire.
> - Front : reducer de `ParticipationsTable` regroupé par `group` (clé préfixée
>   `g:`), bouton « Voir le groupe », `DealsList` avec `showEntity` ; champ Groupe
>   (`Input` + `datalist`) dans `EditCompanyDialog` ; nouvelle route
>   `participations.group.$slug.tsx` (en-tête + KPI réordonnables/masquables +
>   liste d'entités). i18n EN/FR.

## v1.11.0 — 18/06/2026 à 17:29 — Invitations : entrée directe dans l'organisation

Accepter une invitation est désormais plus simple et fiable.

- Un **nouvel invité** définit son nom et son mot de passe et **entre
  directement** dans l'organisation, sans étape « vérifiez votre e-mail » :
  cliquer sur le lien d'invitation reçu prouve déjà que la boîte mail est la
  sienne.
- Si vous êtes **déjà connecté avec un autre compte** que celui invité, un écran
  clair vous le signale et vous propose de **vous déconnecter pour continuer**
  (ou d'annuler) — plus de déconnexion subie.
- Après acceptation, vous atterrissez **dans l'organisation de l'invitation**,
  même si vous étiez déjà membre d'une autre.
- Rouvrir un lien déjà accepté ne provoque plus d'erreur.
- Les inscriptions classiques (hors invitation) continuent, elles, de demander
  la vérification de l'e-mail.

> **🔧 Notes techniques**
> - Cause racine : `signUp.email` n'embarquait pas le token d'invitation et,
>   sous `requireEmailVerification`, n'ouvrait jamais de session → `invitations.accept`
>   ne se rejouait jamais. Fix : hook `databaseHooks.user.create.before`
>   (`convex/auth.ts`) qui pose `emailVerified` **uniquement** si le body du
>   signup porte un token valide (`internal.invitations.validateInviteForSignup`,
>   token + email + pending + non expiré). `autoSignIn` ne se déclenche pas sous
>   `requireEmailVerification`, donc le front enchaîne `signUp → signIn → accept`
>   (`src/routes/accept-invite.$token.tsx`, `register.tsx`), avec
>   `callbackURL=/accept-invite/<token>` en filet. `inviteToken` est un champ de
>   body extra (forwardé par le client BA, jamais persisté).
> - `invitations.accept` rendu idempotent (réconcilie `acceptedAt` si déjà
>   membre, retourne toujours `orgSlug`) ; match email insensible casse + trim.
>   Logique pure extraite dans `convex/lib/invitations.ts` + `tests/invitations.test.ts`.
> - Écran de désambiguïsation (`SwitchAccountCard`) : déconnexion consentie,
>   token préservé, clés i18n `auth:acceptInvite.wrongAccount.*` (EN/FR).
>   Détails et pièges : `KNOWN_ISSUES.md` « Invitation : signup sans vérification
>   email (token-gated) ».

## v1.10.0 — 16/06/2026 à 15:30 — Tableau de bord repensé

Le tableau de bord adopte une mise en page plus éditoriale et plus dense.

- Une **carte héros** met en avant la **valeur estimée du portefeuille** (NAV),
  avec un badge **TVPI** et une **courbe d'évolution** mensuelle.
- Les indicateurs clés passent en grille **2×2** : Capital déployé (sur N
  participations), Distribué (avec le **DPI**), Trésorerie (nombre de comptes
  connectés) et Participations (nombre de deals actifs).
- En bas, **Répartition par instrument** (barres) et **Activité récente** (les 5
  dernières opérations, débits en rouge / crédits en vert) côte à côte, avec le
  lien vers la trésorerie.

> **🔧 Notes techniques**
> - `convex/dashboard.ts` (`getDashboard`) : ajout de `accountsCount` (comptes
>   EUR non archivés) et de `navSeries` (série NAV mensuelle, plafonnée à ~24
>   points). Les transactions et valuations sont désormais lues une seule fois
>   par deal — passe unique réutilisée pour les totaux **et** la série — donc le
>   dernier point de la courbe réconcilie avec le NAV ponctuel. Le DPI
>   (distribué / déployé) est calculé côté client.
> - Refonte de `src/routes/app/$orgSlug/index.tsx` en composants
>   `src/components/dashboard/{HeroCard,AllocationCard,ActivityCard}.tsx` :
>   sparkline recharts en import dynamique (fill via `--chart-1`), barres
>   d'allocation au token accent en opacité dégressive (pas de couleur en dur),
>   lignes d'activité avec `directionTone`. `KpiCard` réutilisée. Nouvelles clés
>   i18n `dashboard` FR/EN : `overview`, `hero.*`, `kpi.dpi*`,
>   `kpi.deployedHint*`, `kpi.accounts*`.

## v1.9.0 — 16/06/2026 à 10:45 — Trésorerie unifiée : Aperçu + Transactions

Le Pointage rejoint la Trésorerie : une seule entrée de menu, deux onglets.

- **Aperçu** : la courbe de trésorerie passe **tout en haut**, suivie du solde
  et des comptes, de la TVA récupérable, puis du prévisionnel (règles
  d'entrées/sorties récurrentes — inchangé).
- **Transactions** : un registre complet façon Pennylane, avec **toutes** les
  transactions de tous les comptes. Une transaction rapprochée ne disparaît
  plus — elle reste visible avec son statut. « À pointer » devient un simple
  filtre (par défaut, avec son compteur), aux côtés de Tout / Pointé / Charges
  / Impôts / Produits / Virements internes ; on peut aussi filtrer par compte
  et rechercher. Le rapprochement se fait directement dans le tableau, et on
  peut détacher une ligne déjà pointée d'un clic.

L'ancien menu « Pointage » disparaît ; les anciens liens vers cette page
redirigent automatiquement vers l'onglet Transactions.

Nouveau thème de couleur **« Albo (orange) »** dans le sélecteur de thème.

> **🔧 Notes techniques**
>
> - Backend : `convex/transactions.ts` gagne `listLedger` (registre complet,
>   filtres `status?`/`bankAccountId?`/`search?`, enrichi du compte, borné aux
>   `LEDGER_LIMIT = 1000` plus récentes, plus récent d'abord — choix d'index
>   selon le filtre, post-filtre compte en JS quand l'index de recherche ne
>   peut l'appliquer) et `countByStatus` (badge « À pointer »). Mutations de
>   pointage réutilisées telles quelles.
> - `PointageTable.tsx` paramétré par `statusColumn` : colonne Statut + action
>   par ligne résolue selon `matchStatus` (match/écarter pour unmatched, sélecteur
>   TVA + Détacher pour charge/produit, Détacher sinon). Le bandeau « Annuler »
>   transitoire reste réservé à l'inbox « À pointer » ; en mode registre la
>   ligne reste visible via la réactivité. `DiscardedTable` supprimée (couverte
>   par le registre). `TxDetails` (`TransactionSheet.tsx`) gagne `matchStatus?`
>   et `allocation?`.
> - Nouveau `src/components/cash/TransactionsLedger.tsx` (filtres statut/compte/
>   recherche → `PointageTable` en mode `statusColumn`).
> - `cash.index.tsx` : page à 2 onglets via `validateSearch` `?tab=` (optionnel,
>   défaut Aperçu). `ForecastSection.tsx` scindé en `ForecastChartCard` (courbe,
>   en haut) et `ForecastRulesSection` (règles, en bas).
> - `pointage.index.tsx` → redirect `beforeLoad` vers `/cash?tab=transactions`.
>   `nav.ts` (item Pointage retiré), `VatCard.tsx` (lien « à qualifier » →
>   registre), `ThemePicker.tsx` + `brand.css` (`data-theme='albo'`,
>   `oklch(0.588 0.17 36.5)`), i18n `cash`/`pointage`/`nav` (en+fr).
> - Plafond du registre documenté dans `KNOWN_ISSUES.md` « Registre Transactions ».

## v1.8.0 — 15/06/2026 à 16:52 — Logos des entreprises du portefeuille

Les participations affichent désormais le logo de chaque société : dans la
liste des participations (par véhicule et dans la vue consolidée) ainsi qu'en
en-tête de la fiche société. Quand le logo n'est pas disponible (société sans
site renseigné), une icône neutre prend le relais — aucune image cassée.

> **🔧 Notes techniques**
>
> - Nouveau composant `src/components/CompanyLogo.tsx` : URL CDN logo.dev
>   construite côté client depuis `companies.domain` + clé publishable
>   `VITE_LOGO_DEV_TOKEN` ; fallback `Building2` sur domaine/token absent ou
>   `onError`. **Pas de stockage** (hotlink CDN, cf. `KNOWN_ISSUES.md`
>   « Logos d'entreprises »).
> - `domain` remonté dans l'enrichissement des deals (`companyRef` de
>   `convex/deals.ts` et `convex/aggregate.ts`) puis threadé dans
>   `ParticipationsTable.tsx` (type `DealRow.target`, groupe) ; logo ajouté à
>   l'en-tête de `routes/app/$orgSlug/participations.$companyId.tsx`.
> - Le `domain` provient du snapshot Attio figé (`attioAlboImport.ts`),
>   éditable via `EditCompanyDialog`. Env var publishable à poser
>   (`.env.example`, Vercel).

## v1.7.5 — 15/06/2026 à 16:28 — Outillage : assistant Resend dans Claude Code

Outillage développeur, rien ne change dans l'app : le plugin Resend officiel
pour Claude Code est désormais activé dans le dépôt — Claude peut envoyer et
inspecter les emails Resend directement pendant le développement.

> **🔧 Notes techniques**
>
> - `.claude/settings.json` : `enabledPlugins: { "resend@claude-plugins-official": true }`
>   (serveur MCP + skills Resend, auto-update via le marketplace officiel, donc
>   hors `skills-lock.json`).
> - La clé `RESEND_API_KEY` du plugin se met dans le gitignored
>   `.claude/settings.local.json` (`env`), **distincte** de la clé runtime de
>   l'app (Convex env, `convex/email.ts`).
> - `KNOWN_ISSUES.md` § « Resend: two integrations » documente le piège des
>   deux clés homonymes.

## v1.7.4 — 15/06/2026 à 15:17 — Note interne : pourquoi l'assistant tourne sur Mistral

Note interne pour l'équipe : la raison du choix de Mistral pour l'assistant —
souveraineté des données en Europe, coût, et choix volontairement réversible —
est désormais consignée. Rien ne change à l'usage.

> **🔧 Notes techniques**
>
> - Nouvelle section « Why Mistral (and not Claude) » dans `KNOWN_ISSUES.md` :
>   résidence EU de la donnée, coût sur le volume d'appels multi-outils, et
>   réversibilité via `getModel()` (`convex/agent.ts`). Complète les sections
>   mécaniques existantes (« Mistral model id », « Mistral prompt caching »).

## v1.7.3 — 15/06/2026 à 13:58 — Lisibilité des montants du tableau de bord

Sur le tableau de bord, les gros montants des tuiles (capital déployé, NAV,
trésorerie…) débordaient de leur carte : le symbole € et les séparateurs de
milliers étaient rognés. Ils s'affichent désormais en notation abrégée —
« 54,0 M€ », « 6,2 M€ » — et le montant exact apparaît en survolant la tuile.
Les barres de défilement, jusqu'ici visibles un peu partout, sont également
masquées pour une interface plus nette (le défilement reste inchangé).

> **🔧 Notes techniques**
>
> - Nouveau formateur `fmtEurCompact` dans `useFormatters()`
>   (`src/components/participations/ParticipationsTable.tsx`) : `Intl.NumberFormat`
>   en `notation: 'compact'`, 1 décimale.
> - `KpiCard` (`src/components/dashboard/KpiCard.tsx`) gagne une prop `title`
>   (tooltip natif du montant exact) ; valeur passée en `tabular-nums
>   whitespace-nowrap`.
> - Tableau de bord (`src/routes/app/$orgSlug/index.tsx`) : KPI monétaires
>   (deployed/distributed/cash/nav) en compact, montant complet en `title`.
> - Masquage global des scrollbars natives dans `src/styles/app.css`
>   (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) ; le
>   pouce custom de `ScrollArea` (Radix, un div) n'est pas affecté.

## v1.7.2 — 12/06/2026 à 16:05 — Documentation du connecteur Claude

Mise à jour purement documentaire, rien ne change à l'écran.

> **🔧 Notes techniques**
>
> - `KNOWN_ISSUES.md` § « Serveur MCP distant » : claude.ai fige les
>   schémas d'outils à la connexion du connecteur → après un déploiement
>   qui les modifie, déconnecter/reconnecter le connecteur (constat du
>   test live de la v1.7.1).

## v1.7.1 — 12/06/2026 à 15:02 — Connecteur Claude : fini les organisations devinées

Amélioration du connecteur Claude : vos organisations (et uniquement les
vôtres) sont désormais annoncées automatiquement à Claude, qui ne peut plus
se tromper de nom quand il interroge vos données. Une nouvelle organisation
créée dans Albo OS apparaît dans le connecteur sans aucune manipulation.

> **🔧 Notes techniques**
>
> - Constat en test : claude.ai ne charge qu'un sous-ensemble des outils
>   par conversation → `listOrgs` peut manquer et le modèle devinait des
>   slugs erronés (`albo-club`).
> - `convex/mcp/server.ts` : à `initialize` et `tools/list` (requêtes
>   authentifiées), les orgs du user sont résolues
>   (`internal.mcp.queries.listOrgsForUser`) et injectées — `enum` sur le
>   paramètre `org` de chaque outil (`orgAwareSchema`) + liste des slugs
>   dans les `instructions` du serveur. Aucun slug en dur ; l'autorisation
>   reste le re-check `readMembership` à chaque `tools/call`.

## v1.7.0 — 12/06/2026 à 11:36 — L'assistant arrive dans Claude (connecteur MCP)

Vos données de pilotage sont désormais consultables directement depuis
Claude (claude.ai, web et mobile) : ajoutez Albo OS comme « connecteur
personnalisé » et posez vos questions — participations, trésorerie, passif,
prévisionnel, valorisations, KPIs. Claude interroge vos données en **lecture
seule**, après connexion avec votre compte Albo OS (chaque utilisateur ne
voit que ses organisations). Aucune écriture possible par ce canal : la
création et la modification restent dans l'app et le bot Telegram.

> **🔧 Notes techniques**
>
> - `convex/mcp/` : serveur MCP distant Streamable HTTP **stateless** fait
>   main (`server.ts` — JSON-RPC `initialize`/`tools/list`/`tools/call` ;
>   le SDK MCP officiel est Node-only, incompatible avec le runtime des
>   httpActions Convex). Registre de 18 outils lecture (`registry.ts`,
>   schémas zod v4 → `z.toJSONSchema`) qui réutilise les internals des
>   outils agent (`{orgId, actorUserId}` + `readMembership`) ; résolutions
>   user BA → `users` et slug → org dans `queries.ts`.
> - OAuth 2.1 : plugin Better Auth `mcp({ loginPage: '/login' })` (DCR +
>   PKCE ; tables `oauthApplication`/`oauthAccessToken` déjà présentes dans
>   le composant Convex BA). Métadonnées RFC 9728 servies sur convex.site,
>   RFC 8414 au root du domaine app
>   (`src/routes/[.]well-known.oauth-authorization-server.ts`). Reprise du
>   flow après login dans `/login` via `callbackURL` (survit au roundtrip
>   email du magic link).
> - Rate limit `mcpToolCall` (60/min/user), 401 + `WWW-Authenticate`,
>   bypass dev `MCP_DEV_TOKEN`/`MCP_DEV_EMAIL` pour curl/Inspector. Pièges
>   et fallbacks : `KNOWN_ISSUES.md` « Serveur MCP distant ».

## v1.6.4 — 11/06/2026 à 19:05 — Garde-fou : les sauvegardes de données ne partent plus dans le code

Changement purement technique, rien ne change à l'écran : les sauvegardes
de la base de données (créées avant chaque opération sensible) sont
désormais automatiquement exclues du dépôt de code, pour éviter tout risque
de fuite de données.

> **🔧 Notes techniques**
>
> - Ajout de `/albo-backup*.zip` au `.gitignore` : les snapshots produits
>   par l'étape `convex export --prod --path …` (runbook `MIGRATIONS.md`)
>   ne peuvent plus être commités par mégarde. Le repo est **public** → un
>   dump de données prod commité serait une fuite. Aucun zip n'était suivi
>   jusqu'ici ; protection préventive.

## v1.6.3 — 11/06/2026 à 18:29 — Raccordement au template Ouvre-Boîte

Mise à jour technique, rien ne change à l'écran : Albo OS est désormais
raccordé à son template d'origine, ce qui permettra de récupérer proprement
ses futures améliorations de socle (authentification, sécurité, outillage).

> **🔧 Notes techniques**
>
> - Merge `-s ours` de `template/main` (albo-ouvre-boite) : enregistre le
>   lien de parenté sans adopter de code — les prochains
>   `pnpm run upgrade-template` seront des merges 3-way propres.
> - Adoptés explicitement : `.template-version` (v0.2.0), `UPGRADING.md`
>   (lien changelog repointé vers le repo template),
>   `scripts/upgrade-template.mjs` (version capable de graft).
> - Volontairement non repris (déjà refait ici, ou machinerie propre au
>   template) : WhatsNew.tsx, README.product, release-tag.yml, notif
>   signup, bumps de majors (Renovate). Détail et conséquences dans
>   `KNOWN_ISSUES.md` § « Upgrade depuis le template ».

## v1.6.2 — 11/06/2026 à 18:20 — Nettoyage final de la migration précédente

Suite et fin de la correction v1.6.1 : suppression de l'ancien emplacement
de la « dernière organisation visitée », désormais inutile. Aucun
changement visible dans l'app.

> **🔧 Notes techniques**
>
> - Retrait du champ legacy `users.lastOrgSlug` du schéma, du fallback de
>   lecture dans `convex/lib/userPrefs.ts:getLastOrgSlug`, du nettoyage
>   legacy dans `admin:purgeExcept` et de la mutation one-shot
>   `users:purgeLegacyLastOrgSlug` (chantier `MIGRATIONS.md` soldé).
> - ⚠️ Pré-requis au merge : avoir exécuté la purge en prod
>   (`pnpm exec convex run --prod users:purgeLegacyLastOrgSlug`) — sinon
>   la validation de schéma fait échouer le `convex deploy` du build
>   Vercel (garde-fou voulu, la prod en place n'est pas affectée).

## v1.6.1 — 11/06/2026 à 18:11 — Consommation de données divisée, fin d'une boucle invisible

L'application relisait inutilement vos données en continu : garder deux
onglets ouverts sur deux organisations différentes déclenchait une boucle
invisible où chaque onglet réécrivait sans fin la « dernière organisation
visitée », forçant tout l'écran à se recharger des milliers de fois. C'est
corrigé — la consommation de données du compte redescend très nettement, et
l'app ne refait plus de travail en arrière-plan quand rien n'a changé.

> **🔧 Notes techniques**
>
> - Cause racine double : (1) `setLastOrg` patchait la ligne `users`, lue
>   par `requireAppUser` dans **toutes** les queries → chaque write
>   ré-exécutait toutes les subscriptions ouvertes ; (2) l'effect de
>   `src/routes/app/$orgSlug/route.tsx` dépendait de `users.me` → deux
>   onglets sur deux orgs se ré-écrivaient en ping-pong (~16K mutations,
>   4,83 GB de DB bandwidth sur le quota Free de 1 GB).
> - `lastOrgSlug` déplacé vers la nouvelle table `userPrefs` (index
>   `by_user`, helpers `convex/lib/userPrefs.ts`), lue par `users.me` avec
>   fallback sur le champ legacy ; writers migrés (`setLastOrg`,
>   `organizations.create`, `invitations.accept`, purge `admin`).
> - Front : garde `lastOrgSyncedRef` — on ne persiste qu'une fois par slug
>   visité, plus jamais en réaction à un update de `me`.
> - Champ legacy `users.lastOrgSlug` conservé en lecture seule ; purge
>   one-shot `users:purgeLegacyLastOrgSlug` (migre la valeur vers
>   `userPrefs` puis nettoie — exécutable dès le déploiement, runbook
>   `MIGRATIONS.md`).
> - Audit perf annexe : RAS de comparable ; `Date.now()` dans les queries
>   forecast (cache défait) → wontfix documenté dans `KNOWN_ISSUES.md`,
>   à ré-évaluer si ces queries montent dans le breakdown Usage.
> - Docs : `KNOWN_ISSUES.md` « Hot `users` row », anti-pattern `CLAUDE.md`,
>   TESTING A2b (test anti-boucle 2 onglets).

## v1.6.0 — 11/06/2026 à 17:45 — L'assistant arrive sur Telegram

Vous pouvez désormais parler à l'assistant directement depuis Telegram,
comme à n'importe quel contact : posez vos questions sur le portefeuille,
le cash ou le passif depuis votre téléphone, sans ouvrir l'application.
Les actions d'écriture (créer une transaction, pointer, etc.) restent
protégées : l'assistant propose l'action et vous la validez d'un bouton
Confirmer ou Refuser, exactement comme dans l'app. Deux commandes
accompagnent le bot : « /new » pour repartir sur une conversation vierge
et « /org » pour changer de véhicule d'investissement. L'accès est
strictement réservé aux comptes liés par un code fourni par
l'administrateur. En coulisses, le coût des conversations avec
l'assistant a aussi été fortement optimisé (mise en cache du contexte).

> **🔧 Notes techniques**
>
> - `convex/telegram.ts` (nouveau) : webhook `/telegram/webhook` (secret
>   token vérifié en temps constant, ACK immédiat + worker schedulé),
>   table `telegramAccounts` (linking par code one-shot via le runbook CLI
>   `telegram:createLinkCode`, org courante + thread courant par compte),
>   tour d'agent non streamé (`chatAgent.generateText` + typing),
>   approbations en inline keyboard reprises via `promptMessageId` (même
>   contrat que `chat.respondToToolApproval`, cf. KNOWN_ISSUES).
> - Prompt caching Mistral (commit séparé) : `prompt_cache_key` injecté
>   par un `fetch` custom dans `createMistral` (`convex/agent.ts`,
>   `@ai-sdk/mistral` 3.0.37 n'a pas l'option) + `usageHandler` loggant
>   `llm_usage` (input/output/cacheRead) par appel LLM.
> - Setup one-time documenté dans le README « Telegram bot » ; checklist
>   TESTING « Bot Telegram » (T1–T12).

## v1.5.3 — 11/06/2026 à 17:07 — Notes techniques sur chaque nouveauté

Chaque mise à jour de cette page se termine désormais par un court encadré
« Notes techniques » qui résume, pour les développeurs (et les IA) qui
reprennent le code, ce qui a été fait sous le capot — y compris sur toutes
les mises à jour passées.

> **🔧 Notes techniques**
>
> - Rétrofit d'un blockquote « 🔧 Notes techniques » (synthèse façon
>   description de PR, reconstituée depuis les messages de commit) sur
>   toutes les entrées existantes de `CHANGELOG_PRODUIT.md`.
> - Règle pérennisée dans `CLAUDE.md` (pre-PR doc audit, question 5) :
>   toute nouvelle entrée doit porter la section ; en-tête du fichier et
>   ligne SH12 de `TESTING.md` mis à jour.
> - Format blockquote (pas `<details>`) : `/app/$orgSlug/changelog` rend
>   via react-markdown sans `rehype-raw`, le HTML brut serait ignoré.
>   Aucun changement de code.

## v1.5.2 — 11/06/2026 à 11:40 — Tableau de bord et pointage plus rapides

Le tableau de bord d'une organisation s'affiche désormais quasi
instantanément (il relisait tout l'historique bancaire à chaque ouverture),
et les tables de pointage chargent nettement plus vite. Pointer une
transaction ne fait plus recharger toute la page : chaque clic de la file
est maintenant immédiat. L'assistant répond aussi plus vite quand il
consulte la synthèse de l'organisation, et il sait maintenant dire
correctement quel moteur le propulse (Mistral Medium 3.5) quand on le lui
demande.

> **🔧 Notes techniques**
>
> - `getDashboard` et l'outil agent `getDashboardSummary` ne scannent plus
>   toutes les transactions de l'org : lectures par deal via l'index
>   `by_deal`.
> - `listUnmatched` / `listByStatus` : plus de `db.get` compte par ligne —
>   une Map des comptes de l'org chargée une fois.
> - Pointage : comboboxes branchées sur les nouvelles queries légères
>   `deals.listOptions` / `liabilities.listOptions` (zéro lecture de
>   transactions), au lieu de `deals.list` + `getLiabilities` qui se
>   réinvalidaient à chaque clic de pointage.
> - Prompt système : déclare l'id du modèle configuré (source unique
>   `MISTRAL_MODEL` lue dans `convex/lib/instructions.ts`) — interrogé,
>   l'agent répondait « Mistral Large 2 » faute de connaître son
>   déploiement.

## v1.5.1 — 11/06/2026 à 10:21 — Passage de l'assistant IA sur Mistral

L'assistant intégré (panneau ⌘J) tourne désormais sur Mistral Medium 3.5. Mêmes outils, mêmes conversations — seul le moteur de réponse change.

> **🔧 Notes techniques** — `@ai-sdk/anthropic` remplacé par
> `@ai-sdk/mistral` dans `convex/agent.ts` ; modèle par défaut
> `mistral-medium-3.5`, override via la variable d'env Convex
> `MISTRAL_MODEL`, clé dans `MISTRAL_API_KEY`. Wizards de setup, hints du
> smoke test et docs alignés.

## v1.5.0 — 11/06/2026 à 10:20 — L'assistant agit, vous validez d'un clic

### ✅ Confirmer une action en un clic

Quand l'assistant s'apprête à écrire quelque chose (créer un deal, pointer
une transaction, ajouter une valorisation…), il ne demande plus un « oui »
dans la conversation : un bloc **Confirmer / Refuser** apparaît directement
sous l'action proposée, avec les valeurs exactes qui seront enregistrées.
Rien ne s'écrit sans votre clic — c'est désormais garanti par l'application
elle-même, plus seulement par la consigne donnée à l'IA. Une demande
laissée en attente est automatiquement annulée si la conversation repart
sur autre chose, et l'historique garde la trace de ce qui a été confirmé
ou refusé.

### 📊 Des réponses qui se lisent d'un coup d'œil

Quand l'assistant consulte vos données, le résultat s'affiche désormais en
clair : tableau des participations (cliquable — chaque ligne ouvre la page
du deal), totaux et lignes des recherches de transactions, projection de
trésorerie mois par mois, passif groupé, valorisations. Le détail technique
reste disponible dans le bloc dépliable. Et sur les suggestions de
pointage, un bouton **« Pointer »** rattache la transaction immédiatement,
sans repasser par la conversation.

### 🧰 Un assistant qui couvre (presque) tout

L'assistant sait maintenant : résumer l'organisation (« où en est-on ? »),
donner la position de TVA, lister les documents d'une société, classer
plusieurs transactions d'un coup (une seule confirmation pour le lot),
gérer le prévisionnel de bout en bout (modifier ou supprimer une règle,
ajouter/modifier/annuler une échéance ponctuelle), corriger le passif et
détacher une transaction mal allouée, renommer un compte bancaire et
mettre à jour la fiche d'une société. Les suppressions importantes restent
volontairement réservées à l'application.

### 💡 Des suggestions qui suivent votre page

À l'ouverture d'une nouvelle conversation, les suggestions s'adaptent à
l'écran où vous êtes : sur le Pointage, l'assistant propose de pointer les
transactions en attente ; sur la Trésorerie, la position de cash et la
TVA ; sur le Passif, les comptes courants — et ainsi de suite.

### 📋 En préparation

La feuille de route de l'assistant (pièces jointes, brief proactif) et un
guide des bonnes pratiques rejoignent la documentation du projet.

> **🔧 Notes techniques**
>
> - Bump `@convex-dev/agent` 0.6.3 (support natif `needsApproval` /
>   `approveToolCall`) ; mutation publique `chat.respondToToolApproval`
>   (gardes org+thread, rate-limit `chatSend`, enregistrement de la
>   décision puis reprise du stream via `promptMessageId`).
> - `needsApproval: true` posé sur tous les outils d'écriture ; composant
>   ai-elements `Confirmation` branché sur les états de tool part
>   `approval-requested` / `responded` / `output-denied` ; libellés i18n
>   en/fr ; system prompt débarrassé de la confirmation conversationnelle.
> - 14 nouveaux outils (~41 au total) : `getDashboardSummary`,
>   `getVatPosition`, `listCompanyDocuments`, `bulkCategorizeTransactions`
>   (lot max 50, une seule approbation), forecast complet (update/delete
>   de règle, entrées manuelles/override/annulation), updates passif +
>   `deallocateTransaction`, `updateCompany`, `renameBankAccount` —
>   helpers métier existants réutilisés, suppressions hors agent (sauf
>   `deleteForecastRule`).
> - Rendu riche des résultats d'outils : 7 renderers (deals, transactions,
>   suggestions de pointage, forecast, passif, valorisations) avec liens
>   profonds vers les pages et bouton « Pointer » direct (mutation
>   publique, sans repasser par le modèle) ; fallback JSON conservé.
> - Suggestions de l'état vide contextuelles à la route courante. Docs :
>   `KNOWN_ISSUES.md` « Approbation d'outils », TESTING C27–C30.

---

## v1.4.0 — 11/06/2026 à 15:05 — Toutes les listes paginées, entrée dans l'app plus directe

### 📄 Des listes qui restent fluides partout

Après la page Pointage, toutes les grandes listes passent en pages de 50
lignes : les participations (vue par organisation et vue « Tout »), les
transactions d'un deal et celles d'un compte bancaire. Comme sur le
Pointage, la recherche, le tri, les totaux et l'export CSV continuent de
porter sur l'ensemble des données, pas seulement la page affichée.

### ⚡ Fini le « redirection… puis chargement… » à l'ouverture

L'app vous amène désormais directement sur votre dernière organisation, en
une seule étape : la redirection se décide immédiatement, avant même le
chargement de vos données. Sur un nouvel appareil, l'app retrouve votre
dernière organisation comme avant.

> **🔧 Notes techniques**
>
> - `usePagination` / `PaginationFooter` extraits dans
>   `src/components/data-table/LocalPagination.tsx` et appliqués aux
>   tables qui grossissent avec l'usage : participations (vue par-org +
>   vue agrégée `/app/all`), transactions d'un deal, transactions d'un
>   compte bancaire. Recherche, tri, totaux, export CSV et Versé/Reçu
>   opèrent toujours sur la liste complète ; les tables bornées par nature
>   (membres, comptes, passif, règles forecast, admin) restent sans
>   pagination.
> - `/` redirige vers `/app` en `beforeLoad` (307 serveur, plus d'écran
>   « redirecting » hydraté) ; `/app` redirige vers la dernière org via le
>   cookie `last_org_slug` (lecture isomorphe, `src/lib/lastOrg.ts`), sans
>   attendre l'auth Convex ; fallback `users.lastOrgSlug`. Le layout d'org
>   écrit le cookie à chaque visite et l'efface avant de bouncer un
>   non-membre (anti-boucle). Smoke test adapté aux 307 attendus.

---

## v1.3.4 — 11/06/2026 à 15:00 — Infrastructure de mise à jour des skills agents durcie

Les skills agents (instructions données à l'IA pour utiliser les librairies du projet) sont désormais épinglés à un commit immuable plutôt qu'à une branche mouvante. La source de la skill TanStack Start passe du repo communautaire `deckardger` vers le monorepo officiel TanStack. Une nouvelle commande (`sync:skills:update`) permet de faire des bumps délibérés et reviewables, distincts du simple vendoring reproductible.

> **🔧 Notes techniques**
>
> - `skills-lock.json` : deux refs par skill — `trackingRef` (branche
>   surveillée pour la dérive) et `pinnedRef` (SHA immuable réellement
>   vendorisé). Les bumps deviennent délibérés et diffables.
> - `scripts/sync-skills.mjs` : mode `--update` qui résout le tip du
>   `trackingRef` via l'API GitHub et avance le `pinnedRef` ; `--check`
>   compare au tip sans toucher le pin. La GitHub Action hebdo passe sur
>   `sync:skills:update`.
> - `tanstack-start-best-practices` re-sourcée de
>   `deckardger/tanstack-agent-skills` vers `TanStack/router`
>   (first-party, versionnée avec les releases de
>   `@tanstack/react-start`).

---

## v1.3.3 — 11/06/2026 à 09:46 — Nettoyage interne

Harmonisation interne du code (commentaires unifiés en anglais). Aucun
changement visible dans l'app.

> **🔧 Notes techniques** — sweep commentaires uniquement sur 85 fichiers
> (`src/`, `convex/`, `tests/`, `scripts/`) : tous les commentaires
> français (`//`, `/* */`, JSDoc, JSX, CSS) passent en anglais. Chaînes
> i18n, templates email, prompts agent et seeds intacts. Règle ajoutée aux
> anti-patterns de `CLAUDE.md`.

---

## v1.3.2 — 11/06/2026 à 01:10 — Nettoyage après la réindexation

Retrait de l'étape technique ponctuelle qui a réindexé l'historique des
transactions lors de la mise à jour précédente. Aucun changement visible
dans l'app.

> **🔧 Notes techniques** — `build:vercel` revient à `convex deploy` seul,
> les backfills one-shot de la v1.3.1 ayant tourné au déploiement (logs
> Vercel : `backfillSearchText` 1278 lignes mises à jour,
> `backfillMatchStatus` rien à reprendre).

---

## v1.3.1 — 11/06/2026 à 00:50 — La recherche retrouve les transactions historiques

Chercher « Antese » dans les transactions pouvait ne rien renvoyer alors que
les lignes existaient bel et bien : les transactions importées avant
l'arrivée de la recherche (historique Mémo Bank, premières synchros
bancaires) n'étaient pas indexées — ni pour la barre de recherche, ni pour
l'assistant. C'est corrigé : l'historique complet redevient cherchable, et
les lignes de l'import Mémo Bank apparaissent désormais correctement dans la
file de pointage.

> **🔧 Notes techniques**
>
> - Cause : les transactions écrites avant l'arrivée du champ dérivé
>   `searchText` (import CSV Mémo Bank, premières syncs Powens) n'étaient
>   indexées ni pour la recherche UI ni pour l'outil agent.
> - `importMemoCsvTransactions` pose désormais `matchStatus: 'unmatched'`
>   à l'insert (sinon les lignes manquaient aussi à la file de pointage).
> - Backfills internes `backfillSearchText` / `backfillMatchStatus`
>   (arg `{}` = toutes les orgs), exécutés une fois au déploiement via
>   `build:vercel` (étape temporaire retirée en v1.3.2). Docs :
>   `KNOWN_ISSUES.md`, `MIGRATIONS.md`.

---

## v1.3.0 — 11/06/2026 à 00:20 — Page Pointage fluide même avec beaucoup de transactions

La page Pointage affiche désormais ses transactions par pages de 50 lignes
(boutons Précédent / Suivant sous le tableau), au lieu de tout dérouler d'un
bloc. Fini les ralentissements quand la file ou un onglet contient des
centaines de lignes. Rien ne change pour le reste : le compteur « N à
pointer », la recherche, les onglets et la sélection multiple continuent de
porter sur l'ensemble des transactions, pas seulement la page affichée.

> **🔧 Notes techniques** — pagination purement côté rendu (50 lignes par
> page) sur les tables de la page Pointage ; les queries Convex sont
> inchangées : compteur, sélection bulk et sa purge, recherche et onglets
> opèrent toujours sur la liste complète (filtrage serveur en amont).
> Changement de recherche/onglet ramène à la page 1 ; la page courante se
> borne quand la liste rétrécit.

---

## v1.2.1 — 11/06/2026 à 00:10 — Fondations remises à neuf

Les briques techniques de navigation et de connexion passent sur leurs
dernières versions corrigées, jusqu'ici gelées à cause de défauts en amont.
Aucun changement visible dans l'app.

> **🔧 Notes techniques** — retrait des `pnpm.overrides` : TanStack résout
> de nouveau un `router-core` unique (1.171.13, le typage
> `server.handlers` tient sans pin) et better-auth 1.6.16 épingle
> better-call 1.3.6 (`openapi.mjs`/`validator.mjs` restaurés). Règle de
> gel Renovate et section `KNOWN_ISSUES.md` correspondante supprimées.
> Vérifié : lint, 70/70 tests unitaires, build.

---

## v1.2.0 — 10/06/2026 à 23:35 — Un assistant qui se manie comme les grands

### 💬 Une vraie zone de saisie

La zone de saisie de l'assistant passe en **multiligne** : Entrée envoie,
**Maj+Entrée** va à la ligne, et le champ **grandit avec votre texte** — fini
le message long invisible dans une ligne unique. Pendant que l'assistant
répond, le bouton d'envoi devient un **bouton stop**.

### ✨ Une conversation plus fluide

Le fil **suit la réponse en cours d'écriture** ; si vous remontez relire un
passage, il vous laisse tranquille et un bouton permet de **revenir en bas**
d'un clic. Une nouvelle conversation propose des **suggestions de départ**
(position de cash, passif, projection, valorisations), et quand l'assistant
consulte vos données, son travail s'affiche dans un **bloc dépliable** —
statut, demande, résultat.

### ⌨️ Au clavier

**⌘J / Ctrl+J** ouvre et ferme le panneau de l'assistant, prêt à taper.

> **🔧 Notes techniques**
>
> - Rendu maison du panneau (input mono-ligne, scroll manuel,
>   react-markdown) remplacé par les composants Vercel AI Elements
>   vendorés dans `src/components/ai-elements/` (registry 403 depuis le
>   réseau restreint → sources GitHub, imports réécrits).
> - `PromptInput` : textarea auto-grow (cap ~12rem), garde IME, stop
>   intégré au bouton d'envoi ; `Conversation` stick-to-bottom ; markdown
>   streaming via `streamdown` (plugins Shiki/KaTeX/Mermaid trimés,
>   `@source` Tailwind v4 dans `app.css`) ; tool calls en blocs dépliables
>   (labels i18n) ; suggestions métier sur l'état vide ; ⌘J/Ctrl+J toggle
>   - focus du composer.
> - Threads/rename/delete et toute la couche Convex (`sendMessage`,
>   `stopStream`, `useUIMessages`) inchangés. Skill `ai-elements` ajoutée
>   à `skills-lock.json` ; trims documentés dans `KNOWN_ISSUES.md`
>   « Streamdown ».

---

## v1.1.1 — 10/06/2026 à 23:30 — Ménage des branches de travail

Un nettoyage à la demande supprime les anciennes branches de travail déjà
intégrées. Aucun changement visible dans l'app.

> **🔧 Notes techniques** — workflow GitHub Actions à déclenchement manuel
> qui supprime les branches dont la PR est mergée (35+ branches `claude/*`
> accumulées : les sessions ne peuvent pas supprimer leurs refs via le
> proxy git). PRs ouvertes et branches sans PR préservées.

---

## v1.1.0 — 10/06/2026 à 22:58 — La TVA récupérable, suivie au plus près

Un vrai suivi de TVA fait son entrée pour fiabiliser les charges réelles :

- **Un taux de TVA sur chaque charge et produit.** Quand vous classez une
  transaction en charge, elle part avec 20 % de TVA par défaut — ajustable
  ligne à ligne (0 %, 5,5 %, 10 %, 20 %) dans les onglets Charges et
  Produits du pointage. Les transactions déjà classées sont marquées
  « à qualifier » : à vous de poser le bon taux (les salaires, assurances et
  frais bancaires n'ont pas de TVA — pas de calcul global trompeur).
- **Une carte « TVA récupérable » sur la page Trésorerie** : la TVA
  déductible de vos charges moins la TVA collectée sur vos produits, avec le
  nombre de transactions restant à qualifier. De quoi savoir où en est votre
  créance de TVA pour le prévisionnel.
- **L'assistant sait maintenant chercher dans toutes les transactions.**
  « Combien a-t-on payé à Antese au total ? » : il retrouve tous les
  paiements d'un fournisseur (rapprochés ou non) et répond avec les totaux —
  TTC, et TVA incluse quand les lignes sont qualifiées.
- **Le vert et le rouge partout.** Les badges Entrée/Sortie des deals et
  Créance/Dette du passif passent en couleur, les entrées oubliées en noir
  (dashboard, prévisionnel) passent au vert — le sens d'un mouvement se lit
  désormais d'un coup d'œil sur toutes les pages.

> **🔧 Notes techniques**
>
> - Taux de TVA par transaction (basis points : 0/550/1000/2000), défaut
>   20 % à la catégorisation en charge ; la TVA est toujours dérivée du
>   TTC, jamais stockée. Carte « TVA récupérable » (déductible −
>   collectée + compteur « à qualifier ») sur la page Trésorerie.
> - Agent : nouvel outil `searchTransactions` (tous statuts, totaux
>   pré-agrégés TTC + TVA) ; `categorizeTransaction` accepte le taux de
>   TVA.
> - UI : token `--positive` + helpers `moneyTone`, badges Entrée/Sortie et
>   Créance/Dette teintés, verts manquants ajoutés (dashboard,
>   prévisionnel, plan vs réel, delta KPI).

---

## v1.0.3 — 10/06/2026 à 22:38 — Nettoyage de l'outillage interne

Suppression d'un automatisme de publication qui n'avait jamais fonctionné.
Aucun changement visible dans l'app.

> **🔧 Notes techniques** — retrait du workflow release-please (47/47 runs
> en échec : un réglage d'organisation GitHub bloque la création de PR par
> Actions) et nettoyage de ses mentions dans `CLAUDE.md`, `README.md` et
> `KNOWN_ISSUES.md`. Le versionnage produit vit dans ce fichier.

---

## v1.0.2 — 10/06/2026 à 22:36 — Retouches visuelles du menu latéral

Trois finitions sur l'habillage de l'app : le petit trait vertical à côté
du bouton d'ouverture du menu reprend sa hauteur discrète (il ne barrait
plus toute la barre du haut), le logo de l'organisation s'affiche sans
liseré parasite, et le logo comme la photo de profil gardent leurs
proportions quand le menu est replié en mode icônes.

> **🔧 Notes techniques** — bump `tailwind-merge` v3 pour que les classes
> Tailwind v4 à `!` final (`p-0!`, `p-2!`) se dédupliquent correctement
> (le clipping des boutons de la sidebar repliée venait de là) ; hauteur
> du séparateur du header via le variant `data-[orientation=vertical]` ;
> `bg-sidebar-primary` peint uniquement derrière le fallback du switcher
> d'org, pour que les logos uploadés s'affichent sans halo.

---

## v1.0.1 — 10/06/2026 à 22:13 — Le changelog passe au suivi par version

Chaque évolution porte désormais un numéro de version et la date et l'heure
de sa mise en ligne — cette page devient l'historique précis de l'outil.

> **🔧 Notes techniques** — la question 5 du pre-PR doc audit
> (`CLAUDE.md`) devient inconditionnelle : chaque PR ajoute une entrée
> `## vX.Y.Z — JJ/MM/AAAA à HH:MM — titre` en tête de ce fichier (minor =
> feature visible, patch = fix/technique ; heure d'ouverture de la PR,
> Europe/Paris).

---

## v1.0.0 — 10/06/2026 à 21:58 — Les entrées en vert

Dans toutes les vues de transactions (pointage, comptes bancaires, passif),
les **entrées d'argent s'affichent en vert** — les sorties restent en rouge.
Le sens d'un mouvement se lit d'un coup d'œil.

> **🔧 Notes techniques** — `text-foreground` → `text-emerald-600` pour
> les transactions `direction === 'in'` dans `PointageTable`,
> `TransactionSheet`, la page de compte bancaire et `PassifTables` (les
> sorties restent en `text-destructive`).

---

## Juin 2026 — La finition qui change tout

### 💶 Le passé et le futur sur la même courbe

La courbe de trésorerie montre désormais **le solde réel des 6 derniers
mois** (trait plein) qui se prolonge en **solde projeté** (pointillé) — on
voit d'un coup d'œil d'où l'on vient et où l'on va, sans rupture.

### 📐 Le TVPI partout

La table des participations affiche le **TVPI de chaque société et de
chaque deal** — le multiple qui répond à « pour 1 € investi, combien
j'en ai aujourd'hui ? » (l'argent déjà revenu + ce que la participation
vaut encore). Et toutes les colonnes se **trient d'un clic**.

### 📤 Export Excel

Un bouton **Exporter CSV** sur les participations : la liste filtrée part
dans Excel, prête à retravailler.

### ✏️ Le passif s'édite enfin

Les positions de capital et les comptes courants se **modifient et se
suppriment** directement depuis la page Passif. Garde-fou : une ligne sur
laquelle des transactions sont encore pointées ne peut pas être supprimée —
on détache d'abord, on supprime ensuite.

> **🔧 Notes techniques**
>
> - Passif : mutations update/delete sur `equityPositions` et
>   `intercompanyLoans` ; suppression refusée si des transactions sont
>   encore allouées dessus (`has_allocations`) ; dialogs de création
>   réutilisés en édition.
> - Trésorerie : `getForecastBalance(historyMonths)` reconstruit le solde
>   réel de fin de mois à rebours (`buildMonthlyHistory`, fonction pure
>   testée) ; la courbe fusionne réel (trait plein) et projeté (pointillé)
>   avec jonction au solde courant.
> - Participations : TVPI par deal et par société (dernière valo, fallback
>   coût, 0 si sorti — convention dashboard), tri client sur toutes les
>   colonnes, export CSV (`;` + BOM UTF-8 pour Excel FR) des deals
>   filtrés.
> - Legacy : `seed:purgeLegacyForecasts` + création de `MIGRATIONS.md`
>   (index des opérations data prod, runbook de retrait de la table
>   `forecasts`).

---

## Juin 2026 — Le pilotage en un coup d'œil

### 📊 Un vrai tableau de bord

La page d'accueil de chaque organisation affiche enfin l'essentiel :
**participations actives, capital déployé, distribué, trésorerie, NAV
estimée et TVPI** — calculés en temps réel depuis vos données (NAV = ce
que vaut le portefeuille aujourd'hui ; TVPI = le multiple sur le capital
investi). S'y ajoutent
la répartition du capital par type d'instrument et l'activité bancaire
récente.

### 📉 La trésorerie se projette

Sur la page Trésorerie, une **courbe du solde projeté** (6, 12 ou 24 mois)
part de vos soldes bancaires réels et déroule vos flux récurrents : loyers,
salaires, échéances… Créez et gérez ces **règles récurrentes** directement
sur la page (ou via l'assistant) — la projection se recalcule à chaque
modification, et un passage sous zéro se voit immédiatement.

> **🔧 Notes techniques**
>
> - `convex/dashboard.ts:getDashboard` : participations actives (cibles
>   distinctes), déployé/distribué (Σ des transactions pointées par deal),
>   trésorerie (Σ des soldes EUR réels), NAV estimée (dernière valo par
>   deal, fallback versé + flag `navIsPartial`), répartition par
>   instrument, activité récente.
> - `/app/$orgSlug` : le redirect placeholder devient un vrai dashboard
>   (6 cartes KPI, barres de répartition, activité récente) ; entrée
>   sidebar Dashboard activée.
> - `/app/$orgSlug/cash` : courbe du solde projeté (recharts client-only,
>   ligne de référence 0 si négatif), horizon 6/12/24 mois, CRUD des
>   règles récurrentes avec `expandRules` automatique post-save
>   (idempotent par `derivedKey`) ; `forecasts.listRules` + `deleteRule`
>   (conserve les entrées réalisées/annulées/éditées).

---

## Juin 2026 — Chaque projet a enfin sa vue

Tous les investissements ne se suivent pas pareil. Les pages de deal et de
société s'adaptent maintenant au type de projet.

### 📈 Royalties : le BP face à la réalité

- Saisissez le **business plan initial** (et ses révisions) en le collant
  simplement dans l'assistant — il structure les lignes pour vous.
- La page du deal affiche la **courbe BP initial vs BP révisé vs réalisé**
  (le réalisé vient automatiquement des transactions pointées) et le tableau
  des périodes avec l'écart cumulé, en rouge quand on est en retard sur le
  plan.

### 🏦 Fonds : appelé, distribué, performance

- Les deals de type fonds affichent **Engagé / Appelé / Distribué / DPI /
  TVPI** d'un coup d'œil (appelé = ce que le fonds a réellement demandé ;
  DPI = la part déjà rendue en cash), avec l'historique des valorisations.

### 🏢 Sociétés : reportings et KPIs au même endroit

- **Déposez les reportings** (investor updates, BP, juridique) directement
  sur la page de la société : classés, datés, téléchargeables.
- **Les KPIs s'historisent** : collez un reporting dans l'assistant, il en
  extrait les métriques (ARR, cash, effectifs… et NAV/TVPI pour les fonds) —
  vous confirmez, c'est enregistré.

> **🔧 Notes techniques**
>
> - Schéma : `dealProjections` (BP en lignes datées, versions `initial`
>   figée au closing / `revised` actualisée, unicité (deal, version,
>   période) enforcée par la mutation `replaceVersion`, delete + insert
>   idempotent) ; `documents` (reportings par société, storage Convex
>   20 Mo, source upload) ; `kpiSnapshots` (table existante enfin exposée
>   UI + agent).
> - Backend : `convex/projections.ts`, `convex/kpis.ts`,
>   `convex/documents.ts` (queries/mutations publiques + variantes agent
>   qui re-vérifient l'appartenance) ; outils agent dans
>   `agentToolsProjections.ts` (lister/poser un BP, lister/créer des
>   snapshots KPI).
> - Front : page deal — sections « BP vs réalisé » (recharts client-only,
>   réalisé issu des transactions pointées, écart cumulé vs BP révisé avec
>   fallback initial) et « Fonds » (Engagé/Appelé/Distribué/DPI/TVPI +
>   historique des valos) ; page société — sections KPIs et Reportings &
>   documents ; séries cumulées pures dans `src/lib/projectionSeries.ts`
>   (testées).

## Juin 2026 — L'assistant devient copilote

**En une phrase** : Albo OS passe en AI-first — l'assistant n'est plus un
gadget caché derrière un bouton, c'est un copilote toujours présent à côté de
l'écran, capable de lire **et d'agir** sur tout le portefeuille, jusqu'à
pré-pointer les transactions bancaires.

### ✨ L'assistant, toujours à vos côtés

- **Un panneau dédié, toujours ouvert.** Le chat vit à droite de l'écran et
  vous suit de page en page — la conversation ne se ferme plus jamais toute
  seule. Repliez-le d'un clic, il s'en souvient à votre prochaine visite.
- **Il sait où vous êtes.** Une question posée depuis la page Pointage ou
  Trésorerie est comprise dans son contexte.
- **Des conversations qui se gèrent.** Historique complet, reprise
  automatique de la dernière discussion, renommage, suppression, titre
  automatique.
- **Des réponses enfin lisibles.** Tableaux et listes mis en forme, bouton
  copier, bouton stop, et les actions de l'assistant visibles en temps réel.

### 🤝 Il ne fait plus que répondre — il travaille

- **Pointage intelligent** ⭐ — « suggère-moi des rattachements » : il analyse
  les pointages passés et propose pour chaque transaction en attente le deal
  ou le compte le plus probable, preuves à l'appui. Vous confirmez, il
  pointe. Rien n'est jamais écrit sans votre accord.
- **Prévisionnel de trésorerie** — créer une règle (« loyer de 1 500 € chaque
  5 du mois ») et demander la projection de cash sur 12 mois, directement
  dans la conversation.
- **Valorisations** — « ajoute une valo de 1,2 M€ sur ce deal au 31/12 » :
  enregistré, l'historique se construit.
- **Passif** — consulter capitaux propres et comptes courants inter-entités
  (soldes calculés en temps réel), en créer de nouveaux.
- Toujours là : création de sociétés, deals, comptes et transactions — chaque
  organisation reste strictement cloisonnée.

### 📰 Et ce changelog

- **Les nouveautés, dans l'app.** Cette page « Nouveautés » est accessible en
  bas du menu — chaque release y laisse sa trace, en clair.

### 🛡️ Sous le capot

- Qualité verrouillée : chaque modification passe une batterie complète de
  vérifications automatiques avant déploiement.
- Fiabilité renforcée du pointage : interface et assistant partagent
  exactement les mêmes règles métier.

> **🔧 Notes techniques**
>
> - `AiPanel` persistant dans le layout org (400px desktop, overlay
>   mobile, état en cookie `ai_panel_state` — pattern `sidebar_state`)
>   remplace le slide-over ; threads list/rename/delete + reprise auto du
>   plus récent ; stop via `abortStream` ; contexte de page injecté en
>   system prompt par message (`buildInstructions`,
>   `convex/lib/instructions.ts`, pur + testé) ; titre auto au premier
>   message.
> - Cœur du pointage extrait dans `convex/lib/pointage.ts` (invariants
>   matched ⟺ deal ∨ allocation, miroir `reconciled`, log append-only
>   `matchingDecisions`) — partagé entre mutations publiques et outils
>   agent, zéro divergence de règles.
> - Outils agent par domaine (`agentToolsPointage.ts` puis passif /
>   forecast / valuations, ~23 outils) avec scope key `${orgId}:${userId}`
>   re-vérifiée à chaque appel ; ranking pur des suggestions de pointage
>   dans `convex/lib/suggest.ts` (similarité de libellés + décisions
>   passées + Δ montant vs engagé, testé).
> - CI : job lint → tests unitaires → build + job séparé de dérive des
>   skills ; enum instruments dédupliquée dans
>   `convex/lib/instruments.ts`.
> - Page « Nouveautés » : `/app/$orgSlug/changelog` rend ce fichier via
>   import `?raw` (react-markdown + remark-gfm), lien sidebar.

---

## Petit lexique

- **Pointage** : rattacher une transaction bancaire à ce qu'elle paie ou
  rembourse (un deal, une position de capital, un compte courant). C'est ce
  qui permet de calculer « Versé » et « Reçu » automatiquement, sans saisie.
- **BP (business plan)** : les flux prévus d'un projet, période par période.
  « BP révisé » = la version corrigée quand la réalité a dévié du plan.
- **NAV** : ce que vaut le portefeuille aujourd'hui, d'après les dernières
  valorisations connues (à défaut, le montant investi).
- **TVPI** : (argent déjà récupéré + valeur restante) ÷ argent investi.
  1,50× = pour 1 € mis, 1,50 € de valeur créée.
- **DPI** : pareil, mais en ne comptant que le cash déjà rendu —
  argent récupéré ÷ argent investi.
- **Engagé / Appelé** (fonds) : le montant promis au fonds / la part que le
  fonds a effectivement demandée à ce jour.
- **C/C (compte courant d'associé)** : argent avancé entre deux entités du
  groupe. Son solde n'est jamais saisi à la main : il est calculé depuis les
  transactions pointées dessus.
