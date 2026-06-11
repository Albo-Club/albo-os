# Migrations & opérations de données (prod)

Index des opérations one-shot sur la base prod. Les runbooks détaillés vivent
dans les doc-comments des modules concernés (« link, don't duplicate ») — ce
fichier liste _quoi existe_ et _où_, plus les chantiers en cours.

**Règle invariable avant toute opération destructive :**

```bash
pnpm exec convex export --prod   # snapshot de secours
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
| Purge champ legacy `users.lastOrgSlug`                               | `convex/users.ts` → `users:purgeLegacyLastOrgSlug`                                                          | Cf. chantier ci-dessous.                                                                                                                                                                                       |

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
   pnpm exec convex export --prod
   pnpm exec convex run --prod seed:purgeLegacyForecasts
   ```

2. **PR de suivi** (après purge effective) : retirer la table `forecasts` du
   `convex/schema.ts`, la dérivation `prevRentree`/`prevSortie` de l'import
   Airtable, et la section correspondante de `KNOWN_ISSUES.md`.

## Chantier : retrait du champ legacy `users.lastOrgSlug`

La dernière org visitée vit désormais dans la table `userPrefs`
(cf. `KNOWN_ISSUES.md` « Hot `users` row ») ; le champ `users.lastOrgSlug`
n'est plus écrit, seulement lu en fallback quand la ligne `userPrefs`
n'existe pas encore. Retrait en deux temps :

1. **Purge (à exécuter en prod dès que ce code est déployé — la mutation
   migre la valeur legacy vers `userPrefs` avant de la nettoyer, donc pas
   besoin d'attendre que les users se reconnectent ; idempotente)** :

   ```bash
   pnpm exec convex export --prod
   pnpm exec convex run --prod users:purgeLegacyLastOrgSlug
   ```

2. **PR de suivi** (après purge effective) : retirer le champ `lastOrgSlug`
   de la table `users` dans `convex/schema.ts`, le fallback dans
   `convex/lib/userPrefs.ts:getLastOrgSlug`, le nettoyage legacy dans
   `convex/admin.ts:purgeExcept`, et la mutation de purge elle-même.
