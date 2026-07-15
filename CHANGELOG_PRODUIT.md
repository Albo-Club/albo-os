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

## v1.89.0 — 15/07/2026 à 13:40 — Communications Parallel : chargement instantané (cache + rafraîchissement automatique)

Ouvrir le rattachement à un SPV Parallel et afficher les communications d'une
entité étaient **lents** : à chaque clic, Albo se reconnectait à Parallel et
retéléchargeait tout. Désormais Albo garde une **copie locale** des
communications Parallel : l'ouverture du sélecteur de SPV **et** l'affichage des
communications sont **instantanés**. Cette copie est **rafraîchie automatiquement
tous les 2 jours** en arrière-plan, et un bouton **« Rafraîchir »** permet de
forcer une mise à jour immédiate (par exemple juste après un nouveau deal). La
toute première ouverture reste un chargement en direct — le temps de remplir la
copie — puis tout est instantané.

À noter : Parallel n'envoie aucune notification quand une communication ou un SPV
est ajouté, donc un nouvel élément apparaît au prochain rafraîchissement
(automatique sous 2 jours, ou immédiat via le bouton).

> **🔧 Notes techniques**
>
> - Nouvelle table `vascoCommunicationsCache` (1 ligne par communication ;
>   remplacement **atomique** par `(orgId, clientSlug)`). Métadonnées seulement —
>   les octets des PDF restent téléchargés en direct
>   (`downloadCommunicationDocument`).
> - `vasco.ts` : lectures **réactives** `listCachedVascoIssuers` /
>   `getCachedCommunications` (l'UI lit le cache → instantané) ; rafraîchissement
>   `refreshVascoCacheForOrg` (pull complet → `replaceCommunicationsCache`,
>   best-effort : un échec garde l'ancien cache) exposé via un cron
>   `refreshAllVascoCaches` (`crons.ts`, toutes les 48 h) **et** une action
>   publique `refreshVascoCacheNow` (org-guardée, bouton « Rafraîchir »).
>   Suppression des actions live `listVascoIssuers` / `fetchCommunications` (+ le
>   pull allégé de la v1.88.2), remplacées par le cache.
> - Front `VascoCommunicationsSection` : picker + liste lisent les queries du
>   cache ; amorçage (option 1) = un pull au 1er affichage si le cache est vide ;
>   bouton « Rafraîchir » via le hook `useVascoRefresh`. i18n
>   `vasco:communications.refreshError` (en+fr).
> - Contexte : VASCO n'expose **pas** de webhook pour le persona investisseur
>   (pull-only, vérifié sur la doc API) → cache + cron + refresh manuel est la
>   seule voie « rapide ET frais ».

## v1.88.2 — 15/07/2026 à 11:59 — Rattachement Parallel : ciblé sur les bonnes entités et plus rapide à ouvrir

Deux réglages sur la section Reports des participations :

- Le bloc **« Rattacher à Parallel »** ne s'affiche désormais **que sur les
  entités Parallel** — repérées par leur nom, leur domaine ou leur origine — et
  sur celles déjà rattachées. Fini l'encart sur les ~185 autres participations
  où il n'avait rien à faire. (Rien ne change sur les entités juridiques du
  groupe, ni sur une entité déjà liée.)
- **Ouvrir le sélecteur de SPV est plus rapide** : Albo ne télécharge plus tout
  le contenu des communications juste pour lister les SPV, seulement l'essentiel
  (nom du SPV + dernier titre).

> **🔧 Notes techniques**
>
> - `VascoCommunicationsSection` : gate resserré —
>   `looksParallel = kind === 'portfolio' && /parallel/i.test(name + domain + sponsor + group)`
>   **OU** déjà rattaché. Union multi-champs délibérée : le domaine seul n'est
>   pas fiable sur les SPV (souvent vide ou pointant la plateforme mère), le nom
>   (« PARALLEL INVEST … ») rattrape. Corrige le bruit sans retomber dans le trou
>   de la v1.86.1 (aucune entité Parallel cachée).
> - `vasco.ts` : `GET_COMMUNICATIONS_LIGHT` (émetteur + titre + dates, **sans**
>   `htmlContent` ni `communicationDocuments`) + `pullCommunicationsLight`,
>   branchés dans `listVascoIssuers`. Le picker ne rapatrie plus les corps
>   complets de toutes les communications juste pour dédupliquer les émetteurs.
>   `fetchCommunications` (liste des comms d'une entité rattachée) inchangé — il
>   a besoin des corps et des pièces jointes.

## v1.88.1 — 15/07/2026 à 11:17 — Validations « tâches planifiées » : réglage sans effet retiré

La mise à jour v1.83.3 annonçait la fin des demandes de validation à
répétition quand l'assistant gère ses rappels planifiés. En pratique ça ne
marchait pas : ces confirmations viennent de la **plateforme claude.ai**
(la couche qui fait tourner les sessions), pas de l'application — et elles
ne peuvent **pas** être désactivées depuis le dépôt. Le réglage sans effet
a donc été retiré. Aucun impact sur l'outil ; pour éviter ces fenêtres, la
seule voie reste de ne pas déclencher ces tâches planifiées.

> **🔧 Notes techniques**
> Retrait du bloc `permissions.allow` (`mcp__Claude_Code_Remote__*`) de
> `.claude/settings.json` — inefficace : testé en direct, le prompt
> réapparaît malgré la règle chargée au démarrage. Ces approbations (outils
> Routines / Remote Control) ne transitent pas par le système de permissions
> du repo, mais par la couche Remote Control de claude.ai. Piège documenté
> dans `KNOWN_ISSUES.md` (« Prompts Claude Code Remote (Routines) »).

## v1.88.0 — 15/07/2026 à 10:49 — Synthèse IA : bouton « Relancer l'analyse » et prise en compte des communications Parallel

La **synthèse IA** (« Cerveau ») de chaque fiche entité peut désormais être
**relancée à la demande** : un bouton « Relancer l'analyse » apparaît dans
l'en-tête du bloc (et sur la ligne d'attente tant qu'aucune synthèse n'existe).
Un clic lance l'analyse — le bloc passe en « Analyse en cours… » puis se met à
jour tout seul en « terminé ». Surtout, pour les entités investies via
**Parallel**, la synthèse tient maintenant compte de leurs **communications
Parallel** (titres, contenus, documents), en plus des reports reçus par mail.
Jusqu'ici la synthèse ne se déclenchait qu'à la réception d'un report par mail :
les entités Parallel, qui n'en reçoivent pas, restaient sans synthèse — elles
peuvent désormais être analysées d'un clic.

> **🔧 Notes techniques**
>
> - `intelligence.rerun` : nouvelle mutation publique (org-member-guarded) qui
>   passe la ligne `companyIntelligence` en `processing` (UI réactive immédiate)
>   puis planifie `runAnalysis`. Le trigger mail (`reportStore`, fan-out
>   d'ingestion) reste l'unique autre déclencheur — inchangé.
> - `runAnalysis` : après `getContext` (élargi pour renvoyer aussi les liens
>   `vascoClientSlug`/`vascoIssuerId`), pull **live** des communications de
>   l'émetteur VASCO lié via `vasco.pullCommunicationsForSynthesis`
>   (internalAction system-context : `getActiveConnectionsByOrgId` auth-less →
>   `pullCommunications` → filtre `issuerId`), concaténées au contexte du prompt.
>   Best-effort (`[]` si échec VASCO). Garde `no_data` ré-évaluée sur
>   (contexte **OU** comms).
> - Front : `CompanyAiSynthesisBlock` → sous-composant `RerunButton` (icône
>   refresh, spinner tant que `pending || status === 'processing'`), visible en
>   états vide/erreur/terminé. i18n `participations:intelligence.rerun` /
>   `rerunError` (en+fr). Aucun changement de schéma.

## v1.87.1 — 15/07/2026 à 12:50 — Reports par email : les liens Notion en notion.com sont détectés

Correctif sur le circuit des reports : les liens Notion au nouveau format
`notion.com` (celui que Notion génère désormais avec « Copier le lien »,
comme dans l'update Tango du jour) n'étaient pas reconnus — le report
était rangé sans la page Notion. Ils sont maintenant détectés comme les
anciens formats. Pour un report déjà rangé sans sa page Notion :
« Retraiter » depuis la page Reports entrants.

> **🔧 Notes techniques**
>
> - `convex/lib/reportLinks.ts` : troisième pattern `NOTION_PATTERNS` pour `(*.)notion.com` (ex. `app.notion.com/p/<workspace>/<page>`), avec exigence d'un id de page 32-hex dans l'URL pour ne pas embarquer les pages marketing (`notion.com/pricing`…). Les domaines historiques `notion.so` / `*.notion.site` sont inchangés.
> - Nouveau `tests/reportLinks.test.ts` (4 cas, dont l'URL Tango réelle et le cas marketing exclu).

## v1.87.0 — 15/07/2026 à 10:42 — Vos deals en term sheet arrivent tout seuls depuis Attio

Quand un deal passe en **Term Sheet** dans Attio (vous vous êtes engagé à
verser les fonds), il apparaît maintenant **automatiquement dans vos deals**
Albo OS, marqué **« Term sheet »** — visible, mais pas encore réalisé. Et une
**sortie de trésorerie anticipée** est ajoutée à votre prévisionnel, à la date
d'investissement prévue, pour mieux anticiper le décaissement.

Quand le deal passe ensuite en **Invested**, il bascule en réalisé et la ligne
du prévisionnel est confirmée (elle se soldera toute seule au pointage du vrai
virement).

Vos deals **déjà investis ne sont jamais réimportés** : la synchro ne crée un
deal qu'au stade Term Sheet, donc aucun doublon avec ce qui est déjà dans
Albo OS. À noter : la ligne de prévisionnel n'apparaît que si la **date
d'investissement** est renseignée dans Attio (sinon le deal s'affiche quand
même, sans échéance). Fonction à activer une fois côté configuration (voir
notes techniques) — tant qu'elle ne l'est pas, rien ne change.

> **🔧 Notes techniques**
>
> - Reprise du chantier « Lot 2 » (webhook Attio → deals), réécrit sur le
>   modèle prévisionnel actuel (`forecastEntries` + rattachement deal). La
>   PR #89, basée sur un `main` périmé, est remplacée.
> - `convex/attioSync.ts` : `upsertFromDeal` réel (mutation interne, écrit via
>   `ctx.db`, investisseur = `group_root` de l'org). La décision de branche est
>   **pure** dans `convex/lib/attioSync.ts` (`decideSyncAction`), testée
>   (`tests/attioSync.test.ts`). Term Sheet → deal `pending` + une
>   `forecastEntries` (`direction: out`, `confidence: expected`, `category:
>   deals`, `derivedKey: deal:{id}` **stable**, date = `date_de_l_investissement`,
>   montant = `value` Attio) ; Invested → statut `active` (forward-only) +
>   `confidence: confirmed`. **Jamais de création sur Invested** (verrou
>   anti-doublon). Frontière d'attribution : `pending` = Attio source (refresh),
>   `active` = Albo OS source (aucun écrasement).
> - Schéma additif : `deals.status += 'pending'`, `INSTRUMENTS += 'unknown'`
>   (fallback instrument absent/non mappé, archétype placeholder). i18n
>   `participations:status.pending` (« Term sheet ») + `instrument.unknown`.
> - Webhook durci : re-fetch transitoire (réseau / 5xx Attio) → 503 (retry) ;
>   erreur de config (secret/clé absente) → 200 (pas de tempête de retries).
> - Activation prod : `pnpm exec convex env set ATTIO_WEBHOOK_SECRET <secret>`
>   + webhook Attio `record.updated` sur l'objet `deals` → `/attio/webhook`.

## v1.86.2 — 14/07/2026 à 12:20 — Reports par email : extraction Notion fiabilisée

Correctif sur le circuit des reports : l'extraction des pages Notion
échouait systématiquement, y compris sur des pages publiques — Notion a
récemment fermé l'accès technique que le monde entier utilisait pour lire
ses pages sans navigateur. L'extraction passe désormais par un service de
rendu (la page est ouverte dans un vrai navigateur distant, son contenu est
récupéré en texte), avec l'ancienne méthode toujours tentée en premier au
cas où Notion rouvrirait l'accès. Une clé gratuite est à configurer sur
browserless.io (voir notes techniques) ; les reports Notion déjà en échec
peuvent ensuite être relancés avec « Retraiter » depuis la page Reports
entrants.

> **🔧 Notes techniques**
>
> - Diagnostic (13/07/2026) : `loadPageChunk`/`loadCachedPageChunkV2` → 400 même sur page publique (www + sous-domaine), `notion-client` npm cassé pareil, HTML public = coquille SPA, UA Googlebot → 403. Aucune voie sans navigateur — documenté dans `KNOWN_ISSUES.md` « Notion : extraction ».
> - `convex/lib/notion.ts` : chaîne API interne (auto-guérison) → **Browserless** (`POST /content`, `waitForSelector: .notion-page-content`, `bestAttempt`, HTML → texte via `htmlToText`, garde anti-coquille `MIN_USEFUL_CHARS`) → **Jina Reader** (`r.jina.ai`, payant, utilisé seulement si `BROWSERLESS_TOKEN` absent). `extractPageId` accepte aussi les UUID avec tirets.
> - Nouvel env **`BROWSERLESS_TOKEN`** (browserless.io, plan gratuit 1000 unités/mois — largement assez pour 2-3 reports/jour) : `pnpm exec convex env set BROWSERLESS_TOKEN <token> --prod`. `BROWSERLESS_URL` optionnel (région, défaut `production-sfo`). `JINA_API_KEY` reste supporté en alternative payante. Sans aucune clé, comportement précédent (échec actionnable).
> - Libellé du récap `notion_unreachable` reformulé (la cause n'est plus forcément une page privée) ; TESTING R17/R17b mis à jour.

## v1.86.1 — 14/07/2026 à 14:48 — Reportings Parallel : le rattachement s'affiche sur toutes les entités investies

Le bloc « Rattacher à Parallel » n'apparaissait que si l'entité portait la
mention « Parallel » dans un champ d'origine — du coup il restait invisible sur
beaucoup de fiches. Il s'affiche désormais sur **toutes les entités investies**,
sous forme d'un encart clair dans l'onglet Reports : un clic pour lier la fiche
à son deal Parallel, et ses communications apparaissent. (Rien ne change sur les
entités juridiques du groupe.)

> **🔧 Notes techniques**
>
> - `VascoCommunicationsSection` : suppression du gate `sponsor`/`group`. Le bloc
>   s'affiche si `company.kind === 'portfolio'` **ou** entité déjà rattachée ;
>   l'état non-rattaché passe d'un bouton fantôme discret à un encart pointillé
>   visible (nouvelle clé i18n `vasco:link.prompt`, en+fr).

## v1.86.0 — 14/07/2026 à 14:25 — Les reportings Parallel arrivent sur vos fiches deals

Les entités investies via **Parallel** (les SPV Youse, Bernay, Abel Garnier,
STOA, NG Invest…) peuvent désormais afficher leurs **communications Parallel**
directement dans l'onglet « Reports » de leur fiche : chaque annonce datée
(coupons, reportings, actualités de l'opération) avec, quand il y en a, le
**document à télécharger** (le reporting PDF). On rattache une fiche à son deal
Parallel en un clic (« Rattacher à Parallel » → on choisit le SPV) ; les
communications s'affichent alors, rafraîchies à la demande. Rien n'est stocké :
tout est lu en direct depuis Parallel. Une entité non concernée ne voit aucun
changement.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : trois actions org-guardées, lecture live (login +
>   appels externes, non réactives) — `fetchCommunications({orgId, clientSlug,
>   issuerId})` (scope `GetCommunications(userId)`, filtré par issuer, tri date
>   desc), `listVascoIssuers` (émetteurs distincts + dernier titre pour le
>   picker), `downloadCommunicationDocument` (le `downloadUrl` VASCO est
>   authentifié → proxy : login + fetch bearer → `ctx.storage` → `getUrl`).
>   `htmlContent` nettoyé en texte (`stripHtml`) côté serveur.
> - Mapping entité↔émetteur **par id** : champs `companies.vascoClientSlug` +
>   `companies.vascoIssuerId` (schéma), mutation `companies.setVascoLink`
>   (set/unset ensemble ; jamais par nom, les labels sont opaques « SPVn »).
> - Front : `src/components/vasco/VascoCommunicationsSection.tsx` dans l'onglet
>   Report de `participations.$companyId` (bloc communications + dialog de
>   rattachement) ; namespace i18n `vasco` (en+fr). Le linker n'apparaît que sur
>   une entité Parallel (`sponsor`/`group`) ou déjà rattachée.
> - Détails et pièges (accès investisseur, proxy download, doublon de connexion
>   401) : `KNOWN_ISSUES.md` § « VASCO API » ; recette de test : `TESTING.md`
>   § « Communications Parallel ».

## v1.85.0 — 14/07/2026 à 14:23 — Le prévisionnel se rattache aux deals

Les flux prévisionnels peuvent désormais être **rattachés à un deal** — les
loyers Iroko à votre deal SCPI, un coupon à son obligation, un appel de
fonds daté à son deal signé.

- Dans les formulaires de règle récurrente et d'échéance ponctuelle, un
  nouveau champ **« Deal (optionnel) »** : choisissez le deal, et toutes
  les occurrences générées portent le lien (le retirer est tout aussi
  simple).
- La **fiche deal** gagne une section **« Prévisionnel »** : les échéances
  à venir rattachées au deal (avec leur confiance) et le reste à déployer
  engagé — juste au-dessus des transactions réalisées. Les trois couches
  au même endroit : réalisé, prévu, engagé.
- Bonus de cohérence : quand vous **rapprochez** une échéance rattachée à
  un deal avec un mouvement bancaire pas encore pointé, l'application vous
  propose dans la foulée de **pointer la transaction sur ce deal** — un
  clic dans la notification, et le geste reste explicite.
- L'assistant IA sait faire pareil : créer ou modifier une règle/échéance
  avec son deal.

> **🔧 Notes techniques**
>
> - `dealId` optionnel sur `forecastRules` (nouveau) + activation du champ
>   réservé sur `forecastEntries` (+ index `by_deal`) ; garde-fou
>   `assertDealInOrg` (`deal_wrong_org`) sur toutes les écritures ;
>   `expandRules` propage le `dealId` de la règle (insert **et** resync) ;
>   le reliquat d'un paiement partiel hérite du lien. Clear par `null`
>   (même convention wire que `category`).
> - Query `forecasts.getDealForecast` (échéances pending par `by_deal` +
>   reste à déployer, même dérivation que `getCommittedPipeline`) →
>   section `src/components/deals/DealForecastSection.tsx` sur la fiche
>   deal. Sélecteur `DealCombobox` (réutilisé du pointage) dans
>   `RuleDialog`/`EntryDialog` via `deals.listOptions`.
> - `suggestForecastMatches` renvoie `pointToDealId` (échéance liée + tx
>   non pointée) → toast avec action « Pointer sur le deal »
>   (`transactions.matchTransaction`, le pointage reste un geste distinct).
> - Outils agent : `dealId` sur create/update règle et échéance, exposé
>   dans les listes. i18n fr/en (`cash:forecast.dealLabel`,
>   `participations:dealForecast`).

## v1.84.0 — 14/07/2026 à 14:17 — Même domaine, même description

Quand plusieurs entités partagent le même site web (par exemple les différentes
sociétés « La Vie de Quartier »), elles affichent maintenant **le même
one-liner et le même résumé**, pour rester cohérentes. Concrètement :

- **Si vous modifiez le résumé de l'une, il se met à jour sur toutes** celles
  qui ont le même domaine (au sein d'un même espace) — plus besoin de recopier.
- **À la génération automatique**, une nouvelle entité reprend le texte d'une
  entité sœur déjà décrite (même domaine) au lieu d'en réécrire une variante.
- L'existant est **harmonisé** en une passe : pour chaque domaine partagé, le
  résumé le plus complet devient le résumé commun.

> **🔧 Notes techniques**
>
> - Nouveau `convex/lib/pitch.ts` : `pickCanonicalPitch` (résumé le plus long
>   du groupe) + `applyPitchToDomainGroup(ctx, orgId, domain, fields, mode)`
>   (`overwrite` = propagation/unif, `fill` = enrichissement additif). Tests
>   `tests/pitch.test.ts`.
> - `companies.update` propage un `summary` édité à tout le groupe de même
>   domaine (par org). `companyEnrichment.enrich` réutilise le pitch d'un voisin
>   (pas d'appel LLM) sinon génère ; `applyEnrichment` remplit tout le groupe en
>   mode `fill`.
> - Migration one-shot `convex/migrations/unifyDomainPitches.ts` (`dryRun`/
>   `apply`/`report`) pour figer l'existant. Invariant documenté dans
>   `KNOWN_ISSUES.md` « Pitch partagé par domaine ». `MIGRATIONS.md` mis à jour.

## v1.83.4 — 14/07/2026 à 13:53 — Nettoyage des résumés génériques par lot

Complément à l'outillage de nettoyage : le premier passage (non filtré) avait
posé un résumé sur beaucoup de lignes de plateforme (les SPV Parallel, les
opérations Anaxago, des fonds…), toutes avec le même texte générique décrivant
la plateforme plutôt que l'actif. Un outil permet maintenant de vider ces
résumés **par catégorie** en une fois, tout en préservant les résumés utiles
(lignes de deal décrivant la vraie société investie) et ceux rédigés à la main.

> **🔧 Notes techniques**
>
> - `backfillCompanyEnrichment.clearByReason({ reasons })` : vide
>   `oneLiner`+`summary` sur les entités portfolio dont le motif
>   `classifyExclusion` est dans la liste passée (buckets plateformes/
>   véhicules). Ne touche jamais `side_deal` (décrit la boîte sous-jacente) ni
>   `lvdq_sub_entity` (curé) sauf si explicitement nommés. Complète
>   `clearByIds` (liste d'id) et `listEnrichedNonCompanies` (revue).
> - `MIGRATIONS.md` mis à jour.

## v1.83.3 — 14/07/2026 à 13:39 — Moins d'interruptions de l'assistant sur les tâches planifiées

L'assistant n'a plus besoin d'une validation manuelle à chaque fois qu'il
crée, met à jour ou supprime un **rappel planifié** (par exemple la
revérification automatique d'une pull request). Ces actions n'ont aucun
effet sur vos données : elles sont désormais autorisées d'office — fini les
clics de confirmation à répétition.

> **🔧 Notes techniques**
> Ajout d'un bloc `permissions.allow` dans `.claude/settings.json`
> auto-autorisant les 4 outils de planification du serveur MCP « Claude
> Code Remote » : `create_trigger`, `update_trigger`, `delete_trigger`,
> `send_later`. Périmètre volontairement restreint à ces 4-là (pas de
> `fire_trigger` ni `list_triggers`). Config versionnée et partagée → vaut
> pour les deux utilisateurs ; effet immédiat en session, persistance
> assurée par le commit (le conteneur des sessions web est recréé à zéro,
> seul le versionné survit).

## v1.83.2 — 14/07/2026 à 13:20 — Résumés : exclure les produits d'épargne et nettoyer les scories

Deux ajustements au rattrapage des résumés :

- Les **contrats de capitalisation** (ex. « Capitalisation Palatine ») sont
  désormais écartés de la génération, comme les autres lignes qui ne sont pas
  des sociétés — leur domaine est celui de la banque, un résumé n'aurait pas
  de sens.
- Un **outil de vérification** permet de repérer les lignes non-sociétés qui
  auraient reçu un résumé générique lors du tout premier passage (avant la
  mise en place du filtre), pour les vider proprement — en préservant les
  résumés rédigés à la main.

> **🔧 Notes techniques**
>
> - `backfillCompanyEnrichment` : motif `capitalisation_contract` ajouté à
>   `classifyExclusion`.
> - Nouveau `listEnrichedNonCompanies` (lecture seule) : liste les entités
>   motif-exclu portant déjà `oneLiner`/`summary` (scories du 1er backfill
>   #201, non filtré), avec le texte. `clearByIds` vide `oneLiner`+`summary`
>   sur une **liste d'id explicite** (jamais de wipe global — protège les
>   résumés curés type « La vie de Quartier - Holding »).
> - `MIGRATIONS.md` mis à jour.

## v1.83.1 — 14/07/2026 à 13:18 — Parallel : préparation de l'affichage des communications par deal

Travail préparatoire (rien de visible pour l'instant) en vue d'afficher, dans la
section « Report » de chaque entité, les communications publiées par Parallel sur
chaque deal (datées, avec pièces jointes). Cette étape ajoute un outil de
diagnostic interne pour vérifier que ces communications sont bien lisibles via
l'API avant de construire l'affichage.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : nouvelle `internalAction` `probeCommunications`
>   (diagnostic CLI — `npx convex run --prod vasco:probeCommunications
>   '{"orgSlug":"calte"}'`) : login, liste des comptes, puis `GetCommunications`
>   sous chaque scoping candidat (`userId`, `accountId`). Renvoie la réponse
>   GraphQL **brute** (`data` + `errors` + `extensions.warnings`), car le refus
>   d'accès de la persona investisseur arrive en `warnings` (champ `null`) et non
>   en `errors`.
> - Ajoute `vascoGraphqlRaw` (variante non-throwing de `vascoGraphql`) et la
>   requête `GET_COMMUNICATIONS` (`id`, `title`, `period`, `publishDate`,
>   `issuer { id label }`, `communicationDocuments { document { … downloadUrl } }`).
> - Aucune UI ni écriture DB. Phase 1 (dé-risquage) de l'étape 2b VASCO ;
>   l'affichage (read path org-guardé + rattachement entité↔émetteur + bloc dans
>   `CompanyReportsSection` + roll-up org) suivra une fois l'accès prouvé.
## v1.83.0 — 14/07/2026 à 13:09 — Le prévisionnel se mesure, vous alerte, et anticipe la TVA

Trois compléments au prévisionnel de trésorerie :

- **Fiabilité mesurée** : chaque 1er du mois, une photo du prévisionnel est
  prise automatiquement. Dès le mois suivant, la page Trésorerie affiche
  l'écart entre ce qui était projeté pour le mois écoulé et ce qui s'est
  réellement passé — pour savoir à quel point faire confiance à la courbe.
- **Alerte de seuil** : réglez un seuil (ex. 50 000 €) sur la page
  Trésorerie ; si le solde projeté des 3 prochains mois passe dessous, vous
  recevez un email — au plus un par semaine, et le réglage se modifie ou se
  coupe à tout moment.
- **Échéance TVA estimée** : quand la TVA du trimestre clos est à payer
  (collectée > déductible), une carte propose de créer l'échéance
  correspondante (datée du 24 du mois suivant le trimestre) dans le
  prévisionnel — en un clic, jamais automatiquement, avec un avertissement
  si des transactions du trimestre restent à qualifier.

> **🔧 Notes techniques**
>
> - Premiers **crons Convex** du repo (`convex/crons.ts`) : snapshot
>   mensuel (1er, 05:00 UTC → `forecasts.captureSnapshots`, idempotent par
>   (org, mois), relançable via `convex run`) et alertes quotidiennes
>   (07:00 UTC → `checkCashAlerts`, cooldown 7 j, email bilingue
>   `emailTemplates.ts:cashAlertEmail` via Resend). Fonctions internal sans
>   auth — même famille d'exceptions que les backfills (KNOWN_ISSUES).
> - Nouvelles tables `forecastSnapshots` (append-only, projection 12 mois
>   au 1er du mois) et `cashAlertSettings` (une par org, `lastNotifiedAt`
>   remis à zéro à chaque modification). Query `getForecastReliability`
>   (snapshot M-1 vs solde réel fin M-1), `getCashAlert`/`setCashAlert`.
> - TVA trimestrielle : `previousQuarter` (pur, `lib/recurrence.ts`, testé),
>   `computeVatPositionForOrg` extrait de `getVatPosition` avec fenêtre de
>   dates, `suggestVatEntry`/`createVatEntry` (montant recalculé serveur,
>   idempotent par `derivedKey` "vat:{org}:{trimestre}" — sans `ruleId`,
>   l'échéance reste une ponctuelle éditable). UI :
>   `VatSuggestionCard.tsx`, `CashAlertCard.tsx`, ligne fiabilité dans
>   `ForecastOverview.tsx`.

## v1.82.2 — 14/07/2026 à 12:49 — Nettoyage des domaines et ciblage du rattrapage

En lançant le rattrapage des résumés, on a découvert que beaucoup de fiches
Calte avaient un **domaine mal enregistré** (collé sous forme de lien ou
d'adresse complète avec des paramètres de suivi). Conséquence : leur **logo
était cassé** et le résumé ne pouvait pas se générer. Cette mise à jour :

- **répare les domaines** existants (ils redeviennent un simple nom de site,
  ex. `anaxago.com`), ce qui rétablit les logos **et** débloque la génération ;
- **normalise désormais tout domaine à la saisie** — coller une adresse
  complète ou un lien fonctionne, c'est nettoyé automatiquement ;
- **cible mieux le rattrapage** : les lignes qui ne sont pas des sociétés
  (lignes de deal, SPV, fonds, véhicules d'investissement) sont désormais
  écartées de la génération de résumé, où elle n'a pas de sens.

> **🔧 Notes techniques**
>
> - Helper pur `convex/lib/domain.ts:normalizeDomain` (retire wrapper markdown
>   `[…](…)`, protocole, chemin/query, `www.` ; `null` si irréductible) +
>   tests `tests/domain.test.ts`. Appliqué à l'écriture (`companies.create`/
>   `update`, `agentTools.createCompanyInternal`) et défensivement au fetch
>   (`companyEnrichment.fetchSiteText`).
> - Migration `convex/migrations/normalizeCompanyDomains.ts` (`dryRun`/`apply`/
>   `report`) : réécrit les domaines corrompus en base (idempotent, non
>   destructif — illisible → `needsManualReview`). **À lancer avant** le
>   backfill.
> - `backfillCompanyEnrichment` : filtre `classifyExclusion` (motifs
>   structurels + liste nominative) ; `dryRun` sort `willEnrich` vs `excluded`.
> - Contexte complet : `KNOWN_ISSUES.md` « Domaines corrompus ». `MIGRATIONS.md`
>   mis à jour (2 lignes).

## v1.82.1 — 14/07/2026 à 12:26 — Rattrapage des résumés/one-liners pour les entités déjà existantes

Le remplissage automatique du one-liner et du résumé (v1.81) ne se déclenchait
que pour les **nouvelles** entités, ou quand on posait un domaine pour la
première fois. Les entités déjà en base avec un domaine — SPV, véhicules, et
autres sociétés dont le domaine avait été rempli lors des imports précédents —
restaient donc vides. Cette mise à jour ajoute une **opération de rattrapage**
qui relance la génération sur toutes ces entités (Calte et Albo) d'un coup. À
noter : pour les SPV et véhicules, le domaine pointe souvent vers le site de la
plateforme mère, donc le texte généré peut décrire la plateforme plutôt que le
véhicule — ces quelques cas sont à relire à la main.

> **🔧 Notes techniques**
>
> - Migration one-shot `convex/migrations/backfillCompanyEnrichment.ts`
>   (`dryRun` / `apply` / `report`) : liste toute entité `kind: 'portfolio'`
>   non archivée, toutes orgs, ayant un `domain` mais `oneLiner` et/ou
>   `summary` vide, et schedule `companyEnrichment.enrich` sur chacune
>   (staggeré `STAGGER_MS` pour lisser les appels site + LLM). Additive et
>   idempotent (l'action ne remplit que les champs `undefined`). `report`
>   reliste ce qui reste vide après coup (site injoignable → saisie manuelle).
> - Ligne ajoutée à `MIGRATIONS.md`. Aucun changement de schéma ni d'UI.

## v1.82.0 — 14/07/2026 à 12:20 — La Trésorerie repère vos flux récurrents et propose des règles

Le prévisionnel apprend de votre historique. La Trésorerie détecte désormais
les **flux qui reviennent régulièrement** dans les 12 derniers mois — même
sens, même rythme (hebdo, mensuel, trimestriel), montants stables — et les
propose comme **règles récurrentes** quand aucune règle existante ne les
couvre déjà.

- Une carte « Règles suggérées » apparaît en tête de la section Règles
  récurrentes (uniquement quand il y a quelque chose à proposer) : libellé,
  montant médian avec la fourchette observée, rythme détecté, nombre
  d'occurrences.
- **« Créer la règle »** ouvre le formulaire habituel **prérempli** — vous
  ajustez si besoin, vous enregistrez, la projection se recalcule. Rien ne
  se crée jamais tout seul.
- **« Ignorer »** est définitif : la suggestion ne reviendra pas.

> **🔧 Notes techniques**
>
> - Moteur pur `convex/lib/recurrenceDetection.ts` (+ 11 tests) : groupement
>   par `(direction, pattern)` via `deriveCategoryPattern` (même clé que les
>   règles apprenantes de catégorie), ≥ 3 occurrences, intervalles réguliers
>   (médiane + 60 % dans la tolérance — survit à une occurrence manquée),
>   montants tous à ±30 % de la médiane ; dédup contre les règles actives
>   (même sens/fréquence, montant ±15 %).
> - Query `forecasts.suggestRules` (12 mois, comptes EUR) + mutation
>   `dismissRuleSuggestion` ; nouvelle table `dismissedRuleSuggestions`
>   (orgId, pattern, direction — pas de surface d'édition en V1, dashboard
>   Convex comme `categoryRules`).
> - UI : `src/components/cash/SuggestedRules.tsx` ; `RuleDialog` accepte un
>   `prefill` (mode création). i18n fr/en `cash:forecast.suggestedRules`.

## v1.81.0 — 14/07/2026 à 12:05 — Résumés des participations Albo + remplissage automatique depuis le domaine

Deux nouveautés autour du résumé de société introduit en v1.80 :

- **Les 35 participations opérationnelles d'Albo ont leur résumé** : 2-3
  phrases factuelles rédigées à partir du site officiel de chaque société
  (même périmètre que les one-liners — les SPV immobiliers et véhicules
  d'investissement n'en ont pas, un résumé n'y a pas de sens). Les domaines
  manquants de Redesk et Loewi ont été retrouvés au passage. L'import est
  prêt à être exécuté en prod (dry-run puis apply, commandes dans le module).
- **Remplissage automatique pour les prochaines entités, dans les deux
  espaces (Calte et Albo)** : dès qu'une société portfolio a un domaine —
  posé à la création (y compris via l'assistant) ou plus tard sur sa fiche —
  le one-liner du tableau **et** le résumé de la fiche se génèrent tout
  seuls en arrière-plan à partir du site web. Une valeur déjà renseignée
  n'est jamais écrasée : on peut toujours corriger à la main, la correction
  reste. Si le site est inaccessible, les champs restent simplement vides.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/companyEnrichment.ts` : action interne `enrich`
>   (fetch homepage + `htmlToText`, puis `generateObject` sur `getModel()`
>   avec fallback `generateText`, prompt FR) → mutation `applyEnrichment`
>   **additive** (n'écrit que les champs encore `undefined`, re-vérifié à
>   l'écriture). Schedulée via `ctx.scheduler.runAfter(0, …)` depuis
>   `companies.create` (si domaine), `companies.update` (pose de domaine,
>   kind `portfolio` uniquement) et `agentTools.createCompanyInternal`.
>   Échecs silencieux (warn logs), aucun impact UI.
> - Migration one-shot `convex/migrations/alboSummaryImport.ts`
>   (`dryRun`/`apply`/`verify`, pattern d'`alboOneLinerImport`) : 35
>   `summary` + 2 `domain` (Redesk `redesk.fr`, Wheelee - Loewi `loewi.fr`),
>   ancrée par `_id` prod + garde nom. Ligne ajoutée à `MIGRATIONS.md`.
> - `convex/_generated/api.d.ts` re-synchronisé à la main (codegen
>   indisponible dans l'environnement). TESTING.md : lignes ED6f/ED6g.

## v1.80.1 — 14/07/2026 à 11:28 — Parallel (VASCO) : outillage pour débusquer le login qui échoue en prod

Correctif technique. Le diagnostic a montré que Parallel renvoie « identifiants
invalides » depuis la prod — donc pas un blocage réseau, mais un mot de passe
stocké qui ne correspond pas. Ce patch ajoute de quoi le confirmer sans exposer
le secret, et de quoi ré-enregistrer le mot de passe sans risque de corruption.

> **🔧 Notes techniques**
>
> - `debugVascoLogin` remonte désormais, par connexion, `storedUsername`,
>   `storedPasswordLen` et `storedPasswordSha12` (empreinte SHA-256 tronquée,
>   non réversible) — pour comparer le secret stocké à l'attendu sans le
>   divulguer.
> - `seedConnection` accepte `passwordB64` (mot de passe en base64) en plus de
>   `password`, pour ré-enregistrer un mot de passe à l'abri du mangling
>   shell/copier-coller. `pnpm lint` + `pnpm test:unit` au vert.

## v1.80.0 — 14/07/2026 à 11:38 — Résumé de la société sur sa fiche

Chaque fiche société peut maintenant porter un **résumé** de deux à trois
lignes, affiché juste sous le nom de la société en haut de sa fiche — plus
complet que le one-liner du tableau des entreprises, qui reste inchangé. Le
résumé se saisit via le dialog « Modifier » de la fiche (nouveau champ
« Résumé ») ; le vider le retire de la fiche. Le champ est prêt partout — il
sera rempli dans un premier temps sur les participations Albo.

> **🔧 Notes techniques**
>
> - Nouveau champ optionnel `companies.summary` (`convex/schema.ts`), accepté
>   par le patch de `companies.update` (`convex/companies.ts`) : trim, `''`
>   efface (miroir de `domain`).
> - Fiche entité (`src/routes/app/$orgSlug/participations.$companyId.tsx`) :
>   affichage du résumé sous l'en-tête (`whitespace-pre-line`, texte muted) +
>   `Textarea` « Résumé » dans `EditCompanyDialog`.
> - i18n FR/EN (`participations.json` : `edit.summaryLabel`,
>   `edit.summaryPlaceholder`) ; TESTING.md ligne ED6e. Pas de seed dans cette
>   PR — remplissage Albo à suivre.

## v1.79.0 — 14/07/2026 à 11:38 — La page Trésorerie devient un cockpit

L'onglet Aperçu de la Trésorerie est réorganisé pour répondre d'abord aux
questions qui comptent : combien j'ai, où j'atterris, qu'est-ce qui tombe
bientôt.

- **Bandeau de chiffres clés** en tête de page : solde disponible (avec le
  détail des fonds bloqués ou clôturés), atterrissage projeté fin de mois,
  et net des échéances à 30 et 90 jours (entrées − sorties, retards
  compris).
- **Échéances à venir** : une nouvelle liste 30/90 jours montre tout ce qui
  tombe bientôt — y compris les occurrences des règles récurrentes (loyers,
  salaires…), qui n'étaient visibles jusqu'ici que dans la courbe. Les
  retards remontent en premier, marqués en rouge.
- **Nouvel ordre de lecture** : chiffres clés, courbe, grille, échéances et
  rapprochements suggérés d'abord ; comptes bancaires, TVA et gestion des
  règles/échéances ponctuelles en dessous.

> **🔧 Notes techniques**
>
> - Nouvelle query `forecasts.getUpcomingEntries` (pending EUR ≤ 90 j,
>   retards inclus sans borne basse — même position que le rollover de la
>   grille ; renvoie aussi `net30Cents`/`net90Cents`), partagée entre le
>   bandeau et la liste (dédup de souscription Convex).
> - Nouveaux composants `src/components/cash/CashKpis.tsx` (bandeau, 4
>   tuiles ; atterrissage = `projection[0]` de la grille) et
>   `UpcomingEntries.tsx` (toggle 30/90 j, lecture seule) ;
>   `ForecastOverview` accueille le bandeau (prop `accounts`) ; les cartes
>   Solde disponible/total quittent `CashAccounts` (tables seules) ;
>   réordonnancement dans `cash.index.tsx`. i18n fr/en (`cash:kpis`,
>   `cash:upcoming`). TESTING CA2/FC1 mis à jour + FC19-FC20.

## v1.78.0 — 14/07/2026 à 11:10 — Voir un one-liner en entier d'un clic

Dans le tableau des entreprises, un one-liner un peu long était coupé (« … ») et
on n'en voyait pas la fin. Désormais, quand un one-liner est tronqué, il devient
**cliquable** (petit souligné pointillé au survol) : un clic ouvre une petite
carte avec le **texte complet**. Le reste de la ligne continue d'ouvrir la fiche
de la société comme avant. Les one-liners courts, qui tiennent déjà en entier,
ne changent pas.

> **🔧 Notes techniques**
>
> - `ParticipationsTable.tsx` : sous-composant `OneLinerCell` qui détecte la
>   troncature via un callback ref stable + `ResizeObserver` (`scrollWidth >
>   clientWidth`), robuste au resize et au swap span↔bouton. Seuls les
>   one-liners coupés deviennent un `PopoverTrigger` ; `stopPropagation` sur le
>   clic/keydown du bouton et sur le `PopoverContent` pour ne jamais déclencher
>   la navigation de ligne (`role="link"`).
> - Remplace l'ancien `title` natif (tooltip navigateur) sur la cellule.
> - Nouvelle clé i18n `participations.oneLinerExpand` (FR/EN) pour l'aria-label.

## v1.77.1 — 14/07/2026 à 11:09 — Parallel (VASCO) : diagnostic de connexion depuis la prod

Correctif technique. La connexion à Parallel échoue depuis les serveurs de
production alors que les identifiants sont valides (elle marche depuis un autre
environnement). Ajout d'un outil de diagnostic pour identifier précisément la
cause, et d'un en-tête d'identification qui peut à lui seul débloquer.

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : en-tête `User-Agent` sur les appels VASCO (certains WAF
>   rejettent une requête sans UA) ; l'erreur `vasco_login_failed` remonte
>   désormais le **code HTTP + un extrait du corps** de la réponse.
> - Nouvelle action interne `debugVascoLogin`
>   (`convex run --prod vasco:debugVascoLogin '{"orgSlug":"calte"}'`) : renvoie
>   l'**IP de sortie** de Convex + la réponse brute du login par connexion
>   (status/corps, token masqué) — pour trancher entre blocage IP/WAF et autre.
>   `pnpm lint` + `pnpm test:unit` au vert.

## v1.77.0 — 14/07/2026 à 11:01 — Rapprochement des échéances prévues avec les mouvements réels

La page Trésorerie sait désormais **rapprocher le prévu du réel**. Une carte
« Rapprochements suggérés » repère les échéances dues ou en retard qui
ressemblent à un mouvement bancaire récent (même sens, montant proche, date
proche, libellé qui colle) et propose de les rapprocher en un clic — les
occurrences des règles récurrentes (loyers, salaires…) comme les échéances
ponctuelles.

Quand les montants ne collent pas exactement, la décision vous appartient,
explicitement :

- **Clore avec l'écart** (par défaut) : l'échéance est considérée réalisée
  telle quelle, l'écart reste visible.
- **Conserver le reliquat** (paiement partiel) : la partie payée est
  réalisée et le solde restant redevient une échéance à venir, visible dans
  les échéances ponctuelles.

Au passage, **l'assistant IA parle désormais le même prévisionnel que la
page** : sa projection de trésorerie utilise exactement la même logique que
la courbe et la grille (flux du mois courant déjà passés en banque non
recomptés, échéances en retard glissées sur le mois courant, comptes
disponibles uniquement). Il sait aussi gérer le reliquat d'un paiement
partiel quand vous lui demandez de pointer une échéance.

> **🔧 Notes techniques**
>
> - Moteur de suggestion pur `convex/lib/entryMatching.ts` (fenêtres
>   sens/date ±10 j/montant 50–150 %, score montant+date+libellé,
>   affectation greedy 1↔1) + `tests/entryMatching.test.ts` ; query
>   `forecasts.suggestForecastMatches` (exclut les tx `ignored`/virements
>   internes et celles déjà portées par un `realizedTransactionId`).
> - `markEntryRealized` (+ outil agent) prend `mode: 'close' |
>   'keepRemainder'` via le cœur partagé `applyMarkEntryRealized` ; le
>   reliquat devient une entry one-shot pure (sans `ruleId`/`derivedKey`).
> - UI : `src/components/cash/ForecastMatchSuggestions.tsx` (carte + dialog
>   de décision), i18n fr/en `cash:forecast.suggestions`.
> - Alignement agent/MCP : `getForecastBalanceInternal` rebranché sur le
>   cœur grille extrait `forecasts.ts:computeForecastGridForOrg`
>   (`historyMonths: 0`) ; l'ancienne sémantique fenêtrée
>   (`buildMonthlyBalance`, query publique `getForecastBalance`) est
>   supprimée. KNOWN_ISSUES/TESTING mis à jour (F6-F14, FC16-FC18).
## v1.76.1 — 14/07/2026 à 10:44 — Parallel (VASCO) : lecture des positions + vérif en prod

Suite de la connexion Parallel. Albo OS lit désormais tes **positions réelles**
depuis Parallel (montant investi par ligne, société, véhicule, date), et une
commande permet de **vérifier la connexion directement en prod**. Toujours rien
d'affiché dans l'app pour l'instant : c'est la fondation pour rattacher ces
lignes à tes deals et remonter les valorisations (étape suivante).

> **🔧 Notes techniques**
>
> - `convex/vasco.ts` : les positions se lisent maintenant via
>   `GetAccount(id).investments` (montant investi réel par ligne : `amount` en
>   cents, `securityName`, `vehicleName`, `securitiesNumber`, dates) — les
>   `accountSecurityContracts` renvoyaient des montants **masqués** (0) pour le
>   persona investisseur. Cf. `KNOWN_ISSUES.md` « VASCO API ».
> - Nouvelle action interne `verifyConnection` (lançable en
>   `convex run --prod vasco:verifyConnection '{"orgSlug":"calte"}'`, sans
>   session auth) : remonte les positions par connexion pour valider un accès en
>   prod. `fetchParticipations` (publique, org-gardée) partage le même code.
> - Mutation `deleteConnection` (retirer une connexion, ex. ligne seedée par
>   erreur) + lecture par slug `getConnectionsByOrgSlug` ; parsing null-safe des
>   contrats. `pnpm lint` + `pnpm test:unit` au vert ; pas de resync
>   `_generated` (module `vasco` déjà enregistré).

## v1.76.0 — 14/07/2026 à 10:43 — One-liners des participations Albo + nouveau secteur « Consumer »

Chaque société opérationnelle du portefeuille Albo a désormais un **one-liner** :
une phrase courte qui dit en un coup d'œil ce qu'elle fait, affichée dans le
tableau des participations (par ex. « Marketplace de produits électroniques
reconditionnés » pour BackMarket, ou « Exosquelettes de marche et robots
humanoïdes » pour Wandercraft). Les SPV immobiliers et véhicules
d'investissement (Parallel Invest, Sezame Immo, fonds…) restent volontairement
sans one-liner — une accroche produit n'aurait pas de sens pour eux.

Côté **secteurs**, les quelques sociétés qui n'en avaient pas encore un sont
désormais classées (Wandercraft, AZmed, Genomines, Versant, Jeen, ACT Running,
Oprtrs & Co). Et un nouveau secteur **« Consumer / Marques »** fait son
apparition pour les marques qui vendent leur propre produit (Eclo Beauty,
Bleen, JOONE, ACT Running), là où « Marketplace » ne collait pas vraiment.

> **🔧 Notes techniques**
>
> - Nouveau slug `consumer` ajouté à `SECTOR_SLUGS` (`src/lib/sectors.ts`) +
>   libellés i18n `participations.sectors.consumer` (« Consumer / Marques » /
>   « Consumer / Brands »). Repris automatiquement par `SectorCombobox` et le
>   filtre secteur, sans autre changement.
> - Migration one-shot idempotente `convex/migrations/alboOneLinerImport.ts`
>   (`dryRun`/`apply`/`verify`, prod-only manuelle, calquée sur
>   `alboIdentityImport`) : `ENTRIES` n'écrit `oneLiner`/`sector` que si le
>   champ est vide (valeurs saisies à la main préservées), `SECTOR_OVERRIDES`
>   force `consumer` sur les 4 marques D2C. Sociétés ancrées par `_id` prod +
>   contrôle du nom exact avant tout patch.
> - One-liners FR (~3-7 mots) rédigés à partir des sites officiels, périmètre
>   startups opérationnelles uniquement.
> - Commentaire `oneLiner` dans `convex/schema.ts` mis à jour : la convention
>   « hand-filled, no backfill » est levée pour ce seed unique.

## v1.75.0 — 14/07/2026 à 10:30 — Prévisionnel de trésorerie par catégorie : la grille réalisé / engagé / prévu

Deuxième jalon de la refonte de la trésorerie : le prévisionnel devient
lisible et honnête.

**Une grille catégories × mois.** Sous la courbe, un tableau croise chaque
grande catégorie avec les mois passés et à venir : le passé montre le
réalisé (ce qui s'est vraiment passé), le futur montre ce qui est engagé et
ce qui est prévu, et la dernière ligne donne le solde projeté mois par
mois. Le mois en cours fusionne les deux mondes : le réalisé à date, plus
le « reste à venir ».

**Fini le double comptage.** Une échéance prévue qui s'est déjà réalisée ce
mois-ci ne compte plus deux fois : le réalisé consomme le prévu, catégorie
par catégorie. Et une échéance en retard (prévue le mois dernier, jamais
passée en banque) reste attendue — elle glisse sur le mois en cours au lieu
de disparaître en silence.

**Deux courbes de certitude.** La projection distingue désormais le
scénario « engagé » (les flux confirmés uniquement) du scénario « avec
prévu » (tout compris) — deux trajectoires superposées sur le graphique.

**Le reste à déployer, enfin visible.** Une carte affiche le capital engagé
sur les deals signés qui n'a pas encore été versé — deal par deal. Ce sont
des obligations réelles sans date : elles sont comptées à part, jamais
inventées dans la courbe.

**Les prévisions parlent la même langue que le réalisé.** Les règles
récurrentes et les échéances ponctuelles se rangent dans les mêmes grandes
catégories que les transactions (salaires, loyers, deals, comptes
courants…) via un sélecteur — plus de texte libre.

> **🔧 Notes techniques**
>
> - Moteur pur `convex/lib/recurrence.ts:buildForecastGrid` (testé par
>   `tests/forecastGrid.test.ts`) : axe mois historique→horizon,
>   consommation par cellule (direction × catégorie) sur le mois courant
>   (engagé d'abord, puis prévu avec le reliquat), rollover des échéances
>   en retard, projection cumulée en deux scénarios.
> - Query `forecasts.getForecastGrid` (périmètre = comptes EUR disponibles,
>   buckets réalisés via `effectiveCategory`) + `getCommittedPipeline`
>   (reste à déployer = `committedAmount` − Versé dérivé des transactions).
> - `ForecastOverview.tsx` remplace `ForecastChartCard` (courbe 2 séries
>   projetées via `ForecastChart` remanié, carte pipeline, grille) ;
>   sélecteurs de catégorie dans `RuleDialog`/`EntryDialog`
>   (`forecastCategories(direction)`, clear via `null` dans
>   `updateRule`/`updateEntry`).
> - `getForecastBalance` (outil agent/MCP) garde l'ancienne sémantique
>   fenêtrée — divergence documentée dans `KNOWN_ISSUES.md`.

## v1.74.1 — 14/07/2026 à 09:50 — Parallel (VASCO) : première brique de connexion

Vos participations, valorisations et reportings passés par **Parallel Invest**
ne vivent aujourd'hui que sur leur plateforme — rien n'arrive par e-mail. On a
commencé à les rapatrier dans Albo OS. Cette première étape pose la **connexion
sécurisée** : Albo OS sait désormais s'authentifier auprès de Parallel et lire
les données d'un véhicule, avec un accès distinct par véhicule et par entité
(Parallel–Calte aujourd'hui, Parallel–Albo et d'autres ensuite). Rien de
visible dans l'application pour l'instant — l'affichage des lignes, des
valorisations et des reportings arrive dans les étapes suivantes. La connexion
a été validée sur le vrai compte Calte (portefeuille réel : STOA Bordeaux,
NG Invest, obligations, etc.).

> **🔧 Notes techniques**
>
> - Nouvelle table interne `vascoConnections` (secrets au repos, une ligne par
>   couple client VASCO × org Albo OS, upsert sur `by_client_and_username`) et
>   module `convex/vasco.ts` : helpers `fetch` en runtime Convex par défaut pour
>   `POST /auth/login` → JWT et appels GraphQL authentifiés, registre de
>   connexions (`authorizeAndListConnections`, `markConnected`, `seedConnection`)
>   et action `fetchParticipations` (gardée par appartenance à l'org, lecture
>   seule — aucune écriture dans les tables portefeuille à ce stade).
> - Scoping investisseur : `api.<client>.vasco.fund` a l'introspection coupée et
>   le persona `ROLE_DISTRIBUTED_CUSTOMER` n'accède pas à `GetAccounts` /
>   `GetSecurities` / `GetParticipationsSummary`. Les positions se lisent via
>   `GetUser(id).accounts` → `GetAccount(id).accountSecurityContracts` (id user
>   extrait des claims du JWT). Détaillé dans `KNOWN_ISSUES.md` « VASCO API ».
> - `convex/_generated/api.d.ts` synchronisé à la main (ajout du module `vasco`)
>   car `convex codegen` exige un déploiement authentifié, indisponible dans
>   l'environnement distant ; `pnpm dev` le régénère à l'identique. `pnpm lint`
>   et `pnpm test:unit` au vert.

## v1.74.0 — 14/07/2026 à 10:05 — Trésorerie : solde disponible, grandes catégories et classement automatique

Premier jalon de la refonte de la trésorerie (socle du futur prévisionnel).

**Des soldes auxquels on peut se fier.** La page Trésorerie affiche
désormais le **solde disponible** — le cash réellement mobilisable — à côté
du solde total. Chaque compte peut être qualifié depuis sa fiche : fonds
nantis ou bloqués (comptés à part), compte clôturé à la banque (conservé
avec tout son historique, mais hors des soldes), et pour les comptes non
connectés à la banque, le solde se saisit à la main avec sa date, pour
toujours savoir de quand date le chiffre.

**Des grandes catégories, sans comptabilité analytique.** Les charges et
produits se classent en une douzaine de grandes familles (salaires,
honoraires, abonnements, loyers, frais bancaires, royalties & dividendes…)
directement depuis le registre des transactions. Les rattachements
existants comptent d'office : un deal, un compte courant, un impôt sont
déjà des catégories.

**Le classement apprend tout seul.** Classer une transaction une fois
suffit : l'outil mémorise une règle et classe automatiquement les
transactions similaires à leur arrivée de la banque. Un bouton « Appliquer
les règles » rattrape la file en attente d'un clic.

**Un nouvel onglet Analyse.** Entrées et sorties par catégorie et par mois
(3, 6 ou 12 mois), avec le net mensuel — pour voir enfin d'où vient et où
part l'argent, virements internes exclus.

> **🔧 Notes techniques**
>
> - `bankAccounts` : nouveaux champs `accountStatus` (active/closed) et
>   `pledged` ; prédicat partagé `convex/lib/bankAccounts.ts:isAvailableAccount`
>   appliqué au solde de départ du prévisionnel (`forecasts.ts`), au cash du
>   dashboard (`dashboard.ts`) et à l'outil agent ; mutations
>   `cash.updateAccountSettings` / `cash.updateAccountBalance` (refusée sur
>   un compte Powens), dialog d'édition sur `/cash/$accountId`.
> - `transactions.category` (slug, statuts charge/product uniquement, même
>   invariant que `vatRateBps` dans `convex/lib/pointage.ts`) ; listes de
>   catégories dupliquées `convex/lib/categories.ts` ↔ `src/lib/categories.ts`
>   (sync testée par `tests/categories.test.ts`).
> - Table `categoryRules` (upsert par org + pattern stable du libellé,
>   `deriveCategoryPattern`) : règles créées par les gestes unitaires de
>   pointage et `setCategory`, rejouées à l'insert (webhook Powens, import
>   Mémo CSV) et à la demande (`transactions.applyCategoryRules`) — jamais de
>   ligne `matchingDecisions` (décision machine). Cf. `KNOWN_ISSUES.md`
>   « Catégories & règles apprenantes ».
> - Query `transactions.getCategoryBreakdown` (buckets dérivés via
>   `effectiveCategory`) + composant `CategoryBreakdown` (onglet Analyse,
>   `?tab=analyse`).

## v1.73.2 — 13/07/2026 à 22:47 — Un peu d'air entre le nom d'une fiche et son badge

Sur la fiche d'une entreprise et sur la fiche d'un deal, le badge affiché
juste à droite du nom (« Entreprise », statut du deal) était collé un peu
trop près du titre. On a ajouté un léger espace pour qu'il respire, de la
même manière sur les deux pages.

> **🔧 Notes techniques**
>
> - Ajout d'un `ms-1.5` sur le badge d'en-tête : cette marge inline-start
>   (~6 px) s'ajoute au `gap-3` du header et porte l'écart nom↔badge de ~12
>   à ~18 px, sans toucher aux autres écarts (logo↔nom, badge↔actions) ni
>   aux vues liste (où le badge de statut vit dans sa propre colonne).
> - `EntityNatureBadge` (`src/components/companies/EntityFiche.tsx`) accepte
>   désormais un `className` optionnel, passé depuis le header de
>   `participations.$companyId.tsx` — la marge vit côté header, pas dans le
>   composant partagé.
> - Même `ms-1.5` sur le badge de statut du header de `deals.$dealId.tsx` :
>   les deux seuls en-têtes où un badge est directement collé au nom, gardés
>   cohérents.

## v1.73.1 — 13/07/2026 à 22:24 — Correctif : défilement de la fenêtre « Modifier » d'une société

La fenêtre « Modifier » d'une participation ou d'une entité pouvait devenir
trop haute pour l'écran lorsqu'une société comptait beaucoup de personnes
(fondateurs, co-investisseurs…) : le bas du formulaire et le bouton
« Enregistrer » se retrouvaient hors de portée, sans possibilité de faire
défiler. La fenêtre défile désormais dès que son contenu dépasse la hauteur
de l'écran, comme les autres grandes fenêtres de l'application.

> **🔧 Notes techniques**
>
> - `EditCompanyDialog` (`participations.$companyId.tsx`) : ajout de
>   `max-h-[85vh] overflow-y-auto` sur le `DialogContent`, alignant le dialog
>   sur le pattern déjà en place ailleurs (`deals.$dealId.tsx`,
>   `RoyaltiesPanel.tsx`, `CompanyReportsSection.tsx`).
> - Ce même dialog édite aussi bien les participations `portfolio` que les
>   entités `group_*` (même route, même composant) : les deux cas signalés
>   sont donc couverts par un seul correctif.

## v1.73.0 — 13/07/2026 à 21:35 — Import de l'identité des participations Albo (Drive + Attio)

Les fiches des participations Albo se remplissent : SIREN, raison sociale,
secteur, nombre total d'actions (qui fait apparaître la détention globale),
et les trois listes Fondateurs / Membres du board / Co-investisseurs,
extraits des documents juridiques du Drive et vérifiés ligne à ligne.
Chaque personne retrouvée dans Attio devient cliquable : son nom ouvre
directement sa fiche Attio. Les fonds et les personnes absentes d'Attio
restent affichés en texte simple. Une valeur déjà saisie à la main n'est
jamais écrasée, et l'import ne s'exécute qu'après validation d'un rapport
de contrôle.

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/alboIdentityImport.ts`
>   (`dryRun` / `apply` / `verify`) : 45 sociétés de l'org `albo`, ancrées
>   par `_id` prod + garde sur le nom exact. Champs scalaires écrits
>   seulement si `undefined` ; `people` posé seulement si la fiche n'en a
>   aucun ; unicité SIREN re-vérifiée via l'index `by_org_siren` (conflit
>   → rapporté, pas écrit).
> - Données extraites des docs du dossier Drive « ⚠️ Investissements »
>   (8 agents parallèles, chaque valeur avec doc source + citation) ; les
>   44 SIREN passent la clé de Luhn. 158 personnes physiques résolues
>   contre l'objet `people` d'Attio (98 liées via `attioRecordId`, dont 16
>   « probables » signalées dans la table de revue partagée avec Benjamin).
> - Exclusions volontaires : `totalShares` non importé pour les positions
>   détenues via SPV (le % de détention serait faux) ou quand le chiffre
>   documenté est périmé (Waro, Bleen) ; rien d'importé pour « LVDQ Bdv
>   Voltaire » (aucun doc juridique n'existe encore). Runbook en tête du
>   module ; exécution prod manuelle (snapshot → dryRun → apply → verify).

---

---

## v1.72.0 — 13/07/2026 à 20:50 — Reports par email : récaps et file d'attente (brique 6)

Sixième et dernière brique du circuit des reports par email — la boucle est
fermée. Chaque report transféré reçoit désormais un récapitulatif **en
réponse dans le fil même du transfert** : participation(s) rattachée(s) avec
lien vers la fiche, période, sources traitées, métriques enregistrées, et
trois signaux de contrôle — métriques non reconnues, valeurs inhabituelles
par rapport au report précédent (erreur d'unité probable), et métriques
habituellement présentes mais absentes. En cas d'échec, la réponse indique
la raison et renvoie vers la file. Un email d'un expéditeur inconnu ou du
spam déclenche un message séparé aux membres — jamais de réponse à
l'inconnu. Sur la page « Reports entrants », trois actions ferment la
boucle : **Rattacher** (choisir la participation, le traitement reprend tout
seul), **Retraiter** (rejouer de zéro, par exemple après avoir complété une
fiche), **Rejeter**.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportNotify.ts` : `send` (success/failure/quarantine), idempotent via claim `notifiedAt` ; routing anti-énumération re-vérifié **au moment de l'envoi** (`isMemberEmail`) — membre → `replyToMessage` in-thread, sinon mail neuf aux membres (`sendMessage`, destinataires = tous les `organizationMembers`). Wrappers reply/send ré-ajoutés à `convex/agentmail.ts`.
> - Gabarits français dans `convex/emailTemplates.ts` (§ recaps, HTML compact) : formatage cents/bps → €/%, libellés de méthode de match, détails de sources actionnables, raisons de review.
> - Récap succès construit dans `reportStore.run` avec la mémoire PRE-stockage : non-reconnues (échec `toCanonical`), inhabituelles (ratio ≥ 8 vs dernière valeur connue, même unité), habituelles absentes. Hooks échec : `reportIdentify.setReview`, `no_content` (extraction), quarantaine à l'ingestion.
> - Actions publiques `reportInbox` : `assignCompany` (garde `requireOrgMember` sur l'org de la cible, fan-out même domaine/nom cross-org, reprise `reportExtract`/`reportStore` selon l'état, `matchMethod: 'manual'`), `reprocess` (reset complet + re-auth du From), `reject` (`manual_reject`) + query `listAssignTargets`. Helpers factorisés `memberUserIdFor`/`requireAnyMember`.
> - Page `/app/all/reports` : colonne Actions (Rattacher via Dialog+Select, Retraiter, Rejeter), toasts sonner, i18n fr/en. `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.71.0 — 13/07/2026 à 20:20 — Reports par email : fiche, métriques et rangement (brique 5)

Cinquième brique du circuit des reports par email — celle qui transforme le
contenu extrait en données exploitables. Chaque report traité produit
désormais une fiche complète (titre, période, résumé, points clés) rangée
sur la fiche de **chaque** entité concernée, dans les deux organisations si
besoin, avec ses pièces jointes dans l'onglet Documents. Les métriques sont
extraites avec un garde-fou anti-dérive : un **catalogue fermé** de
métriques officielles (CA, EBITDA, trésorerie, effectif…), la mémoire des
métriques déjà connues de chaque boîte pour rester cohérent d'un mois à
l'autre, et les conversions d'unités (« 1,2 M€ », « 15 % ») faites par du
code vérifié — jamais par l'IA. Une métrique inconnue du catalogue est
conservée sur le report mais n'entre jamais dans les séries temporelles.
Renvoyer un report déjà importé met à jour la fiche existante au lieu de
créer un doublon, et la synthèse IA de la participation se relance
automatiquement à chaque nouveau report.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportStore.ts`, chaîné depuis `reportExtract.setExtraction` (verrou `markStoring`). Un appel LLM (pattern `generateObject`/fallback) produit fiche + métriques **telles qu'écrites** (valeur + unité vue : EUR/kEUR/MEUR/percent/count/months) ; devise étrangère et budget/forecast → jamais sur une clé canonique.
> - `lib/metricCatalog.ts` : catalogue fermé (~35 clés typées eur/percent/count/months), `toCanonical` = conversion déterministe (cents, bps), rejet des clés hallucinées et unités incompatibles → snapshot brut seulement. `lib/reportPeriod.ts` : parsing déterministe des périodes (mois/trimestre/semestre/année/plage). **13 tests unitaires** ajoutés (135 au total).
> - Rangement démultiplié : `storeForCompany` par entité matchée — `companyReports` (dédup index `by_company_period`, renvoi = patch ; nouveau champ `rawMetrics` pour le snapshot audit), `documents` par entité (blob storage partagé, jamais supprimé au re-import), `kpiSnapshots` idempotents (clé company+metricType+periodStart+`source: report:<id>`), `companyIntelligence.latestReportId` + `intelligence.runAnalysis` re-déclenchée.
> - Mémoire anti-dérive : `knownMetrics` (dernière valeur par metricType via `by_company_metric`) injectée dans le prompt. Échec d'analyse → `needs_review`/`analyze_error`. Statut final `processed` + `reportIds` sur le courrier entrant.
> - `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.70.0 — 13/07/2026 à 19:25 — Reports par email : extraction du contenu (brique 4)

Quatrième brique du circuit des reports par email. Une fois le report
rattaché à sa participation, tout son contenu est extrait automatiquement :
le corps du mail, les PDF (lecture OCR), les captures d'écran de tableaux
collées dans le message (les logos et signatures sont ignorés), les Excel et
CSV, les pages Notion publiques, les fichiers Google Drive partagés par lien,
les documents DocSend, et même les liens cachés derrière des redirections de
tracking. Chaque élément finit dans exactement un de trois états — extrait,
stocké tel quel, ou échec signalé avec sa raison — visibles dans la nouvelle
colonne « Contenu » (✅/📦/⚠️) : un format inconnu ne produit jamais d'erreur
imprévue, et une source qui échoue n'empêche jamais de traiter le reste. Les
pièces jointes sont conservées. Si aucun contenu exploitable n'est trouvé
nulle part, l'email part en « À traiter / Aucun contenu exploitable ».

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportExtract.ts` (routeur monde fermé), chaîné depuis `reportIdentify.setMatch` ; verrou `markExtracting` (matché + pas encore de `sources`). Résultats sur `inboundEmails` : `sources[]` (kind/label/state/detail/chars), `extractedText` (agrégé, cap 150k chars), `attachments[].storageId` (fichiers dans le storage Convex, cap 20 Mo → `file_too_large` au-delà, non stocké).
> - Helpers : `lib/ocr.ts` (Mistral OCR PDF+images — le modèle chat OpenRouter ne lit pas les PDF, décision assumée d'un seul chemin OCR ; jamais de throw, `''` en échec), `lib/excel.ts` (dump cellules borné via `xlsx`, pas de pré-digestion — leçon « llmPrompt vide mais truthy »), `lib/notion.ts` (loadPageChunk non officiel, échec = cas nominal), `lib/reportLinks.ts` (détection Notion/GDrive/DocSend + résolution des liens de tracking seulement si aucun lien direct).
> - `downloadAttachment` ré-ajouté au wrapper AgentMail (raw / presigned URL / base64 gérés). Petites images (<15 Ko) = logos → stockées sans OCR. GDrive : exports publics (Sheets→xlsx, Docs/Slides→pdf), page HTML de login détectée = non partagé. DocSend via docsend2pdf.com (choix validé, confidentialité assumée).
> - Dépendance ajoutée : `xlsx`. Env requis : `MISTRAL_API_KEY` (déjà documenté dans `.env.example`). `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.69.0 — 13/07/2026 à 20:14 — Import des instruments du portefeuille Albo

Les fiches des 51 participations Albo se remplissent d'un coup : les
caractéristiques de chaque instrument (taux et échéances des obligations,
paramètres des contrats de royalties, valorisations et pourcentages de
détention des tours, caps et décotes des convertibles, véhicules SPV,
conditions de carried des SPV menés en lead) ont été extraites des documents
juridiques du Drive, vérifiées ligne à ligne, puis importées en masse — sans
toucher aux montants, statuts et dates déjà saisis. Chaque valeur importée est
traçable vers son document source. Au passage, la périodicité de coupon
« Semestriel » fait son entrée dans les fiches obligataires, et la
participation Keenest est requalifiée en BSA Air (c'était un investissement
direct, pas un véhicule SPV).

> **🔧 Notes techniques**
>
> - Nouvelle migration one-shot `convex/migrations/alboInstrumentImport.ts`
>   (`dryRun`/`apply`/`verify`, modèle `splitAlboSponsorSpvs`) : ~46 deals
>   patchés par `_id` prod avec garde org + nom de la cible, écriture
>   uniquement des champs `undefined` (sauf requalification Keenest
>   `instrumentKind`→`bsa_air`, idempotente par valeur). Données en dur dans
>   le module, converties aux conventions du schéma (cents, bps, ms epoch,
>   multiples décimaux).
> - `'semestriel'` ajouté à `COUPON_PERIODICITIES`
>   (`convex/lib/instruments.ts`) + labels `enum.couponPeriodicity` dans
>   `src/locales/{fr,en}/participations.json` — schéma, mutations et UI
>   suivent automatiquement.
> - Extraction amont : 8 agents parallèles sur le Drive (dossier
>   « ⚠️ Investissements »), ~240 valeurs sourcées (doc + citation +
>   confiance) ; les estimations fragiles (% SPV sur émission max, valos de
>   tours absentes des docs) ne sont volontairement PAS importées. Runbook
>   prod dans le doc-comment du module + ligne dans `MIGRATIONS.md`.

## v1.68.0 — 13/07/2026 à 18:55 — Reports par email : rattachement automatique à la participation (brique 3)

Troisième brique du circuit des reports par email. Chaque email transféré est
désormais rattaché automatiquement à la bonne participation : l'assistant lit
le message (y compris le bloc de transfert pour retrouver l'auteur d'origine),
le compare au portefeuille des deux organisations, et sa proposition n'est
acceptée que si elle est confirmée par un signal vérifiable (le domaine email
de l'auteur ou le nom de la boîte présent dans le message) — jamais sur sa
seule intuition. Si la boîte existe dans les deux organisations ou via
plusieurs entités, le rattachement s'applique à toutes. Le cas « un fonds
transmet le report d'une de ses participations » est reconnu et rattaché à la
bonne cible. En cas de doute (introuvable, plusieurs candidates possibles),
l'email part en file « À traiter » avec la raison affichée, et la page
« Reports entrants » montre désormais la participation rattachée.

> **🔧 Notes techniques**
>
> - Nouveau module `convex/reportIdentify.ts` : `run` (internalAction) chaîné après l'auth de la brique 2 (directement, ou après hydratation du corps via `thenIdentify`). Verrou `markProcessing` (statut `received` + `senderUserId` + pas déjà matché) contre les doubles exécutions.
> - Appel LLM au pattern projet (`generateObject` Zod sur `getModel()` OpenRouter, fallback `generateText` + parse JSON) : candidates = toutes les `companies` kind `portfolio` non archivées des 2 orgs (id, nom, domaine, org) ; sortie = auteur réel, ids candidats, cas fonds→participation, confiance. Garde anti-injection dans le system prompt (le contenu du mail est une donnée).
> - **Corroboration déterministe obligatoire** : domaine de l'auteur réel = `companies.domain` (freemails et domaines internes exclus), ou nom en mot entier dans objet+corps (emails/URLs strippés — leçon Albo App). Pick non corroboré = pas de match. Cas fonds : corroboration par nom uniquement.
> - **Démultiplication** : expansion du match à toutes les entités de même domaine ou même nom (cross-org) → `inboundEmails.matchedCompanies` (+ `realSenderEmail`, `matchMethod`). Ambiguïté = clés d'identité distinctes parmi les picks corroborés → `needs_review`/`ambiguous` ; sinon `no_match` / `identify_error`.
> - Page `/app/all/reports` : colonne Participation (noms résolus dans `reportInbox.list`) ; nouvelles raisons i18n fr/en. `convex/_generated/api.d.ts` re-synchronisé à la main (codegen indisponible dans l'environnement).

## v1.67.0 — 13/07/2026 à 18:00 — Reports par email : contrôle de l'expéditeur (brique 2)

Deuxième brique du circuit des reports par email. Chaque email reçu est
désormais authentifié dès son arrivée : seuls les emails transférés par un
membre de l'équipe sont acceptés pour traitement. Un email venant d'une
adresse inconnue, ou marqué comme spam, part en quarantaine — visible sur la
page « Reports entrants » avec le badge « À traiter » et sa raison
(« Expéditeur inconnu » ou « Spam ») — et ne reçoit jamais aucune réponse
automatique : impossible pour un tiers de deviner que l'adresse existe.

> **🔧 Notes techniques**
>
> - Auth expéditeur inline dans `reportInbox.ingest` (même transaction que l'insert) : `From` doit matcher un `users` (index `by_email`) membre d'au moins une org (`organizationMembers.by_user`) → `senderUserId` posé ; sinon statut `needs_review` + `statusReason: 'unknown_sender'`. Échec de casse = fail-safe vers la quarantaine.
> - Label AgentMail `spam` (détection native) capturé dans `normalizeMessage` (nouveau champ `labels`) → quarantaine `statusReason: 'spam'` avant même le check expéditeur.
> - Nouveau champ `inboundEmails.senderUserId` (optional) ; `reportInbox.list` expose `senderVerified` ; la page `/app/all/reports` affiche la raison à côté du badge (i18n `reports:reasons.*` fr/en).
> - Log d'observabilité des clés du payload webhook (préparation du contrôle SPF/DKIM : on décidera sur la forme réelle des messages, cf. design).
> - Aucun email sortant dans toute la brique (anti-énumération) — les notifications arrivent en brique 6.

## v1.66.0 — 13/07/2026 à 17:40 — Réception des reports par email (brique 1)

Première brique du nouveau circuit de traitement des reports envoyés par
email. Chaque email transféré vers la boîte reports dédiée est désormais
enregistré dans Albo OS dès sa réception — avant tout traitement — et visible
sur une nouvelle page « Reports entrants » (vue toutes organisations) : date
de réception, expéditeur, objet, nombre de pièces jointes et statut. Un même
email reçu deux fois n'apparaît qu'une seule fois. Les étapes suivantes
(vérification de l'expéditeur, rattachement à la participation, extraction du
contenu et des métriques, récap) arriveront brique par brique ; l'ancienne
version expérimentale de ce circuit a été retirée.

> **🔧 Notes techniques**
>
> - Nouvelle table `inboundEmails` (store-first) : chaque webhook AgentMail `message.received` est inséré avec le statut `received` avant tout traitement ; dédup par `agentmailMessageId` (index `by_message_id`) dans `reportInbox.ingest` ; snapshots de corps tronqués à 100k chars (cap document 1 Mo), hydratation asynchrone via `body_url`/API quand le webhook arrive sans corps.
> - `convex/agentmail.ts` réécrit : wrapper REST minimal (normalize, fetchBody, getMessage), vérif Svix inchangée, garde anti-boucle (message émis par l'inbox → ignoré), le webhook ne fait plus aucune logique métier.
> - Pipeline legacy supprimé : `convex/reportPipeline.ts`, `convex/reportAnalysis.ts`, `convex/lib/reportMatching.ts`, `convex/lib/reportLinks.ts`, `convex/lib/ocr.ts` + test orphelin. Les tables `companyReports`/`documents`/`companyIntelligence` et leurs queries de lecture restent.
> - Nouvelle page `/app/all/reports` (`src/routes/app/all/reports.tsx`) branchée sur `reportInbox.list` (accès : membre d'au moins une org, même frontière que la vue agrégée) ; entrée nav « Reports entrants », namespace i18n `reports` (fr+en).
> - `convex/_generated/api.d.ts` synchronisé à la main (codegen indisponible dans l'environnement d'exécution — pas d'auth Convex) : à régénérer au prochain `convex dev` local.

## v1.65.3 — 13/07/2026 à 12:31 — Mise à jour des fiches Better Auth de l'assistant

Changement interne, sans effet visible dans l'app : les fiches de référence
Better Auth utilisées par l'assistant IA ont été resynchronisées avec leur
version à jour en amont, et une fiche qui ne se chargeait plus a été réparée.

> **🔧 Notes techniques**
>
> - Bump des 6 skills `better-auth/skills` au commit upstream `17dfe3a` dans `skills-lock.json`. Contenu mis à jour pour `better-auth-best-practices`, `create-auth`, `organization-best-practices`, `two-factor-authentication-best-practices` ; inchangé pour `email-and-password-best-practices` et `better-auth-security-best-practices`.
> - Échec `skills-drift` réparé : l'upstream a renommé `security/SKILL.MD` → `security/SKILL.md` (casse du nom de fichier, `raw.githubusercontent` est sensible à la casse) ; `skillPath` corrigé dans le lock, contenu identique.
> - Skill `create-auth-skill` renommé `create-auth` pour suivre le `name` amont : dossier `.agents/skills/`, symlink `.claude/skills/`, clé de lock et ligne du tableau `CLAUDE.md`.
> - Diffs upstream relus un par un (aucune prompt-injection) ; re-vendorisation via `raw` (SHA résolu par `git ls-remote`, sans `--update` car `api.github.com` est bloqué dans le sandbox).

## v1.65.2 — 13/07/2026 à 11:56 — Cadre de travail de l'assistant IA

Changement interne, sans effet visible dans l'app : l'assistant IA suit
désormais un cadre explicite avant chaque tâche de code — comprendre la
demande, proposer un plan et le faire valider avant d'écrire, puis rester au
plus près de ce qui est demandé sans y ajouter de « petit plus » non demandé.

> **🔧 Notes techniques**
>
> - Section « Règles de travail » ajoutée en fin de `CLAUDE.md` (append-only, aucun contenu existant modifié).
> - Nouveau skill `.claude/skills/golden-rules/SKILL.md` (`/golden-rules`) : reformulation de l'intention → plan-first → 5 règles d'exécution → étape de vérification.
> - Fichier réel sous `.claude/skills/` (délibérément pas sous `.agents/skills/`, que `pnpm run sync:skills` écrase depuis l'upstream).

## v1.65.1 — 09/07/2026 à 14:31 — Fiche deal Royalties : saisie du CA réel réparée

Sur un deal **Royalties**, cliquer sur une case **CA réel** (ou CA du BP
initial) du tableau trimestriel pour saisir un montant faisait quitter la
fiche et afficher **« Deal introuvable »**, sans jamais laisser rien
renseigner. La case s'ouvre désormais **en édition directe**, on tape le
montant et il s'enregistre **sans changer de page**.

> **🔧 Notes techniques**
>
> - Bug de _rules of hooks_ : `EditableCa` (`RoyaltiesPanel.tsx`) appelait
>   `useAmountField` **dans** la branche `if (editing)`. Le passage en édition
>   ajoutait un hook absent du render précédent → `Rendered more hooks than
>   during the previous render`. Le hook est remonté au **top-level** du
>   composant, ses props n'étant _spreadées_ sur l'input que quand la cellule
>   est ouverte (même pattern que `DealFieldInput`).
> - Pourquoi « Deal introuvable » : la route `deals.$dealId.tsx` déclare **le
>   même** composant `NotFound` en `errorComponent` **et** `notFoundComponent`,
>   donc tout crash de render dans la fiche s'affiche comme un deal absent. Ni
>   donnée ni schéma touchés.
> - Filet manquant relevé : `eslint-plugin-react-hooks` n'est pas dans la
>   config lint (`@tanstack/eslint-config` ne l'embarque pas), d'où le passage
>   en prod sans alerte. Piège de debug + recommandation documentés dans
>   `KNOWN_ISSUES.md` (section panneau Royalties).

---

## v1.65.0 — 03/07/2026 à 00:05 — Vue Deals : nouvelles colonnes, colonne figée et deals soldés à part

La liste transversale des **deals** (par organisation et vue agrégée) adopte
les mêmes repères que la vue Entreprises. L'ordre de lecture devient :
**Société · Secteur · Instrument · Stage · Investi le · Montant investi ·
Reçu · TVPI**. Les colonnes Investisseur et Engagé disparaissent pour alléger
le tableau ; le **Stage** reprend le tour de table du deal (Seed, Série A…)
quand il est renseigné, « — » sinon.

Quand le tableau déborde en largeur, la **colonne Société reste figée** à
gauche pendant le défilement horizontal — le nom de la boîte reste toujours
sous les yeux. Et comme pour les entreprises, les **deals soldés** (sortie
totale ou perte) passent dans une **section dédiée en bas de page**, où la
colonne **Statut** réapparaît pour distinguer les sorties des dépréciations.
Une seule barre de recherche et de filtres pilote les deux tables ; l'export
CSV reste inchangé et couvre l'ensemble des deals.

> **🔧 Notes techniques**
>
> - `DealsListView.tsx` refondu : d'une table plate unique à un orchestrateur
>   (recherche + facettes + split actives/soldées) rendant deux `DealsTable` —
>   le bas porte le flag `settled` (colonne Statut réaffichée, tri désactivé),
>   sur le modèle `ParticipationsView`/`ParticipationsTable`.
> - Colonnes : Secteur (`col.sector`), Stage (nouveau `col.stage`, lit le champ
>   **existant** `roundType` via `enum.roundType.*` — aucun ajout au schéma, pas
>   de backfill), Investi le (nouveau `col.investedOn`, affiche `signedDate`),
>   Montant investi (`col.invested`, donnée `paidActual`). Retrait des colonnes
>   Investisseur / Engagé / Statut de la table active (facette Statut conservée).
> - `roundType` remonte déjà via le `...deal` de `enrich` (`deals.list` +
>   `aggregate.listDeals`, pas de validateur `returns`) ; surfacé côté client par
>   un type local `DealListRow = DealRow & { roundType? }` — le `DealRow` partagé
>   et `ParticipationsTable.tsx` ne sont pas touchés.
> - Colonne figée : `stickyHeadClass`/`stickyCellClass` dupliqués localement
>   (fond opaque + hover `color-mix` piloté par `group-hover`, cf.
>   `KNOWN_ISSUES.md` « Colonne figée »). Split : `fully_exited`/`written_off`
>   en bas, le reste (dont `partially_exited`) reste actif. Routes
>   `deals.index.tsx` / `all/deals.tsx` inchangées (prop compatible).
> - i18n EN + FR : `col.stage`, `col.investedOn` (participations),
>   `settled.sectionTitle` (deals). TESTING.md : DL1/DL3/DL4 mis à jour,
>   nouvelles lignes DL6 (colonne figée) + DL7 (split soldés).

---

## v1.64.0 — 02/07/2026 à 23:31 — Vue Entreprises : nouvelles colonnes et colonne figée

La liste des **entreprises** (par organisation et vue agrégée) gagne trois
colonnes : le **one-liner** (le pitch de la boîte en une ligne, à remplir à la
main sur chaque société), le **secteur**, et le **score IA** — la note sur 10
issue de la synthèse automatique des reports investisseurs, avec le même code
couleur que la fiche société (vert ≥ 7, orange 5-6, rouge ≤ 4). Une société
sans synthèse affiche simplement « — » ; le score apparaîtra au fil des
reports reçus.

L'ordre de lecture devient : société · one-liner · secteur · score IA ·
deals · **montant investi** (le décaissé réel) · reçu · TVPI. Et quand la
table déborde en largeur, la **colonne société reste figée** à gauche pendant
le défilement horizontal — on garde toujours le nom sous les yeux. La section
des participations soldées (avec son badge de sortie) est inchangée.

> **🔧 Notes techniques**
>
> - Schéma : nouveau champ `companies.oneLiner` (`v.optional(v.string())`),
>   sans backfill ni UI de saisie (remplissage manuel).
> - `convex/deals.ts` : `companyRef` expose `oneLiner` ; nouveaux helpers
>   exportés `aiHealthScore` (lecture défensive de
>   `aiAnalysis?.health_score?.score`, null si non numérique) et
>   `aiScoresByCompany` (une lecture indexée `companyIntelligence.by_org` →
>   map companyId → score, pas de N+1). `deals.list` attache `target.aiScore` ;
>   `convex/aggregate.ts` fait la même jointure batchée par org.
> - `ParticipationsTable.tsx` : colonnes One-liner (tronquée, tooltip),
>   Secteur (libellé i18n `sectors.*`), Score IA (carré teinté via
>   `scoreVerdict`/`verdictSquareClass` de `src/lib/reportScore.ts`) ; en-tête
>   « Versé » remplacé par la clé `col.invested` (« Montant investi », même
>   donnée `paid`). Première colonne figée : `sticky left-0` + fond **opaque**
>   `bg-background` (sinon les cellules transparaissent en glissant dessous) ;
>   le hover de ligne étant translucide (`bg-muted/50`), la cellule figée
>   composite la même teinte via `color-mix` piloté par `group-hover` (classe
>   `group` posée sur toutes les lignes). `ui/table.tsx` intact (le
>   passthrough `className` suffisait).
> - i18n EN + FR : `col.oneLiner`, `col.sector`, `col.aiScore`,
>   `col.invested`. TESTING.md : nouvelle ligne SH19.

---

## v1.63.0 — 02/07/2026 à 19:09 — Édition au clic des fiches deal & société

Fini le détour par le menu « … » pour corriger une valeur. Sur la fiche d'un
**deal**, les champs du bloc **« Détails de l'instrument »** (montants, taux,
dates, listes) s'éditent maintenant **directement au clic** : on clique sur la
valeur, on la modifie, **Entrée** (ou un clic ailleurs) enregistre, **Échap**
annule. Même geste sur la fiche d'une **société**, pour le bloc **« Identité »** :
**secteur**, **SIREN** et **domaine** se corrigent d'un clic.

Les valeurs **calculées** ne bougent pas — détention, nombre d'actions, décaissé
réel et lien Attio restent en lecture seule — et un champ ajusté à la main est
**protégé** : un ré-import de données ne l'écrase plus. Le menu « … » reste là
pour ce qu'il fait seul (renommer, changer le type d'instrument, réaffecter le
deal, gérer les personnes). Enfin, tant qu'on **prévisualise** un autre type
d'instrument, l'édition au clic est mise en pause pour éviter toute confusion.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `src/components/ui/inline-field.tsx` (`InlineField`) :
>   généralise l'interaction clic → saisie → Entrée/blur commit / Échap cancel de
>   `EditableCa` (`RoyaltiesPanel`) à une grille de champs multi-formats. L'éditeur
>   est piloté par le `FieldFormat` (€ / % / date / nombre / décimal / année /
>   texte, `Select` pour les enums) ; `renderEditor` sert d'échappatoire pour le
>   combobox créable du secteur.
> - Parsing/sérialisation factorisés dans `src/lib/parse.ts` (`parseField`,
>   `rawToInput`, type `FieldFormat`) — source unique partagée avec le dialog
>   d'édition ; `deals.$dealId.tsx` s'y branche (suppression du `parseField`
>   local dupliqué, `fieldToInput` délègue à `rawToInput`).
> - Deal : `InstrumentBlock` / `FieldsView` reçoivent `editable` (= `!unsaved`,
>   coupé en aperçu de type) et écrivent via un patch à un seul champ sur
>   `deals.update` (qui marque `manuallyEditedFields`). Société : bloc Identité
>   câblé sur `companies.update` (secteur / SIREN / domaine) ; `SectorCombobox`
>   gagne `defaultOpen` + `onOpenChange` pour s'ouvrir puis se refermer en inline.
> - Les colonnes deal ne se vident pas via la mutation → un champ vidé est un
>   no-op ; côté société, SIREN / domaine vidés partent en `''` (efface). Nouvelle
>   clé i18n `participations:edit.inlineLabel` (EN + FR).

---

## v1.62.0 — 02/07/2026 à 15:17 — Fiche entreprise : synthèse IA en pleine largeur

Sur la page d'une société, la **synthèse IA** quitte les onglets pour devenir
un **bloc pleine largeur**, placé juste sous le bloc des deals et au-dessus des
onglets. Son contenu ne change pas : le score coloré selon le verdict, la phrase
de synthèse, les points forts et de vigilance, les trois indicateurs clés et
l'alerte critique (uniquement si elle existe). Tant qu'aucune synthèse n'a été
générée, une simple ligne discrète prend sa place.

Les onglets en dessous sont simplifiés et réordonnés : **Reports** (l'historique
des reports) d'abord, puis **Documents**. L'ancien onglet « Synthèse IA » est
supprimé — son contenu vit désormais dans le bloc au-dessus. Le bouton
« Ajouter un report » (désactivé) disparaît lui aussi.

> **🔧 Notes techniques**
>
> - Nouveau composant `CompanyAiSynthesisBlock.tsx`, extrait tel quel de
>   l'ex-zone 1 (héros `SynthesisHero`) de `CompanyReportsSection.tsx` : même
>   query `intelligence.getByCompany`, même rendu. Monté dans la route
>   `participations.$companyId.tsx` en pleine largeur entre le bloc Deals et le
>   `<Tabs>`, gardé par `company`.
> - `CompanyReportsSection.tsx` ne rend plus que l'historique (ex-zone 2) ;
>   en-tête « Historique des reports » conservé, bouton « Ajouter un report »
>   désactivé retiré (+ imports orphelins `Plus`, `Tooltip*`, `cn`,
>   `reportScore`, `moneyTone`).
> - `<Tabs>` réordonné (`defaultValue="reports"`, Reports puis Documents) ;
>   onglet `intelligence` + composant `CompanyIntelligenceCard.tsx` supprimés.
>   Query `intelligence.getByCompany` **conservée** (utilisée par le bloc).
> - État vide standalone = une ligne sobre (plus d'encart en pointillés).
> - i18n EN+FR : retrait de `tabs.intelligence`, `reports.history.add/addHint`,
>   `intelligence.title/updated/section.insights/section.alerts` ; clés
>   partagées avec le bloc (`intelligence.status.*`, `section.good/bad`)
>   conservées.

---

## v1.61.1 — 02/07/2026 à 15:16 — Suivi des remontées vers le template

Changement interne, sans effet visible dans l'app : on met en place un suivi
des améliorations « cœur » d'Albo OS qui pourraient être reversées dans le
template de départ (le starter SaaS dont Albo OS est dérivé), pour ne plus les
perdre au fil des développements.

> **🔧 Notes techniques**
>
> - Nouveau `TEMPLATE_SYNC.md` : backlog des candidats à remonter vers
>   `albo-ouvre-boite` (sens inverse de `UPGRADING.md`), avec l'heuristique
>   ✅/❌ (générique vs métier) et un tableau de suivi par candidat.
> - `CLAUDE.md` § « Pre-PR doc audit » : ajout de la question 6 — à chaque PR,
>   flaguer le code réutilisable (infra, auth, `convex/lib/`,
>   `src/components/ui/*`, DX/CI) dans `TEMPLATE_SYNC.md` + une section
>   « Template sync » dans la description de la PR.
> - L'agent se contente de flaguer ; Benjamin/Clément portent le code dans le
>   template. Pointeur croisé ajouté en tête de `UPGRADING.md`.

## v1.61.0 — 02/07/2026 à 13:41 — Fiche entreprise : onglet Reports repensé

L'onglet **Reports** d'une société a été réorganisé en deux zones plus
lisibles.

En tête, une **synthèse IA** met en avant le dernier report reçu : un score
sur 10 dans un carré coloré selon le verdict (vert « en bonne voie », ambre
« à surveiller », rouge « à risque »), une phrase de synthèse, les points
forts et les points de vigilance côte à côte, trois indicateurs clés, et —
seulement s'il y en a une — une alerte critique intégrée et dépliable.

En dessous, l'**historique des reports** se présente comme une pile de cartes
cliquables, de la plus récente à la plus ancienne. Chaque carte affiche la
période, un résumé en une ligne, sa date de réception et son ancienneté
(« il y a 13 j »), un badge « à jour » sur le dernier report, et un raccourci
« Voir les docs » vers les documents source. Un clic ouvre le détail complet
du report.

> **🔧 Notes techniques**
>
> - `CompanyReportsSection.tsx` refondu en deux zones : héros `SynthesisHero`
>   (query `intelligence.getByCompany`, même payload Cerveau 3 que
>   `CompanyIntelligenceCard`, présentation différente) + `ReportHistory`
>   (cartes issues de `companyReports.listByCompany`, dialog détail conservé).
> - Helper couleur centralisé `src/lib/reportScore.ts` : `scoreVerdict`
>   (seuils ≥7 / 5-6 / ≤4) → carrés teintés sur les tokens
>   `positive` / `warning` / `destructive`. Nouveau token sémantique
>   `--warning` (+ `--warning-foreground`), light+dark, dans `brand.css` —
>   seul changement hors onglet.
> - `documents.listByCompany` renvoie désormais `reportId` : les pièces
>   jointes email d'un report sont regroupées côté client pour alimenter
>   « Voir les docs » (aucun nouvel endpoint).
> - Le score reste au niveau société : les cartes de l'historique ont un
>   carré neutre (pas de score par report). Bouton « Ajouter un report »
>   désactivé avec tooltip (ingestion email uniquement, pas de création
>   manuelle). L'onglet « Synthèse IA » (intelligence) est conservé tel quel.

## v1.60.3 — 02/07/2026 à 12:01 — Chat IA : budget et validation sur l'accès HTTP

Durcissement de sécurité interne. L'accès HTTP annexe du chat IA (un point
d'entrée direct utilisé pour des tests, en marge du panneau intégré) applique
désormais le **même budget d'usage par utilisateur** que le panneau : un membre
authentifié ne peut plus contourner la limite en bouclant sur cet accès, ce qui
protège le coût des appels au modèle. Le corps de chaque requête est aussi
validé — JSON malformé rejeté proprement, taille du message plafonnée,
organisation vérifiée — au lieu d'être traité sans contrôle. Aucun changement
visible à l'usage normal.

> **🔧 Notes techniques**
>
> - `convex/chat.ts`, handler `streamOverHttp` (route `/api/chat`) : 4
>   correctifs chirurgicaux, la logique de streaming et
>   `sendMessage`/`respondToToolApproval` restent inchangées.
> - `request.json()` est enveloppé dans un `try/catch` → `400 Bad JSON` si le
>   corps n'est pas du JSON valide (avant : seule httpAction sans garde,
>   audit §5.1).
> - `consumeLimit(ctx, 'chatSend', probeUser._id)` ajouté **après**
>   `actionAuthProbe` (user résolu), même clé/budget que `sendMessage`
>   (30/min/user, `convex/rateLimiters.ts`) — comble le contournement §4.1.
> - Plafond `PROMPT_MAX = 30_000` caractères sur le prompt (aligné sur
>   `MAX_TEXT` de `reportAnalysis.ts`) → `400 Prompt too long` si dépassé.
> - L'appel `actionAuthProbe` est enveloppé dans un `try/catch` → `403`
>   propre : un `orgId` malformé (rejeté par le validateur `v.id`) ou un
>   non-membre ne fuit plus en `500`. Signature d'`actionAuthProbe` et casts
>   `as Id<>` laissés tels quels (option légère).
> - `TESTING.md` : cas C31–C34 ajoutés au Niveau 5 (JSON malformé, 31e
>   requête/min, prompt géant, `orgId` invalide).

## v1.60.2 — 02/07/2026 à 11:14 — Réception d'e-mails : vérification obligatoire

Durcissement de sécurité interne. Le point d'entrée qui reçoit les e-mails
entrants (utilisés pour la génération de rapports) rejette désormais
systématiquement toute requête tant que son secret de vérification n'est pas
configuré, au lieu de la traiter sans contrôle. Le comportement est aligné sur
les autres intégrations entrantes (banque, CRM, Telegram). Aucun changement
visible à l'usage : le secret est bien en place en production.

> **🔧 Notes techniques**
>
> - `convex/agentmail.ts`, handler `agentmailWebhook` : le chemin fail-open
>   (`console.warn` + traitement du payload quand `AGENTMAIL_WEBHOOK_SECRET`
>   est absent) est remplacé par un guard fail-closed
>   `if (!secret) throw new ConvexError('missing_agentmail_webhook_secret')`,
>   identique à `telegram.ts`, `powens.ts` et `attioSync.ts`. La vérification
>   Svix devient inconditionnelle (le secret est garanti présent) ; import de
>   `ConvexError` ajouté.
> - Hors périmètre, signalés par l'audit et à traiter dans des PR séparées :
>   comparaison Svix non constant-time (§3.4) et absence d'anti-rejeu (§3.5).

## v1.60.1 — 02/07/2026 à 10:58 — Isolation inter-organisations renforcée (deals)

Correctif de sécurité interne. À la modification d'un deal, le SPV
intermédiaire ne peut plus être rattaché à une société d'une autre
organisation : l'isolation des données entre organisations est désormais
vérifiée de la même façon à la création **et** à la modification d'un deal.
Aucun changement visible à l'usage.

> **🔧 Notes techniques**
>
> - `convex/deals.ts`, mutation `update` : ajout de la revalidation
>   `assertSameOrg(ctx, deal.orgId, patch.viaSpvCompanyId, 'spv_wrong_org')`
>   quand le patch porte un `viaSpvCompanyId`, symétrique de celle déjà
>   présente dans `create`. `investorCompanyId` et `targetCompanyId` étaient
>   déjà revalidés dans `update` ; seul `viaSpvCompanyId` manquait.
> - Sans ce contrôle, un membre pouvait pointer le SPV d'un de ses deals vers
>   une société d'une autre org et lire ses données au travers de l'enrichissement
>   du deal — seule faille d'isolation cross-org restante côté backend.

## v1.60.0 — 01/07/2026 à 18:41 — TRI des participations exact (calcul serveur)

Le taux de rendement interne (TRI) affiché pour une société soldée est
désormais **exact**. Il est calculé côté serveur sur l'enchaînement daté des
flux réels (versements et encaissements) de **tous** les deals de la société,
au lieu d'une approximation qui annualisait le multiple entre la première
entrée et la dernière sortie.

Concrètement, pour une société qui a plusieurs investissements à des dates
d'entrée et de sortie différentes, le TRI affiché **change** — il devient plus
juste. L'écart avec l'ancien chiffre peut être important quand les opérations
sont étalées dans le temps. Le TRI reste vide (« — ») lorsqu'il n'est pas
définissable mathématiquement, par exemple une perte totale sans aucun
encaissement — le multiple 0,00× et le badge « perdu » signalent déjà la perte.

L'export CSV des participations gagne deux colonnes, **MOIC** et **TRI**
réalisés par ligne, alignées sur ces mêmes chiffres. L'assistant IA lit lui
aussi ces valeurs réelles (versé, reçu, MOIC, TRI) plutôt que les seuls
montants saisis.

> **🔧 Notes techniques**
>
> - Nouveau helper pur `realizedCashflows(txs, instrumentKind)` dans
>   `convex/lib/metrics.ts` : flux signés et dé-TVA-és (÷1,2 pour `royalty`),
>   prêts pour `xirr()`. Le TRI d'une société se résout sur l'**union** des flux
>   de ses deals — le TRI/IRR n'est pas additif, il ne se déduit pas des TRI par
>   deal.
> - `convex/deals.ts` : helper `dealRealizedMetrics(ctx, deal)` (une seule
>   lecture des transactions) → `{ paidActual, received, flows, moic, irr }`
>   avec `irr = xirr(flows)`. `deals.list` renvoie ces champs par deal ; idem
>   `convex/aggregate.ts` pour la vue cross-org `/app/all`.
> - Front `ParticipationsTable.tsx` : le groupement par société accumule les
>   `flows` et calcule `tri = xirr(g.flows)` (solveur partagé `~/lib/xirr`).
>   Suppression de `annualizedTri` et des dates de groupe `signedDate` /
>   `exitedDate` qui ne servaient qu'à l'approximation. Le MOIC société reste
>   calculé côté client (Σproceeds / Σcapital, additif donc exact).
> - Export CSV `ParticipationsView.tsx` : colonnes MOIC (`d.moic`) et TRI
>   (`d.irr`, ratio décimal), lues depuis les champs autoritatifs.
> - Outil IA `agentTools.ts` (`listDealsInternal` / `listDeals`) : expose le
>   réalisé `paidActual` / `received` / `moic` / `irr` par deal.
> - Tests purs : `realizedCashflows` (`tests/metrics.test.ts`) et un cas de
>   divergence à 2 deals (`tests/groupTri.test.ts`) — XIRR exact ≈ 28,6 % vs
>   ancienne approximation ≈ 7,8 %. Dashboard inchangé (TVPI/DPI dérivés
>   d'agrégats additifs).

## v1.59.1 — 01/07/2026 à 18:00 — Cohérence des indicateurs de portefeuille

Les multiples et taux de performance (MOIC, TVPI, TRI, DPI, valeur
résiduelle / NAV) sont désormais calculés à partir d'une seule et même
formule partagée par tous les écrans (liste des participations, tableau de
bord, export CSV, fiche fonds). Auparavant chaque écran refaisait le calcul
de son côté, avec un risque de voir les chiffres diverger d'un endroit à
l'autre. Aucun chiffre affiché ne change : c'est un nettoyage interne qui
garantit que tous les écrans parlent le même langage.

> **🔧 Notes techniques**
>
> - Nouveau module pur `convex/lib/metrics.ts`, source unique de vérité :
>   `sumCashflows` (capital = Σ sortantes jamais dé-TVA'ées ; proceeds = Σ
>   entrantes, ÷1,2 uniquement pour `royalty`), `proceedsFromReceived`,
>   `residualValueCents`, `moic`, `tvpi` (sur le reçu brut), `dpi`,
>   `annualizedTri`, et un `MS_PER_YEAR` unique aligné sur actual/365.
> - `src/lib/xirr.ts` déplacé vers `convex/lib/xirr.ts` (importe le
>   `MS_PER_YEAR` partagé) ; l'ancien chemin ré-exporte pour ne rien casser
>   (`RoyaltiesPanel`).
> - Sites rebranchés sans changer les valeurs : `dealMetrics.dealMoic`
>   (wrapper mince), `ParticipationsTable` (résiduel + MOIC/TVPI/TRI groupe
>   et fiche), `ParticipationsView` (TVPI export CSV), `FundSection`
>   (DPI/TVPI fonds), dashboard `index.tsx` (TVPI/DPI), `convex/dashboard.ts`
>   et `agentTools.getDashboardSummaryInternal` (NAV via `residualValueCents`).
> - Correction d'une incohérence : le TRI de la liste passait de 365,25 à 365
>   jours pour s'aligner sur le XIRR (variation d'affichage négligeable).
> - Nouveau `tests/metrics.test.ts` (node:test) verrouillant dé-TVA
>   royalty-only, capital jamais dé-TVA'é, MOIC=0 → TRI −100 %, capital=0 →
>   null, day-count.

## v1.59.0 — 01/07/2026 à 18:04 — Royalties : trimestres en colonnes dans le suivi

Sur la fiche d'une participation en royalties, le tableau de suivi trimestriel
est désormais présenté « à l'horizontale » : chaque trimestre occupe une
**colonne**, et les lignes portent les métriques (CA et royalties du BP
initial, du BP dégradé, du réel, puis l'écart en euros et en pourcentage). Le
cumul reste affiché, à droite du tableau. Cette orientation colle à la lecture
habituelle d'un business plan et facilite la comparaison d'un trimestre à
l'autre. Les cases de CA (BP initial et réel) restent modifiables au clic comme
avant.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` : transposition purement
>   présentationnelle du tableau. `buildRoyaltyRows` (et `royalties.ts`) est
>   inchangé — `rows` (une entrée par trimestre) et `totals` sont réutilisés
>   tels quels, seul le rendu change.
> - Les trimestres deviennent les en-têtes de colonnes ; deux colonnes de
>   gauche portent le groupe (rowSpan=2 : BP initial / BP dégradé / Réel /
>   Écart) et le sous-libellé (CA / Royalties / € / %). Le `Cumul` passe du
>   `TableFooter` (supprimé) à une colonne de droite.
> - Hiérarchie visuelle (`COL_BP_INITIAL` / `COL_BP_DEGRADED` / `COL_REAL`)
>   appliquée aux `TableRow` au lieu des colonnes. Helper local `euroCell`
>   pour les cellules euros en lecture seule ; `EditableCa` réutilisé pour les
>   deux lignes de CA éditables.

## v1.58.0 — 01/07/2026 à 17:48 — Vue transversale des deals + recherche globale

Les deals ne se retrouvaient qu'en passant par leur entreprise, alors qu'une
même boîte peut porter plusieurs deals — impossible de savoir dans quelle entité
vivait un deal donné. Trois nouveautés y répondent :

- **Une liste « Deals »** dans le menu de gauche : tous vos deals, toutes
  entités confondues, sur une seule page. Chaque ligne montre à la fois la
  société investie **et** l'entité investisseuse, avec recherche, filtres
  (instrument, statut, secteur), tri et export CSV. Disponible aussi dans la vue
  agrégée « Toutes les organisations » (avec la colonne Organisation).
- **Une recherche globale (⌘K / Ctrl+K)**, accessible partout depuis le bouton
  « Rechercher » de l'en-tête : elle interroge d'un coup les **deals**, les
  **sociétés** et les **mouvements** bancaires, résultats regroupés par type —
  on choisit d'un clic si l'on ouvre la société ou le deal.
- **L'assistant IA sait sur quoi vous travaillez** : quand vous consultez une
  fiche deal ou société, il opère directement dessus (« résume ce deal » sans
  avoir à le nommer). La recherche propose aussi « Demander à l'IA » pour
  envoyer votre requête à l'assistant.

> **🔧 Notes techniques**
>
> - Liste plate : `src/components/deals/DealsListView.tsx` (une ligne = un
>   deal, cible + investisseur), montée sur les routes
>   `src/routes/app/$orgSlug/deals.index.tsx` et `src/routes/app/all/deals.tsx`
>   (réutilise `api.deals.list` / `api.aggregate.listDeals`). `FacetFilter`
>   extrait de `ParticipationsView` vers un module partagé ; `SortableHead`,
>   `useFormatters`, `useDealTitle`, `residualCents` réutilisés. Entrée nav
>   `items.deals` + segment breadcrumb `deals`.
> - Recherche : query `convex/search.ts:global` (deals + sociétés filtrés en
>   mémoire, transactions via l'index full-text `search_text`), palette
>   `src/components/search/CommandPalette.tsx` (shadcn `command` + `Dialog`),
>   montée dans `route.tsx` avec un listener ⌘K et un bouton dans `AppHeader`.
>   Palette org-scoped.
> - Contexte IA : `AiPanel` dérive l'entité courante (`useParams`) et la passe
>   dans `context.entity` de `sendMessage` / `respondToToolApproval`
>   (`convex/chat.ts`), transmise à `buildInstructions`
>   (`convex/lib/instructions.ts`). Pont « Demander à l'IA » via les props
>   `initialPrompt` / `onPromptConsumed` du panneau.

## v1.57.0 — 01/07/2026 à 16:54 — Participations : retrait de la colonne « Investi le »

La liste des participations (regroupée par entreprise) affichait une colonne
« Investi le ». Comme une même entreprise peut porter plusieurs deals à des
dates différentes, cette date agrégée n'était pas pertinente et pouvait
rester vide. Elle a été retirée de la liste. Les dates propres à chaque deal
(closing, signature) restent visibles sur la fiche du deal et dans l'export.

> **🔧 Notes techniques**
>
> - Suppression de la colonne « Investi le » dans
>   `src/components/participations/ParticipationsTable.tsx` : en-tête, cellule,
>   clé de tri `invested`, et l'agrégat `group.signedDate` (min des
>   `signedDate` des deals) qui n'alimentait plus que cette colonne. `fmtDate`
>   retiré des dépendances de la table et de `CompanyRows`.
> - Le champ per-deal `signedDate` (`DealRow`) reste utilisé par la liste des
>   deals de la fiche entité (`DealsList`) et l'export CSV — non touché.

## v1.56.0 — 01/07/2026 à 16:45 — Participations soldées : toujours visibles, avec le TRI

La section « Participations soldées » en bas de la liste Entreprises est
désormais **toujours dépliée** : plus de bouton pour la replier, elle reste
visible en bas de page. La **barre de recherche et les filtres** du haut de la
liste s'appliquent maintenant **aussi** aux participations soldées — il n'y a
donc plus qu'une seule barre, celle du haut (celle qui était juste au-dessus des
soldées a été retirée).

Côté indicateurs, la colonne **TVPI** a été retirée des participations soldées
(elle vaut toujours le MOIC une fois sorti) et une colonne **TRI** (taux de
rendement annualisé) a été ajoutée à côté du MOIC : elle traduit le multiple en
rendement par an sur la durée de détention. Une perte totale s'affiche à −100 %,
et le TRI reste « — » tant qu'aucune date de sortie n'est renseignée.

> **🔧 Notes techniques**
>
> - `ParticipationsView.tsx` devient le propriétaire unique de la recherche +
>   des facettes (état, `useMemo` `facets`/`filtered`, toolbar, export CSV
>   `handleExport` sur le set complet non splitté, `exportRef`). Il applique le
>   filtre puis splitte en `active` / `settled` et passe chaque sous-ensemble
>   déjà filtré à `ParticipationsTable`. Section soldés rendue en `<section>`
>   avec un simple `<h3>` (plus d'état `open`/chevron), masquée si `settled`
>   filtré est vide.
> - `ParticipationsTable.tsx` perd sa toolbar/recherche/facettes/export
>   (remontés) ; il ne fait plus que grouper par société, trier et paginer. Le
>   variant `settled` remplace la colonne TVPI par **MOIC + TRI**. Nouveaux
>   props `isFiltered` (message vide) et `resetKey` (reset pagination). Helper
>   `residualCents` désormais exporté (réutilisé par l'export dans la vue).
> - TRI = IRR à deux points sur le **même** agrégat que le MOIC :
>   `MOIC^(1/années) − 1`, avec années = (`exitedDate` la plus récente −
>   `signedDate` la plus ancienne) du groupe / `MS_PER_YEAR`. Nécessite les deux
>   dates et une durée positive, sinon `null` → « — ». `exitedDate` ajouté au
>   type `DealRow` (déjà présent côté serveur via le spread `...deal`).
>   Formateur `fmtPercent` ajouté à `useFormatters`. Clé i18n `col.tri`
>   (FR « TRI » / EN « IRR »).

## v1.55.0 — 01/07/2026 à 16:32 — Montants plus lisibles pendant la saisie

Quand vous saisissez un montant en euros dans un champ (création d'un deal,
édition d'une fiche participation, prévisionnel de trésorerie, passif, sorties,
revenus royalties…), les milliers s'espacent automatiquement au fil de la
frappe : `1 000 000` au lieu de `1000000`. Plus besoin de compter les zéros
pour vérifier qu'on tape le bon montant. La valeur enregistrée ne change pas —
seul l'affichage pendant la saisie est mis en forme.

> **🔧 Notes techniques**
>
> - Nouveau composant partagé `src/components/ui/amount-input.tsx` : hook
>   `useAmountField(value, onChange)` (props à spread, gère le formatage, le
>   nettoyage et la restauration du caret via `ref`) + wrapper `AmountInput`
>   pour un `<Input>` simple. Le contrat reste une string brute non formatée
>   côté parent, donc les parsers euros existants (`eurosToCents`,
>   `parseAmountToCents`, `parseEuros`) fonctionnent sans changement.
> - Groupement à l'espace (et non la virgule locale) car le séparateur décimal
>   peut être une virgule ; l'espace est la seule marque de milliers non
>   ambiguë pour de la saisie.
> - Câblé sur tous les champs montant EUR éditables : `CreateDealDialog` et
>   `DealFieldInput` (format `eur` uniquement), `ExitDealDialog`,
>   `ForecastSection`, `CreateEquityDialog`, `RoyaltiesPanel` (cellule inline
>   `EditableCa` + revenu trimestriel). `CreateDealDialog` bascule aussi sur
>   `eurosToCents` (gère la virgule décimale, l'input passant de `number` à
>   `text`).

## v1.54.1 — 01/07/2026 à 16:33 — Nouveautés : les horaires affichés passent à l'heure de Paris

Sur la page Nouveautés, l'heure de chaque mise à jour était écrite en UTC, ce qui
la faisait apparaître environ 2h en avance sur l'heure réelle (heure de Paris).
La convention de rédaction est désormais explicite : l'horaire est écrit en heure
de Paris. Les prochaines entrées afficheront donc la bonne heure.

> **🔧 Notes techniques**
>
> - Aucun changement de code : la page `changelog.tsx` rend `CHANGELOG_PRODUIT.md`
>   tel quel (`?raw`), les horaires sont saisis à la main dans le fichier.
> - Cause du décalage : l'horloge de l'environnement d'exécution est en UTC, mais
>   la règle demande l'heure d'ouverture de PR en Europe/Paris. Sans conversion,
>   les horaires sortaient ~2h trop tôt (CEST) / ~1h (CET).
> - Correctif : renforcement de la règle « Pre-PR doc audit » (question 5) dans
>   `CLAUDE.md` — l'offset UTC→Paris (+2h été / +1h hiver) est maintenant explicité.

## v1.54.0 — 01/07/2026 à 15:00 — Fiches deals : suppression des mentions d'import externe

Sur la fiche d'un deal, la petite pastille jaune « Modifié à la main » et la
note associée dans la fenêtre d'édition ont été retirées : elles faisaient
référence à un mécanisme d'import externe qui n'a plus lieu d'être ici. Les
champs restent modifiables comme avant, l'affichage est simplement plus épuré.

> **🔧 Notes techniques**
>
> - `src/components/deals/InstrumentBlock.tsx` : `FieldRow` ne prend plus le
>   flag `manuallyEdited` ; suppression du point `bg-chart-4` + tooltip et des
>   imports `Tooltip*` désormais inutilisés, ainsi que du `editedSet` dérivé de
>   `deal.manuallyEditedFields`.
> - `deals.$dealId.tsx` : retrait du paragraphe `edit.fieldsHint` dans le
>   dialogue d'édition ; commentaire de mécanisme reformulé sans « Airtable ».
> - i18n : suppression des clés `fiche.manuallyEdited` et `edit.fieldsHint`
>   (fr/en), et retrait de « Airtable » de `org.settings.demoDescription`.
> - Le garde-fou `manuallyEditedFields` reste actif côté backend (`upsertDeals`)
>   — seule sa surface UI disparaît.

## v1.53.3 — 01/07/2026 à 12:00 — Secteur d'une entité : un secteur créé réapparaît dans la liste

Quand vous ajoutiez un secteur qui n'était pas dans la liste proposée (en le
tapant à la main sur une entité), il n'était plus proposé ensuite : sur une
autre entité, il fallait le retaper à l'identique. Désormais, tout secteur déjà
utilisé par une entité de l'organisation apparaît directement dans la liste de
sélection du champ secteur.

> **🔧 Notes techniques**
>
> - `SectorCombobox` accepte une prop `extraSectors` : les valeurs de secteur
>   libres (hors `SECTOR_SLUGS`) déjà stockées sur d'autres entités sont
>   fusionnées dans la liste d'options, affichées telles quelles (pas de label
>   i18n), dédupliquées.
> - Dans `EditCompanyDialog` (`participations.$companyId.tsx`), on lit
>   `api.companies.list` scopée à l'org pour dériver les secteurs existants et
>   les passer au combobox. `companies.sector` reste un champ texte libre.

## v1.53.2 — 01/07/2026 à 11:00 — Reporting par email : le corps des mails est enfin lu

Certains reports transférés par email n'apparaissaient pas dans l'app. En cause :
le contenu des mails un peu volumineux (typiquement un transfert avec pièce
jointe) n'était pas récupéré, ce qui empêchait la création du report — sans
message d'erreur visible. C'est corrigé : un report transféré est désormais
traité à partir du corps du mail et rattaché à la bonne participation, même si
les clés optionnelles (lecture des PDF, réponse de confirmation) ne sont pas
encore configurées.

> **🔧 Notes techniques**
>
> - Le webhook AgentMail `message.received` omet `text`/`html` pour les gros
>   messages : le corps vit derrière un `body_url` présigné (S3). Nouveau
>   `fetchBody()` dans `convex/agentmail.ts` (GET du lien, sans auth) ;
>   `reportPipeline.run` extrait le corps dans l'ordre inline → `body_url` →
>   `getMessage`.
> - `apiKey()` ne throw plus : `getMessage` / `downloadAttachment` / `reply` /
>   `send` dégradent proprement (warn + null/false) quand `AGENTMAIL_API_KEY` est
>   absente — le run ne crashe plus après le 200 du webhook.
> - Parsing du `From` « Nom <email> » → email seul ; logs `[reportPipeline]`
>   (received / body chars / matched / stored) pour l'observabilité dans Convex.

## v1.53.1 — 30/06/2026 à 20:15 — Garde-fou : changelog obligatoire en CI

Pour éviter qu'une évolution n'arrive en ligne sans être documentée dans
« Nouveautés » (ce qui était arrivé pour le reporting par email), la
chaîne d'intégration **refuse désormais toute pull request qui n'ajoute pas
de nouvelle entrée de changelog**. Aucun changement visible côté application.

> **🔧 Notes techniques**
>
> - Nouveau job `changelog` dans `.github/workflows/ci.yml` (sur `pull_request`
>   uniquement) : échoue si l'entrée `## vX.Y.Z` en tête de
>   `CHANGELOG_PRODUIT.md` est déjà présente sur la base de la PR (donc aucune
>   nouvelle entrée ajoutée). Compare via `git show $BASE_SHA:…` + `grep -Fxq`,
>   `fetch-depth: 0` pour disposer de l'historique.
> - Matérialise la règle `CLAUDE.md` § « Pre-PR doc audit » (question 5),
>   jusqu'ici uniquement sur la confiance.

## v1.53.0 — 30/06/2026 à 19:52 — Reporting : suivi des reports et synthèse IA sur la fiche

La fiche d'une participation gagne une zone **« Reporting »** organisée en
onglets :

- **Documents** — l'espace d'upload manuel existant, inchangé.
- **Reports** — la liste des **reports reçus par email** (période, type, date,
  statut). Un clic sur une ligne ouvre le détail : titre, points clés,
  métriques et contenu brut du report.
- **Synthèse IA** — une lecture synthétique générée automatiquement :
  résumé exécutif, **note de santé** (avec points forts et points de
  vigilance), indicateurs clés avec tendance, et alertes. La carte indique
  clairement si l'analyse est en cours, en échec, ou en attente de données.

> **🔧 Notes techniques**
>
> - Onglets ajoutés sur `src/routes/app/$orgSlug/participations.$companyId.tsx`
>   (`Tabs` shadcn) : `ReportingsSection` (existant) + deux nouveaux composants
>   `src/components/companies/CompanyReportsSection.tsx` (tableau + dialog
>   détail) et `CompanyIntelligenceCard.tsx` (synthèse IA).
> - Lecture seule, scoping org via `requireOrgMember` : queries publiques
>   `convex/companyReports.ts` (`listByCompany`, `getById`) et
>   `convex/intelligence.ts:getByCompany`. La donnée est produite par le
>   pipeline d'ingestion (#143).
> - i18n EN + FR, namespace `participations` : `tabs`, `reports`,
>   `intelligence`.

## v1.52.0 — 30/06/2026 à 19:40 — Reporting : réception automatique des reports par email

Un email envoyé à l'**adresse de reporting dédiée** est désormais traité
automatiquement : Albo OS crée le report, le **rattache à la bonne société**,
stocke les pièces jointes, extrait les informations structurées, génère une
**synthèse IA** et répond une confirmation à l'expéditeur. Plus besoin de
saisir les reports investisseurs à la main.

> **🔧 Notes techniques**
>
> - Transport email via **AgentMail** (inbox dédiée + webhook `message.received`
>   signé Svix) : `convex/agentmail.ts` (wrapper REST `fetch`, vérif signature
>   Web Crypto) + route dans `convex/http.ts`.
> - Orchestrateur `convex/reportPipeline.ts` : dédup → extraction texte/liens →
>   résolution company/org cross-org → extraction structurée
>   (`convex/reportAnalysis.ts`, `generateObject` + Zod) → stockage
>   (`companyReports` + `documents`) → synthèse IA (`convex/intelligence.ts`,
>   agent dédié + tool `webSearch` Linkup) → reply de confirmation.
> - Schéma : tables `companyReports` et `companyIntelligence` ; `documents`
>   gagne `reportId` / `extractedText` / `inline`.
> - Env requis (Convex) : `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`,
>   `AGENTMAIL_WEBHOOK_SECRET`, `LINKUP_API_KEY`. OCR des PJ et suivi KPI
>   structuré différés.

## v1.51.2 — 30/06/2026 à 18:00 — Favicon Albo agrandi dans l'onglet

Le **« a » d'Albo** occupe désormais une plus grande part de l'icône :
la marge autour du logo a été réduite pour qu'il soit plus lisible dans
l'onglet du navigateur et sur l'écran d'accueil.

> **🔧 Notes techniques**
>
> - Régénération des assets `public/` (mêmes fichiers que v1.51.1) avec un
>   padding réduit autour du glyphe : `pad=12` sur 100 pour les favicons web
>   arrondis (zone utile 76 vs 48 auparavant), `pad=14` pour
>   `apple-touch-icon` / `android-chrome` (carrés pleins). Couleurs
>   inchangées (a `#0A0A0A` sur fond crème `#F4F3EF`).

## v1.51.1 — 30/06/2026 à 17:30 — Nouveau favicon Albo

L'onglet du navigateur affiche désormais le **« a » d'Albo** (le logo de
la marque, repris du site alboteam.com) à la place de l'icône générique du
template. Les icônes d'écran d'accueil (iOS / Android) et la tuile
d'application reprennent le même logo.

> **🔧 Notes techniques**
>
> - Favicon source récupéré sur `alboteam.com` (site Framer, lien
>   `rel="icon"`) : le mark « a » de la marque.
> - Régénération de tous les assets dans `public/` à partir du tracé SVG
>   officiel recoloré (a noir `#0A0A0A` sur fond crème `#F4F3EF`) :
>   `favicon.ico` (multi-tailles 16/32/48/64), `favicon.png`,
>   `favicon-16x16.png`, `favicon-32x32.png` (coins arrondis), plus
>   `apple-touch-icon.png` (180, carré plein), `android-chrome-192x192.png`
>   et `android-chrome-512x512.png`.
> - Aucun changement dans `src/routes/__root.tsx` : les balises `<link>`
>   pointaient déjà sur ces noms de fichiers. `logo.svg` / `logo-mark.svg`
>   (logos applicatifs) laissés inchangés.

## v1.51.0 — 30/06/2026 à 17:00 — Participations : actives en haut, soldées repliées en bas

La liste des participations est désormais scindée en **deux tableaux empilés** :

- en **haut**, les participations **actives** (et en sortie partielle) — le
  tableau habituel, inchangé ;
- en **bas**, une section **« Participations soldées (N) »**, **repliée par
  défaut** (un clic pour la déplier), qui regroupe les sorties totales et les
  pertes totales. Le compteur reste visible même repliée.

Le tableau des soldées reprend la même présentation (regroupement par société,
formatage) et ajoute une colonne **MOIC** ainsi que le **badge** gagnant /
perdant / « Sorti ». Une perte totale s'affiche toujours en perdant. S'il n'y a
aucune participation soldée, la section n'apparaît pas. La séparation s'applique
à la vue d'une organisation comme à la vue agrégée toutes organisations, et
l'export CSV continue de couvrir l'ensemble des deals (actifs + soldés).

> **🔧 Notes techniques**
>
> - Nouveau wrapper `ParticipationsView`
>   (`src/components/participations/ParticipationsView.tsx`) : scinde le `deals`
>   déjà chargé (un seul aller-retour) en actifs / soldés sur `status` et empile
>   deux `ParticipationsTable`. La section soldés réutilise le pattern
>   collapsible maison (`useState` + chevron) comme `ArchivedSection`.
> - `ParticipationsTable` gagne deux props : `settled` (ajoute la colonne MOIC +
>   `ExitBadge`, en-têtes non triables) et `exportDeals` (l'export reste branché
>   sur le jeu complet, en amont du split — comportement export inchangé).
> - MOIC du groupe **dérivé des sommes agrégées** déjà en scope (`paidActual` /
>   `received`) — les transactions brutes ne sont pas chargées. Dé-TVA royalty
>   appliquée **par deal** (`received / 1.2`, convention de `dealMoic`) pour ne
>   **jamais surévaluer** un groupe à instruments mixtes. `ExitBadge` réutilisé
>   tel quel via un deal synthétique (statut + instrument non-royalty) et des
>   transactions synthétiques portant les proceeds déjà nets de TVA.
> - Routes `app/$orgSlug/participations.index.tsx` et
>   `app/all/participations.tsx` consomment `ParticipationsView`. i18n :
>   `col.moic` + `settled.sectionTitle` (EN + FR).

## v1.50.0 — 30/06/2026 à 16:30 — Sortie d'un deal : badge gagnant/perdant et geste dédié

Sur la fiche d'une participation, un nouveau geste **« Marquer comme sorti »**
(menu en haut à droite) permet d'enregistrer la sortie d'un investissement :
type de sortie (totale, partielle ou perte totale), date de sortie et produit
de sortie. Le produit est pré-rempli avec le total des sommes déjà reçues, mais
reste librement modifiable. La sortie est **réversible** : un bouton
« Annuler la sortie » repasse le deal en actif et efface les informations de
sortie.

Une fois le deal sorti, un **badge** apparaît à côté du statut :

- **Exit gagnant** (vert) quand l'argent récupéré dépasse le capital investi,
- **Exit perdant** (rouge) quand il est inférieur,
- **Sorti** (neutre) quand le multiple n'est pas calculable (aucun flux), sans
  rien affirmer sur la performance.

Une participation explicitement **dépréciée** affiche toujours « Exit perdant ».

> **🔧 Notes techniques**
>
> - Nouveau `src/lib/dealMetrics.ts` : `dealMoic(deal, transactions)` →
>   `{ moic, isWin }`. Assiette = Σ flux entrants / Σ flux sortants, les deux
>   issus des transactions réelles (pas de `exitProceeds`). Dé-TVA ÷1.2 sur les
>   entrants **uniquement** si `instrumentKind === 'royalty'` ; le capital
>   (sortants) n'est jamais dé-TVA-é. `moic = null` si Σ sortants = 0.
> - `src/components/deals/ExitBadge.tsx` : badge à 3 états rendu seulement pour
>   `status ∈ {fully_exited, written_off}`. `written_off` force « perdant » ;
>   sinon `isWin` décide (`null` → « Sorti » neutre). RoyaltiesPanel n'est pas
>   touché (son CoC garde le scalaire `capitalInvested`).
> - `src/components/deals/ExitDealDialog.tsx` : dialog dédié (select statut,
>   date, produit pré-rempli depuis `received`), persiste via `deals.update`
>   existant. Bouton « Annuler la sortie » → `status: 'active'` + clear.
> - `convex/deals.ts` : ajout de `exitProceeds` à `dealFields` (absent
>   auparavant) ; dans `update`, `exitedDate`/`exitProceeds` acceptent un `null`
>   explicite qui efface le champ (Convex ne transmet pas `undefined` côté
>   client). Greffe UI dans `deals.$dealId.tsx` (badge + entrée de menu).

## v1.49.2 — 30/06/2026 à 10:51 — Royalties : correction d'affichage de la jauge

Sur la fiche d'un investissement à royalties, l'étiquette flottante des
**royalties perçues (réel)** est désormais correctement alignée aux extrémités
de la jauge : à 0 € reçu elle ne déborde plus à gauche, et au plafond elle ne
déborde plus à droite.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` : ancrage de l'étiquette flottante
>   du curseur rendu sensible aux bords. Extraction de `cursorPct =
>   barPct(realizedCumul)` (réutilisé par l'étiquette et le remplissage), puis
>   bascule de `-translate-x-1/2` vers `translate-x-0` (≤ 5 %) ou
>   `-translate-x-full` (≥ 95 %) pour éviter le clipping hors de la piste.

## v1.49.1 — 30/06/2026 à 12:00 — Royalties : date de début des royalties

Les paramètres d'un investissement à royalties accueillent un nouveau champ
optionnel **« Début des royalties »**. Purement informatif, il se saisit dans
la fenêtre d'édition (sélecteur de date) et s'affiche dans le bloc paramètres,
entre la date d'investissement et la date de fin. Laissé vide, il affiche
« — ». Il ne modifie **aucun calcul** (TRI, multiple, barre de progression
restent inchangés).

> **🔧 Notes techniques**
>
> - Nouveau champ `royaltyStartDate` (`v.optional(v.number())`, ms epoch)
>   ajouté sur le modèle exact de `investmentDate`/`endDate`, sur les cinq
>   points de la chaîne : groupe royalty de `convex/schema.ts`, `dealFields`
>   dans `convex/deals.ts` (patchable via `deals.update`), `ROYALTY_FIELDS`
>   dans `convex/lib/instrumentMapping.ts`, `FIELD_FORMAT` (`'date'`) dans
>   `InstrumentBlock.tsx`, et le tableau `params` de `RoyaltiesPanel.tsx`
>   (`fmtDate`). Clé i18n `field.royaltyStartDate` (EN/FR). Découvert
>   automatiquement par `EditDealDialog` (date picker via le format `date`).
> - Strictement informatif : absent de toute formule (TRI/CoC/barre). Pas de
>   migration, pas de donnée dérivée.

## v1.49.0 — 30/06/2026 à 11:45 — Royalties : barre plus lisible et distinction « rien saisi » / « zéro »

Sur la fiche d'un investissement à royalties, la **barre de progression** gagne
deux libellés discrets — **« Plancher »** et **« Plafond »** — placés au-dessus
de leurs montants respectifs, pour lire la jauge d'un coup d'œil. Le montant de
royalties perçues n'apparaît **plus qu'une seule fois**, sur l'étiquette posée
sur la barre (avec sa mention « (HT) ») : le doublon affiché en haut à droite du
bloc a été retiré.

Dans le **tableau de suivi trimestriel**, on distingue désormais clairement un
trimestre **sans relevé** d'un trimestre **à zéro** : une cellule réelle (ou
prévue) sans point affiche « — », tandis qu'un point réellement saisi à 0
affiche « 0 € ». À l'édition, **vider** une cellule **supprime** le point (la
cellule repasse à « — »), alors que saisir **« 0 »** conserve un point à zéro.

> **🔧 Notes techniques**
>
> - `src/components/deals/RoyaltiesPanel.tsx` — barre : libellés
>   `field.floorMultiple` / `field.capMultiple` empilés au-dessus des montants
>   de repère (spans `bottom-0 flex flex-col`, ancrés au trait, libellé qui
>   pousse vers le haut). Retrait du span cumul `realizedCumul` en haut à droite
>   du bloc réalisé ; ajout du `htTag` sur l'étiquette flottante de la barre
>   (seul affichage du cumul désormais).
> - `EditableCa` : ajout d'un callback `onDelete` et réécriture de `commit` en
>   trois cas — `draft.trim() === ''` → `onDelete` (suppression du point) ;
>   parse réussi (0 inclus) → `onSave` ; parse `null` sur saisie non vide
>   (« abc ») → no-op sans suppression. Branché sur les deux colonnes BP et réel
>   via `removeBpPoint` / `removeActual` (filter sans réinsertion, patch
>   `deals.update`). L'affichage `value == null ? '—' : fmtEur(value)` distingue
>   déjà point absent / point à 0 — seul le comportement d'édition changeait.
## v1.48.1 — 30/06/2026 à 10:30 — Royalties : TRI masqué tant que le capital n'est pas recouvré + barre plus lisible

Sur la fiche d'un investissement à royalties, le **TRI annualisé** ne s'affiche
plus tant que le capital investi n'a pas été recouvré (multiple récupéré
inférieur à 1×) : dans cette phase le taux est mathématiquement exact mais très
instable et trompeur, on affiche donc « **n/a — capital non recouvré** ». Le
TRI réapparaît automatiquement dès que le capital est recouvré.

La **barre de progression** gagne en lisibilité : un repère vertical **explicite
sur le plafond** (en plus du plancher), et un **code couleur à trois zones**
(avant le minimum garanti, entre le minimum et le plafond, plafond atteint). Le
montant de royalties perçues affiché est désormais suivi d'un discret « (HT) »
pour rappeler qu'il s'agit du montant hors taxes (l'écart avec le total TTC des
encaissements correspond à la TVA).

> **🔧 Notes techniques**
>
> - `RoyaltiesPanel.tsx` : le bloc TRI n'est plus gardé par `tri != null` mais
>   par le CoC — `coc < 1` → libellé `triNotRecovered` ; sinon la valeur signée
>   (`signTone`) ; `xirr()` à `null` → « — ». La sous-note `triRecovering` et ses
>   clés i18n (fr/en) sont retirées (devenues mortes).
> - Barre : nouveau drapeau `capReached` ; le remplissage passe à trois états
>   (`bg-primary` / `bg-positive` / `bg-chart-5`). Trait plafond ajouté en
>   **dehors** de la track `overflow-hidden` (sinon le coin `rounded-full` le
>   masque), aligné via `top-6`. Cumul réalisé suffixé de la clé `htTag`.
> - Le calcul `src/lib/xirr.ts` est **inchangé** (déjà un XIRR daté actual/365,
>   `r` annualisé) : seul l'affichage évolue. `KNOWN_ISSUES.md` et `TESTING.md`
>   (FD31, FD34) mis à jour en conséquence.

## v1.48.0 — 29/06/2026 à 22:30 — Royalties : performance réelle (CoC, TRI) et fiche réorganisée

Le suivi des royalties distingue désormais clairement la **projection** (le
tableau, basé sur le chiffre d'affaires saisi) du **réalisé** (ce qui a
vraiment été encaissé) :

- **Barre de progression repensée.** Elle se base maintenant sur le cash
  réellement reçu (transactions entrantes ramenées hors taxes), plus sur la
  projection du tableau. Deux zones colorées (sécurisation jusqu'au plancher,
  rendement au-delà), les repères **plancher** et **plafond** affichent montant
  et multiple alignés sous leur trait, et un message d'état indique ce qu'il
  reste à percevoir avant le minimum garanti ou le plafond.
- **Multiple récupéré (CoC).** Combien le capital a déjà rapporté, exprimé en
  multiple (ex. « 0,18x »), en regard du plancher et du plafond.
- **TRI annualisé.** Le taux de rendement interne, calculé sur le capital
  investi et les encaissements réels à leurs dates. Négatif tant que le capital
  n'est pas récupéré (mention « en cours de récupération »).
- **Fiche réorganisée.** Pour un deal royalty : paramètres → notes → indicateurs
  de réalisé → tableau de suivi.
- **Unités dans l'édition.** Les champs du formulaire d'édition affichent leur
  unité (€, %, ×) pour lever toute ambiguïté.

> **🔧 Notes techniques**
>
> - Séparation stricte projection / réalisé. La barre, le CoC et le TRI sont
>   calculés **uniquement** sur les transactions entrantes du deal
>   (`transactions.listByDeal`), dé-TVA-ées à 20 % (`amount / 1.2`) ; le tableau
>   reste sur `actualPoints`. Le capital (`capitalInvested`) n'est **jamais**
>   dé-TVA-é.
> - Helper XIRR : nouveau `src/lib/xirr.ts` (Newton-Raphson + repli bissection,
>   day-count actual/365), couvert par `tests/xirr.test.ts`. Flux du TRI : un
>   sortant `-capitalInvested` à `investmentDate` + chaque entrant `amount/1.2` à
>   sa `transactionDate`.
> - Threading : `CustomPanelProps` reçoit `transactions?` et `notesSlot?`
>   (`InstrumentBlock.tsx`) ; `deals.$dealId.tsx` passe `txs` et injecte
>   `NotesSection` dans le panneau pour les deals royalty (sinon rendue dessous).
> - Unités d'édition : map `FORMAT_UNIT` (`eur`→€, `pct`→%, `decimal`→×) dans
>   `InstrumentBlock.tsx` ; `DealFieldInput` (`deals.$dealId.tsx`) enveloppe
>   l'`Input` dans `InputGroup` + `InputGroupAddon align="inline-end"`.
> - Barre : positions via `barPct(amount)` sur l'échelle 0→`capAmount`, repères
>   en éléments absolus, message d'état selon `realizedCumul` vs
>   `floorAmount`/`capAmount`.

## v1.47.0 — 29/06/2026 à 21:30 — Suivi des royalties : édition, plancher/plafond et progression

Le panneau de suivi des royalties s'enrichit et corrige plusieurs points :

- **Montants collés mieux interprétés.** Un chiffre d'affaires avec décimales
  fines (ex. « 311 995,152 ») n'est plus lu comme une valeur géante : quand les
  milliers sont déjà séparés par un espace, la virgule est traitée comme une
  décimale. Plus de montants absurdes après un collage.
- **Cellules de CA modifiables.** Vous pouvez désormais corriger directement un
  chiffre d'affaires dans le tableau — aussi bien la colonne **BP initial** que
  la colonne **Réel** — en cliquant sur la cellule, sans repasser par l'import.
- **Lecture hiérarchisée.** Les colonnes sont mises en valeur selon leur
  importance : le **Réel** ressort, le **BP dégradé** (la référence de
  comparaison) est marqué, le **BP initial** reste discret.
- **Nouveaux paramètres.** Date d'investissement, **plancher** et **plafond**
  (saisis en multiple du capital, ex. « 1,25x », « 2x », avec le montant calculé
  affiché), et date de fin.
- **Barre de progression.** Le cumul des royalties perçues se positionne sur une
  échelle plancher → plafond, avec le pourcentage atteint ; la barre passe au
  vert dès que le plancher est franchi.

L'ancien bloc « Business plan vs réalisé » disparaît des fiches royalties (il est
remplacé par ce tableau) ; il reste disponible pour les autres instruments.

> **🔧 Notes techniques**
>
> - Parsing : `parseAmountToCents` (`src/lib/royalties.ts`) devient
>   *space-aware* — `hadSpaceGroup = /\d\s\d/.test(raw)` ; une virgule seule
>   suivie de 3 chiffres n'est traitée comme séparateur de milliers que si aucun
>   espace n'a déjà groupé les milliers, sinon c'est une décimale. Régression
>   couverte dans `tests/royalties.test.ts` (cas « 311 995,152 » → 31199515).
> - Édition inline : composant local `EditableCa` dans `RoyaltiesPanel.tsx`
>   (clic → `Input` → Enter/blur → `parseAmountToCents`). Sauvegarde via le même
>   mécanisme de liste que `addActual` (dedup-replace + `deals.update` patch) :
>   `saveBpPoint` pour `bpPoints`, `addActual` réutilisé pour `actualPoints`.
> - Style : constantes `COL_BP_INITIAL` / `COL_BP_DEGRADED` / `COL_REAL`
>   (tokens `text-muted-foreground`, `bg-muted/40`, `font-medium`) appliquées en
>   en-tête, corps et pied.
> - Paramètres : champs `investmentDate`, `floorMultiple`, `capMultiple`,
>   `endDate` (optionnels) ajoutés à `convex/schema.ts`, `dealFields`
>   (`convex/deals.ts`), `ROYALTY_FIELDS` (`convex/lib/instrumentMapping.ts`) et
>   `FIELD_FORMAT` (`InstrumentBlock.tsx`, formats `date` / `decimal` existants).
>   Plancher/plafond stockés en multiple ; montant = `multiple × capitalInvested`
>   dérivé à l'affichage, rien de stocké.
> - Progression : `totals.actualRoyalty` (déjà calculé) comparé à `floorAmount` /
>   `capAmount` ; barre `div` stylée par tokens, repère plancher en marqueur.
> - `PlanVsActualSection` conditionné sur `instrumentKind !== 'royalty'` dans
>   `deals.$dealId.tsx` (modèle `FundSection`).

## v1.46.1 — 29/06/2026 à 20:30 — Correction : enregistrement d'une règle récurrente de trésorerie

Dans la trésorerie, lors de la création d'une **règle récurrente**, le bouton
**Enregistrer** restait grisé si le montant était saisi avec le symbole **€**
(ex. « 5 580 € »). Le montant est désormais correctement interprété même
lorsqu'il contient le symbole de l'euro : la règle s'enregistre normalement.

> **🔧 Notes techniques**
>
> - `parseEuros` (`src/components/cash/ForecastSection.tsx`) ne retirait que les
>   espaces et la virgule ; un `€` collé au montant donnait `Number("5580€") =
>   NaN`, donc `amountCents === null` → `invalid === true` → bouton désactivé.
> - Fix : la regex de nettoyage retire aussi le symbole `€` (`/[\s€]/g`).

## v1.46.0 — 29/06/2026 à 19:11 — Suivi des royalties trimestre par trimestre

Les deals en **royalties** (ex. La Vie de Quartier) ont désormais leur propre
panneau de suivi. Renseignez une fois les trois paramètres — capital investi,
taux de dépréciation, taux de royalties — puis **collez votre business plan**
depuis Excel ou Google Sheets (deux colonnes : trimestre, chiffre d'affaires
prévu). Un aperçu vous montre ce qui a été reconnu **avant** d'enregistrer.

Ensuite, **ajoutez le chiffre d'affaires réalisé** trimestre par trimestre :
c'est la seule donnée à saisir. Le tableau compare automatiquement, pour chaque
trimestre, le BP initial, le BP dégradé (BP moins la dépréciation) et le réel —
en chiffre d'affaires **et** en royalties — avec l'écart entre le réel et le BP
dégradé (en euros et en pourcentage, coloré en vert ou rouge) et les cumuls en
bas de tableau.

> **🔧 Notes techniques**
>
> - 2e panel custom après Lead SPV (PR #127), même pattern : `RoyaltiesPanel`
>   branché dans `CUSTOM_PANELS` (`src/components/deals/InstrumentBlock.tsx`),
>   props `CustomPanelProps`, édition des 3 scalaires via `EditDealDialog` +
>   `INSTRUMENT_FIELDS['royalty']` (`convex/lib/instrumentMapping.ts`).
> - Nouveauté vs Lead SPV : deux **listes** sur `deals`
>   (`bpPoints`/`actualPoints`, `v.array(v.object(...))` dans `schema.ts` et
>   `dealFields` de `convex/deals.ts`), mises à jour par patch partiel via
>   `deals.update` depuis le panneau (pas via `INSTRUMENT_FIELDS`).
> - Calculs (BP dégradé, royalties, écart, cumuls) dérivés à l'affichage,
>   rien de stocké : `buildRoyaltyRows` dans `src/lib/royalties.ts`. Parsing du
>   collage tabulé tolérant FR/US (`parseAmountToCents`) + normalisation des
>   trimestres en clé canonique `"Qn YYYY"` (`normalizeQuarter`, `parseBpPaste`),
>   couverts par `tests/royalties.test.ts`.
> - Nouveaux champs `capitalInvested` (cents) / `depreciationRate` (bps) +
>   formats dans `FIELD_FORMAT`. Champs optionnels → aucune migration sur les
>   4 deals royalty existants.

## v1.45.0 — 29/06/2026 à 18:05 — Liste des entreprises plus lisible

La liste des entreprises se lit plus vite. **Cliquez n'importe où sur une
ligne** pour ouvrir la fiche — le bouton « Ouvrir la fiche » répété sur chaque
ligne disparaît, et une discrète flèche apparaît à droite au survol. Les noms
de société s'alignent désormais proprement à gauche.

Les valeurs « neutres » s'effacent visuellement pour laisser ressortir
l'essentiel : un montant **reçu à 0 €** et un **TVPI à 1,00×** s'affichent en
gris clair. L'œil va d'abord aux lignes qui ont distribué quelque chose ou dont
le multiple s'écarte de 1.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` (`CompanyRows`) :
>   suppression du bouton/pilule `openDetail` ; la `TableRow` devient le seul
>   point de navigation (`onClick` existant + `tabIndex`/`role="link"`/
>   `onKeyDown` Enter pour le clavier, `aria-label` via la clé i18n
>   `rowOpenAria`). Colonne traînante ajoutée avec une flèche `ArrowRight`
>   en `opacity-0 group-hover/group-focus-visible:opacity-100` ; `colSpan` du
>   loader passé à 7/8.
> - Mise en muted des valeurs neutres via deux helpers locaux
>   `isNeutralAmount` (reçu `=== 0`) et `isNeutralTvpi` (arrondi à `1,00×`),
>   appliquant `text-muted-foreground` sur les cellules Reçu et TVPI. Token DS
>   existant réutilisé, aucune couleur en dur.
> - Périmètre strict liste entreprises ; le même rendu muted pourrait être
>   partagé plus tard avec la fiche deal / les cards KPI du dashboard (autre PR).
## v1.44.0 — 29/06/2026 à 17:44 — Nouveau moteur pour l'assistant IA

L'assistant IA d'Albo OS change de moteur : il tourne désormais sur le modèle
**DeepSeek V4 Pro**, via la passerelle OpenRouter. Au quotidien rien ne change
dans l'usage — même panneau, mêmes outils, mêmes garde-fous de confirmation
avant chaque écriture — mais les réponses s'appuient sur un modèle plus récent
et plus capable. Si vous demandez à l'assistant quel modèle il utilise, il
répond maintenant « DeepSeek V4 Pro ».

> **🔧 Notes techniques**
>
> - Swap de provider isolé dans `getModel()` (`convex/agent.ts`) : remplacement
>   de `@ai-sdk/mistral` par `@openrouter/ai-sdk-provider` (`createOpenRouter` →
>   `openrouter.chat(AGENT_MODEL)`). Le wrapper `fetch` qui injectait
>   `prompt_cache_key` (spécifique Mistral) est supprimé — DeepSeek cache le
>   préfixe automatiquement côté serveur.
> - Id du modèle : source unique `convex/lib/instructions.ts:AGENT_MODEL`
>   (ex-`MISTRAL_MODEL`), défaut `deepseek/deepseek-v4-pro`, override via la var
>   d'env Convex `OPENROUTER_MODEL`. Clé sous `OPENROUTER_API_KEY`.
> - Scripts (`setup.mjs`, `setup-prod.mjs`, `e2e-smoke.mjs`), `.env.example` et
>   docs (README, KNOWN_ISSUES, TESTING, CLAUDE) alignés sur les nouvelles vars.
>   Identité de l'agent dans le system prompt mise à jour.

## v1.43.0 — 26/06/2026 à 15:30 — Lead SPV (gestion)

Quand vous êtes **lead d'un SPV** (Hectarea, Eben Home), vous ne faites pas que
co-investir : vous **gérez**, et à ce titre vous percevez des **frais de gestion**
et du **carried**. Ce volet gestion a désormais son propre type de deal,
**Lead SPV (gestion)**, distinct du deal d'investissement « Equity via SPV ». Sur
une même société, les deux deals coexistent côte à côte : l'un suit votre invest,
l'autre vos revenus de gérant.

Le deal Lead SPV affiche un panneau dédié : les **paramètres** que vous renseignez
(montant levé, % de frais de gestion, hurdle, % de carried) et, en lecture seule,
le **perçu à date** — la somme des encaissements rattachés au deal. Niveau 1, donc
pas encore de projection ni de ventilation frais/carried : on suit ce qui est
réellement tombé.

> **🔧 Notes techniques**
>
> - Nouvel `instrumentKind` **`lead_spv`** (additif) dans
>   `convex/lib/instruments.ts` + liste du sélecteur dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx`.
> - Nouvel archétype **`management`** et `render: 'custom'` dans
>   `convex/lib/instrumentMapping.ts`. 4 colonnes `deals` neuves (`v.optional`) :
>   `amountRaised` (cents), `managementFeeRate` / `hurdleRate` / `carriedRate`
>   (bps) — schéma + validateur `patch` de `deals.update` + `FIELD_FORMAT`.
> - **Premier vrai panel custom** : registre `CUSTOM_PANELS`
>   (`instrumentKind → composant`) dans `InstrumentBlock.tsx`, branché sur
>   `render === 'custom'` (royalty reste sur son placeholder, faute d'entrée).
>   Nouveau `src/components/deals/LeadSpvPanel.tsx`. `InstrumentBlock` reçoit
>   `received` (somme des flux entrants, déjà calculée page) + `onEdit` (ouvre le
>   dialog d'édition existant). `lead_spv` est listé dans `INSTRUMENT_FIELDS` pour
>   que ce dialog édite ses 4 paramètres — le mode de rendu (custom) et les champs
>   éditables restent orthogonaux.
> - i18n EN/FR (`instrument.lead_spv`, 4 `field.*`, `archetype.management`,
>   `fiche.leadSpv.*`) ; badge `management` réutilise le token `positive`.

## v1.42.0 — 26/06/2026 à 12:30 — Equity via SPV

Les participations détenues **via un SPV** sont désormais reconnues pour ce
qu'elles sont : de l'**equity** sur la société cible, simplement détenue de façon
indirecte. Ce type d'instrument, jusqu'ici présenté comme « Titres SPV » dans la
catégorie des fonds, s'appelle maintenant **« Equity via SPV »** et apparaît dans
la catégorie **Capital**, comme une prise de participation classique.

Sa fiche affiche désormais : date et montant d'investissement, **nom du SPV**,
détention via le SPV, frais de structuration, puis valorisations pre-money et
post-money. La société cible reste rattachée au deal comme pour toute
participation. Les participations « via SPV » déjà saisies conservent toutes
leurs valeurs et s'affichent simplement avec ces champs.

> **🔧 Notes techniques**
>
> - Pas de nouveau `instrumentKind` : `spv_share` (12 deals réels en org `albo`)
>   est **reclassé** `funds_lp → equity` dans `INSTRUMENT_ARCHETYPE`
>   (`convex/lib/instrumentMapping.ts`), render `fields` inchangé. La valeur enum
>   et les données en base ne bougent pas — aucune migration.
> - Nouvelle config `SPV_FIELDS` : `closingDate`, `paidAmount`, `spvName`,
>   `spvOwnershipPct`, `structuringFees`, `preMoneyValuation`,
>   `postMoneyValuation`. `underlyingTarget` **retiré de l'affichage** (la cible
>   passe par `targetCompanyId`) mais conservé en base, en sommeil.
> - 1 seule colonne neuve : `spvName v.optional(v.string())` (`convex/schema.ts`
>   + `dealFields` dans `convex/deals.ts`, éditable) ; `FIELD_FORMAT: 'text'`
>   (`InstrumentBlock.tsx`). `spvOwnershipPct` / `structuringFees` réutilisés tels
>   quels. `viaSpvCompanyId` (référence entité) **non** utilisé : le SPV n'est pas
>   modélisé comme entité.
> - Libellé i18n EN/FR « Equity via SPV » (fiche `participations.json` + vue agent
>   `chat.json`) ; nouveau libellé `field.spvName`. Incohérence assumée et
>   documentée : equity direct → `ownershipPct`, equity via SPV →
>   `spvOwnershipPct` (unification = migration future, hors périmètre).

## v1.41.0 — 26/06/2026 à 11:30 — Fiches dédiées pour les BSA et les obligations convertibles

Les **BSA** et les **obligations convertibles (OC)** ont désormais leur propre
fiche, distincte du SAFE. Jusqu'ici ces trois instruments partageaient la même
liste de champs ; ils sont pourtant économiquement différents.

- Un **BSA** affiche maintenant ses champs propres : date d'attribution, nombre
  de BSA, prix d'acquisition, prix d'exercice, parité, date limite d'exercice,
  puis les titres obtenus et la détention résultante en cas d'exercice.
- Une **OC** affiche les siens : montant et date d'investissement, taux
  d'intérêt, date de maturité, ratio et discount de conversion, puis la
  valorisation à la conversion, les titres obtenus et la détention résultante.
- Le **SAFE** et le **BSA Air** restent ensemble, et le sélecteur de type
  d'instrument côté SAFE ne propose plus que **SAFE / BSA Air**.

Les participations BSA et OC déjà saisies conservent toutes leurs valeurs : elles
s'affichent simplement avec les champs adaptés à leur nature.

> **🔧 Notes techniques**
>
> - Séparation des configs d'archétype dans `convex/lib/instrumentMapping.ts` :
>   `bsa` pointe sur un nouveau `BSA_FIELDS`, `oc` + `convertible_note` sur un
>   nouveau `OC_FIELDS` ; tous deux retirés de `SAFE_FIELDS`. Archétype `equity`
>   et render `fields` inchangés pour les trois.
> - 8 colonnes neuves (toutes `v.optional`, en sommeil) dans `convex/schema.ts`
>   + `convex/deals.ts` `dealFields` : `grantDate`, `warrantsCount`,
>   `warrantPrice`, `strikePrice`, `warrantParity`, `exerciseDeadlineDate`
>   (BSA), `conversionRatio`, `conversionDiscount` (OC). L'OC réutilise
>   `interestRate` + `maturityDate` (bloc debt) et le trio post-conversion
>   `conversionValuation` / `sharesAcquired` / `ownershipPct`.
> - `SAFE_TYPES` garde `oc` (validateur, en sommeil) ; nouveau
>   `SAFE_TYPE_OPTIONS = ['safe','bsa_air']` alimente le select via
>   `ENUM_FIELD_VALUES.safeType`.
> - Front : `FIELD_FORMAT` (`InstrumentBlock.tsx`) étendu des 8 champs ; nouveau
>   format `decimal` (parité / ratio fractionnaires, parseur `decimalToNumber`
>   dans `src/lib/parse.ts`, input `step="any"`). Le BSA s'affiche à plat (pas
>   d'onglets pré/post, faute de marqueur `conversionValuation`) ; l'OC garde
>   les onglets. Libellés i18n EN/FR des 8 champs.

## v1.40.0 — 26/06/2026 à 09:57 — Saisir vos flux de trésorerie ponctuels

Le prévisionnel de trésorerie gagne une section **« Échéances ponctuelles »**,
juste sous les règles récurrentes dans l'onglet **Aperçu** de la page Cash.
Vous pouvez désormais **lister, créer, modifier et annuler** un flux unique —
appel de capital, distribution, impôt one-shot, cession — directement depuis
l'écran, sans passer par l'assistant. Les échéances sont triées par date, avec
montant signé (−/+), un niveau de **confiance** (confirmé / attendu / probable)
et un **statut** (à venir / réalisé / annulé). Annuler une échéance la retire
du solde projeté sans l'effacer : l'historique reste intact, et la **courbe se
met à jour immédiatement**.

> **🔧 Notes techniques**
>
> - Nouvelle query publique `convex/forecasts.ts` `listEntries({ orgId,
>   status? })` : `requireOrgMember`, index `by_org_and_date` (tri date
>   ascendant gratuit), filtre `ruleId == null` (seules les one-shot pures),
>   renvoie les Doc bruts. Calquée sur `agentToolsForecasts.listEntriesInternal`
>   mais sans filtre date ni limite (V1).
> - Front : `ForecastEntriesSection` + `EntryDialog` dans
>   `src/components/cash/ForecastSection.tsx`, montés sous `ForecastRulesSection`
>   dans `cash.index.tsx`. `EntryDialog` calqué sur `RuleDialog` (création →
>   `createManualEntry`, édition → `updateEntry`, annulation → `cancelEntry` via
>   Dialog de confirmation), sans champ fréquence/jour. Lignes `pending`
>   éditables/annulables ; `realized`/`cancelled` atténuées et figées. Aucun
>   appel à `expandRules` : la réactivité Convex rafraîchit table +
>   `getForecastBalance`.
> - i18n `cash:forecast.entries.*` (en/fr), réutilise `cash:forecast.rules.in/out`
>   et `common:actions.*`.
> - Limitation V1 assumée : une occurrence de règle passée en `overridden`
>   (faisable uniquement via l'agent IA aujourd'hui) n'apparaît ni dans cette
>   table (`ruleId == null`) ni dans la table des règles — seulement dans la
>   courbe. Cf. `KNOWN_ISSUES.md` « Cash flow forecast ».

## v1.39.1 — 26/06/2026 à 09:57 — Ménage d'outillage interne

Retrait de deux scripts de diagnostic temporaires qui avaient servi à
cartographier les entités orphelines avant leur réparation manuelle. Ils ont
fait leur travail et n'avaient plus de raison d'exister. Aucun changement
visible côté application.

> **🔧 Notes techniques**
>
> - Suppression de `convex/migrations/diagnoseAlboUmbrellas.ts` et
>   `convex/migrations/diagnoseDeadEntities.ts` — deux `internalQuery dryRun`
>   en lecture seule, invoqués manuellement via `convex run`, créés pour
>   l'enquête sur les entités orphelines (réparation des chapeaux Sezame /
>   Parallel sur `albo`, repérage des entités sans deal). Diagnostics
>   ponctuels, jamais référencés par le code (front, crons, tests) ni par un
>   export — d'où une suppression purement chirurgicale.
> - Une fois mergé, ces fonctions disparaissent de la prod au prochain build
>   Vercel (`build:vercel` → `convex deploy`) ; elles ne s'affichent plus dans
>   la liste `convex run`.

## v1.39.0 — 26/06/2026 à 09:46 — Retrouver les entités sans deal

Sur la page **Participations**, les entités qui n'ont **aucun deal** étaient
jusqu'ici invisibles, puisque la liste se construit à partir des deals. Pour les
retrouver (les compléter, les archiver ou les supprimer), il fallait passer par
des liens bruts — pas pratique. Désormais, **s'il existe au moins une entité sans
deal**, un petit lien discret apparaît en bas de la liste : « N entités sans
deal ». Un clic le **déroule sur place** (comme la section « Archivées ») et
liste chaque entité avec un accès direct à sa fiche. S'il n'y en a aucune, rien
ne s'affiche — la page reste propre. Les entités juridiques du groupe (SCI,
holdings…) n'apparaissent jamais dans cette liste.

> **🔧 Notes techniques**
>
> - Ajout 100 % front + lecture dans
>   `src/routes/app/$orgSlug/participations.index.tsx` : nouveau composant
>   `WithoutDealSection`, calqué sur `ArchivedSection` (toggle `useState`,
>   chevron, rendu `null` si liste vide).
> - Dérivation côté client : `companies.list({ kind: 'portfolio' })` (déjà
>   filtré non-archivé + exclut nativement les `group_*` via l'index
>   `by_org_kind`) croisé avec l'ensemble des IDs référencés par
>   `api.deals.list` (`targetCompanyId` / `investorCompanyId` /
>   `viaSpvCompanyId`). Matching **par `_id`**, jamais par nom. Aucune nouvelle
>   query, mutation, route ni schéma — `deals` est déjà chargé par la page.
> - Ouverture de la fiche via le même `<Link>` que les lignes existantes
>   (`/app/$orgSlug/participations/$companyId`). Libellés i18n
>   `participations:withoutDeal.sectionTitle_one/_other` (EN/FR).

## v1.38.0 — 25/06/2026 à 23:20 — Suppression définitive d'une entité

Depuis la fiche d'une entité, un nouveau bouton **Supprimer** permet de la
retirer **définitivement** — utile pour faire le ménage des coquilles vides
créées par erreur. C'est différent de l'**archivage** (qui masque l'entité mais
la garde et reste réversible) : ici, l'entité disparaît pour de bon, l'action
est **irréversible**. Deux garde-fous protègent des erreurs : on ne peut pas
supprimer une **entité juridique** du groupe (SCI, holding…), ni une entité
encore **reliée** à des deals, mouvements ou autres éléments — un message
l'explique alors et propose de tout détacher d'abord. En cas de doute,
l'archivage reste recommandé.

> **🔧 Notes techniques**
>
> - Nouvelle mutation `convex/companies.ts` `remove({ id })`, calquée sur
>   `deals.remove` : `requireOrgMember`, refus des `kind` `group_*`
>   (`ConvexError('cannot_delete_group_entity')`), réutilisation du helper
>   existant `listBlockingRefs` (refus `company_has_references` si une référence
>   subsiste), puis `ctx.db.delete`. Hard delete réel, distinct de `archive`
>   (soft delete `archivedAt`) — schéma et archivage inchangés.
> - `listBlockingRefs` est déjà exhaustif sur les 8 champs du schéma qui
>   pointent vers une `company` (deals target/investor/viaSpv, companyRelations
>   parent/child, kpiSnapshots, bankAccounts, documents). `equityPositions` /
>   `intercompanyLoans` référencent l'**org**, jamais une `company` : rien à y
>   vérifier (commenté dans le code).
> - UI dans `src/routes/app/$orgSlug/participations.$companyId.tsx` : item
>   destructif « Supprimer » dans le menu de la fiche + `Dialog` de
>   confirmation calqué sur l'archivage (bouton désactivé si `group_*` ou si
>   l'entité porte des deals, message contextuel ; `err.data` ConvexError mappé
>   en i18n). Succès → toast + redirection vers la liste.
> - i18n EN/FR : namespace `deleteCompany` dans `src/locales/{en,fr}/participations.json`.

## v1.37.0 — 25/06/2026 à 23:15 — Nouveautés : affichage par paliers

La page « Nouveautés » n'affiche plus tout l'historique d'un coup : seules les
**10 dernières** mises à jour sont visibles à l'ouverture, et un bouton « Voir
les nouveautés plus anciennes » en déroule 10 de plus à chaque clic. L'intro en
haut et le petit lexique en bas restent toujours là. La page reste légère et
rapide à mesure que l'historique s'allonge (une entrée par release), sans rien
perdre du contenu.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/changelog.tsx` : `parseChangelog()` (pur, exécuté
>   une fois au chargement du module) découpe l'import `?raw` en
>   `header` / `entries[]` / `footer`. Les entrées sont les sections `## …`
>   dont le titre porte le séparateur ` — ` (couvre `## vX.Y.Z — …` **et** les
>   4 entrées historiques `## Mois AAAA — …`) ; le premier titre sans ` — `
>   (le « Petit lexique ») démarre le footer, toujours épinglé.
> - Rendu en deux blocs `ReactMarkdown` (entête + N entrées visibles, puis
>   footer) partageant le même `markdownComponents` extrait au niveau module ;
>   `visibleCount` (`useState`, pas de 10) borne le slice — le coût de rendu
>   suit le nombre d'entrées affichées, plus l'historique complet.
> - Libellé bouton i18n `nav:changelogPage.showOlder` (FR/EN, interpolation
>   `{{remaining}}` — pas `count` pour éviter la pluralisation i18next).

## v1.36.0 — 25/06/2026 à 23:14 — Filtres et tri sur la liste Entreprises

La page **Entreprises** gagne des filtres et de nouveaux tris pour retrouver
plus vite une participation :

- **Filtres** (multi-sélection, cumulables avec la recherche) : par **type
  d'instrument**, par **statut** et par **secteur**. Un filtre n'apparaît que
  s'il y a au moins deux valeurs à distinguer. Un bouton **« Réinitialiser »**
  efface tous les filtres actifs.
- **Tri par date d'investissement** : une nouvelle colonne **« Investi le »**
  affiche la date du premier investissement dans la société et permet de
  classer du plus récent au plus ancien (et inversement).
- **Tri par nombre de deals** : la colonne **Deals** est désormais cliquable
  pour trier les sociétés par nombre d'investissements.
- La colonne **« Engagé »** (montant engagé) a été **retirée** de la vue
  liste ; seul le **montant versé** y reste affiché. Le montant engagé reste
  visible sur la fiche de chaque deal et dans l'export CSV.

> **🔧 Notes techniques**
>
> - Tout est porté par `src/components/participations/ParticipationsTable.tsx`
>   (composant partagé par la vue par-org et la vue agrégée `/app/all`).
> - Nouveau composant interne `FacetFilter` (dropdown + `DropdownMenuCheckboxItem`,
>   menu maintenu ouvert via `onSelect preventDefault`). Trois facettes
>   (`instrument`, `status`, `sector`) dérivées du jeu de deals complet et
>   localisées ; rendues seulement si ≥ 2 valeurs distinctes.
> - Les filtres s'appliquent au **niveau deal** dans le `useMemo` `filtered`
>   (avant regroupement par société), composables avec la recherche. La
>   pagination se réinitialise via une `filterKey` ajoutée à la clé de reset.
> - `SortKey` : `committed` retiré, `invested` et `deals` ajoutés. Le groupe
>   société porte désormais `signedDate` (= **min** des dates de deals = date
>   d'entrée) à la place de `committed`. Colonnes `committed` retirées du
>   header et de `CompanyRows` ; colonne `invested` (via `fmtDate`) ajoutée.
> - L'export CSV et la `DealsList` de la fiche conservent le montant engagé
>   (`col.committed` toujours utilisée par l'export).
> - i18n : `participations.col.invested` + bloc `participations.filters.*`
>   (EN/FR).

## v1.35.0 — 25/06/2026 à 22:44 — Notes éditables depuis la fiche deal

Les **notes** d'un deal se modifient désormais directement depuis sa fiche,
sans passer par le dialog « Modifier » :

- La section **Notes** affiche un petit crayon ; un clic ouvre une zone de
  saisie multi-lignes avec **Enregistrer** / **Annuler**.
- La section reste **toujours visible**, même quand le deal n'a pas encore de
  note (« Aucune note pour le moment. »), ce qui permet d'en **ajouter** une.
- Vider entièrement le champ puis enregistrer **efface** la note.
- Une note saisie à la main est protégée d'un éventuel ré-import (comme les
  autres champs édités manuellement).

> **🔧 Notes techniques**
>
> - Nouveau composant `NotesSection` dans
>   `src/routes/app/$orgSlug/deals.$dealId.tsx` : édition inline (état local
>   `editing`/`value`/`pending`), `Textarea` shadcn, toggle crayon.
> - Sauvegarde via `api.deals.update` avec un **patch partiel** `{ notes }`
>   (la mutation acceptait déjà le champ et marque `notes` dans
>   `manuallyEditedFields`). Diff sur la valeur trimmée → no-op si inchangé,
>   chaîne vide → note effacée (l'affichage retombe sur l'état vide).
> - Bloc lecture-seule précédent remplacé ; clés i18n
>   `participations:notes.empty` / `notes.placeholder` (EN/FR).

## v1.34.0 — 25/06/2026 à 23:10 — Avertissements de suppression rangés dans la confirmation

Les avertissements qui empêchent d'archiver une entité ou de supprimer un deal
ne s'affichent plus en permanence sur la fiche. Désormais, l'action reste
accessible dans le menu : c'est en cliquant sur **Archiver** (fiche entité) ou
**Supprimer** (fiche deal) que la fenêtre de confirmation explique, le cas
échéant, pourquoi l'opération est bloquée — « Cette entité porte N deal(s)… »
ou « Ce deal a N mouvement(s) rapproché(s)… » — et désactive le bouton de
validation tant que le blocage subsiste. La fiche reste ainsi dégagée tant
qu'on ne cherche pas réellement à supprimer.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` et
>   `src/routes/app/$orgSlug/deals.$dealId.tsx` : suppression du bandeau inline
>   `archive.blocked` / `deleteDeal.blocked` rendu en haut de page.
> - L'entrée de menu destructive (`Archiver` / `Supprimer`) n'est plus
>   `disabled` quand `dealCount > 0` / `linkedCount > 0` : le dialog s'ouvre.
> - Le message bloquant est déplacé dans le `DialogContent` (ternaire vs
>   `confirmBody`) et le bouton de validation porte désormais
>   `disabled={…|| dealCount > 0}` / `disabled={…|| linkedCount > 0}`. Garde
>   serveur (`company_has_references`, `deal_has_transactions`) inchangée.
> - `TESTING.md` : lignes AR1 et DD2 mises à jour.
## v1.33.1 — 25/06/2026 à 22:32 — Diagnostic : entités portfolio sans deal (lecture seule)

Nouveau diagnostic interne, en lecture seule, qui mesure sur les deux véhicules
(Albo et Calte) les entités du portefeuille qu'aucun investissement ne référence
— les candidates potentielles à un futur ménage. Il liste, pour chacune, son
identité (SIREN, forme juridique, date de création…) et sa provenance, signale
les doublons de noms exacts et les copies portant le nom d'une entité juridique
protégée. Aucun changement visible, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseDeadEntities.ts` : nouvel `internalQuery dryRun`
>   (lecture seule, modèle `diagnoseAlboUmbrellas`). Pour chaque org (`albo`,
>   `calte`) : résumé chiffré (total entités archivées comprises, `group_*`
>   protégées, portfolio sans deal, archivées), liste détaillée des entités
>   portfolio sans deal (identité + `identityFilled` + provenance `airtableId`/
>   `attioCompanyId` + flag heuristique `isLikelyShell`), et rapport de doublons
>   (groupes de noms exacts avec présence de deals par ID, portfolio dont le nom
>   matche un `group_*`).
> - Matching deal → entité strictement **par ID** (`targetCompanyId`,
>   `investorCompanyId`, `viaSpvCompanyId`) pour ne pas être trompé par les
>   doublons de noms. Les `group_*` ne sont jamais candidates, listées à part.
> - `pnpm exec convex run --prod migrations/diagnoseDeadEntities:dryRun`.

---

## v1.33.0 — 25/06/2026 à 11:38 — Secteur éditable depuis la fiche entité

Le **secteur** d'une entité du portefeuille se modifie désormais directement
depuis l'application :

- Dans le dialog **« Modifier la société »**, un nouveau champ **« Secteur »**
  propose un sélecteur recherchable avec une liste de secteurs courants (SaaS,
  Fintech, Santé, Climat, Immobilier, Fonds, Crypto…).
- Vous pouvez **choisir un secteur de la liste** ou **saisir votre propre
  valeur** si aucune ne convient (« Créer … »).
- Pour retirer le secteur, rouvrez le sélecteur et recliquez sur le secteur
  déjà sélectionné.
- Le secteur reste visible dans le bloc Identité de la fiche et la recherche
  des participations le prend en compte (libellé traduit ou valeur libre).

> **🔧 Notes techniques**
>
> - Liste canonique des secteurs dans `src/lib/sectors.ts` (`SECTOR_SLUGS`,
>   slugs stables) ; libellés via i18n `participations:sectors.<slug>` (EN/FR).
> - Nouveau composant `src/components/companies/SectorCombobox.tsx` : combobox
>   créatif (Popover + `Command` cmdk) calqué sur `TargetCombobox`. Un secteur
>   prédéfini est stocké comme **slug**, une saisie libre **verbatim** — le
>   champ `companies.sector` reste `v.optional(v.string())`, donc **aucune
>   migration**. Toggle pour vider (reclic sur le secteur actif → `''`).
> - Câblage dans `EditCompanyDialog` (`participations.$companyId.tsx`) : état
>   `sector`, champ après le domaine, `sector` ajouté au `patch` de
>   `companies.update` (qui l'acceptait déjà). Affichage fiche via
>   `t('sectors.<v>', { defaultValue: v })` (fallback valeur brute).
> - Recherche `ParticipationsTable` enrichie : slug brut **+** libellé traduit
>   ajoutés au haystack (même pattern que l'instrument).

## v1.32.0 — 25/06/2026 à 10:40 — Actions des pages regroupées dans un menu

Les actions de modification de chaque page sont désormais regroupées derrière
un unique bouton menu (icône « … ») aligné à droite du titre, au lieu d'occuper
l'en-tête sous forme de boutons bien visibles :

- **Entreprises** : « Nouvelle entité » et « Exporter CSV » passent dans le menu.
- **Fiche d'une entité** : « Modifier », « Nouveau deal » et « Archiver »
  passent dans le menu (Archiver en rouge).
- **Fiche d'un deal** : « Modifier » et « Supprimer » passent dans le menu
  (Supprimer en rouge).

Les listes et les fiches restent ainsi au premier plan, l'écran est plus épuré.

> **🔧 Notes techniques**
>
> - Nouveau libellé i18n `common:actions.menu` (nom accessible du déclencheur).
> - `ParticipationsTable` accepte une prop `exportRef` : quand elle est fournie,
>   le bouton CSV de la barre d'outils est masqué et `handleExport` est exposé
>   via la ref, pour que le menu d'en-tête déclenche l'export en conservant le
>   filtre de recherche/tri. La vue cross-org `/app/all` n'a pas de menu et garde
>   son bouton d'export dans la barre d'outils.
> - `participations.index.tsx`, `participations.$companyId.tsx` et
>   `deals.$dealId.tsx` : les boutons d'en-tête sont remplacés par un
>   `DropdownMenu` (déclencheur `Button variant="outline" size="icon-sm"` +
>   `MoreHorizontal`, `align="end"`). Items destructifs (`Archiver`, `Supprimer`)
>   en `variant="destructive"`, désactivés quand une référence bloque l'action
>   (deals rattachés / transactions liées).

## v1.31.0 — 25/06/2026 à 11:01 — Fiche entreprise : focus identité + reporting

La fiche d'une entreprise est allégée et recentrée sur l'essentiel :

- Le bloc « Identité » affiche désormais la **détention globale (%)** et le
  **nombre d'actions consolidé** (cumul des titres acquis sur tous les deals
  de la société).
- La section « Reportings & documents » s'appelle simplement **« Reporting »**
  (l'ajout de documents reste inchangé).
- La section **« KPIs » est retirée** de la fiche.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/participations.$companyId.tsx` : extraction d'un
>   mémo `heldShares` (Σ `sharesAcquired` des deals) réutilisé par le calcul
>   `ownership` et par le nouveau `sharesConsolidated`. Deux `IdentityField`
>   dans le bloc identité — `info.ownershipGlobal` (ex-`info.ownership`,
>   conservé pour l'en-tête) et `info.sharesConsolidated`.
> - Le rendu `<KpisSection>` et son import sont retirés de la fiche, mais le
>   composant `src/components/companies/KpisSection.tsx` et le bloc i18n
>   `participations:kpis` (fr/en) sont **conservés** (non câblés) pour un
>   éventuel ré-affichage. Le backend KPIs (`convex/kpis.ts`, outil agent
>   `createKpiSnapshot`) reste intact — seul l'affichage front est retiré.
> - i18n : `reportings.title` → « Reporting » (fr/en), ajout de
>   `info.ownershipGlobal` / `info.sharesConsolidated` (fr/en).

## v1.30.0 — 25/06/2026 à 10:31 — Fiche deal : entité liée entièrement cliquable

Sur la fiche d'un deal, le bloc « Entité liée » est désormais cliquable sur
toute sa surface (et plus seulement sur la flèche au bout de la ligne) pour
ouvrir la fiche de l'entité investie.

> **🔧 Notes techniques**
>
> - `src/routes/app/$orgSlug/deals.$dealId.tsx`, section « Entité liée » :
>   la ligne enveloppe désormais tout le `CardContent` dans un seul `Link`
>   (classe `group block`) vers `/app/$orgSlug/participations/$companyId`,
>   au lieu de deux liens distincts (nom + flèche) qui auraient été imbriqués.
>   Le nom redevient un `span` avec `group-hover:underline` et la flèche
>   `ArrowRight` réagit au survol via `group-hover`. La branche sans
>   `deal.target` reste un `CardContent` non cliquable.

## v1.29.1 — 25/06/2026 à 10:08 — Fiche entreprise : nom et instrument du deal séparés

Sur la fiche d'une entreprise, la ligne d'un deal affichait son nom personnalisé
collé à son type d'instrument (par ex. « Sezame immo 6 · Titres SPV »).
Désormais deux champs distincts : un champ **Nom** (le nom personnalisé du deal,
« — » s'il n'y en a pas) et un champ **Instrument** (le type seul). L'en-tête de
la fiche du deal, qui n'affichait déjà que le nom, est inchangé.

> **🔧 Notes techniques**
>
> - `src/components/participations/ParticipationsTable.tsx` (`DealsList`) :
>   le champ unique `deal.instrument` rendait `dealTitle(dl)` (nom + instrument
>   combinés). Scindé en deux `Field` : `deal.name` (`dl.name ?? '—'`) et
>   `deal.instrument` (libellé d'instrument seul via `t('instrument.<kind>')`).
>   `useDealTitle` (titre combiné) reste utilisé tel quel par les comboboxes de
>   pointage et le fil d'Ariane — non touché.
> - Nouvelle clé i18n `deal.name` (`Nom` / `Name`) dans
>   `src/locales/{fr,en}/participations.json`.

## v1.29.0 — 25/06/2026 à 10:00 — Domaine de société éditable depuis la fiche

Le domaine d'une société se modifie maintenant directement depuis la fiche, via
le bouton « Modifier » (à côté du nom et du SIREN). C'est ce domaine qui
alimente le logo affiché en en-tête de fiche et dans les listes : renseignez
par exemple `stripe.com` et le logo apparaît automatiquement ; videz le champ
et l'icône de secours reprend sa place.

> **🔧 Notes techniques**
>
> - `companies.update` acceptait déjà `domain` ; ajout d'une normalisation
>   serveur (`convex/companies.ts`) : domaine `trim()`, chaîne vide → champ
>   effacé (`undefined`), calquée sur le traitement du SIREN.
> - `EditCompanyDialog` (`src/routes/app/$orgSlug/participations.$companyId.tsx`) :
>   nouvel état `domain` + champ de saisie sous le SIREN, envoyé dans le `patch`.
> - i18n : clés `edit.domainLabel` / `edit.domainPlaceholder` (en + fr),
>   `edit.companyDescription` mise à jour.
> - Aucun stockage de logo (cf. `KNOWN_ISSUES.md` « Logos d'entreprises ») :
>   le domaine continue d'être hotlinké à la volée par `CompanyLogo`.
## v1.28.3 — 24/06/2026 à 22:10 — Diagnostic : détail d'identité des entités cibles (lecture seule)

Complément au diagnostic interne : un relevé en lecture seule du détail complet
(nom, SIREN, forme juridique, date de création…) des entités cibles, pour
distinguer une entité renseignée d'une coquille créée par migration. Aucun
changement visible, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseAlboUmbrellas.ts` : nouvel `internalQuery
>   entityDetails` (lecture seule). Pour chaque umbrella albo + ses entités
>   cibles candidates, renvoie le doc complet via `entityView` (tous les champs
>   d'identité + `_creationTime` + `archivedAt`) avec un bloc `identityFilled`
>   indiquant quels champs sont réellement remplis (coquille vs entité complète).
>   `pnpm exec convex run --prod migrations/diagnoseAlboUmbrellas:entityDetails`.

---

## v1.28.2 — 24/06/2026 à 21:55 — Diagnostic interne des entités chapeau (lecture seule)

Ajout d'un diagnostic interne, en lecture seule, pour mesurer les entités
« chapeau » à nettoyer (deals encore rattachés à « Sezame » / « Parallel
Invest » archivées, et homonymes côté Calte). Aucun changement visible dans
l'application, aucune donnée modifiée.

> **🔧 Notes techniques**
>
> - `convex/migrations/diagnoseAlboUmbrellas.ts` : `internalQuery dryRun`
>   (les queries Convex ne peuvent pas écrire → `convex run --prod … :dryRun`
>   ne mute rien). Pour chaque umbrella albo (ancrée par `attioCompanyId`) :
>   statut archivé, deals encore rattachés (`by_org_target`) avec
>   `name`/`notes`/`attioDealId`/montant/tx pour le mapping manuel, entités
>   cibles candidates (existence + archivé), refs bloquantes (mirror de
>   `companies.listBlockingRefs`) et `archivableOnceDealsReassigned`.
> - Calte : doublons de nom normalisé (casse/accents/espaces) + collisions de
>   préfixe (`SEZAME` vs `SEZAME IMMO 1`). Liste seule, aucun plan d'action.

---

## v1.28.1 — 24/06/2026 à 21:50 — Procédure interne en cas de dérive des skills

Ajout d'une consigne interne pour l'assistant : pas d'impact visible dans
l'application.

> **🔧 Notes techniques**
>
> - `CLAUDE.md` § « Skills (READ BEFORE CODING) » : nouvelle procédure à suivre
>   quand le job CI `skills-drift` est rouge avant un merge — expliquer
>   l'erreur (`pnpm run sync:skills:check`), récupérer la maj sur une branche
>   dédiée (`pnpm run sync:skills:update`), expliquer le `git diff`
>   (`.agents/skills/*/SKILL.md` + `skills-lock.json`) et demander l'accord
>   avant de merger, au lieu de contourner ou `--update` à l'aveugle.

## v1.28.0 — 24/06/2026 à 20:30 — Transactions : voir le deal rattaché en un coup d'œil

Dans la Trésorerie, une transaction déjà pointée montrait son statut (« Pointé »)
sans dire **à quoi** elle était rattachée. C'est corrigé.

- Sous le statut, chaque transaction pointée affiche désormais **le deal**
  rattaché (ou l'entité de passif — capital, compte courant), en **lien
  cliquable** : un clic ouvre la fiche du deal (ou la page Passif).
- Même lien dans le détail d'une transaction (volet latéral) et dans la colonne
  « Deal » de la fiche d'un compte.

> **🔧 Notes techniques**
>
> - Résolution **100 % front**, sans nouveau read serveur : `listLedger` renvoie
>   déjà `allocation = { kind, targetId }`, et `PointageTable` charge déjà
>   `deals` (`deals.listOptions`) + `liabilityOptions` pour ses comboboxes. On en
>   dérive deux maps (`dealsById`, `liabilityByTarget`) pour le libellé.
> - Nouveau composant `MatchLink` (`src/components/pointage/PointageTable.tsx`) :
>   deal → `/app/$orgSlug/deals/$dealId`, equity/loan → `/app/$orgSlug/passif`
>   (pas de fiche par-entité). `stopPropagation` pour ne pas ouvrir le sheet au
>   clic. `orgSlug` threadé via `TransactionsLedger` ← `cash.index.tsx` ; absent
>   = texte brut (vue agrégée).
> - Rendu sous le badge dans la cellule **Statut** ; ligne « Rattaché à » ajoutée
>   au `TransactionSheet` (prop `match`, clé i18n `pointage:detail.matchedTo`).
> - Fiche compte (`cash.$accountId.tsx`) : colonne « Deal » rendue cliquable
>   (le serveur renvoyait déjà `tx.deal`). Reste deal-only par design.
## v1.27.2 — 24/06/2026 à 20:20 — Nom de la société dans le fil d'Ariane

Sur la fiche d'une entreprise, le dernier élément du fil d'Ariane (en haut de
page) affiche désormais le **nom de la société** au lieu de son identifiant
technique. Le fil se lit « Organisation › Entreprises › ‹Nom de la société› ».
Aucun identifiant brut n'apparaît plus, y compris pendant le chargement ou si
la page pointe vers une société introuvable (le fil s'arrête alors à
« Entreprises »).

> **🔧 Notes techniques**
>
> - Défaut d'affichage pur, front only. `buildCompanyCrumbs` ajouté dans
>   `src/components/app-shell/AppHeader.tsx`, calqué sur `buildDealCrumbs`
>   (déjà en place pour la route deal).
> - La company est lue via la query existante `api.companies.getById`
>   (réutilisée, pas de nouvelle query) au pattern **non-throwing**
>   `useQuery(convexQuery(...))` + `enabled: companyId != null` : un
>   `companyId` invalide dégrade le breadcrumb au lieu de jeter vers
>   l'`errorComponent` parent et de casser le header. Leaf = `company.name`
>   (aligné sur le H1), non cliquable.
> - Libellé « Entreprises » inchangé (clé i18n existante
>   `nav:appShell.breadcrumb.participations`). Route deal et autres routes
>   strictement inchangées.

---

## v1.27.1 — 24/06/2026 à 20:15 — Mise à jour d'une skill agent (interne)

Mise à jour interne d'une fiche de bonnes pratiques destinée aux assistants
IA qui travaillent sur le projet. Aucun impact sur l'application ni sur vos
données.

> **🔧 Notes techniques**
>
> - `skills/convex-performance-audit` re-vendorisée au tip upstream courant
>   (`get-convex/agent-skills@main`, `pinnedRef` `7a6fcc6` → `ec1e6ba`) — le
>   seul skill ayant dérivé. Changement de contenu purement cosmétique (un
>   renvoi « `skills/convex-migration-helper/SKILL.md` » devient « le skill
>   `convex-migration-helper` ») ; aucune guidance comportementale modifiée,
>   donc aucun override projet à ajuster. `pnpm run sync:skills:check` repasse
>   au vert.
> - Bump fait à la main (résolution du tip via un appel unauth à
>   `api.github.com`, puis `pnpm run sync:skills`) car `sync:skills:update`
>   échoue dans le sandbox cloud — nouvelle section `KNOWN_ISSUES.md`
>   « `sync:skills:update` échoue dans le sandbox cloud ».

---

## v1.27.0 — 24/06/2026 à 20:10 — Réaffecter un deal & archiver une entité

Deux nouveautés pour ranger le portefeuille quand un deal a été créé sous la
mauvaise société :

- **Réaffecter un deal** : depuis la page d'un deal, **Modifier** propose
  désormais un sélecteur d'**entité cible**. On déplace le deal vers la bonne
  entreprise du portefeuille ; ses transactions rapprochées et ses valorisations
  **suivent** automatiquement (le rapprochement reste intact).
- **Archiver / restaurer une entité** : une entreprise du portefeuille peut être
  **archivée** (masquée des listes, de façon réversible) depuis sa fiche. Par
  sécurité, l'archivage est **refusé** tant que l'entité est encore reliée à
  des deals, des relations, des KPI, des comptes bancaires ou des documents —
  un message indique alors quoi traiter d'abord. Les entités archivées se
  retrouvent (et se **restaurent**) via une section dédiée en bas de la liste
  des entreprises.

> **🔧 Notes techniques**
>
> - **Réaffectation** : aucune mutation créée — `deals.update`
>   (`convex/deals.ts`) accepte déjà `targetCompanyId` dans le `patch` avec le
>   garde-fou same-org (`assertSameOrg` / `target_wrong_org`). Front : nouveau
>   combobox local `CompanyCombobox` (Popover + Command, calqué sur
>   `DealCombobox`) dans `EditDealDialog` (`deals.$dealId.tsx`), alimenté par
>   `companies.list { kind: 'portfolio' }` (déjà filtré non-archivé) ; ajout de
>   `targetCompanyId` au patch diff de la nouvelle structure d'édition.
> - **Archivage** : `companies.archive` / `companies.restore` /
>   `companies.listArchived` (`convex/companies.ts`). `archive` pose
>   `archivedAt = Date.now()` après le garde-fou `listBlockingRefs` (deals
>   target + investisseur + viaSpv, `companyRelations` parent/enfant,
>   `kpiSnapshots`, `bankAccounts`, `documents`) → `ConvexError('company_has_references')`.
>   `restore` efface `archivedAt` (`patch` avec `undefined`). Les deux sont
>   idempotents. Pas de hard delete.
> - Front : bouton **Archiver** + dialog de confirmation sur
>   `participations.$companyId.tsx` (calqué sur la suppression de deal,
>   désactivé si des deals visibles ciblent l'entité) ; section repliable
>   `ArchivedSection` + **Restaurer** sur `participations.index.tsx`.
> - i18n EN/FR : bloc `archive.*` + clés `edit.target*` du namespace
>   `participations`.

---

## v1.26.0 — 24/06/2026 à 19:30 — Fil d'Ariane de la fiche deal

Sur la **fiche d'un deal**, le fil d'Ariane en haut de page indique désormais
le chemin complet et lisible : **Organisation › Entreprises › ‹société› ›
‹deal›**. « Entreprises » et le nom de la société sont cliquables (retour à la
liste ou à la fiche société), et le dernier élément reprend le nom du deal.
Fini l'identifiant technique illisible et le maillon « Deals » mort qui
s'affichaient auparavant. Un deal sans société rattachée affiche simplement
**Organisation › Entreprises › ‹deal›**.

> **🔧 Notes techniques**
>
> - `src/components/app-shell/AppHeader.tsx` : nouveau `buildDealCrumbs`
>   dédié à la route `/app/$orgSlug/deals/$dealId` (le `buildCrumbs` générique
>   produisait un crumb « Deals » avec `href` vers une route inexistante + l'id
>   Convex brut en feuille). Le libellé entreprise **réutilise** la clé i18n
>   existante `nav:appShell.breadcrumb.participations` (aucune nouvelle clé) ;
>   la feuille reprend `useDealTitle({ withInstrument: false })`.
> - `dealId` lu via `useParams({ strict: false })` ; deal chargé via
>   `useQuery(convexQuery(api.deals.getById, …))` (et non `useConvexQuery`) :
>   ce pattern **ne jette pas** sur erreur, donc un `dealId` invalide ne casse
>   pas le header partagé via la boundary de la route parente. Query `enabled`
>   uniquement sur la route deal.
> - États dégradés sûrs : pendant le chargement / not-found (`deal` undefined),
>   le fil s'arrête à « Entreprises » ; `target` null → crumb société omis.
>   **Jamais** d'id brut ni de lien cassé, dans aucun état.
> - `TESTING.md` : nouvelle vérif SH14 (breadcrumb fiche deal, EN/FR + états
>   dégradés). Hors scope (follow-up) : l'id brut en feuille de la fiche
>   société `/participations/$companyId`.

## v1.25.0 — 24/06/2026 à 18:55 — « Participations » devient « Entreprises »

Le terme **« Participations »** est renommé **« Entreprises »** (et
**« Companies »** en anglais) partout dans l'interface : l'entrée du menu
latéral, le fil d'Ariane, l'indicateur du tableau de bord, le titre de la
page liste et celui de la fiche société. Rien d'autre ne change — les pages,
les adresses et vos données restent identiques.

> **🔧 Notes techniques**
>
> - Renommage **cosmétique** limité aux valeurs de strings i18n (EN →
>   « Companies », FR → « Entreprises ») : `src/locales/{en,fr}/nav.json`
>   (`appShell.breadcrumb.participations`, `items.participations`),
>   `dashboard.json` (`kpi.participations`, `kpi.deployedHint_one/other`),
>   `participations.json` (`metaTitle`, `metaTitleAll`, `metaTitleDetail` en
>   FR, `title`, `back` en FR, `empty`, `search.noResults`). Les libellés EN
>   `metaTitleDetail`/`back` étaient déjà migrés (« Investment » / « ←
>   Investments »), non touchés.
> - Aucune clé JSON, route, namespace i18n, composant ni code Convex modifié :
>   le namespace `participations`, les chemins `/participations*` et la table
>   restent inchangés ; `{{count}}` et les suffixes de phrases préservés.
> - `TESTING.md` : libellés rafraîchis dans la section App shell (SH1/SH4/SH5)
>   + nouvelle vérif SH13 (nav/breadcrumb/KPI/liste/fiche, EN et FR).

## v1.24.0 — 24/06/2026 à 18:14 — Participations : clic sur une ligne ouvre la fiche

Dans les **Participations**, cliquer **n'importe où sur une ligne** ouvre
désormais directement la **fiche de la société** — où ses deals sont listés.
Le dépliage de la ligne (chevron) qui affichait les deals sous la table est
retiré : un clic vous emmène droit à la fiche, et le bouton « Ouvrir la fiche »
reste disponible. La recherche, le tri, la pagination et l'export CSV ne
changent pas.

> **🔧 Notes techniques**
>
> - Front pur, dans `src/components/participations/ParticipationsTable.tsx` :
>   retrait de l'état d'expansion (`expanded`/`toggle`), du chevron et de la
>   ligne `DealsList` inline ; `CompanyRows` n'a plus les props
>   `isOpen`/`onToggle`/`colSpan`.
> - Le clic ligne câble `useNavigate` vers
>   `/app/$orgSlug/participations/$companyId`, gardé par `slug` (la vue agrégée
>   `/app/all` dérive l'org de chaque deal ; sans slug la ligne n'est pas
>   cliquable). Le bouton « Ouvrir la fiche » et son `stopPropagation` sont
>   conservés ; les deals restent atteignables via la fiche entité (qui liste
>   déjà `DealsList`).

## v1.23.0 — 24/06/2026 à 17:11 — Participations : retour à une liste simple

Les **Participations** reviennent à une présentation simple : **une ligne par
société**, dépliable vers ses deals. Le regroupement de plusieurs sociétés sous
un même « groupe » (badges *groupe*/*sponsor*, bouton « Voir le groupe » et page
de consolidation dédiée) est **retiré** — il ajoutait de la complexité sans usage
réel. Le tri, la recherche, la pagination et l'export CSV restent identiques. Côté
société, le champ **« Groupe »** disparaît des fenêtres de création et de
modification ; tout le reste (nom, SIREN, personnes, deals) est intact.

> **🔧 Notes techniques**
>
> - Étape A (code uniquement) : on retire le code qui lit/écrit/affiche le
>   regroupement, **le schéma reste inchangé** — `companies.group`, `companies.sponsor`,
>   la table `portfolioGroupSettings` et leurs index restent déclarés, inertes (le
>   nettoyage données + schéma sera une Étape B dédiée, avec snapshot).
> - Front : suppression de la route `participations.group.$slug.tsx` ; reducer de
>   `ParticipationsTable.tsx` reclassé par société (forme pré‑#83), retrait des
>   badges groupe/sponsor et du bouton « Voir le groupe », retrait de `showEntity` ;
>   retrait du champ Groupe + select de type dans `participations.$companyId.tsx` et
>   `participations.index.tsx` ; `EntityFiche.tsx` simplifié (nature « company »
>   uniquement) ; nettoyage des clés i18n `participations` (badge/kind/block/group,
>   natures sponsor/group, identity de conso).
> - Back : suppression de `convex/participations.ts`, `convex/lib/groupSettings.ts`,
>   `convex/lib/portfolioGroups.ts` et de `tests/portfolioGroups.test.ts` ;
>   `companies.update`, `deals.ts` et `aggregate.ts` allégés de la méta‑groupe
>   (`buildGroupMeta`/`groupMeta`, `companyRef` sans champs groupe).
>   `assertInvestorIsGroupEntity` (entités juridiques `group_*`) est conservé — sans
>   rapport avec la feature de regroupement.

## v1.22.0 — 24/06/2026 à 12:30 — Recherche Attio des personnes

Dans la fenêtre **Modifier la société**, chaque ligne de personne propose
désormais une **recherche Attio** : tapez un nom, les **suggestions** issues
d'Attio apparaissent (avec un repère « Attio »), et un clic **remplit le nom et
le lien** vers la fiche Attio de la personne — son nom devient ensuite cliquable
sur la fiche. L'ajout **à la main** reste possible : si vous ne choisissez
aucune suggestion, la personne est simplement enregistrée **sans lien**, comme
avant. Une personne liée affiche un discret « **Lié à Attio** ». Si la recherche
est momentanément indisponible, un message neutre s'affiche et la saisie
manuelle continue de fonctionner.

> **🔧 Notes techniques**
>
> - Backend : nouvelle **action** `convex/attio.ts:searchPeople` (seules les
>   actions font du réseau externe). POST `…/v2/objects/people/records/query`,
>   filtre `name $contains`, 8 résultats max, **lecture seule**. La clé
>   `ATTIO_API_KEY` (réutilisée du webhook entrant `attioSync.ts`) est lue
>   **côté serveur uniquement** et jamais loggée. Auth via l'`internalQuery`
>   probe `requireMember` → `requireOrgMember` appelé en `ctx.runQuery` (une
>   action n'a pas `ctx.db`).
> - Dégradation propre : clé manquante → `error:'config'`, Attio en erreur /
>   transport KO → `error:'upstream'`, liste vide, **pas de crash** (seul un
>   non-membre lève). Le front affiche un message neutre et garde l'ajout manuel.
> - Front : `participations.$companyId.tsx` — extraction d'un composant
>   `PersonRow` (état de recherche local par ligne), `useAction` débouncé 300 ms
>   (`useDebouncedValue`), suggestions dans un `Popover`/`PopoverAnchor` ancré
>   sur l'input (badge « Attio »). Éditer le nom remet `attioRecordId: undefined`
>   (délie). **Save inchangé** : `companies.update`, remplacement total, pas de
>   nouvelle mutation.
> - Le lien vers la fiche est déjà fabriqué par `attioPersonUrl` (5b) dès que
>   `attioRecordId` est rempli. i18n EN/FR : `edit.personSearching`,
>   `personSearchNoResults`, `personSearchError`, `personLinkedToAttio`,
>   `attioBadge`.
> - Hors périmètre : pré-remplissage depuis le team Attio de l'entité (5d),
>   toute écriture vers Attio, resync des noms snapshotés.

## v1.21.0 — 24/06/2026 à 11:45 — Fondateurs, board et co-investisseurs sur la fiche

Les fiches société affichent désormais leurs **fondateurs**, **membres du
board** et **co-investisseurs**, regroupés par rôle. Un nouveau bloc dans la
fenêtre **Modifier la société** permet de les **ajouter, renommer ou
retirer**, à la main par leur nom. Quand une personne est déjà liée à Attio,
son nom devient un **lien cliquable** vers sa fiche Attio ; sinon il s'affiche
en texte simple. Les sections sans personne restent discrètes (« À
renseigner »).

> **🔧 Notes techniques**
>
> - Affichage : `PeopleList` (`src/components/companies/EntityFiche.tsx`) rend
>   le **nom** en lien quand un `attioUrl` est fourni. L'URL est fabriquée par
>   `attioPersonUrl` (`src/lib/attio.ts`, miroir de `attioCompanyUrl`, segment
>   `/person/<record_id>`, `null` si `VITE_ATTIO_WORKSPACE_URL` absente). Le
>   groupement par rôle se fait dans `participations.$companyId.tsx`
>   (`peopleByRole`).
> - Édition : section « Personnes » greffée sur `EditCompanyDialog` (liste de
>   lignes rôle + nom + retirer, bouton « ajouter »). Au save, la **liste
>   complète** part dans `companies.update` (`patch.people`, remplacement
>   total). `attioRecordId` d'une personne déjà liée est **préservé** au
>   rebuild (aucune UI pour le saisir en 5b). Gate Save : un nom vide bloque
>   (miroir du rejet backend `invalid_person_name`).
> - i18n EN/FR : `personRole.{founder,board,coinvestor}`, `edit.people*`,
>   `edit.errors.invalid_person_name`.

## v1.20.1 — 24/06/2026 à 09:15 — Préparer fondateurs, board et co-investisseurs

Les fiches société pourront bientôt lister leurs **fondateurs**, **membres du
board** et **co-investisseurs**. Cette mise à jour pose la **fondation
technique** côté base de données : rien ne change encore à l'écran, mais ces
personnes peuvent désormais être enregistrées (avec, si besoin, un lien vers
leur fiche Attio). L'affichage et la saisie arriveront dans une prochaine
mise à jour.

> **🔧 Notes techniques**
>
> - Nouveau champ `people` sur la table `companies`
>   (`v.optional(v.array(...))`, donc additif — pas de migration) : liste
>   d'objets `{ role, name, attioRecordId? }`.
> - Enum `role` (`founder | board | coinvestor`) + validateur d'objet
>   `personValidator` centralisés dans `convex/lib/people.ts`, selon la
>   convention `literals(...)` du Lot 3 ; importés par `convex/schema.ts` et la
>   mutation.
> - `companies.update` étendue (pas de nouvelle mutation) : accepte `people` en
>   **remplacement total** de la liste ; `role` invalide rejeté par le
>   validateur Convex, `name` vide rejeté (`invalid_person_name`) avant tout
>   write. Scoping `requireOrgMember` inchangé.
> - Choix assumé : `people` est un **champ**, pas une table dédiée ;
>   `linkedin`/`email` non stockés (accessibles via Attio). Cf. `KNOWN_ISSUES.md`
>   « Fiche entité ». Affichage + dialog d'édition = Lot 5b.

Changer le **type d'instrument** d'un deal depuis l'écran « Modifier » est
désormais **enregistré** comme les autres champs. Et pour éviter toute
inquiétude : quand vous sélectionnez un nouveau type, un **message** vous
confirme que les champs propres à l'ancien type ne sont **pas effacés**. Ils
sont simplement mis en sommeil — masqués tant que le deal reste sur le nouveau
type, et **rétablis à l'identique** si vous repassez au type d'origine. Aucune
donnée n'est perdue lors d'un changement de type.

> **🔧 Notes techniques**
>
> - Bannière de confirmation conditionnelle dans `EditDealDialog`
>   (`src/routes/app/$orgSlug/deals.$dealId.tsx`), affichée quand
>   `instrument !== deal.instrumentKind` ; libellé `participations:edit.typeChangeNotice`
>   (interpolation `from`/`to` via `t('participations:instrument.<kind>')`), EN/FR.
> - **Aucun changement backend** : `convex/deals.ts:update` persistait déjà
>   `{ instrumentKind }` (clé du validateur de patch) et ajoutait toute clé du
>   patch à `manuallyEditedFields` (shipé en Lot 3, PR #96). L'invariant
>   « sommeil » vient de la sémantique du patch partiel `ctx.db.patch` : seules
>   les clés fournies sont écrites, donc changer le type ne touche que la colonne
>   `instrumentKind` — aucune mise à null collatérale des champs hors-type.
> - Scénario de survie documenté dans `TESTING.md` (FD15).

## v1.19.0 — 23/06/2026 à 23:15 — Modifier les champs d'un deal à la main

La fiche d'un investissement devient **éditable**. Le bouton « Modifier » ouvre
désormais, en plus du nom et du type, **tous les champs propres au type
d'instrument** : on peut corriger un taux, une valorisation, une date de
closing, un type de tour, un montant… chacun dans le bon format (euros, %,
date, liste de choix).

- Chaque champ modifié à la main est **protégé** : le prochain ré-import depuis
  Airtable ne l'écrasera plus. Un **petit point** à côté du champ, sur la fiche,
  signale qu'il a été saisi à la main.
- Une saisie incohérente (lettres dans un montant, par exemple) **bloque
  l'enregistrement** — rien n'est sauvegardé à moitié.
- Les libellés lèvent une ambiguïté : le **« Montant contractuel »** (saisi à la
  main) est distinct du **« Décaissé (réel) »**, qui reste calculé
  automatiquement à partir des mouvements bancaires et n'est pas modifiable.

Le type d'instrument, lui, reste pour l'instant un aperçu non enregistré sur la
fiche : son changement définitif arrivera dans un lot dédié.

> **🔧 Notes techniques**
>
> - Backend : 7 validateurs enum d'archétype (`roundType`, `safeType`,
>   `couponPeriodicity`, `repaymentModality`, `termDuration`, `fundType`,
>   `propertyType`) déplacés vers `convex/lib/instruments.ts` (source unique,
>   + tableaux `ENUM_FIELD_VALUES` pour les selects) ; `schema.ts` et
>   `deals.ts` les importent. `dealFields` (partagé `create`/`update`) étendu
>   des ~25 champs d'archétype manquants.
> - Garde-fou : nouvelle colonne `deals.manuallyEditedFields: string[]`.
>   `deals.update` ajoute au set **toute** clé patchée (uniforme côté écriture) ;
>   `airtableImport.ts:upsertDeals` retire du patch les colonnes présentes dans
>   ce set (intersection effective : `paidAmount`, `sharesAcquired`,
>   `signedDate`, `exitedDate`, `status`, `instrumentKind`, `targetCompanyId`,
>   `currency`). Champ additif/optionnel → pas de migration. Détaillé dans
>   `KNOWN_ISSUES.md` « Édition manuelle deals ».
> - Front : `EditDealDialog` (`src/routes/app/$orgSlug/deals.$dealId.tsx`)
>   étendu — rend les `INSTRUMENT_FIELDS[deal.instrumentKind]` en inputs typés
>   par `FIELD_FORMAT` (exporté depuis `InstrumentBlock.tsx`). Patch en diff
>   (seuls les champs réellement changés sont envoyés), gate `valid` qui
>   désactive Save. Parsers partagés dans `src/lib/parse.ts` (€→cents, %→bps,
>   date→ms). Marqueur « édité à la main » via tooltip dans `InstrumentBlock`.
>   `paidActual` jamais éditable (calculé, hors dialog).
> - i18n EN/FR : `edit.fieldsHint`, `edit.selectPlaceholder`,
>   `fiche.manuallyEdited`, libellés `deal.paid` / `field.paidAmount` clarifiés.

## v1.18.0 — 23/06/2026 à 21:40 — Fiche deal qui s'adapte au type d'instrument

La fiche d'un investissement change désormais de visage selon son type. Le bloc
central affiche, dans le bon ordre et avec le bon format (montants en euros, taux
en %, dates), exactement les informations qui comptent pour ce type d'instrument :
actions, obligations, SAFE, fonds, immobilier, SCPI, placements de trésorerie…
Les royalties affichent un panneau « à venir » et les types pas encore configurés
un bloc neutre.

Quelques nouveautés visibles :

- Un **badge de couleur** indique la grande famille de l'instrument (capital,
  dette, fonds, immobilier, royalties, placement…).
- Un **sélecteur de type** en haut de la fiche permet de **prévisualiser** à quoi
  ressemblerait la fiche dans un autre type, sans rien enregistrer : un bandeau
  « Aperçu — non enregistré » le rappelle clairement, et tout revient à la normale
  au rechargement.
- Les **SAFE** proposent une vue Pré / Post-conversion.
- Les **placements** (crypto, contrats de capitalisation) affichent la
  **plus-value latente** (valeur actuelle − montant versé), en vert ou en rouge.
- Une carte **Entité liée** renvoie vers la société investie ; des emplacements
  **Reporting & KPIs** et **Documents** sont réservés pour la suite.

Cette fiche reste en lecture seule : l'édition du type et des champs arrivera
ensuite.

> **🔧 Notes techniques**
>
> - Nouveau composant `src/components/deals/InstrumentBlock.tsx` : bloc central
>   **lecture seule** piloté par `convex/lib/instrumentMapping.ts` (lit
>   `INSTRUMENT_RENDER` pour le mode, `INSTRUMENT_FIELDS` pour les colonnes
>   ordonnées, `INSTRUMENT_ARCHETYPE` pour le badge). Aucune liste de champs en
>   dur : seul un `FIELD_FORMAT` (champ → format cents/bps/ms/enum) vit côté
>   front. Modèle deux-états SAFE déduit de la position de `conversionValuation`
>   dans le mapping (pas de liste codée en dur) ; plus-value placement via
>   `signTone`. Badges d'archétype via tokens `chart-1..5` / `positive`.
> - `src/routes/app/$orgSlug/deals.$dealId.tsx` : la grille d'infos à plat est
>   remplacée par un overview (Engagé/Versé/Reçu) + `InstrumentBlock`. Sélecteur
>   de type = état local `previewKind` (jamais persisté, cf. Lot 3) avec bandeau
>   « aperçu non enregistré » + reset. Ajout carte entité + placeholders
>   reporting/documents. Helpers orphelins (`Info`, `fmtPct`, `fmtNum`) retirés.
> - i18n EN/FR : nouveaux namespaces `field.*`, `enum.*`, `archetype.*`,
>   `fiche.*` dans `src/locales/{en,fr}/participations.json`.
> - Dette tracée dans `KNOWN_ISSUES.md` : `INSTRUMENTS` dupliqué dans la route
>   deal vs `convex/lib/instruments.ts` (à nettoyer dans un lot ultérieur).
> - Front uniquement : aucune mutation, aucun changement de schéma, aucune
>   commande `--prod`.

## v1.17.0 — 23/06/2026 à 21:38 — Fiches entités : un socle commun par nature

Les fiches d'entité s'organisent désormais autour d'un même squelette, quel que
soit le type : un en-tête (nom, nature, détention), un bloc d'identité qui
s'adapte à la nature de l'entité, puis les zones Reporting/KPIs et Documents.

- **Entreprise** : secteur, SIREN, nom de domaine, détention, lien vers la fiche
  Attio, et des sections Fondateur(s) / Membres du board / Co-investisseurs (pour
  l'instant à renseigner — leur saisie viendra plus tard).
- **Sponsor dette** : nom, type de plateforme, lien Attio et contact principal
  (à renseigner) ; rappel que les deals de dette rattachés remontent via les
  entités membres.
- **Groupe** : nom, identifiant stable, type, et la liste des entités membres.

Tout reste en lecture seule sur le bloc d'identité — l'édition fine (le crayon)
arrivera dans une prochaine étape. Les actions déjà en place (modifier une
société, créer un deal, renommer/classer un groupe) sont conservées.

> **🔧 Notes techniques**
>
> - Nouveau module présentation `src/components/companies/EntityFiche.tsx`
>   (`EntityNatureBadge`, `IdentityField`, `IdentitySection`, `PeopleList`,
>   `ReservedSection`, `AttioCompanyLink`) — briques read-only partagées.
> - Refonte de `participations.$companyId.tsx` (nature « company ») et
>   `participations.group.$slug.tsx` (natures « sponsor »/« group ») au même
>   squelette, **édition existante conservée**. Nature dérivée : company
>   `portfolio` → Entreprise ; `portfolioGroupSettings.groupKind === 'sponsor'`
>   → Sponsor dette ; sinon → Groupe (le `groupKind` vit sur
>   `portfolioGroupSettings`, pas sur `companies`).
> - Aucun champ ajouté au schéma : fondateurs/board/co-investisseurs, type de
>   plateforme et contact sponsor sont rendus en « À renseigner » (cf.
>   `KNOWN_ISSUES.md` « Fiche entité »).
> - Lien Attio via `src/lib/attio.ts:attioCompanyUrl`, base d'URL publique
>   `VITE_ATTIO_WORKSPACE_URL` (sans elle : pas de lien, jamais d'URL devinée).
> - i18n EN/FR : blocs `nature` et `identity` dans
>   `src/locales/{en,fr}/participations.json`.

## v1.16.2 — 23/06/2026 à 20:33 — Placements de trésorerie : socle de fiche (technique)

Suite du socle des fiches par type d'instrument : les placements de trésorerie
(crypto, contrats de capitalisation) sortent du « type non encore configuré » et
disposent d'une fiche minimale côté serveur (date de placement, montant placé,
valeur actuelle, établissement). Rien de visible pour l'instant ; l'affichage et
le calcul de plus-value latente viendront avec l'interface.

> **🔧 Notes techniques**
>
> - Nouvel archétype `placement` dans `convex/lib/instrumentMapping.ts` :
>   `crypto` et `capitalization_account` passent de `unassigned`/`placeholder` à
>   `placement`/`fields`, config partagée `PLACEMENT_FIELDS` (`closingDate`,
>   `paidAmount`, `currentValue`, `bankName`). `cto` reste seul en
>   `unassigned`/`placeholder` (pas de deal en prod pour cadrer son layout). Les
>   `Record` restent totaux (19 clés) ; `INSTRUMENT_FIELDS` passe à 17 types.
> - `convex/schema.ts` : une seule colonne neuve optionnelle `currentValue`
>   (cents). Date de placement / montant placé / établissement réutilisent
>   `closingDate` / `paidAmount` / `bankName`. La plus-value latente
>   (`currentValue − paidAmount`) sera calculée côté front (Lot 2), non stockée.
> - Aucune mutation, aucune migration, aucune commande `--prod`.

## v1.16.1 — 23/06/2026 à 19:56 — Socle des fiches par type d'instrument (technique)

Préparation interne de la refonte des fiches deal/instrument : le socle de
données par type d'instrument est posé côté serveur. Rien de visible pour
l'instant ; les nouvelles informations s'afficheront avec les prochaines mises
à jour de l'interface.

> **🔧 Notes techniques**
>
> - Nouveau module source unique `convex/lib/instrumentMapping.ts` : 5
>   archétypes (`equity`, `debt`, `funds_lp`, `real_estate`, `royalties`) + un
>   bucket d'attente `unassigned`. `INSTRUMENT_ARCHETYPE` et `INSTRUMENT_RENDER`
>   sont des `Record` totaux sur les 19 `instrumentKind` ; `INSTRUMENT_FIELDS`
>   est partiel (15 types configurés, ordre = ordre d'affichage). `royalty` en
>   render `custom` (panel réservé) ; `cto`, `crypto`, `capitalization_account`
>   en `placeholder` (design reporté avant Lot 2). `bsa`/`convertible_note`
>   réutilisent la config `safe`, `loan` la config `os`, `secondary` la config
>   `fonds`.
> - `convex/schema.ts` : 7 enums (`roundType`, `safeType`, `couponPeriodicity`,
>   `repaymentModality`, `termDuration`, `fundType`, `propertyType`) + 24
>   colonnes optionnelles dormantes sur `deals`. Colonnes de valorisation
>   neuves `preMoneyValuation`/`postMoneyValuation` (l'`entryValuation`
>   existant n'est pas touché). Réutilisation des colonnes existantes quand le
>   sens correspond (roundSize, interestRate, maturityDate, principalAmount,
>   committedAmount, paidAmount, sharesAcquired, pricePerShare, valuationCap,
>   discount).
> - Aucune mutation, aucune migration, aucune commande `--prod` : colonnes en
>   sommeil jusqu'au câblage du front (Lot 2).
## v1.16.0 — 23/06/2026 à 18:36 — Participations : distinguer sponsors et groupes

Les **groupes de participations** peuvent désormais être de deux natures :
**sponsor** ou **groupe**. Un badge dédié les distingue d'un coup d'œil dans la
liste des participations et sur la page consolidée. À la **création d'un
nouveau groupe** (en tapant un nom inédit depuis une fiche société), le choix
du type est **obligatoire** — impossible d'enregistrer tant qu'il n'est pas
fait. Les groupes existants restent affichés comme avant ; vous pouvez les
classer (ou les reclasser) à tout moment depuis leur page consolidée. Ce
réglage est purement visuel : il ne change aucun calcul ni aucun KPI.

> **🔧 Notes techniques**
>
> - Nouveau champ optionnel `groupKind` (`'sponsor' | 'group'`) sur
>   `portfolioGroupSettings` (`convex/schema.ts`). Rétro-compatible, sans
>   backfill : un groupe sans `groupKind` retombe sur le badge « groupe ».
> - `ensureGroupSettings` (`convex/lib/groupSettings.ts`) accepte un 4e
>   paramètre `groupKind` écrit **uniquement à l'insert** ; l'early-return sur
>   groupe existant garantit l'idempotence (jamais réécrit). `GroupMeta` +
>   `buildGroupMeta` propagent le champ.
> - `companies.update` accepte `groupKind` dans le `patch`, le transmet à
>   `ensureGroupSettings` puis le retire avant le `ctx.db.patch('companies')`
>   (ce n'est pas un champ société). Backend permissif : le forçage du choix
>   est côté front.
> - Nouvelle mutation `participations.setGroupKind` (reclassement depuis la
>   page conso) ; `getGroup` renvoie `groupKind`. Les `companyRef` de
>   `convex/deals.ts` et `convex/aggregate.ts` exposent `groupKind`.
> - Front : sélecteur de type dans `EditCompanyDialog`
>   (`participations.$companyId.tsx`) affiché et requis **seulement quand le
>   nom de groupe saisi est nouveau** ; badges sponsor/groupe dans
>   `ParticipationsTable.tsx` et `participations.group.$slug.tsx` (avec
>   sélecteur de reclassement, état « À classer » pour les groupes legacy).
> - i18n EN/FR : `badge.sponsor`, `kind.*`, `edit.kind*`, `group.kind*`.

## v1.15.0 — 22/06/2026 à 17:45 — Participations : supprimer un deal (protégé)

La fiche d'un deal dispose désormais d'un bouton **« Supprimer »** qui efface
définitivement l'investissement, après une confirmation explicite. Garde-fou :
la suppression est **bloquée** tant que des mouvements bancaires sont rapprochés
sur le deal — le bouton est alors désactivé et indique combien de mouvements
dé-rapprocher au préalable. Une fois le deal supprimé, on revient sur la fiche de
la société.

> **🔧 Notes techniques**
> - Backend : garde ajoutée dans `convex/deals.ts` `remove` — avant le hard
>   delete, lecture de l'index `by_deal` ; si une transaction est liée →
>   `ConvexError('deal_has_transactions')` (préserve l'invariant
>   `matched ⟺ dealId`, évite les transactions orphelines). Existence +
>   `requireOrgMember` inchangés.
> - Front : dans `deals.$dealId.tsx`, bouton « Supprimer » (destructive) +
>   `Dialog` de confirmation. Bouton désactivé quand
>   `listByDeal(dealId).length > 0`, avec message pluralisé. Au succès,
>   navigation vers `deal.target` (fiche entité) ou `/participations`.
> - Filet de sécurité : l'erreur `deal_has_transactions` est aussi gérée dans le
>   `catch` (toast clair), au cas où. i18n EN/FR sous `deleteDeal.*`.

## v1.14.1 — 22/06/2026 à 12:11 — Synchronisation Attio (préparation technique)

Préparation de la synchronisation automatique depuis Attio : lorsqu'un deal
change d'étape dans Attio (passage en « Term Sheet » ou « Invested »), Albo OS
pourra bientôt créer ou mettre à jour le deal correspondant. Ce lot pose la
plomberie technique côté serveur ; rien n'est encore visible ni écrit en base.

> **🔧 Notes techniques**
> - Nouveau endpoint webhook `POST /attio/webhook` (`convex/http.ts` →
>   `convex/attioSync.ts:attioWebhook`). Vérification de signature
>   HMAC-SHA256 (hex) sur le corps brut, header `Attio-Signature`, secret
>   `ATTIO_WEBHOOK_SECRET` — même approche Web Crypto que Powens
>   (`crypto.subtle.verify`), adaptée (Powens = base64 + message préfixé).
> - Pour chaque event : re-fetch du record via `GET /v2/objects/deals/records/{id}`
>   (Bearer `ATTIO_API_KEY`), lecture de la valeur **active**
>   (`active_until === null`) de `stage` / `value` / `albo_or_calte` /
>   `associated_company` / `type_d_invest` / `date_de_l_investissement`.
>   Filtre serveur sur les status id Term Sheet (`bb580481…`) et Invested
>   (`b59066ed…`) ; tout autre stage → 200 no-op. 401 seulement si signature
>   invalide.
> - `internal.attioSync.upsertFromDeal` : **squelette** (Lot 1), signature
>   d'args complète mais ne fait que logger, aucune écriture DB. L'upsert réel
>   (deal `pending`/`active` + forecast, investor = `group_root`, idempotent
>   sur `attioDealId`) est le Lot 2.
> - Env à positionner en prod : `ATTIO_WEBHOOK_SECRET` (nouveau),
>   `ATTIO_API_KEY` (déjà set).

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
