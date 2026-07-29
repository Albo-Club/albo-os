/**
 * Identity of a Powens payload account vs the bank accounts already recorded
 * for an org — the rule that keeps a reconnection from duplicating a bank.
 *
 * Why it exists: a reconnection (and above all a fresh « Connecter une
 * banque » on a bank that is already connected) hands out BRAND NEW Powens
 * account ids for the very same real accounts. Resolving by
 * `powensAccountId` alone then misses, the ingestion creates a second row,
 * and the first one keeps its dead link — the bank appears twice and alerts
 * forever. Cf. KNOWN_ISSUES.md « Ingestion Powens ».
 *
 * Pure function (no ctx) so the rules are unit-tested — cf.
 * `tests/powensAccounts.test.ts`.
 */

/** Diacritics-folded, lowercased, trimmed. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Like `normalizeName` but also collapses internal whitespace — to compare
 * multi-word labels ("Neuflize OBC - Compte à terme"). */
export function squashName(s: string): string {
  return normalizeName(s).replace(/\s+/g, ' ')
}

export function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}

/** The fields of a `bankAccounts` row the matching looks at. */
export type MatchCandidate = {
  id: string
  bankName: string
  label: string
  displayName?: string
  iban?: string
  powensAccountId?: string
  archivedAt?: number
}

/** The payload account being resolved. `bankName` is our own bank label
 * (connector → entity mapping) or, failing that, the connector name. */
export type IncomingAccount = {
  bankName: string
  accountName?: string
  iban?: string
  /** The connection delivers this ONE account for that bank. Lets a lone
   * renamed account still be recognized (the Qonto record imported from
   * Airtable, whose label never matches the bank's). */
  soleAccountOfBank: boolean
}

export type AccountMatch =
  | { kind: 'iban' | 'label' | 'sole'; id: string }
  | { kind: 'ambiguous'; ids: Array<string> }
  | null

/**
 * Resolution order, strongest signal first:
 *
 * 1. **IBAN** — the only signal strong enough to take over an account
 *    ALREADY linked to another (stale) Powens id: same IBAN = same account.
 * 2. **Same bank + same account name**, among the records not yet linked —
 *    catches the accounts Powens delivers without an IBAN (nantissement,
 *    titres).
 * 3. **Lone account of a lone record** — the connection delivers a single
 *    account for that bank and the org holds a single unlinked record for
 *    it. Covers the renamed account (Qonto).
 *
 * Rules 2 and 3 never touch an already-linked record, and never match a
 * record whose IBAN contradicts the payload. A tie on rule 1 or 2 returns
 * `ambiguous`: the caller must write nothing rather than guess.
 */
export function matchExistingAccount(
  candidates: ReadonlyArray<MatchCandidate>,
  incoming: IncomingAccount,
): AccountMatch {
  const live = candidates.filter((c) => !c.archivedAt)
  const iban = incoming.iban ? normalizeIban(incoming.iban) : null

  if (iban) {
    const hits = live.filter((c) => c.iban && normalizeIban(c.iban) === iban)
    if (hits.length === 1) return { kind: 'iban', id: hits[0].id }
    if (hits.length > 1) {
      return { kind: 'ambiguous', ids: hits.map((c) => c.id) }
    }
  }

  const pool = live.filter(
    (c) =>
      !c.powensAccountId &&
      squashName(c.bankName) === squashName(incoming.bankName) &&
      !(iban && c.iban && normalizeIban(c.iban) !== iban),
  )

  const name = incoming.accountName ? squashName(incoming.accountName) : null
  if (name) {
    const hits = pool.filter(
      (c) =>
        squashName(c.label) === name ||
        (c.displayName != null && squashName(c.displayName) === name),
    )
    if (hits.length === 1) return { kind: 'label', id: hits[0].id }
    if (hits.length > 1) {
      return { kind: 'ambiguous', ids: hits.map((c) => c.id) }
    }
  }

  if (incoming.soleAccountOfBank && pool.length === 1) {
    return { kind: 'sole', id: pool[0].id }
  }
  return null
}
