# Cadrage — Migration des reports Albo App (Supabase) → Albo OS (Convex)

**Date** : 2026-07-02
**Nature** : document de cadrage, reconnaissance **read-only** (aucune écriture
Convex, aucun `--prod`, aucun code de migration). Checkpoint : rien ne démarre
sans validation explicite d'Albo.
**Source** : projet Supabase `kpvbcqilzfeitxzwhmou` (« Albote Prod »,
eu-central-1), repo `albo-club/albo` (workers Trigger.dev + front).
**Cible** : déploiement Convex prod `mellow-curlew-738` (eu-west-1), repo
`albo-club/albo-os`, schéma `convex/schema.ts` (main).

---

## 0. Synthèse

- Le périmètre source = **2 workspaces** Supabase : « Albo 1 » (org cible
  `albo`) et « CALTE portfolio » (org cible `calte`). Ensemble : **187
  companies** (dont 116 avec au moins un report), **390 reports**, **405
  fichiers** (max 15 Mo, sous le cap Convex de 20 Mo), **19 138 métriques** —
  les chiffres collent avec « ~187 companies / ~18 800 métriques » de la
  migration précédente.
- La cible naturelle côté Albo OS (main) est le trio **`companyReports`** +
  **`documents`** (kind `reporting`, lien `reportId`) +
  **`companyIntelligence`** — le schéma posé par les PRs #143–#145 (pipeline
  AgentMail) et déjà en prod.
- ⚠️ **Constat bloquant (§1)** : je n'ai trouvé **aucune trace vérifiable de la
  migration companies + metrics précédente** — ni dans les deux repos, ni dans
  les PRs, ni dans les données visibles via le MCP Albo OS. Les tables
  « option B » et surtout le **mapping id Supabase → id Convex** doivent être
  localisés avant d'écrire la moindre ligne de code.
- ~56 reports (~14 %) atterrissent sur des companies dont le rattachement
  n'est pas résolvable automatiquement par nom (§5.3) → mapping manuel à
  produire (petit : 116 companies concernées en tout).
- Le flux source est **encore vivant** (dernier report ingéré le 02/07/2026 à
  18:28 UTC) et le pipeline AgentMail d'Albo OS tourne aussi → il faut une
  règle de cutoff/anti-double-ingestion (§6, D8).

---

## 1. ⚠️ Constat critique : la migration précédente est introuvable

Le brief indique qu'une migration companies + metrics Supabase → Convex a déjà
été faite (« ~187 companies, ~18 800 métriques, schéma option B tables de
reporting dédiées »). Ce que j'observe :

