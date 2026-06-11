/**
 * Search normalization: lowercase + diacritics removal (case- and
 * accent-insensitive). Applied to both sides of the comparison (stored
 * data and user input).
 *
 * Mirror copy of `convex/lib/searchText.ts` (convex/ and src/ don't share
 * runtime modules) — keep both in sync.
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
