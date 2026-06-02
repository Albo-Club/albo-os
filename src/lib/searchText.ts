/**
 * Normalisation pour la recherche : minuscules + suppression des diacritiques
 * (insensible casse/accents). Appliquée des deux côtés de la comparaison
 * (donnée et saisie utilisateur).
 *
 * Copie miroir de `convex/lib/searchText.ts` (convex/ et src/ ne partagent
 * pas de modules runtime) — garder les deux en phase.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
