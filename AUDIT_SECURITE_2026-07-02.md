# Audit backend — Sécurité / Auth / Multi-tenant / Performance — Albo OS

**Date** : 2026-07-02
**Périmètre** : backend Convex (`convex/`, ~19 000 lignes), lecture seule.
**Nature** : diagnostic priorisé. Aucun code modifié. Chaque constat = un lot
potentiel (une PR par sujet), à arbitrer par Albo.
**Déploiement** : prod `mellow-curlew-738` (eu-west-1). Outil interne, 2 users.

> Toutes les citations de code ont été relues ligne à ligne dans le repo. Les
> constats « théoriques » (timing HMAC, brute-force 128 bits) sont notés comme
> tels et classés en conséquence.

---

## 0. Inventaire (reconnaissance)

**Fonctions Convex** : 117 publiques (`query`/`mutation`/`action`/`httpAction`)
+ 113 internes (`internal*`). Aucun cron déclaré.

**Composants** : `better-auth`, `resend`, `agent`, `rate-limiter`.

**Endpoints HTTP publics** (`convex/http.ts`) :

| Path | Handler | Auth |
| --- | --- | --- |
| `/api/chat` | `chat.streamOverHttp` | Identité Convex (JWT bearer) |
| `/powens/webhook` | `powens.powensWebhook` | HMAC-SHA256 (base64) |
| `/attio/webhook` | `attioSync.attioWebhook` | HMAC-SHA256 (hex) |
| `/telegram/webhook` | `telegram.telegramWebhook` | Secret token header |
| `/agentmail/webhook` | `agentmail.agentmailWebhook` | Svix (HMAC-SHA256) |
| `/mcp` (+ discovery) | `mcp.mcpEndpoint` | OAuth bearer (BA `mcp`) |
| `/api/auth/*` | Better Auth | interne BA |

**Isolation multi-tenant** : toutes les tables métier portent `orgId` indexé.
Helpers d'autorisation centralisés dans `convex/lib/auth.ts`
(`requireAppUser`, `requireOrgMember`, `requireOrgRole`, `requireSuperAdmin`) et
`convex/lib/agentScope.ts` (`parseScope`, `readMembership`) côté agent.

**Verdict global** : l'isolation multi-tenant est **solide et systématique**.
Toutes les surfaces publiques et outils agent/MCP re-vérifient l'appartenance à
l'org, y compris sur les IDs de ressources passés en argument. Les failles
trouvées sont **ciblées** (une écriture non re-validée, un webhook fail-open,
des rate-limits manquants), pas structurelles. Aucun secret hardcodé, aucun
secret sous préfixe `VITE_`, `powensUsers.authToken` jamais exposé par une
fonction publique.

---

## 1. Isolation multi-tenant

### 1.1 — `deals.update` ne revalide pas `viaSpvCompanyId` contre l'org du deal
- **Sévérité** : Élevée
- **Emplacement** : `convex/deals.ts:386-405` (`update`, mutation)
- **Constat** : `create` valide `viaSpvCompanyId` via `assertSameOrg`
  (deals.ts:357-358), mais `update` valide `investorCompanyId` et
  `targetCompanyId` et **oublie** `viaSpvCompanyId`.
- **Risque** : un membre de l'org A peut pointer le SPV d'un de ses deals vers
  une `companies._id` d'une **autre** org ; `enrich()` (deals.ts:138-150)
  renvoie ensuite `name/kind/sector/domain/totalShares` de cette société
  étrangère via `deals.list`, `deals.getById`, `aggregate.listDeals` → lecture
  cross-org obtenue par une écriture non validée. Exploitable seulement si l'ID
  Convex cible est connu (non devinable).
- **Piste** : ajouter dans `update` le même
  `if (patch.viaSpvCompanyId) await assertSameOrg(ctx, deal.orgId, patch.viaSpvCompanyId, 'spv_wrong_org')`
  que dans `create`.

### 1.2 — C/C inter-org créable/modifiable/supprimable en étant membre d'un seul côté
- **Sévérité** : Moyenne
- **Emplacement** : `convex/liabilities.ts:283-328` (`createIntercompanyLoan`),
  `446-468` (`updateIntercompanyLoan`), `475-488` (`deleteIntercompanyLoan`)
- **Constat** : la garde exige d'être membre d'**au moins une** des deux orgs
  (`if (!memberships.some((member) => member !== null)) throw 'not_a_party'`).
- **Risque** : un membre de la seule org A peut créer un prêt A↔B (B = toute org
  existante) qui apparaît d'office dans le Passif de B
  (`getLiabilities`/`listOptions` via index `by_to`/`by_from`), en changer le
  taux/blocage, ou le supprimer — écriture cross-org sans consentement de
  l'autre partie. Le nom de l'org B est aussi divulgué côté A
  (`counterpartyNameOf`). Contexte 2-users : impact réel faible, mais c'est le
  seul chemin d'écriture inter-org non consenti du backend.
- **Piste** : décision explicite — soit exiger la membership des **deux** côtés
  à la création, soit un rôle admin côté créateur, et documenter le choix dans
  `KNOWN_ISSUES.md` « Passif ».

### 1.3 — `holderOrgId` d'une equity position accepte une org tierce
- **Sévérité** : Faible
- **Emplacement** : `convex/liabilities.ts:261-264` (`createEquityPosition`),
  `403-406` (`updateEquityPosition`)
- **Constat** : seule l'**existence** de `holderOrgId` est vérifiée, pas
  l'appartenance de l'appelant du côté holder.
