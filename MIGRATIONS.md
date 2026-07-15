# Migrations & opérations de données (prod)

Index des opérations one-shot sur la base prod. Les runbooks détaillés vivent
dans les doc-comments des modules concernés (« link, don't duplicate ») — ce
fichier liste _quoi existe_ et _où_, plus les chantiers en cours.

**Règle invariable avant toute opération destructive :**

```bash
# snapshot de secours (`--path` est obligatoire : répertoire ou .zip)
pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
```

## Opérations disponibles

| Opération                                                            | Module / commande                                                                                           | Notes                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed multi-org (Calte + Albo)                                        | `convex/seed.ts` → `seed:seedAll`                                                                           | Idempotent (upsert par slug/name). Runbook complet en tête du fichier.                                                                                                                                         |
| Purge de l'ancienne org combinée                                     | `convex/seed.ts` → `seed:cleanupLegacy`                                                                     | Idempotent (no-op si l'org legacy est absente).                                                                                                                                                                |
| Import Airtable → Convex                                             | `convex/airtableImport.ts` → `airtableImport:runImport`                                                     | Idempotent via `airtableId`. Vérifs : `verify`, `duplicateReport`, `reconcileOrphans`, `cleanupTestData`. Runbook en tête du fichier.                                                                          |
| Purge table legacy `forecasts`                                       | `convex/seed.ts` → `seed:purgeLegacyForecasts`                                                              | Cf. chantier ci-dessous.                                                                                                                                                                                       |
| Scénario de test passif                                              | `convex/liabilities.ts` → `liabilities:seedTestScenario` / `cleanupTestScenario`                            | Données marquées `[TEST liabilities]`, purge idempotente.                                                                                                                                                      |
| Backfills transactions (`matchStatus` / `allocation` / `searchText`) | `convex/transactions.ts` → `transactions:backfillMatchStatus` / `backfillAllocation` / `backfillSearchText` | Idempotents. `'{}'` = toutes les orgs (`backfillAllocation` reste par org). À relancer après tout import historique antérieur à ces champs — cf. `KNOWN_ISSUES.md` « Pointage » et « Recherche transactions ». |
| Import instruments Albo (docs juridiques Drive)                      | `convex/migrations/alboInstrumentImport.ts` → `dryRun` / `apply` / `verify`                                 | Idempotent (ne remplit que les champs vides ; requalification Keenest par valeur). Ancré par `_id` prod + garde nom de cible. Runbook en tête du module.                                                        |
| Import instruments Calte (SPV Parallel, contrats d'émission Drive)   | `convex/migrations/calteInstrumentImport.ts` → `dryRun` / `apply` / `verify`                                | Idempotent (champs vides uniquement ; rapport `mismatches` si un champ déjà rempli diffère du doc). Lot obligations SPV 4·5·6·7·11·13 (principal, taux, coupon, remboursement) + SPV 9 requalifié `os`→`oc` (OCA, taux 12 %). Hors périmètre : SPV 18 (annulé, supprimé à la main), 14/17 (contrat absent), 2 (exited), 8/16 (equity). Ancré par `_id` prod + garde nom. Runbook en tête du module. |
| Import identité entités Albo (docs juridiques Drive + liens Attio)   | `convex/migrations/alboIdentityImport.ts` → `dryRun` / `apply` / `verify`                                   | Idempotent (champs vides uniquement ; `people` posé seulement si absent ; unicité SIREN re-vérifiée). Ancré par `_id` prod + garde nom. Runbook en tête du module.                                              |
| Import résumés Albo (sites officiels, recherche 14/07/2026)          | `convex/migrations/alboSummaryImport.ts` → `dryRun` / `apply` / `verify`                                    | Idempotent (champs vides uniquement : `summary` des 35 startups opérationnelles + 2 `domain` manquants, Redesk/Loewi). Ancré par `_id` prod + garde nom. Runbook en tête du module.                             |
| Nettoyage des domaines corrompus (markdown/URL → hostname) toutes orgs | `convex/migrations/normalizeCompanyDomains.ts` → `dryRun` / `apply` / `report`                            | Réécrit `companies.domain` via `normalizeDomain` (retire wrapper markdown, protocole, chemin/query, `www`). Idempotent (n'écrit que si ça change), non destructif (illisible → `needsManualReview`). Débloque logos + enrichissement. **À lancer AVANT le backfill.** Runbook en tête du module. |
| Rattrapage enrichissement auto (one-liner + résumé) toutes orgs      | `convex/migrations/backfillCompanyEnrichment.ts` → `dryRun` / `apply` / `report`                            | Rejoue `companyEnrichment.enrich` sur toute entité portfolio (Calte + Albo) avec domaine + champ vide (l'auto est forward-only). Additive, idempotent, staggeré. **Exclut** les lignes non-sociétés (SIDE, Anaxago, SPV, fonds, véhicules, capitalisation — cf. `classifyExclusion`) ; `dryRun` montre `willEnrich` vs `excluded`. Runbook en tête du module. |
| Scories du 1er passage non filtré (résumés à tort) toutes orgs       | `convex/migrations/backfillCompanyEnrichment.ts` → `listEnrichedNonCompanies` / `clearByIds` / `clearByReason` | Le tout 1er backfill (#201) tournait sans filtre → des non-sociétés joignables ont reçu un résumé. `listEnrichedNonCompanies` (lecture seule) liste les entités motif-exclu **portant déjà** un texte. `clearByReason` vide des **buckets entiers** de motifs (plateformes/véhicules type `parallel_spv`, `anaxago_line`, `named_vehicle`… — **jamais** `side_deal` ni `lvdq_sub_entity`) ; `clearByIds` vide une **liste d'id** précise. |
| Unification du pitch par domaine (existant) toutes orgs              | `convex/migrations/unifyDomainPitches.ts` → `dryRun` / `apply` / `report`                                    | Fige un même `oneLiner`+`summary` sur toutes les entités partageant un domaine (par org). Canonique = résumé le plus long du groupe (`lib/pitch.ts:pickCanonicalPitch`), écrit sur tous. Idempotent (groupes déjà identiques ou sans résumé ignorés). Corrige la dérive existante (ex. La Vie de Quartier). Runbook en tête du module. |
| Description Parallel via VASCO (one-liner + résumé des SPV) toutes orgs | `convex/companyEnrichment.ts` → `companyEnrichment:backfillVascoPitches`                                    | Décrit **chaque entité Parallel rattachée** (portfolio + `vascoIssuerId`) à partir de ses communications VASCO en cache. **Écrase** `oneLiner`+`summary` (la description d'opération VASCO supplante celle du domaine, inadaptée aux SPV). Rafraîchit le cache par org d'abord. Org-agnostique (toute org avec une connexion VASCO active — Calte, Albo si branchée). Aussi déclenché **auto au rattachement** (`setVascoLink`). Non idempotent (régénère à chaque passage). Ancre : le lien `vascoClientSlug`+`vascoIssuerId`. |
| Backfill Attio → deals (Term Sheet en cours)                         | `convex/attioSync.ts` → `attioSync:backfillTermSheets`                                                       | Importe les deals **actuellement** en Term Sheet dans Attio (le webhook ne prend que le futur). Query paginée, filtre stage TS par id, chacun dans `upsertFromDeal` (idempotent sur `attioDealId`, **ne crée jamais sur Invested** → pas de doublon avec le portefeuille déjà importé). Re-run sûr. Cf. `KNOWN_ISSUES.md` « Sync Attio → deals ». |

Les ponts Attio (`attioCompanyId` / `attioDealId`) et l'ingestion Powens sont
des flux **continus**, pas des migrations — cf. `KNOWN_ISSUES.md`
(« Ingestion Powens ») et `CLAUDE.md` (frontière d'attribution Attio).

## Chantier : retrait de la table legacy `forecasts`

La table `forecasts` est inerte (alimentée par l'import Airtable uniquement,
lue par rien — le prévisionnel vit dans `forecastRules`/`forecastEntries`,
cf. `KNOWN_ISSUES.md` « Cash flow forecast »). Retrait en deux temps,
conformément à la règle « purger d'abord, resserrer ensuite » :

1. **Purge (à exécuter en prod)** :

   ```bash
   pnpm exec convex export --prod --path ./albo-backup.zip
   pnpm exec convex run --prod seed:purgeLegacyForecasts
   ```

2. **PR de suivi** (après purge effective) : retirer la table `forecasts` du
   `convex/schema.ts`, la dérivation `prevRentree`/`prevSortie` de l'import
   Airtable, et la section correspondante de `KNOWN_ISSUES.md`.
