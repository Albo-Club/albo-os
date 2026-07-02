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

## Chantier : migration des reports Albo App (Supabase) → `companyReports`

Reprise de l'historique des reports investisseurs de l'ancienne app Albo
(Supabase `kpvbcqilzfeitxzwhmou`, workspaces « Albo 1 » → org albo et
« CALTE portfolio » → org calte ; 390 reports, 405 fichiers). État :
**dry-run terminé, écriture en attente de GO.**

- **Constat Lot 0 (proxy)** : `LOT0_MIGRATION_REPORTS_2026-07-02.md` (PR #169,
  domaines OS reconstruits depuis les fichiers d'import).
- **Dry-run sur les VRAIS domaines prod** : `LOT0B_DRYRUN_REPORTS_2026-07-03.md`
  + `MAPPING_REPORTS_RESOLUTION_FINALE_2026-07-03.csv` (PR #171) — jointure
  domaine-d'abord/nom-en-fallback recalculée via le MCP (`listCompanies`
  expose `domain`), 420 écritures attendues (400 hors archivés/doublons).
- **Idempotence (posée au schéma, non exécutée)** : clé d'upsert
  (`companyReports.supabaseReportId`, `companyId`) via `by_supabase_report` ;
  fichiers idem via `documents.supabaseFileId` + `by_supabase_file`. La dédup
  `(companyId, reportPeriod)` est disqualifiée (collisions + périodes NULL).
- **À trancher avant le GO** : domaines de plateforme (3+ entités OS), 5
  conflits de domaine (17 reports), orphelins Marble + Sant Roch, Onima ×1
  vs ×2, Artefact→LA VIRGULE — liste complète dans le doc LOT0B.
