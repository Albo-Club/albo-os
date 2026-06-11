/**
 * Normalization for the transactions full-text search: lowercase +
 * diacritics removal (case/accent insensitive). The Convex search index
 * tokenizer does no accent folding — so we store already-normalized text
 * (`searchText`) and normalize the user input the same way on the query
 * side.
 *
 * Mirror copy of `src/lib/searchText.ts` (convex/ and src/ share no runtime
 * modules) — keep both in sync.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Derived `searchText` field of a transaction: raw label + counterparty,
 * normalized. Call it on EVERY transaction write (insert or patch of
 * `rawLabel`/`counterparty`) — a row without `searchText` is invisible to
 * search until `transactions:backfillSearchText` has run.
 */
export function buildSearchText(
  rawLabel: string,
  counterparty?: string | null,
): string {
  return normalizeSearch(`${rawLabel} ${counterparty ?? ''}`)
}