| Vérification | Résultat |
| --- | --- |
| `convex/schema.ts` (main) | Aucune table de reporting dédiée de type « option B » (pas de `reportingCompanies` / `reportMetrics`). Aucun champ d'ancrage Supabase (`supabaseId` ou équivalent) sur `companies`. |
| `convex/migrations/` (main) | Seulement `attioAlboImport.ts` et `splitAlboSponsorSpvs.ts` (imports Attio). |
| `MIGRATIONS.md`, `CHANGELOG_PRODUIT.md` | Aucune mention d'une migration Supabase. |
| PRs du repo | La PR #142 (« backend prêt à recevoir les reportings », avec une table normalisée `reportMetrics`) a été **fermée sans merge**. Le design retenu en prod est celui des PRs #143–#145 (AgentMail, métriques en snapshot JSON sur le report). |
| Données prod via MCP | Org `albo` : 45 companies (cohérent avec l'import Attio + splits, pas +40 Supabase visibles). `kpiSnapshots` de Reekom : **vide**. Pas de 3ᵉ org. |
| Repo `albo` (source) | Aucune référence Convex. |

**Hypothèses** (à trancher par Albo, c'est le point D1 en §6) :

1. La migration a été exécutée dans une session précédente **hors repo**
   (script de scratchpad, schéma poussé directement sur `mellow-curlew-738`)
   → les tables dédiées existent en prod mais sont invisibles depuis main et
   depuis le MCP. Vérification en 30 s : dashboard Convex → Data → liste des
   tables (ou `npx convex data --prod`).
2. La migration a matché les companies Supabase sur les `companies` Convex
   existantes (par nom) sans conserver d'ancrage id — auquel cas il n'existe
   **pas** de mapping réutilisable et il faudra le reconstruire (§5.3).
3. Elle a visé un autre projet Convex que `mellow-curlew-738`.

**Conséquence** : le mécanisme de rattachement report → company (le cœur de
cette migration) dépend entièrement de la réponse. Je m'arrête donc à ce
cadrage, comme convenu.

---

## 2. Côté source — Albo App (Supabase)

### 2.1 Tables concernées

Le stockage des reports vit dans 3 tables (`apps/workers/src/steps/store-report.ts`
est le point d'écriture ; pas de fichier de migrations SQL dans le repo — le
schéma fait foi en base) :

**`company_reports`** (459 lignes au total) — l'enveloppe d'un report.

| Colonne | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `company_id` | uuid NOT NULL | FK → `portfolio_companies` ON DELETE CASCADE |
| `report_title` | text | |
| `report_date` | date | |
| `report_type` | text | `monthly` (défaut) / `bimonthly` / `quarterly` / `semi-annual` / `annual` |
| `report_period` | text | label humain (« January 2026 ») |
| `period_sort_date` | date | clé de tri dérivée |
| `headline` | text | |
| `key_highlights` | text[] | |
| `metrics` | jsonb | snapshot `{clé: valeur}`, défaut `{}` |
| `raw_content` | text | texte extrait combiné |
| `cleaned_content` | text | corps nettoyé (HTML) |
| `email_subject` / `email_from` / `sender_email` | text | `sender_email` = copie d'`email_from` |
| `email_date` | timestamptz | |
| `email_message_id` | text | Message-ID RFC 5322 |
| `source_thread_id` | text | dedup applicative (contrainte unique company+thread, fallback code sur (company, period)) |
| `has_attachments` | bool | dérivé |
| `processing_status` | text | `pending`/`completed`/… |
| `processing_error` | text | |
| `report_source` | text | ⚠️ `unknown` sur 387/390 lignes du périmètre |
| `is_archived` / `archive_reason` / `archived_at` / `archived_by` | | archivage soft (FK auth.users) |
| `is_duplicate` | bool NOT NULL | |
| `pipeline_version` / `reprocessed_at` / `processed_at` / `created_at` | | |
| `memo_html`, `dust_conversation_id`, `dust_conversation_url`, `additional_context` | text | legacy / annexes |

**`report_files`** (442 lignes) — fichiers d'un report, blobs dans Supabase
Storage.

| Colonne | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `report_id` | uuid NOT NULL | FK → `company_reports` ON DELETE CASCADE |
| `file_name` / `original_file_name` | text | |
| `storage_path` | text NOT NULL | chemin Supabase Storage |
| `mime_type` | text | défaut `application/pdf` |
| `file_size_bytes` | bigint | |
| `file_type` | text | `report` (284 en périmètre) / `inline_image` (121) |
| `original_text_report` | text | texte extrait du fichier |
| `html_content` | text | rare (2 lignes en périmètre) |
| `is_archived` | bool | 0 en périmètre |
| `created_at` | timestamptz | |

**`portfolio_company_metrics`** (21 393 lignes) — métriques normalisées.
UNIQUE `(company_id, metric_key, report_period)` ; FK `source_report_id` →
`company_reports` (SET NULL), `source_document_id` → `portfolio_documents`
(SET NULL). Colonnes : `metric_key`, `canonical_key`, `metric_category`,
`metric_type` (`currency`/`percentage`/`number`/`months`/`ratio`/`text`),
`metric_value` (**text**, pas numeric), `report_period`, `period_sort_date`,
`source`, timestamps. **Concernée par la migration précédente, pas par
celle-ci** (cf. §4 et D2).

Relation : `company_reports.company_id` → `portfolio_companies.id`
(`workspace_id` → `workspaces.id` donne l'org).

### 2.2 Volumes en périmètre

Périmètre = workspaces « Albo 1 » (`94199e0b…`) et « CALTE portfolio »
(`06e7b48d…`) :

| | Albo 1 | CALTE portfolio | Total |
| --- | --- | --- | --- |
| Companies | 40 | 147 | **187** |
| … dont avec ≥ 1 report | 34 | 82 | 116 |
| Reports | 183 | 207 | **390** |
| … dont `is_archived` | 6 | 2 | 8 |
| … dont `is_duplicate` | 7 | 4 | 11 |
| … dont statut ≠ `completed` | 0 | 1 | 1 |
| … sans aucune métrique liée (et `metrics = {}`) | 13 | 16 | 29 |
| Période couverte (`period_sort_date`) | 2024-01 → 2026-06 | 2023-01 → 2026-06 | |
| Fichiers (`report_files`) | | | **405** (284 `report`, 121 `inline_image`) |
| … taille max / moyenne | | | 15 Mo max (aucun > 20 Mo), ~1 Mo moy. (report) |
| Métriques liées aux companies du périmètre | 9 948 | 9 190 | **19 138** |

Hors périmètre (autres workspaces, à confirmer — D3) : OPRTRS (34 reports,
311 métriques), SideAngels (34 reports, 1 217), Veja Ventures (1 report, 727),
plus des workspaces sans reports.

Collisions de dédup : **23 groupes `(company_id, report_period)` portant 48
reports non archivés** — important car la cible déduplique précisément sur
cette paire (§3.2, D7).

Le flux est **toujours actif** : report le plus récent ingéré le 02/07/2026
18:28 UTC (pipeline Trigger.dev `report-pipeline` côté Albo App).

---

## 3. Côté cible — Albo OS (Convex, main)

### 3.1 Tables d'accueil

Posées par les PRs #143–#145, écrites par
`convex/reportPipeline.ts:storeReport` :

**`companyReports`** (`convex/schema.ts:650`) : `orgId`, `companyId`
(obligatoires), provenance (`source: 'email'|'upload'`, `agentmailInboxId`,
`agentmailMessageId` (clé de dédup), `agentmailThreadId`, `fromEmail`,
`subject`, `emailDate` ms), analyse (`title`, `headline`, `keyHighlights[]`,
`reportPeriod` string, `periodSortDate` ms, `reportType`
(`monthly|bimonthly|quarterly|semi-annual|annual`), `reportAbout`
(`company_self|fund_portfolio_company`), `metrics: v.any()` snapshot brut),
contenu (`rawContent`, `cleanedHtml`), état (`status:
processing|completed|failed`, `error`, `pipelineVersion`, `processedAt`).
Index : `by_company (companyId, periodSortDate)`, `by_org`,
`by_message_id (agentmailMessageId)`, `by_company_period (companyId,
reportPeriod)`.

**`documents`** (`convex/schema.ts:610`) : un fichier = une ligne (`orgId`,
`companyId`, `title`, `kind: 'reporting'`, `storageId` (_storage Convex, cap
20 Mo), `contentType`, `size`, `source: 'upload'|'email'`, `uploadedAt`,
`reportId` → companyReports, `inline` (images cid:), `extractedText`).

**`companyIntelligence`** (`convex/schema.ts:710`) : 1 ligne / company,
`latestReportId` maintenu par `storeReport`, synthèse IA (`aiAnalysis`)
recalculée par le pipeline — pas à migrer, se remplit tout seul.

Il n'existe **pas** de table de métriques normalisée dans main (design
`reportMetrics` de la PR #142 abandonné) : les métriques d'un report vivent
dans le champ `metrics` (JSON) du report ; `kpiSnapshots` est un historique
**curé** séparé, non alimenté par le pipeline.

### 3.2 Mécanique d'écriture existante (à réutiliser telle quelle ou presque)

- Résolution company : `reportPipeline.ts:resolveCompanyInternal` scanne les
  companies **de toutes les orgs** et matche domaine/nom ; l'`orgId` est
  **dérivé de la company matchée**.
- Dédup : par `agentmailMessageId`, puis par `(companyId, reportPeriod)` — un
  re-import du même couple **patche la ligne en place et supprime/remplace ses
  `documents`** (fichiers inclus, blobs effacés).
- Multi-tenant : toute lecture passe par `requireOrgMember` ; les writes du
  pipeline sont `internalMutation` (pas d'exposition publique).

### 3.3 Rattachement company : ce qui existe comme ancrages

Sur `companies` (main) : `attioCompanyId`, `airtableId`, `siren`, `domain` —
**aucun id Supabase**. Donc, en l'état de main, le seul rattachement possible
est un matching nom/domaine + table de correspondance manuelle, sauf si la
migration précédente a laissé un mapping (§1, D1).

---

## 4. Table de correspondance des schémas (livrable principal)

### 4.1 `company_reports` → `companyReports`

| Source | Cible | Statut | Commentaire |
| --- | --- | --- | --- |
| `id` (uuid) | — | **SOURCE UNIQUEMENT** ⚠️ | Aucun champ d'ancrage idempotence côté cible. Proposition : champ additif optionnel `supabaseReportId` + index (pattern `airtableId`) → **D6**. |
| `company_id` (uuid) | `companyId` (Id\<companies\>) | **RETYPÉ / MAPPING** | Via la table de correspondance companies (§5.3). C'est LE point dur. |
| — (workspace de la company) | `orgId` | **CIBLE UNIQUEMENT** | Dérivé : « Albo 1 » → org `albo`, « CALTE portfolio » → org `calte` (D4). |
| `report_title` | `title` | RENOMMÉ | Direct. |
| `report_type` | `reportType` | MATCH 1:1 | Mêmes littéraux exactement (y c. `semi-annual`). |
| `report_period` | `reportPeriod` | MATCH 1:1 | Labels déjà normalisés source (`normalizePeriodDisplay`). |
| `period_sort_date` (date) | `periodSortDate` (ms) | RETYPÉ | date → ms epoch UTC. |
| `report_date` (date) | — | **SOURCE UNIQUEMENT** | Pas d'équivalent. À droper (info ≈ `period_sort_date`/`email_date`) ou discuter. |
| `headline` | `headline` | MATCH 1:1 | |
| `key_highlights` (text[]) | `keyHighlights` | MATCH 1:1 | |
| `metrics` (jsonb) | `metrics` (v.any()) | MATCH 1:1 | Snapshot brut recopié tel quel. ⚠️ La cible attend plutôt `{clé: number}` ; le jsonb source peut contenir des strings → tolérer (v.any()) ou normaliser, à trancher (D2). |
| `raw_content` | `rawContent` | MATCH 1:1 | ⚠️ borne 1 Mo/doc Convex : vérifier les plus gros contenus au dry-run. |
| `cleaned_content` | `cleanedHtml` | RENOMMÉ | Même rôle (corps HTML nettoyé). |
| `email_subject` | `subject` | RENOMMÉ | |
| `email_from` | `fromEmail` | RENOMMÉ | |
| `sender_email` | — | SOURCE UNIQUEMENT | Doublon d'`email_from` à la source. Droper. |
| `email_date` (timestamptz) | `emailDate` (ms) | RETYPÉ | |
| `email_message_id` | — | **SOURCE UNIQUEMENT / à discuter** | Sémantiquement ≠ `agentmailMessageId` (ids AgentMail). Ne PAS le mapper dessus (risque de collision de dédup) sauf décision contraire (D6). |
| `source_thread_id` | — | SOURCE UNIQUEMENT | Idem (`agentmailThreadId` réservé AgentMail). |
| `has_attachments` | — | SOURCE UNIQUEMENT | Dérivable des `documents` liés. Droper. |
| `processing_status` | `status` | MATCH (quasi) | `completed` → `completed`. 1 seul report non-completed en périmètre → skip ou `failed` (D5). |
| `processing_error` | `error` | RENOMMÉ | |
| `report_source` | `source` | **RETYPÉ / DÉCISION** | Source ≈ toujours `unknown` ; cible n'accepte que `email`/`upload`. Proposition : `upload` pour tout le lot migré (D6). |
| `pipeline_version` | `pipelineVersion` | RENOMMÉ / re-sémantisé | Proposition : valeur dédiée type `supabase-migration-v1` pour tracer l'origine. |
| `processed_at` | `processedAt` | RETYPÉ | timestamptz → ms. |
| `created_at` | — (`_creationTime` auto) | SOURCE UNIQUEMENT | `_creationTime` Convex sera la date de migration, pas l'originale — l'ordre d'affichage repose sur `periodSortDate`, OK. |
| `is_archived`, `archive_reason`, `archived_at`, `archived_by` | — | **SOURCE UNIQUEMENT / DÉCISION** | 8 reports archivés : skip pur et simple recommandé (D5). |
| `is_duplicate` | — | **SOURCE UNIQUEMENT / DÉCISION** | 11 reports marqués : skip recommandé (D5). |
| `reprocessed_at`, `memo_html`, `dust_conversation_id`, `dust_conversation_url`, `additional_context` | — | SOURCE UNIQUEMENT | Legacy (mémos Dust, contexte d'upload). Droper. |
| — | `agentmailInboxId` / `agentmailMessageId` / `agentmailThreadId` | **CIBLE UNIQUEMENT** | Laisser absents (optionnels). Conséquence : la dédup ne tient que sur `(companyId, reportPeriod)` → cf. collisions D7. |
| — | `reportAbout` | **CIBLE UNIQUEMENT** | Pas d'équivalent source. Défaut proposé : `company_self` (plusieurs companies sont pourtant des fonds — Eutopia, Batch, Asterion… : accepter l'imprécision ou classifier à la main, D6). |

### 4.2 `report_files` → `documents`

| Source | Cible | Statut | Commentaire |
| --- | --- | --- | --- |
| `id` | — | SOURCE UNIQUEMENT | Idempotence fichier : dériver de `supabaseReportId` + nom (D6). |
| `report_id` | `reportId` | RETYPÉ / MAPPING | Via le mapping reports du même lot. |
| — | `orgId`, `companyId` | CIBLE UNIQUEMENT | Recopiés du report parent. |
| `file_name` | `title` | RENOMMÉ | (`original_file_name` en secours). |
| `storage_path` (Supabase Storage) | `storageId` (Convex `_storage`) | **RETYPÉ — transfert de blobs** | Télécharger depuis Supabase Storage puis `ctx.storage` Convex. 405 fichiers, max 15 Mo < cap 20 Mo ✅. |
| `mime_type` | `contentType` | RENOMMÉ | |
| `file_size_bytes` | `size` | RENOMMÉ | |
| `file_type` (`report`/`inline_image`) | `inline` (boolean) + `kind: 'reporting'` | RETYPÉ | `inline_image` → `inline: true` (121 fichiers, masqués de l'onglet Docs) — ou skip des inline (D5). |
| `original_text_report` | `extractedText` | RENOMMÉ | |
| `html_content` | — | SOURCE UNIQUEMENT | 2 lignes en périmètre. Droper. |
| `is_archived` | — | SOURCE UNIQUEMENT | 0 en périmètre. |
| `created_at` | `uploadedAt` | RETYPÉ | |
| — | `source` (`upload`/`email`), `uploadedBy` | CIBLE UNIQUEMENT | `upload` proposé, `uploadedBy` absent. |

### 4.3 Métriques — hors périmètre de cette migration (à confirmer)

Ma compréhension (à valider, **D2**) :

- `portfolio_company_metrics` (19 138 lignes en périmètre : 12 801 liées à un
  report, 5 995 à un document, 554 orphelines) = l'objet de la **migration
  précédente** (« option B ») — **pas re-migrées ici**.
- Ce lot-ci embarque uniquement le **snapshot `metrics` jsonb** de chaque
  report (recopie telle quelle), parce que l'UI cible (`getById`) le lit.
- Aucun peuplement de `kpiSnapshots` (historique curé, hors scope).
- Conséquence : le lien fin `métrique → report source`
  (`source_report_id`) n'existera pas côté Convex, sauf si les tables
  « option B » le portent déjà et qu'on veut le re-câbler → dépend de D1.
- Métriques structurellement non migrables signalées : `metric_value` est du
  **text** (valeurs non numériques possibles), cardinalité énorme (10 201
  `canonical_key` distincts pour 19 138 lignes — clés quasi uniques par
  report), 469+ lignes `metric_type='text'`, catégorie `other` majoritaire
  (13 850 lignes). Tout mapping vers un modèle typé perdra de l'information.

---

## 5. Points durs

### 5.1 Double pipeline vivant

Les deux systèmes ingèrent en parallèle : Albo App (Trigger.dev, dernier
report aujourd'hui) et Albo OS (AgentMail, PRs #143+). Sans cutoff, le même
report peut exister deux fois (une fois migré, une fois ré-ingéré par
AgentMail avec un `reportPeriod` légèrement différent → la dédup
`(companyId, reportPeriod)` ne le rattrapera pas toujours) — ou au contraire
un report AgentMail récent peut être **écrasé** par la migration (patch en
place sur le même couple + suppression de ses fichiers). → D8.

### 5.2 Dédup cible vs collisions source

48 reports source (23 couples `(company, period)`) entrent en collision : au
fil d'un import naïf via la mécanique `storeReport`, le dernier écrase les
précédents (et leurs fichiers). Il faut une politique explicite : garder le
plus récent (`processed_at` max), fusionner, ou suffixer le `reportPeriod`. → D7.

### 5.3 Rattachement company → estimation des orphelins

Matching par nom normalisé (insensible casse/accents, containment) entre les
116 companies source ayant des reports et les companies Convex des deux orgs :

| | Match exact | Containment unique | **Ambigu** | **Sans match** |
| --- | --- | --- | --- | --- |
| Albo 1 (34 companies / 183 reports) | 30 | 1 | 2 (Sezame → quelle entité « Sezame Immo » ; La vie de quartier → Holding vs 3 SCI) | 1 (Marble, 2 reports) |
| CALTE (82 companies / 207 reports) | 18 | 43 | 6 (Eutopia ×2 candidats, Virgil ×5, Virgil Properties ×2, billiv ×2, Mineral ×2, Onima dupliquée) | 15 (Ordalie, Sant Roch, Caeli, Asterion Ventures, Ceinture Verte, Apnée Paris, Artefact, Baker Staff, MIO, makesense, iArtisan, Comptoir des Pharmacies, SIDE Capital, OVNI, Komeet-CALTE) |

En reports : **~56 reports (~14 %)** nécessitent un arbitrage manuel (24
reports sur les ambigus, ~32 sur les sans-match — dont beaucoup se résolvent à
l'œil : « Caeli Energie » → « Asterion Side CAELI », « Baker Staff » → « SIDE
BAKERSTAFF », « OVNI Capital » → « OVNI VENTURES », etc. ; les vrais orphelins
probables après curation : ~2–5, ex. Marble, Sant Roch, Artefact). Le volume
(116 lignes) justifie une **table de correspondance curée à la main, commitée
dans le module de migration**, plutôt qu'un matching flou.

Si la migration précédente a conservé un mapping id→id (D1), tout ceci
disparaît : on réutilise le mapping.

### 5.4 Problèmes adjacents constatés (signalés, pas corrigés)

- `report_source` = `unknown` sur 387/390 reports : l'info de provenance est
  perdue à la source.
- Domaines sales sur `portfolio_companies` : URLs complètes
  (`https://out-work.fr/`), casse (`Backmarket.com`), domaines incohérents
  (Komeet-CALTE → `wenabi.com`, Feeli → `tylia.fr`, Onima → `genopole.fr`,
  Renovation Man et iArtisan partagent `i-artisan.fr`) → le matching par
  domaine est peu fiable côté CALTE.
- Doublons de noms dans l'org `calte` (Convex) : « ASTERION SIDE ONIMA
  (ex:YEASTY) » ×2, « COEUR PIGALLE » ×2, « RDB » ×3 (kinds différents),
  FLEX LIVING / FLEXLIVING… — toute résolution par nom doit être déterministe
  face à ces doublons.
- 1 report source en statut non-`completed` ; 8 archivés ; 11 `is_duplicate`.
- 69 reports vivent dans des workspaces hors périmètre supposé (OPRTRS,
  SideAngels, Veja) — perdus si non migrés (D3).

---

## 6. Points de décision (je ne tranche rien)

- **D1 — Migration précédente / mapping IDs (bloquant).** Où sont les tables
  « option B » et le mapping id Supabase → id Convex ? Action la plus rapide :
  ouvrir le dashboard Convex de `mellow-curlew-738` → Data → liste des tables,
  ou me pointer la session/le script de la migration companies+metrics. Tout
  le lot 1 en dépend.
- **D2 — Périmètre métriques.** Confirmer : (a) `portfolio_company_metrics`
  n'est PAS re-migrée ici ; (b) le snapshot `metrics` jsonb des reports est
  recopié tel quel ; (c) `kpiSnapshots` n'est pas touché. Et me dire quelles
  métriques étaient « hors périmètre » dans la migration précédente pour que
  je vérifie la cohérence (19 138 en base vs ~18 800 annoncées).
- **D3 — Workspaces hors périmètre.** OPRTRS (34 reports), SideAngels (34),
  Veja (1) : confirmés exclus ?
- **D4 — orgId.** « Albo 1 » → org `albo`, « CALTE portfolio » → org `calte` :
  confirmer ce mapping workspace → org.
- **D5 — Lignes à exclure.** Reports archivés (8), `is_duplicate` (11),
  non-`completed` (1) : skip ? Images inline (121 fichiers) : migrer (avec
  `inline: true`, masquées de l'UI) ou skip ?
- **D6 — Ancrage d'idempotence + champs cible.** (a) Ajouter un champ additif
  `supabaseReportId` (+ index) sur `companyReports` — seule modification de
  schéma envisagée, réversible, pattern `airtableId` — ou s'appuyer uniquement
  sur `(companyId, reportPeriod)` (fragile, cf. D7) ? (b) `source` des reports
  migrés : `upload` ? (c) `reportAbout` : défaut `company_self` partout ?
- **D7 — Collisions (company, period).** 48 reports concernés : garder le plus
  récent, fusionner, ou suffixer la période ? (La mécanique cible écrase en
  place.)
- **D8 — Cutoff double-pipeline.** Date/heure de bascule, et politique si un
  report existe des deux côtés (AgentMail déjà ingéré vs migré). Option
  simple : migrer uniquement les reports source dont `created_at` < date du
  premier report AgentMail de la company, puis comparaison manuelle du reste.
- **D9 — Reports « coquille ».** 29 reports en périmètre n'ont ni métrique
  liée ni snapshot `metrics` non vide. Ils portent quand même un narratif
  (headline/raw_content/fichiers) → je recommande de les migrer quand même ;
  si tu préfères les skipper, c'est 29 lignes.

---

## 7. Plan de migration proposé — par lots, bornés, sans auto-chaînage

Chaque lot s'arrête à son point de vérification ; le suivant ne démarre que
sur ton GO explicite. Les `--prod` restent à ta main ; snapshot
`convex export --prod` avant tout lot qui écrit.

**Lot 0 — Levée de doute & décisions (aucun code).**
Périmètre : réponse à D1 (tables prod / mapping), arbitrage D2→D9.
Vérification : ce document annoté/validé.

**Lot 1 — Table de correspondance companies (read-only, commitée).**
Périmètre : produire `sourceCompanyId (uuid) → companies._id Convex` pour les
116 companies à reports (mapping auto pour les ~93 sûres, arbitrage manuel
listé pour les ~23 autres). Livrable : module data + `dryRun` de contrôle.
Volume : 116 lignes. Dépendance : D1, D4.
Vérification : 100 % des 390 reports ont une cible OU un skip explicite
motivé ; revue humaine de la liste.

**Lot 2 — Migration des enveloppes `companyReports` (sans fichiers).**
Périmètre : reports du périmètre (390 − exclusions D5/D7/D8), mapping §4.1,
mutation interne idempotente sur l'ancrage D6, batchée par org.
Volume : ~370 lignes. Dépendances : lot 1, D6, D7, D8.
Vérification : comptages source/cible par org et par company, spot-check UI
(onglet Reports de 3 companies), re-run = 0 doublon.

**Lot 3 — Transfert des fichiers → `documents`.**
Périmètre : download Supabase Storage → upload Convex storage → insert
`documents` (mapping §4.2). Volume : 284 fichiers `report` (+121 inline si
D5 le retient), ~430 Mo cumulés, aucun > 20 Mo.
Dépendances : lot 2. Vérification : comptage + somme des tailles par report,
ouverture manuelle de quelques PDF via l'UI.

**Lot 4 — Cohérence & finitions.**
Périmètre : `companyIntelligence.latestReportId` recalé sur le report le plus
récent par company, vérification globale (orphelins, index), mise à jour
`MIGRATIONS.md`/`TESTING.md`, entrée changelog.
Vérification : dry-run de contrôle listant 0 incohérence.

**Lot 5 (optionnel, à discuter) — Bascule du flux vivant.**
Périmètre : cutoff D8 côté Albo App (arrêt ou redirection du pipeline
Trigger.dev), rattrapage des reports arrivés entre le lot 2 et la bascule.
Hors migration de données au sens strict — planifié séparément.

---

*Reconnaissance conduite en lecture seule : SQL `SELECT` via MCP Supabase,
queries MCP Albo OS, lecture des deux repos et de l'historique GitHub. Aucune
écriture nulle part.*
