# Lot 0-bis — Dry-run de la jointure sur les VRAIS domaines prod

**Date** : 03/07/2026. **Nature** : dry-run **read-only** (aucune écriture de
report, aucune mutation, zéro donnée modifiée). Suite du Lot 0
(`LOT0_MIGRATION_REPORTS_2026-07-02.md`, PR #169) dont les chiffres reposaient
sur des domaines OS **reconstruits par proxy**. Cette phase recalcule la
jointure sur les domaines réellement en prod, exposés en lecture seule via le
MCP (`listCompaniesInternal` renvoie désormais `domain` — PR #171).

**Livrable jumeau** : `MAPPING_REPORTS_RESOLUTION_FINALE_2026-07-03.csv` —
390 lignes, une par report source, cibles/méthode/flags recalculés.
**Checkpoint : STOP à la fin de ce document.** Aucune écriture tant que le CSV
final, les domaines de plateforme et les orphelins/conflits ne sont pas
tranchés.

---

## Fiabilité des entrées

- **Source (Supabase)** : re-tirée en live et vérifiée **byte-identique** au
  Lot 0 — md5 des 390 ids par workspace ET md5 des flags
  (archive/doublon/statut/période) identiques. 183 reports albo (34
  companies), 207 calte (82 companies).
- **Cible (Convex prod)** : domaines réels lus via MCP après déploiement.
  Remplissage réel : **albo 44/45** entités actives avec domaine (le proxy
  Lot 0 en voyait 33), **calte 188/280** (proxy : 187, mais pas les mêmes —
  beaucoup d'URLs complètes avec chemin/tracking, normalisées ici).

## Chiffres réels par org

| Org | Méthode | Companies source | Reports | Écritures `companyReports` |
| --- | --- | --- | --- | --- |
| albo | domaine | 33 | 181 | 197 |
| albo | **orphelin** | 1 (Marble) | 2 | 0 |
| **albo total** | | **34** | **183** | **197** (185 hors archivés/doublons/non-completed) |
| calte | domaine | 69 | 167 | 178 |
| calte | mixte (domaine + nom) | 4 (Batch, Flexliving, SIDE Capital, Virgil) | 9 | 32 |
| calte | nom seul | 3 (Inari Properties, Virgil Properties, SCI OUTWORK VERDONNE) | 10 | 13 |
| calte | **conflit de domaine** | 5 (cf. §conflits) | 17 | 0 |
| calte | **orphelin** | 1 (Sant Roch) | 4 | 0 |
| **calte total** | | **82** | **207** | **223** (215 hors archivés/doublons/non-completed) |
| **TOTAL** | | **116** | **390** | **420** (400 net) |

Fan-outs > 1 cible (tous alignés sur les arbitrages validés) : La vie de
quartier ×4, Sezame ×2 (albo) ; Virgil ×5, Batch Ventures ×6, SIDE Capital ×5,
Asterion Ventures ×2, billiv ×2, Eutopia ×2, Flexliving ×2 (doublon OS
assumé), Mineral ×2, Virgil Properties ×2 (calte).

## Domaines de plateforme mutualisés (3+ entités OS — à arbitrer)

Détection automatique sur les domaines **réels** :

| Org | Domaine | Entités | Impact sur la jointure |
| --- | --- | --- | --- |
| albo | `parallel-invest.com` | ×4 (SPV 10, 13, 18, 23) | Aucun (aucune source albo ne porte ce domaine) |
| albo | `laviedequartier.fr` | ×4 (Holding + 3 SCIs) | **Matche la source « La vie de quartier » ×4** — conforme au fan-out validé au Lot 0, mais techniquement un domaine mutualisé : à confirmer |
| calte | `parallel-invest.com` | ×11 (SPV2, 4, 5, 6, 7, 8, 9, 11, 13, 14, 16) | Aucun après décision Virgil (le domaine est ignoré côté source) |
| calte | `anaxago.com` | ×17 (toutes les lignes Anaxago) | Aucun (pas de source Anaxago) |
| calte | `rewatt.fr` | ×10 (REWATT + 9 adresses) | Aucun (la source Rewatt est côté albo, `rewatt.fr` matche l'entité albo unique) |
| calte | `wearevirgil.com` | ×4 (VIRGIL SAS, Properties 2020, 2025, Inari 2023) | **Matche la source « Virgil » ×4** — c'est la base de la décision actée (5 cibles avec SPV2) ; les sources « Virgil Properties » (×2) et « Inari Properties » (×1) passent par nom vers des sous-ensembles de ces mêmes entités |
| calte | `batch.ventures` | ×3 (Fund n°2, Venture 1, CTO Fund) | **Matche la source « Batch Ventures » ×3** (+3 par nom = ×6, fan-out validé) |
| calte | `overseed.fr` | ×3 (SEZAME, SEZAME IMMO 1, SAS OVERSEED) | Aucun (aucune source calte ne porte overseed.fr) |

→ **3 domaines de plateforme touchent la jointure** (`laviedequartier.fr`,
`wearevirgil.com`, `batch.ventures`) et les trois recoupent des fan-outs déjà
validés au Lot 0. Les reports concernés portent le flag `plateforme:<domaine>`
dans le CSV. **Rien n'est résolu d'office : à confirmer au GO.**

## Conflits de domaine (les deux côtés remplis, valeurs différentes — à trancher)

Confirmés sur les vrais domaines (identiques au Lot 0), 17 reports, 0 cible
dans le CSV, cible nom proposée en colonne `conflits_domaine_exclus` :

| Source (domaine source) | Cible nom proposée (domaine OS réel) | Reports |
| --- | --- | --- |
| Arkéa Investment Services (`arkea-reim.com`) | ARKEA (`site.arkea-banque-ei.com`) | 2 |
| Chilli (`chilli.club`) | Roundtable Regroop (Chilli.club) (`regroop.org`) | 4 |
| Klara (`klarahr.com`) | SIDE KLARA (MOOVEO) (`mooveo.co`) | 6 |
| MIO Group (`miogroup.com`) | MIO Agence Marketing Pote Benhamou (`hellomio.com`) | 2 |
| Revolte (`revolte.club`) | REVOLTE (`revoltegarages.com`) | 3 |

Reco inchangée (Lot 0) : garder la cible nom → récupère les 17 reports.

## Orphelins (liste nominative)

- **albo — Marble** (`marble.studio`, 2 reports : « 2025 »,
  « Q1 2026 ») : aucune entité OS albo ne porte ce domaine ni de cible #168.
  Créer la company OS ou mapper à la main.
- **calte — Sant Roch** (URL source `santroch.framer.website`, 4 reports :
  March 2026 ×2, March-May 2026, May 2026) : aucune entité OS, aucune cible
  #168.

## Écarts vs Lot 0 (l'essentiel tient)

1. **Totaux** : albo **197 écritures, identiques** ; calte **235 → 223**
   (−12), entièrement expliqué par les deux points suivants. Total 432 → 420.
2. **Virgil ×15 → ×5** : application de la décision actée
   (`parallel-invest.com` ignoré). Les 4 cibles `wearevirgil.com` sont
   **confirmées par les domaines réels** + SPV2 (Virgil) par nom.
3. **Onima ×2 → ×1 (−2 écritures)** — *seul écart non anticipé* : le Lot 0
   servait le report aux **deux** lignes « ASTERION SIDE ONIMA (ex:YEASTY) »
   (doublon OS assumé, les deux sur `genopole.fr` d'après le proxy). En prod
   réelle, une ligne porte `genopole.fr/...` (matche) mais l'autre porte
   **`onima.bio`** → la règle stricte l'exclut. **À trancher** : garder ×1
   (règle stricte) ou forcer ×2 (doublon assumé du Lot 0).
4. **Albo passe intégralement en domaine** : La vie de quartier, Loewi et
   Sezame matchaient par nom au Lot 0 (le proxy voyait les SPVs sans
   domaine) ; en prod ils ont des domaines et matchent par **domaine**, vers
   **exactement les mêmes cibles**. Le remplissage réel albo est 44/45 (vs
   33/45 estimé) — le proxy attioAlboImport sous-estimait fortement.
5. **Artefact → LA VIRGULE confirmé** : `artefact.eco` est réellement porté
   par « LA VIRGULE » en prod (ce n'était pas un artefact du proxy Airtable).
   Le CSV #168 ne proposait rien — à confirmer ou exclure au GO.
6. Reclassement cosmétique : les 5 conflits étaient étiquetés « orphelin »
   au Lot 0, ils ont leur propre méthode `conflit` dans le CSV final.

## Problèmes adjacents (remontés, non corrigés — inchangés vs Lot 0)

- 26 reports `period_sort_date` NULL (flag `periode_null` dans le CSV), dont
  1 label de période vide (Doinsport, seul report non-`completed`).
- 8 archivés, 11 `is_duplicate` : **migrés avec leur flag d'origine**
  (décision actée, filtrage à l'affichage). ⚠️ Le schéma `companyReports`
  n'a pas encore de champ pour porter ces flags — à décider au Lot 1 (champ
  additif type `supabaseFlags` ou champs dédiés), hors périmètre de cette
  phase (seule modif de schéma autorisée : les ancres d'idempotence).
- iArtisan + Renovation Man → même cible OS `I ARTISAN (renovation man)`
  (confirmé par les domaines réels, `i-artisan.fr` des deux côtés).
- Doublons OS servis en double : Flexliving → FLEXLIVING + FLEX LIVING
  (assumé) ; Onima ne l'est **plus** sur données réelles (cf. écart n°3).

## Clé d'idempotence (posée au schéma dans cette PR, non exécutée)

`companyReports.supabaseReportId` + index `by_supabase_report`
(`supabaseReportId`, `companyId`) ; `documents.supabaseFileId` + index
`by_supabase_file`. Un re-run d'import upsert sur la paire — le fan-out crée
une ligne par cible, zéro doublon possible. La dédup existante
`(companyId, reportPeriod)` reste **disqualifiée** (décision actée).

**STOP — checkpoint.** Prochaine étape sur GO explicite, après arbitrage :
domaines de plateforme (§ci-dessus), 5 conflits, 2 orphelins, Onima ×1 vs ×2,
Artefact→LA VIRGULE.
