import { useTranslation } from 'react-i18next'

/**
 * Formatters of the Immobilier surfaces. Two money families on purpose, per
 * the house rule « l'actuel au centime, l'estimé arrondi » (CLAUDE.md):
 *
 * - `fmtEurCents` for what came out of a bank account — the cost-basis line
 *   items, the rents received, the charges paid, the matched transactions.
 * - `fmtEur` (rounded) for the steering figures — a valuation, a latent
 *   gain, the portfolio total. Centimes there would suggest a precision an
 *   estimate does not have.
 */
export function usePropertyFormatters() {
  const { i18n } = useTranslation('immobilier')
  const lang = i18n.language
  const money = (cents: number, digits: number) =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(cents / 100)
  return {
    fmtEur: (cents: number) => money(cents, 0),
    fmtEurCents: (cents: number) => money(cents, 2),
    /** Signed, for a latent gain — the sign is the information. */
    fmtEurSigned: (cents: number) =>
      `${cents > 0 ? '+ ' : cents < 0 ? '− ' : ''}${money(Math.abs(cents), 0)}`,
    fmtPercent: (ratio: number | null) =>
      ratio == null
        ? '—'
        : new Intl.NumberFormat(lang, {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(ratio),
    fmtDate: (ms: number) =>
      new Date(ms).toLocaleDateString(lang, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    fmtMonthYear: (ms: number) =>
      new Date(ms).toLocaleDateString(lang, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
  }
}