- **Risque** : limité — l'index `by_holder_org` (schema.ts:749) n'est lu par
  aucune query, donc l'org « détentrice » ne voit rien ; divulgation mineure du
  nom d'une org tierce (`holderNameOf`) si son ID est connu.
- **Piste** : même logique que `createIntercompanyLoan` (restreindre aux orgs
  dont l'appelant est membre).

### 1.4 — Suppressions destructives accessibles à un simple `member`
- **Sévérité** : Moyenne
- **Emplacement** : `companies.remove` (`convex/companies.ts:210`, hard delete),
  `companies.archive` (176), `deals.remove` (`deals.ts:434`), `kpis.remove`
  (`kpis.ts:128`), `documents.remove` (`documents.ts:104`, supprime aussi le
  blob), `forecasts.deleteRule` (`forecasts.ts:191`, cascade entries pending),
  `liabilities.deleteEquityPosition` (426), `deleteIntercompanyLoan` (475)
- **Constat** : aucune de ces mutations n'appelle `requireOrgRole` — un `member`
  peut tout supprimer. Seules org-settings, invitations, logo et
  `powens.startBankConnection` exigent `admin`/`owner`.
- **Risque** : pas d'escalade cross-org, mais aucun garde-fou de rôle sur des
  suppressions irréversibles.
- **Piste** : si le modèle 2-users l'assume, le documenter ; sinon passer les
  hard-deletes en `requireOrgRole(ctx, orgId, 'admin')`.

### 1.5 — Oracle d'existence d'IDs (erreurs distinctes `not_found` / `not_a_member`)
- **Sévérité** : Faible
- **Emplacement** : pattern transversal (ex. `companies.getById`
  `companies.ts:67-69` ; `transactions.bulkCategorize` renvoie
  `reason: 'not_a_member'` par ID dans `failed`, `transactions.ts:509-514`)
- **Constat** : `ctx.db.get(id)` → `not_found` si absent, puis `requireOrgMember`
  → `not_a_member` si l'ID existe dans une autre org : distingue « n'existe pas »
  de « existe ailleurs ».
- **Risque** : négligeable (IDs Convex non devinables), mais oracle gratuit à
  fermer.
- **Piste** : renvoyer `not_found` dans les deux cas.

**Chemins vérifiés SAINS** : `matchTransaction`/`allocateTransaction`/
`markEntryRealized` (checks `deal.orgId === tx.orgId` etc. dans
`lib/pointage.ts:61-64,165-181` et `forecasts.ts:544-547`) ; `search.global` et
`aggregate.listDeals` (read-only, strictement bornés aux memberships) ; `chat.*`
(scope `${orgId}:${userId}` via `authorizeThread`) ; toutes les variantes
`*Internal` des tools agent re-vérifient `readMembership` + re-scopent les IDs.

---

## 2. Authentification & autorisation

Auth via Better Auth (magic link + `convex()`), identité résolue côté Convex
par `authComponent.safeGetAuthUser` → row `users` (`lib/auth.ts`). Rôles
applicatifs dans `users.superAdmin` et `organizationMembers.role`
(owner/admin/member) — jamais dans la table BA. Authentification (qui) et
autorisation (droit sur CETTE ressource) sont bien **toutes deux** présentes sur
les surfaces vérifiées.

### 2.1 — `organizations.checkSlug` non authentifié
- **Sévérité** : Faible
- **Emplacement** : `convex/organizations.ts:84-99` (`checkSlug`, query)
- **Constat** : aucun appel d'auth ; renvoie `taken`/`available`/`reserved` à un
  visiteur anonyme.
- **Risque** : énumération de l'existence d'organisations par slug.
- **Piste** : ajouter `requireAppUser` (le check n'est utile qu'à un user
  connecté qui crée une org).

### 2.2 — Backdoor de dev MCP (`MCP_DEV_TOKEN` / `MCP_DEV_EMAIL`)
- **Sévérité** : Faible
- **Emplacement** : `convex/mcp/server.ts:81-88` (`resolveActor`)
- **Constat** : un bearer statique court-circuite OAuth (comparaison
  constant-time, actif seulement si les **deux** vars sont posées).
- **Risque** : si laissées en prod, token long-lived donnant accès à toutes les
  données de `MCP_DEV_EMAIL`.
- **Piste** : garder les deux absentes en prod (déjà commenté server.ts:16-17) ;
  idéalement gater aussi sur `APP_ENV !== 'production'`. **À vérifier par Albo**
  avec `convex env get MCP_DEV_TOKEN --prod` (doit être absent).

> **Note rôles agent** : `readMembership` (agentScope) ne vérifie que
> l'existence de la membership, pas le rôle — **conforme** : aucune surface
> `requireOrgRole('admin')` n'est exposée en tool. À documenter comme règle
> pour tout futur tool touchant une surface admin.

---

## 3. Webhooks & endpoints publics

### 3.1 — Webhook AgentMail « fail-open » si le secret est absent
- **Sévérité** : Élevée
- **Emplacement** : `convex/agentmail.ts:304-315` (`agentmailWebhook`)
- **Constat** : si `AGENTMAIL_WEBHOOK_SECRET` n'est pas posé, le handler
  **saute** la vérification Svix (simple `console.warn`) et traite le payload.
  Les 3 autres webhooks sont fail-closed (`throw` si secret absent —
  `powens.ts:242`, `attioSync.ts:215`, `telegram.ts:112`).
- **Risque** : ingress non authentifié — n'importe qui peut POSTer un faux
  `message.received` et déclencher tout le pipeline (OCR Mistral, appels LLM,
  écriture `companyReports`/`documents` dans n'importe quelle org, envoi d'email
  de réponse).
- **Piste** : fail-closed comme les autres webhooks (rejeter si secret absent).
  **À vérifier par Albo** que `AGENTMAIL_WEBHOOK_SECRET` est bien posé en prod
  (`convex env get AGENTMAIL_WEBHOOK_SECRET --prod`).

### 3.2 — Attribution d'org dérivée du contenu de l'email (inbox partagée)
- **Sévérité** : Moyenne
- **Emplacement** : `convex/reportPipeline.ts:96-141` (`resolveCompanyInternal`)
  + `258-425` (`run`)
- **Constat** : l'org est déterminée en matchant le domaine expéditeur / le nom
  dans le sujet / une mention dans le corps sur **toutes** les orgs, sans
  allowlist d'expéditeurs.
- **Risque** : même signature Svix valide, l'inbox est publique : un expéditeur
  arbitraire peut injecter un faux « report » (metrics/documents empoisonnés,
  prompt-injection vers l'analyse IA) dans n'importe quelle org en citant le nom
  d'une société ; la réponse auto (« reçu pour X » vs « pas rattaché ») permet
  d'énumérer le portefeuille.
- **Piste** : allowlist d'expéditeurs par société, ou au minimum ne pas
  confirmer le nom matché à un expéditeur inconnu.

### 3.3 — Pipeline email sans rate-limit (coût LLM/OCR)
- **Sévérité** : Moyenne
- **Emplacement** : `convex/reportPipeline.ts:258-425` (`run`)
- **Constat** : chaque email entrant déclenche OCR Mistral + LLM sans
  `consumeLimit` (`convex/rateLimiters.ts` ne définit rien pour l'ingestion).
- **Risque** : DoS de coût — spammer l'inbox consomme des tokens sans limite.
- **Piste** : bucket rate-limiter clé par expéditeur/inbox avant OCR/LLM.

### 3.4 — Comparaison de signature Svix non constant-time
- **Sévérité** : Faible
- **Emplacement** : `convex/agentmail.ts:293-296` (`verifySvix`)
- **Constat** : `.some((sig) => sig === expected)` (les autres endpoints
  utilisent `crypto.subtle.verify` ou un XOR digest constant-time).
- **Risque** : attaque par timing sur HMAC — essentiellement théorique.
- **Piste** : réutiliser le pattern `constantTimeEqual` (telegram.ts:78) ou
  `crypto.subtle.verify`.

### 3.5 — Absence de contrôle de fraîcheur / anti-rejeu (timestamps signés non vérifiés)
- **Sévérité** : Faible
- **Emplacement** : `agentmail.ts:288-297` (svix-timestamp jamais comparé à
  l'horloge), `powens.ts:251` (`BI-Signature-Date` signé mais non validé),
  `attioSync.ts:210-234` (pas de timestamp ni dedup persistant ;
  `Idempotency-Key` seulement loggé, l.259)
- **Constat** : les timestamps entrent dans le HMAC mais ne sont jamais comparés
  à l'heure courante.
- **Risque** : rejeu d'un webhook signé capturé. Impact réduit : Powens
  idempotent (`by_powens_id`), Attio re-fetch + no-op Lot 1, AgentMail dedup
  `findByMessageId` (sauf le chemin « company not found » → re-réponse email
  rejouable).
- **Piste** : rejeter si `|now − timestamp| > 5 min` (recommandation Svix) ;
  persister l'`Idempotency-Key` Attio au Lot 2.

### 3.6 — Log d'URL d'auth complète sur chemin d'erreur
- **Sévérité** : Faible
- **Emplacement** : `src/routes/api/auth/$.ts:36`
- **Constat** : `console.error('[ts-auth-handler] url=', request.url)` — l'URL BA
  peut contenir des tokens one-shot (magic-link, reset, code OAuth).
- **Risque** : en cas d'exception, un token potentiellement valide part dans les
  logs Vercel.
- **Piste** : logger `new URL(request.url).pathname` sans query string.

### 3.7 — Logs de payload business (Lot 1, à retirer)
- **Sévérité** : Faible (info)
- **Emplacement** : `convex/attioSync.ts:328` (`console.log(JSON.stringify(args))`
  du deal complet)
- **Constat** : données business (montants, valorisation) dans les logs Convex —
  pas de secret.
- **Piste** : retirer au passage en Lot 2.

**Secrets sweep — RAS** : aucun secret hardcodé (`sk-`, `whsec_`, `AKIA`,
`-----BEGIN`… → 0 hit) ; aucun `process.env` dans `src/` ; `VITE_*` toutes
publiques (URLs, DSN Sentry publique, token logo.dev `pk_`) ;
`powensUsers.authToken` lu uniquement par des `internal*` de `convex/powens.ts`,
jamais renvoyé par une fonction publique ; aucun webhook ne logge le body avant
vérification de signature. **Note doc** : CLAUDE.md annonce « Sentry (front +
Convex actions) » mais aucune instrumentation Sentry n'existe dans `convex/`
(claim périmée, pas un risque).

**Tableau récap par endpoint**

| Endpoint | Signature | Constant-time | Fail (secret absent) | Rate-limit | Anti-rejeu | Scoping org |
| --- | --- | --- | --- | --- | --- | --- |
| `/powens/webhook` | HMAC-SHA256 | ✅ | fail-closed | ❌ | ❌ (idempotent) | ✅ `powensUsers` par `id_user` |
| `/attio/webhook` | HMAC-SHA256 | ✅ | fail-closed | ❌ | ❌ (no-op Lot 1) | ⚠️ Lot 2 à auditer |
| `/telegram/webhook` | secret token | ✅ | fail-closed | ✅ | n/a | ✅ `telegramUserId` |
| `/agentmail/webhook` | Svix | ❌ (3.4) | **FAIL-OPEN (3.1)** | ❌ (3.3) | ❌ (3.5) | ⚠️ par contenu (3.2) |
| `/api/chat` | JWT Convex | n/a | n/a | **❌ (voir §4.1)** | n/a | ✅ scope thread |
| `/mcp` | OAuth bearer | ✅ | fail-closed | ✅ 60/min | n/a | ✅ double check/appel |

---

## 4. Coût LLM & endpoints agent

### 4.1 — `/api/chat` ne consomme pas le rate-limit `chatSend`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/chat.ts:298-335` (`streamOverHttp`)
- **Constat** : `sendMessage` (l.159) et `respondToToolApproval` (l.205)
  appellent `consumeLimit('chatSend', …)`, pas `/api/chat`. Un non-authentifié
  est bien rejeté 401 avant tout appel LLM, mais un membre authentifié contourne
  le budget 30/min en bouclant sur cette route.
- **Risque** : coût LLM (OpenRouter) non plafonné par un user authentifié.
- **Piste** : ajouter `consumeLimit(ctx, 'chatSend', probeUser._id)` après
  `actionAuthProbe`.

### 4.2 — Approbation Telegram : troncature + TOCTOU sur le `callback_data`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/telegram.ts:292-301` (`generateAndReply`, troncature
  à 4000 chars), `636-638` (`respondToApproval`, `callback_data` `approve`/`deny`
  nu)
- **Constat** : (a) le message d'approbation (texte agent + JSON des params du
  tool) est tronqué — un texte agent long peut pousser les paramètres hors de
  l'affichage ; (b) le bouton résout « la » pending approval du thread au moment
  du clic, sans lier l'`approvalId` → un bouton périmé approuve une approval plus
  récente et différente de celle affichée.
- **Risque** : l'utilisateur approuve une écriture (montants, IDs) qu'il n'a pas
  vue — surface d'injection sur l'UI de consentement.
- **Piste** : ne jamais tronquer le bloc d'approbation ; embarquer l'`approvalId`
  (ou un hash court) dans le `callback_data` et refuser si mismatch.

### 4.3 — Agent « intelligence » : `webSearch` sur contenu email non fiable, sans approbation
- **Sévérité** : Moyenne
- **Emplacement** : `convex/agentToolsIntelligence.ts:11-23`,
  `convex/intelligence.ts:189` + `reportPipeline.ts:412` (déclenché
  fire-and-forget)
- **Constat** : l'agent intelligence consomme le `rawContent` de reports reçus
  par email (contenu non fiable) et dispose d'un tool `webSearch` **sans scope,
  sans approbation, déclenché automatiquement**.
- **Risque** : canal d'exfiltration classique — une injection dans un report
  reçu peut faire partir des données du contexte (métriques, notes) dans la
  requête envoyée à Linkup / aux domaines crawlés.
- **Piste** : filtrer/limiter les requêtes sortantes (longueur, interdiction de
  données du contexte) ou désactiver `webSearch` sur contenu non sollicité.

**Vérifié SAIN** : les **28** tools d'écriture agent portent tous
`needsApproval: true` ; seule suppression exposée = `deleteForecastRule`
(conforme CLAUDE.md) ; les internals d'écriture ne sont référencés que par les
`execute` gated ; les 18 tools MCP sont tous read-only avec double check de
membership par appel ; code de lien Telegram 128 bits, single-use, TTL 24h.

---

## 5. Validation des entrées

Aucune fonction **publique** sans validateur d'args ; aucun `v.any()` sur une
fonction publique en écriture. Les manques sont des **bornes sémantiques**
(entiers, positivité, plafonds de tableaux/chaînes).

### 5.1 — Corps de `/api/chat` non validé (JSON.parse sans try/catch)
- **Sévérité** : Moyenne (couplé à §4.1)
- **Emplacement** : `convex/chat.ts:302` (`streamOverHttp`)
- **Constat** : seule httpAction dont le `request.json()` n'est pas dans un
  try/catch (les 5 autres le sont) ; `orgId` casté sans `normalizeId`, `prompt`
  illimité.
- **Risque** : JSON malformé → 500 non géré ; prompt géant → coût LLM.
- **Piste** : try/catch + valider `orgId` + plafonner `prompt`.

### 5.2 — `deals.create` / `deals.update` : ~60 champs numériques sans bornes + tableaux non plafonnés
- **Sévérité** : Moyenne
- **Emplacement** : `convex/deals.ts:36-123, 340-432` (`dealFields`)
- **Constat** : montants (cents) et taux (bps) acceptent négatifs/flottants
  (`committedAmount`, `paidAmount`, `ownershipPct`…) ; `bpPoints`/`actualPoints`
  sont des tableaux **non plafonnés** persistés tels quels.
- **Risque** : MOIC/TVPI faussés ; un `bpPoints` massif gonfle le doc (limite
  1 Mo) puis est re-poussé à chaque `deals.list`/`aggregate.listDeals`
  (amplification d'abonnement).
- **Piste** : helper `assertValidDealFields` (entier ≥ 0 pour cents, 0–10000
  bps, cap type `MAX_LINES = 200` sur les tableaux — comme `projections.ts:32`).

### 5.3 — `transactions.bulkCategorize` : nombre d'IDs non plafonné + auth dans la boucle
- **Sévérité** : Moyenne
- **Emplacement** : `convex/transactions.ts:486-519`
- **Constat** : `transactionIds: v.array(v.id('transactions'))` sans plafond
  (l'outil agent équivalent est capé à 50, `agentToolsPointage.ts:663`) ;
  `requireOrgMember` appelé **par** transaction dans la boucle.
- **Risque** : 10 000 IDs = 10 000 × (get + check + patch + insert
  `matchingDecisions`) dans une seule mutation → dépassement des limites, OCC
  massif.
- **Piste** : rejeter au-delà de ~50–100 IDs ; hisser `requireOrgMember` hors de
  la boucle (une vérif par org).

### 5.4 — Liabilities : cents/taux acceptent des flottants (public vs agent divergent)
- **Sévérité** : Moyenne
- **Emplacement** : `convex/liabilities.ts:243-276, 384-420, 446-468`
- **Constat** : `amountCents <= 0` rejeté mais pas `Number.isInteger`
  (contrairement à `forecasts.ts:91` et à la variante agent
  `agentToolsLiabilities.ts:82`) ; `interestRateBps` sans plafond.
- **Risque** : cents non entiers dans une table financière (viole la convention
  « entiers en cents ») ; taux aberrants.
- **Piste** : aligner sur la variante agent (`Number.isInteger` + bornes).

### 5.5 — Contenu email persisté sans borne (`metrics: v.any()`, `rawContent`/`cleanedHtml`)
- **Sévérité** : Moyenne
- **Emplacement** : `convex/reportPipeline.ts:145-254` (`storeReport`)
- **Constat** : `metrics: v.any()` + `rawContent`/`cleanedHtml` illimités, issus
  d'un email externe (OCR de PJ jusqu'à 20 Mo concaténé).
- **Risque** : dépassement 1 Mo/doc → échec pipeline ; blob `metrics` (sortie
  LLM influençable) renvoyé au front sans validation de forme.
- **Piste** : tronquer `rawContent`/`cleanedHtml` (~200 Ko) ; valider `metrics`
  (`v.record(v.string(), v.number())` ou cap de clés).

### 5.6 — Chaînes libres et dates non plafonnées (diverses mutations)
- **Sévérité** : Faible
- **Emplacement** : `companies.create/update`, `forecasts.createManualEntry`,
  `kpis.create`, `documents.create`, `cash.updateAccountName`,
  `users.updateProfile`, `intelligence.upsertIntelligence`
  (`analysis: v.any()`, interne)
- **Constat** : `name`/`notes`/`label`/`metricType`/`title`… sans cap ;
  `people` (companies) remplacé intégralement sans cap de longueur ; dates ms
  sans fenêtre plausible (an 9999 accepté).
- **Risque** : pollution / docs gonflés ; volumétrie réelle faible (outil
  interne).
- **Piste** : cap générique (ex. 500 car., 100 personnes) + fenêtre de dates.

**Décompte** : 0 fonction publique sans validateur ; 0 `v.any()` public en
écriture ; **13** fonctions publiques à validation sémantique incomplète (bornes
manquantes) + la route `/api/chat`.

---

## 6. Performance

Règle transverse respectée ailleurs : `deals.listOptions` et
`liabilities.listOptions` sont des variantes légères délibérées pour éviter
l'invalidation par le pointage (bon pattern). Les problèmes sont concentrés sur
les queries **abonnées** qui `collect()` de larges partitions et se ré-exécutent
à chaque écriture transaction.

### 6.1 — `transactions.countByStatus` : collect complet pour un simple count, abonné
- **Sévérité** : Moyenne
- **Emplacement** : `convex/transactions.ts:319-342`
- **Constat** : `.collect()` de la partition org+status pour retourner
  `rows.length`, abonné par le badge « À pointer »
  (`TransactionsLedger.tsx:70`).
- **Risque** : point chaud réactif — chaque écriture transaction (import Powens
  de centaines de lignes, chaque pointage) relit la partition entière (des
  milliers de docs après import) pour produire un entier.
- **Piste** : compteur dénormalisé, composant aggregate Convex, ou `.take(N+1)`
  avec affichage « N+ ».

### 6.2 — `aggregate.listDeals` : N+1 cross-org, abonné sur `/app/all`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/aggregate.ts:53-79` + `deals.ts:181-205`
- **Constat** : pour chaque org × chaque deal → collect transactions `by_deal`
  + read valuation + 3 `ctx.db.get` companies + XIRR.
- **Risque** : chaque rendu lit toutes les transactions matchées de toutes les
  orgs ; toute écriture deal/tx/valo ré-exécute tout ; `flows` datés poussés au
  client à chaque fois.
- **Piste** : préfetch companies par org → Map (pattern déjà dans
  `deals.listOptions:283-287`) ; agrégats `paidActual`/`received` maintenus à
  l'écriture du pointage plutôt que recalculés du raw.

### 6.3 — `deals.list` : même N+1 par-deal, abonné sur 3 routes
- **Sévérité** : Moyenne
- **Emplacement** : `convex/deals.ts:229-263`
- **Constat** : `enrich` (3 gets) + `dealRealizedMetrics` (collect tx) +
  `lastValuationCents` par deal ; abonné (deals.index, participations.index,
  participations.$companyId).
- **Risque** : un rendu Participations relit toutes les transactions matchées de
  l'org ; chaque pointage/valo/édition invalide les 3 pages.
- **Piste** : batcher companies via Map (incohérence : `listOptions` du même
  fichier le fait déjà) ; sortir `flows` du payload liste.

### 6.4 — `forecasts.getForecastBalance` : reconstruction d'historique complet, abonné
- **Sévérité** : Moyenne
- **Emplacement** : `convex/forecasts.ts:366-452`
- **Constat** : avec `historyMonths: 6` (toujours passé par
  `ForecastSection.tsx:314`), collecte toutes les transactions des 6 derniers
  mois de chaque org en scope + toutes les `forecastEntries` + tous les comptes.
- **Risque** : chaque écriture transaction (même un pointage) reconstruit tout
  l'historique ; ×N orgs en mode consolidé.
- **Piste** : mémoïser l'historique clos (snapshots mensuels), ou séparer la
  courbe historique de la projection.

### 6.5 — `transactions.getVatPosition` : collect charge+product complet, abonné (dupliqué)
- **Sévérité** : Moyenne
- **Emplacement** : `convex/transactions.ts:571-607` +
  `agentToolsPointage.ts:665-707`
- **Constat** : collecte l'intégralité des partitions `charge` + `product` à
  chaque appel.
- **Risque** : les charges s'accumulent avec l'historique ; chaque qualification
  TVA re-somme tout.
- **Piste** : sommes TVA incrémentales (aggregate) ou borne de date (exercice
  courant).

### 6.6 — `forecasts.listEntries` : collect de toute la table pour filtrer les manuelles
- **Sévérité** : Moyenne
- **Emplacement** : `convex/forecasts.ts:565-587`
- **Constat** : `.collect()` de toutes les `forecastEntries` de l'org (dérivées
  incluses, jusqu'à rules × 520 occurrences) pour ne garder que `ruleId == null`
  en JS.
- **Risque** : table à croissance non bornée relue intégralement pour quelques
  lignes ; abonné par l'UI forecast.
- **Piste** : champ dénormalisé indexable `isManual` (index `by_org_manual`).

### 6.7 — `forecasts.expandRules` : une requête `.unique()` par occurrence
- **Sévérité** : Moyenne
- **Emplacement** : `convex/forecasts.ts:273-344`
- **Constat** : `.unique()` sur `by_derivedKey` **par occurrence** (rules × ≤520)
  dans une seule mutation.
- **Risque** : mutation lente et lourde ; risque de dépasser les limites avec
  beaucoup de règles actives.
- **Piste** : préfetch une fois par règle via `by_rule` → Map par `derivedKey`.

### 6.8 — `dashboard.getDashboard` : par-deal collect tx + valuations + boucle mensuelle
- **Sévérité** : Moyenne
- **Emplacement** : `convex/dashboard.ts:31-223`
- **Constat** : par deal, collect tx `by_deal` + historique complet valuations,
  puis boucle O(mois × deals × tx) pour la sparkline ; abonné sur la home.
- **Risque** : relecture de toutes les tx matchées + valos à chaque rendu ;
  ré-exécuté à chaque pointage/valo. (Le full-scan a déjà été évité — commentaire
  l.7-11 ; le coût restant est intrinsèque au recalcul « transaction-true ».)
- **Piste** : agrégats `paidActual`/`received` par deal maintenus à l'écriture
  (`metrics.ts:50 proceedsFromReceived` déjà prêt) si le portefeuille grossit.

### 6.9 — N+1 mineurs (gains faciles, volumétrie bornée)
- **Sévérité** : Faible
- **Emplacements** : `transactions.listByDeal` (`transactions.ts:44-76`, 1 get
  bankAccount par tx alors que `orgAccountsById` batché existe dans le même
  fichier) ; `cash.listAccountTransactions` (`cash.ts:106-152`, 2 gets/ligne ×
  200) ; `powens.ingestConnectionSync` (`powens.ts:518-532`, `computeCutoff`
  collecte tout l'historique du compte).
- **Piste** : réutiliser les Map de préfetch déjà présentes ; borner
  `computeCutoff` (early-break).

### 6.10 — Backfills full-table (one-shots CLI)
- **Sévérité** : Faible
- **Emplacement** : `transactions.ts:621-724` (`backfillMatchStatus`,
  `backfillSearchText`, `backfillAllocation`)
- **Constat** : `.collect()` full table + patch en boucle dans une seule
  mutation.
- **Risque** : dépasseront les limites de mutation quand la table sera grosse
  (documentés, réservés au CLI).
- **Piste** : migrer vers `@convex-dev/migrations` (batching par curseur) si
  ré-exécutés.

**Top des chemins de lecture les plus lourds** : 1. `aggregate.listDeals`
2. `deals.list` 3. `forecasts.getForecastBalance` 4. `dashboard.getDashboard`
5. `transactions.countByStatus` 6. `transactions.getVatPosition`
7. `forecasts.listEntries`.

**Vérifié SAIN** : `matchingDecisions` jamais collecté (borné `take(200)`) ;
tools agent/MCP bornés (`take` 25-50, rate-limit 60/min) ; `listLedger` capé à
1000 ; `projections`/`kpis`/`valuations` capés.

---

## 7. Cohérence

### 7.1 — Création de transaction agent viole l'invariant `dealId ⟺ allocation`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/agentTools.ts:282-297` (`createTransactionInternal`)
- **Constat** : pose `dealId` + `matchStatus: 'matched'` mais **ni**
  `allocation: { kind: 'deal', targetId }` **ni** ligne `matchingDecisions`,
  contrairement au cœur partagé `lib/pointage.applyMatchToDeal`.
- **Risque** : viole l'invariant documenté (schema.ts:832-834) : la tx créée
  matchée par l'agent est invisible du pointage généralisé et absente du dataset
  d'apprentissage.
- **Piste** : faire passer la création matchée par `applyMatchToDeal`, ou
  factoriser un `applyCreateMatched` dans `lib/pointage.ts`.

### 7.2 — `updateDealInternal` (agent) n'alimente pas `manuallyEditedFields`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/agentTools.ts:302-326`
- **Constat** : patche un deal sans accumuler `manuallyEditedFields`
  (contrairement à `deals.update:411-428`), et ne gère pas le clear d'exit.
- **Risque** : une édition faite via l'agent sera silencieusement écrasée par un
  re-run de l'import Airtable.
- **Piste** : répliquer l'accumulation, ou partager un cœur `applyDealPatch`.

### 7.3 — `updateRuleInternal` (agent) sous-valide vs `forecasts.updateRule`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/agentToolsForecasts.ts:363-419`
- **Constat** : ne valide que `amountCents` ; la mutation publique valide l'état
  fusionné complet via `assertValidRuleFields` (interval ≥ 1, anchorDay, endDate
  ≥ startDate).
- **Risque** : l'agent peut écrire une règle incohérente (anchorDay 31 en
  weekly, endDate < startDate) que `expandOccurrences` n'expandra jamais.
- **Piste** : exporter `assertValidRuleFields` et l'appeler sur `{...rule,
  ...patch}`.

### 7.4 — `deals.remove` ne garde pas les tables filles `valuations`/`dealProjections`
- **Sévérité** : Moyenne
- **Emplacement** : `convex/deals.ts:434-450`
- **Constat** : bloque sur les transactions liées mais pas sur `valuations`,
  `dealProjections`, `forecasts.dealId` legacy (contrairement à
  `companies.remove` qui utilise un `listBlockingRefs` exhaustif).
- **Risque** : lignes `valuations`/`dealProjections` orphelines ; `valuations.list`
  throw en cascade côté consommateurs.
- **Piste** : étendre la garde aux tables filles, ou cascader la suppression.

### 7.5 — Unicité `attioDealId` / `attioCompanyId` promise mais non appliquée
- **Sévérité** : Moyenne
- **Emplacement** : `convex/deals.ts` (dealFields) + `companies.ts`
- **Constat** : CLAUDE.md et schema.ts:16-17 promettent l'unicité « enforced in
  mutations (helpers dans convex/lib/) » ; en réalité seul `siren` est vérifié
  (`assertSirenFree`, companies.ts:29-40, local au fichier) ;
  `deals.create/update` acceptent `attioDealId` sans check ; `attioCompanyId`
  n'a de dédup que par index dans les imports.
- **Risque** : deux deals avec le même `attioDealId` via l'UI → le futur
  `attioSync.upsertFromDeal` (squelette l.311-330) qui fera `.unique()` sur
  `by_attio_deal_id` crashera / upsertera le mauvais deal.
- **Piste** : `assertAttioDealIdFree` (pattern `assertSirenFree`) dans
  create/update ; déplacer ces helpers d'unicité dans `convex/lib/` comme
  documenté.

### 7.6 — Table `portfolioGroupSettings` + champ `companies.group` : surface morte
- **Sévérité** : Moyenne
- **Emplacement** : `convex/schema.ts:350-362` (+ `companies.group` l.328)
- **Constat** : table entière (slug, displayName, groupKind, blocks) et champ
  `group` référencés par **aucun** code (0 hit dans `convex/` et `src/` hors
  schema.ts) ; les index `by_org_group` (×2) et `by_org_slug` maintenus pour
  rien. La docstring décrit une feature (« conso page ») inexistante.
- **Risque** : dérive schéma/code ; impossible de distinguer « prévu » de
  « mort ».
- **Piste** : annoter « reserved, not read » (comme
  `forecastEntries.probabilityPct`) si lot à venir, sinon purger (workflow
  widen/narrow).

### 7.7 — Helpers dupliqués (à mutualiser dans `convex/lib/`)
- **Sévérité** : Faible
- **Constats** :
  - `assertSameOrg` / `assertInvestorIsGroupEntity` dupliqués deals.ts ↔
    agentTools.ts (deals.ts:314-338 vs agentTools.ts:122-165)
  - famille `getOrgDeal`/`getOrgCompany`/`getOrgTransaction` (« get doc + vérifie
    orgId ») dupliquée 5× (valuations.ts:15, projections.ts:41, kpis.ts:23,
    agentToolsPointage.ts:49, agentToolsLiabilities.ts:225) + ~40 checks inline
    `x.orgId !== orgId`
  - `markEntryRealized` (forecasts.ts:534 ↔ agentToolsForecasts.ts:179),
    `deleteRule` (forecasts.ts:191 ↔ agentToolsForecasts.ts:422),
    `renameBankAccount` (cash.ts:79 ↔ agentTools.ts:702) : cœurs copiés-collés
    entre mutation publique et internal agent
  - `toISODate` (×3) / `parseISODate` (×4) alors que `lib/recurrence.ts:30`
    exporte déjà `isoDay`
  - `requireLoanParty` non appelé par `createIntercompanyLoan` (même check
    réécrit inline, liabilities.ts:296 vs 362)
  - validations equity/C/C recopiées dans 6 handlers (create/update ×
    public/agent) avec divergence `Number.isInteger` (cf. §5.4)
- **Risque** : divergence future des règles métier (déjà amorcée sur
  isInteger).
- **Piste** : cœurs `applyX` partagés dans `convex/lib/` (le pattern
  `lib/pointage.ts` est le bon modèle).

### 7.8 — Codes d'erreur incohérents pour la même sémantique
- **Sévérité** : Faible
- **Constat** : « doc absent/hors org » → `not_found` (77×) mais aussi
  `org_not_found`, `account_not_found`, `counterparty_not_found`… (9 formes) ;
  « mauvaise org » → tantôt `*_wrong_org` (révèle « existe ailleurs »), tantôt
  `not_found` (masque) pour le même cas ; « date ISO invalide » en 7 déclinaisons
  (`invalid_date`, `invalid_as_of_date`, `invalid_iso_date`…) ; codes dynamiques
  `org_not_found:${slug}`, `target_company_not_found:${id}` qui rompent la
  convention « code statique » attendue par le classifieur front.
- **Piste** : inventaire + convention unique ; les codes cross-org devraient
  tous masquer (`not_found`) — recoupe §1.5.

### 7.9 — Soft-delete incohérent + flags orphelins
- **Sévérité** : Faible
- **Constat** : `bankAccounts.archivedAt` lu par ~10 filtres mais **aucune
  mutation ne l'écrit** (write-orphan : archivage possible seulement par édition
  manuelle du dashboard Convex) ; `companyRelations.archivedAt` ni écrit ni lu ;
  soft-delete (companies) vs hard-delete (deals/kpis/documents) sans règle
  claire ; naming `remove` vs `delete*` mélangés.
- **Piste** : ajouter la mutation d'archivage de compte ou documenter le flag ;
  retirer/documenter `companyRelations.archivedAt` ; trancher une convention.

### 7.10 — Champs de schéma orphelins non documentés
- **Sévérité** : Faible
- **Constat** : `companies.registrationNumber`, `equityPositions.actDriveId`,
  `intercompanyLoans.conventionDriveId`, `equityPositions.airtableId` /
  `intercompanyLoans.airtableId` (+ index `by_airtable_id` jamais requêtés,
  aucun import n'écrit ces tables), `companies.incorporationDate` (seed only),
  `deals.repaymentFrequencyMonths` / `royaltyCapAmount` (dans le validator, lus
  par aucun affichage) → 0 hit convex+src.
- **Piste** : annoter « reserved » (pattern `forecastEntries` l.995-1000) ou
  purger.

### 7.11 — Docstrings périmées
- **Sévérité** : Faible (info)
- **Constat** : `documents.extractedText` commenté « deferred — null until OCR is
  wired » alors que `reportPipeline.ts:348` l'écrit désormais ;
  `attioSync.upsertFromDeal:305` documente un statut `pending` (Term Sheet)
  absent du validator `dealStatus` (schema.ts:70-75).
- **Piste** : corriger les commentaires (règle CLAUDE.md §5.3).

**Index déclarés jamais utilisés** (`withIndex` = 0 hit) : `deals.by_org_status`
(status filtré en JS), `transactions.by_org_unreconciled` (supplanté par
`by_org_matchStatus`), `matchingDecisions.by_transaction`,
`equityPositions.by_holder_org`, `companies.by_org_domain`, `by_org_group` (×2),
`portfolioGroupSettings.by_org_slug`, `equityPositions/intercompanyLoans.by_airtable_id`.

**Champs « reserved » documentés (conformes, RAS)** :
`forecastEntries.probabilityPct`/`counterpartyOrgId`/`currency`/`dealId`,
`matchingDecisions.fxRate`/`amountInDealCurrency`, `transactions.importMeta`,
table legacy `forecasts` (confirmée inerte : écrite/lue par airtableImport +
purge seed uniquement).

---

## Synthèse priorisée — Top 5 à traiter en premier

1. **[Critique/Élevé] Webhook AgentMail fail-open (§3.1)** — vérifier d'abord que
   `AGENTMAIL_WEBHOOK_SECRET` est posé en prod (`convex env get … --prod`), puis
   basculer le handler en fail-closed comme les 3 autres webhooks. Un secret
   manquant ouvre l'écriture non authentifiée dans toutes les orgs + coûts LLM.
   *(1 PR, ~10 lignes.)*

2. **[Élevé] `deals.update` ne revalide pas `viaSpvCompanyId` (§1.1)** — la seule
   faille d'isolation multi-tenant réellement exploitable (lecture cross-org par
   écriture non validée). Ajouter le `assertSameOrg` déjà présent dans `create`.
   *(1 PR, 3 lignes.)*

3. **[Moyen] Rate-limit LLM manquant sur `/api/chat` + corps non validé
   (§4.1/§5.1)** — un membre authentifié contourne le budget 30/min ; JSON.parse
   sans try/catch. Ajouter `consumeLimit('chatSend')` + try/catch + plafond
   prompt. *(1 PR.)*

4. **[Moyen] Attribution d'org par contenu d'email + coût illimité (§3.2/§3.3)** —
   inbox partagée publique : n'importe quel expéditeur injecte des reports
   empoisonnés dans n'importe quelle org et énumère le portefeuille. Allowlist
   d'expéditeurs + rate-limit sur le pipeline. Coupler avec §4.3 (webSearch de
   l'agent intelligence sur contenu non fiable). *(1 PR, éventuellement 2.)*

5. **[Moyen] Écritures inter-org du Passif sans consentement (§1.2)** — décision
   produit : membership des deux côtés ou rôle admin pour créer/modifier/supprimer
   un C/C inter-org. À trancher puis documenter dans `KNOWN_ISSUES.md`. *(1 PR.)*

**Lots suivants recommandés** (indépendants, une PR chacun) : cohérence
create-transaction agent (§7.1) et update-deal agent (§7.2) ; validation des
bornes numériques deals/liabilities (§5.2/§5.4) et cap `bulkCategorize` (§5.3) ;
perf `countByStatus` + `getForecastBalance` (§6.1/§6.4) ; unicité `attioDealId`
(§7.5) ; mutualisation des helpers dupliqués (§7.7) ; nettoyage/annotation de la
surface de schéma morte (§7.6/§7.9/§7.10).
