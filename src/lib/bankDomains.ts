/**
 * bankName → website domain, feeding the logo.dev hotlink (same CDN and
 * component as company logos — CompanyLogo). Matching is on the normalized
 * name (lowercase, accents and non-letters stripped) and tolerates prefixes
 * like « Banque Palatine ». Unknown banks fall back to CompanyLogo's icon.
 */
const BANK_DOMAINS: ReadonlyArray<{ key: string; domain: string }> = [
  { key: 'qonto', domain: 'qonto.com' },
  { key: 'palatine', domain: 'palatine.fr' },
  { key: 'hsbc', domain: 'hsbc.com' },
  { key: 'memobank', domain: 'memo.bank' },
  { key: 'neuflize', domain: 'neuflizeobc.fr' },
  { key: 'wormser', domain: 'banque-wormser.fr' },
]

export function bankDomain(bankName: string | null | undefined): string | null {
  if (!bankName) return null
  const normalized = bankName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  if (normalized === '') return null
  return (
    BANK_DOMAINS.find(({ key }) => normalized.includes(key))?.domain ?? null
  )
}
