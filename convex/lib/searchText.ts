/**
 * Normalisation pour la recherche full-text des transactions : minuscules +
 * suppression des diacritiques (insensible casse/accents). Le tokenizer du
 * search index Convex ne fait pas de folding d'accents — on stocke donc un
 * texte déjà normalisé (`searchText`) et on normalise la saisie utilisateur
 * de la même façon côté query.
 *
 * Copie miroir de `src/lib/searchText.ts` (convex/ et src/ ne partagent pas
 * de modules runtime) — garder les deux en phase.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Champ dérivé `searchText` d'une transaction : libellé brut + contrepartie,
 * normalisés. À appeler à CHAQUE écriture de transaction (insert ou patch de
 * `rawLabel`/`counterparty`) — une ligne sans `searchText` est invisible à la
 * recherche tant que `transactions:backfillSearchText` n'a pas tourné.
 */
export function buildSearchText(
  rawLabel: string,
  counterparty?: string | null,
): string {
  return normalizeSearch(`${rawLabel} ${counterparty ?? ''}`)
}
