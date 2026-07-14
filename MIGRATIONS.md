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
| Import identité entités Albo (docs juridiques Drive + liens Attio)   | `convex/migrations/alboIdentityImport.ts` → `dryRun` / `apply` / `verify`                                   | Idempotent (champs vides uniquement ; `people` posé seulement si absent ; unicité SIREN re-vérifiée). Ancré par `_id` prod + garde nom. Runbook en tête du module.                                              |
| Import résumés Albo (sites officiels, recherche 14/07/2026)          | `convex/migrations/alboSummaryImport.ts` → `dryRun` / `apply` / `verify`                                    | Idempotent (champs vides uniquement : `summary` des 35 startups opérationnelles + 2 `domain` manquants, Redesk/Loewi). Ancré par `_id` prod + garde nom. Runbook en tête du module.                             |
| Nettoyage des domaines corrompus (markdown/URL → hostname) toutes orgs | `convex/migrations/normalizeCompanyDomains.ts` → `dryRun` / `apply` / `report`                            | Réécrit `companies.domain` via `normalizeDomain` (retire wrapper markdown, protocole, chemin/query, `www`). Idempotent (n'écrit que si ça change), non destructif (illisible → `needsManualReview`). Débloque logos + enrichissement. **À lancer AVANT le backfill.** Runbook en tête du module. |
| Rattrapage enrichissement auto (one-liner + résumé) toutes orgs      | `convex/migrations/backfillCompanyEnrichment.ts` → `dryRun` / `apply` / `report`                            | Rejoue `companyEnrichment.enrich` sur toute entité portfolio (Calte + Albo) avec domaine + champ vide (l'auto est forward-only). Additive, idempotent, staggeré. **Exclut** les lignes non-sociétés (SIDE, Anaxago, SPV, fonds, véhicules — cf. `classifyExclusion`) ; `dryRun` montre `willEnrich` vs `excluded`. Runbook en tête du module. |

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
