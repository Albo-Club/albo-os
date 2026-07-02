# Lot 0 — Migration des reports : jointure par domaine résolue (read-only)

**Date** : 2026-07-02. **Nature** : reconnaissance **read-only** (aucune
écriture, aucune mutation, aucun `--prod`). Suite du cadrage
`CADRAGE_MIGRATION_REPORTS_2026-07-02.md` (PR #167) et de la table de
correspondance par nom `MAPPING_REPORTS_COMPANIES_2026-07-02.csv` (PR #168).
**Checkpoint** : ce document s'arrête au constat — le Lot 1 (écriture, org
albo d'abord) ne démarre que sur GO explicite.

**Livrable jumeau** : `MAPPING_REPORTS_RESOLUTION_2026-07-02.csv` — 390
lignes, une par report source, avec la liste des entités OS cibles résolues.

---

## a. Le champ domaine des deux côtés

| Côté | Champ | Notes |
| --- | --- | --- |
| Source (Albo App, Supabase) | `portfolio_companies.domain` (text) | Complété par la table **`company_domains`** (multi-domaines par company, `is_primary`) — c'est la clé qu'utilise déjà l'ingestion email. La jointure ci-dessous prend l'**union** des deux. |
| Cible (Albo OS, Convex) | `companies.domain` (`convex/schema.ts:306`, optionnel) | Index `by_org_domain`. C'est déjà la clé du pipeline AgentMail (`convex/reportPipeline.ts:resolveCompanyInternal` matche `c.domain` en lowercase) — la migration utilise donc la même clé que le flux futur. |

**Taux de remplissage — source** (companies ayant ≥ 1 report) :

| Org | Companies | Avec domaine | Sans |
| --- | --- | --- | --- |
| albo (« Albo 1 ») | 34 | 34 (100 %) | 0 |
| calte (« CALTE portfolio ») | 82 | 80 (97,6 %) | 2 (Inari Properties, Virgil Properties) |

Deux domaines source sont des URLs sales mais récupérables après
normalisation : Sant Roch (`https://santroch.framer.website/`) et
SCI OUTWORK VERDONNE (`https://out-work.fr/`).

**Taux de remplissage — cible (⚠️ mesuré par proxy)** : aucun canal read-only
ne me donne `companies.domain` en prod — le MCP Albo OS (`listCompanies`) ne
renvoie que `_id`/`name`/`kind`, et l'accès CLI prod est exclu du Lot 0
(`--prod` interdit). Les domaines OS sont donc reconstruits depuis leurs
**ancres d'import commitées** : `convex/migrations/attioAlboImport.ts` (org
albo, 35 domaines hardcodés) et Airtable `appVRf06AHghMkPZG` (org calte,
champ `domaine`, ancre `airtableId`). Dérive possible si des domaines ont été
édités dans l'UI OS depuis les imports.

| Org | Companies OS actives | Avec domaine (proxy) |
| --- | --- | --- |
| albo | 45 | 33 (73 %) — manquent surtout les SPVs créés par `splitAlboSponsorSpvs.ts`, insérés **sans** domaine (Sezame Immo 2/6, Parallel SPV ×4, entités La Vie de Quartier, Wheelee - Loewi, Oprtrs & Co) |
| calte | 280 | 187 (67 %) — les entités sans domaine sont surtout hors périmètre reports (fondations, comptes de passage, SCIs du groupe) |

→ **Conséquence assumée du Lot 1** : la jointure définitive devra être
recalculée **côté Convex** (internalQuery de dry-run sur les données prod
réelles) avant toute écriture ; les chiffres ci-dessous sont l'attendu à
quelques unités près.

## b. Résolution de la jointure (règle : domaine d'abord, nom en fallback)

Règle appliquée par paire (company source, entité OS), strictement intra-org :

1. intersection des domaines normalisés (lowercase, sans `https://`, `www.`,
   chemin/query) → **match domaine** ;
2. si l'entité OS (ou la source) n'a **pas** de domaine → fallback **nom**
   via le CSV #168 (cible proposée + candidats listés en note) ;
3. si les deux côtés ont un domaine **différent** → pas de match (conflit
   signalé, cf. §« à arbitrer »).

| Org | Méthode | Companies source | Reports |
| --- | --- | --- | --- |
| albo | domaine | 30 | 164 |
| albo | mixte (domaine + nom) | 1 (La vie de quartier) | 3 |
| albo | nom seul | 2 (Loewi, Sezame) | 14 |
| albo | **orphelin** | 1 (Marble) | 2 |
| calte | domaine | 70 | 168 |
| calte | mixte | 3 (Batch, Flexliving, SIDE Capital) | 8 |
| calte | nom seul | 3 (Inari Properties, Virgil Properties, SCI OUTWORK VERDONNE) | 10 |
| calte | **orphelin** | 6 (dont 5 conflits de domaine, cf. ci-dessous) | 21 |

**Companies passant par le fallback nom** (à relire) : albo — La vie de
quartier (3 entités SCI sans domaine), Loewi → Wheelee - Loewi, Sezame →
Sezame Immo 2 + 6 ; calte — Batch Ventures (3 véhicules sans domaine),
Flexliving → FLEX LIVING (doublon assumé), SIDE Capital (SIDE 1, SIDE
INVEST, SIDE Invest 3), Inari Properties → Virgil - Inari Properties 2023,
Virgil Properties → VIRGIL Properties 2020 + 2025, SCI OUTWORK VERDONNE.

## c. Fan-out : volumes d'écriture

Un report se duplique sur **chaque** entité OS qui matche (règle validée).

| | albo | calte | total |
| --- | --- | --- | --- |
| Reports source | 183 | 207 | 390 |
| Écritures `companyReports` (règle brute) | **197** | **235** | **432** |
| … net des exclusions D5 si retenues (8 archivés, 11 `is_duplicate`, 1 non-`completed`) | 185 | 227 | **412** |

Fan-outs > 1 cible : **Virgil ×15 (⚠️ cf. arbitrage)**, Batch Ventures ×6,
SIDE Capital ×5, La vie de quartier ×4, Sezame ×2, Asterion Ventures ×2
(F1+F2), billiv ×2, Eutopia ×2, Flexliving ×2, Mineral ×2, Onima ×2
(doublon OS assumé), Virgil Properties ×2.

Les fichiers (`report_files` → `documents`) suivront le même fan-out au
Lot 3 : 405 fichiers source → ~450 écritures documents (à recompter après
arbitrage Virgil et décision D5 sur les 121 images inline).

## À arbitrer avant le GO (rien n'est tranché ici)

1. **Virgil ×15** : le champ `domain` source de « Virgil » vaut
   `parallel-invest.com` (domaine de la **plateforme**, porté par 11 SPV
   Parallel côté OS) + `wearevirgil.com` en secondaire. Règle brute = 15
   cibles. **Reco** : ignorer `parallel-invest.com` pour cette source → 4
   cibles `wearevirgil.com` (VIRGIL SAS, Properties 2020, Properties 2025,
   Inari 2023) + PARALLEL INVEST SPV2 (Virgil) via la note CSV #168 = 5.
2. **5 conflits de domaine** (les deux côtés remplis, valeurs différentes —
   la règle stricte les rend orphelins alors que le CSV #168 propose une
   cible nom plausible) : Arkéa (`arkea-reim.com` vs
   `site.arkea-banque-ei.com`), Chilli (`chilli.club` vs `regroop.org`),
   Klara (`klarahr.com` vs `mooveo.co`), MIO Group (`miogroup.com` vs
   `hellomio.com`), Revolte (`revolte.club` vs `revoltegarages.com`).
   **Reco** : garder la cible nom du CSV #168 (17 reports récupérés).
3. **Artefact → LA VIRGULE** : match domaine inattendu (`artefact.eco` porté
   par « LA VIRGULE » côté OS) là où le CSV #168 ne proposait rien — à
   confirmer ou à exclure.
4. **Vrais orphelins restants** : Marble (albo, 2 reports,
   `marble.studio`) et Sant Roch (calte, 4 reports, URL framer) — créer la
   company OS ou mapper à la main.
5. **Doublons OS servis en double** (conforme à la consigne, rappel) :
   Onima → les 2 lignes « ASTERION SIDE ONIMA (ex:YEASTY) » ; Flexliving →
   FLEXLIVING + FLEX LIVING.

## d. Clé d'idempotence proposée (non implémentée)

- **`companyReports`** : champ additif optionnel **`supabaseReportId`**
  (pattern `airtableId`) + index `by_supabase_report` ; clé d'idempotence =
  **(`supabaseReportId`, `companyId`)** — le fan-out crée N lignes pour le
  même report source, une par entité cible ; un re-run upsert/skip sur la
  paire, zéro doublon.
- **`documents`** : champ additif optionnel **`supabaseFileId`** + index ;
  clé = (`supabaseFileId`, `companyId`) — évite de re-télécharger et
  re-stocker les blobs au re-run.
- **Pourquoi pas la dédup existante `(companyId, reportPeriod)`** (celle de
  `reportPipeline.storeReport`) : 23 groupes de collisions source (48
  reports) sur cette paire, 26 reports avec `period_sort_date` NULL et 1
  label de période vide — elle écraserait des lignes légitimes **et
  supprimerait leurs fichiers** (patch en place). La migration passera par
  une mutation interne dédiée, pas par `storeReport`.

## Problèmes adjacents (remontés, non corrigés)

- **26 reports avec `period_sort_date` NULL** (pas seulement CrushON) : les
  labels existent presque tous (« Octobre 2025 », « S1 2025 », « Unknown »,
  1 vide chez Doinsport) mais la clé de tri manque → tri UI et dédup par
  période dégradés. Liste exhaustive dans le CSV (colonne
  `period_sort_date` vide). Décision au cas par cas côté Albo.
- 8 reports archivés (dont l'unique report d'iArtisan), 11 `is_duplicate`,
  1 non-`completed` — sort à trancher (D5 du cadrage).
- iArtisan + Renovation Man → **même cible OS** `I ARTISAN (renovation man)`
  (les deux sources partagent `i-artisan.fr`).
- Domaines OS invisibles en read-only (cf. §a) : à re-vérifier dans le
  dry-run Convex du Lot 1.

**STOP — fin du Lot 0.** Prochaine étape sur GO : Lot 1 = module de
migration (schéma additif + dry-run Convex + écriture org albo uniquement).
