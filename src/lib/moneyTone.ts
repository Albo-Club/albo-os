/**
 * Classes de couleur sémantiques des mouvements d'argent (tokens `positive` /
 * `destructive` de brand.css) — à utiliser partout où un sens (entrée/sortie)
 * ou un signe (créance/dette) est affiché, pour rester cohérent.
 */

/** Montant signé par son sens : entrée en vert, sortie en rouge. */
export function directionTone(direction: 'in' | 'out'): string {
  return direction === 'out' ? 'text-destructive' : 'text-positive'
}

/** Solde signé : positif (créance) en vert, négatif (dette) en rouge. */
export function signTone(cents: number): string {
  return cents >= 0 ? 'text-positive' : 'text-destructive'
}

/** Badge teinté (avec `variant="outline"`) : entrée/créance vs sortie/dette. */
export function directionBadgeClass(positive: boolean): string {
  return positive
    ? 'border-positive/40 bg-positive/10 text-positive'
    : 'border-destructive/40 bg-destructive/10 text-destructive'
}
