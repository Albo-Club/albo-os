/**
 * Format a SIREN for display: when the value is exactly 9 digits (spaces
 * ignored), group it in threes with regular spaces ("552178639" →
 * "552 178 639"). Any other value is returned unchanged; null/undefined
 * return ''. Display-only — stored values stay unformatted.
 */
export function formatSiren(siren: string | null | undefined): string {
  if (siren == null) return ''
  const cleaned = siren.replace(/\s/g, '')
  if (!/^\d{9}$/.test(cleaned)) return siren
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
}
