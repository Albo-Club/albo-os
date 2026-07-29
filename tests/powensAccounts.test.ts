/**
 * Pure tests for the Powens account matching (convex/lib/powensAccounts.ts):
 * the rule that keeps a reconnection from duplicating a bank.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchExistingAccount } from '../convex/lib/powensAccounts'
import type {
  IncomingAccount,
  MatchCandidate,
} from '../convex/lib/powensAccounts'

const IBAN = 'FR76 3000 4000 0300 0000 0000 123'

function incoming(over: Partial<IncomingAccount> = {}): IncomingAccount {
  return {
    bankName: 'Palatine',
    accountName: 'COMPTE COURANT GG21 CALTE',
    soleAccountOfBank: false,
    ...over,
  }
}

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: 'acc1',
    bankName: 'Palatine',
    label: 'COMPTE COURANT GG21 CALTE',
    ...over,
  }
}

describe('IBAN match (rule 1)', () => {
  it('takes over an account already linked to a dead Powens id', () => {
    // The reconnection hands out a new account id for the same real account.
    const match = matchExistingAccount(
      [candidate({ iban: IBAN, powensAccountId: 'old-42' })],
      incoming({ iban: 'fr7630004000030000000000123' }),
    )
    assert.deepEqual(match, { kind: 'iban', id: 'acc1' })
  })

  it('ignores archived records', () => {
    const match = matchExistingAccount(
      [candidate({ iban: IBAN, archivedAt: 1 })],
      incoming({ iban: IBAN }),
    )
    assert.equal(match, null)
  })

  it('refuses to guess when two records share the IBAN', () => {
    const match = matchExistingAccount(
      [candidate({ id: 'a', iban: IBAN }), candidate({ id: 'b', iban: IBAN })],
      incoming({ iban: IBAN }),
    )
    assert.deepEqual(match, { kind: 'ambiguous', ids: ['a', 'b'] })
  })
})

describe('label match (rule 2)', () => {
  it('matches an unlinked record of the same bank by account name', () => {
    // Nantissement/titres accounts come without an IBAN.
    const match = matchExistingAccount(
      [
        candidate({ id: 'courant', label: 'COMPTE COURANT GG21 CALTE' }),
        candidate({ id: 'titres', label: 'Nantissement Titres' }),
      ],
      incoming({ accountName: 'nantissement titres', iban: undefined }),
    )
    assert.deepEqual(match, { kind: 'label', id: 'titres' })
  })

  it('matches on the display name too', () => {
    const match = matchExistingAccount(
      [candidate({ label: 'Compte 0001', displayName: 'Nantissement Titres' })],
      incoming({ accountName: 'Nantissement Titres', iban: undefined }),
    )
    assert.deepEqual(match, { kind: 'label', id: 'acc1' })
  })

  it('never steals a record already linked to another connection', () => {
    const match = matchExistingAccount(
      [candidate({ label: 'Nantissement Titres', powensAccountId: 'other' })],
      incoming({ accountName: 'Nantissement Titres', iban: undefined }),
    )
    assert.equal(match, null)
  })

  it('does not cross banks', () => {
    const match = matchExistingAccount(
      [candidate({ bankName: 'Wormser', label: 'Nantissement Titres' })],
      incoming({ accountName: 'Nantissement Titres', iban: undefined }),
    )
    assert.equal(match, null)
  })

  it('refuses to guess between two same-named records', () => {
    const match = matchExistingAccount(
      [
        candidate({ id: 'a', label: 'Nantissement Titres' }),
        candidate({ id: 'b', label: 'Nantissement Titres' }),
      ],
      incoming({ accountName: 'Nantissement Titres', iban: undefined }),
    )
    assert.deepEqual(match, { kind: 'ambiguous', ids: ['a', 'b'] })
  })
})

describe('lone account (rule 3)', () => {
  it('matches the renamed lone record of a bank (the Qonto case)', () => {
    const match = matchExistingAccount(
      [candidate({ id: 'qonto', bankName: 'Qonto', label: 'Qonto — Good' })],
      incoming({
        bankName: 'Qonto',
        accountName: 'Main',
        soleAccountOfBank: true,
      }),
    )
    assert.deepEqual(match, { kind: 'sole', id: 'qonto' })
  })

  it('stays out when the connection delivers several accounts', () => {
    // Palatine delivers 5 accounts: a name mismatch must NOT bind the first
    // free record of the bank.
    const match = matchExistingAccount(
      [candidate({ id: 'legacy', label: 'PALATINE' })],
      incoming({ soleAccountOfBank: false }),
    )
    assert.equal(match, null)
  })

  it('stays out when the bank has several free records', () => {
    const match = matchExistingAccount(
      [
        candidate({ id: 'a', label: 'Compte A' }),
        candidate({ id: 'b', label: 'Compte B' }),
      ],
      incoming({ accountName: 'Main', soleAccountOfBank: true }),
    )
    assert.equal(match, null)
  })

  it('never binds a record whose IBAN contradicts the payload', () => {
    const match = matchExistingAccount(
      [candidate({ iban: 'FR7611111111111111111111111' })],
      incoming({ iban: IBAN, soleAccountOfBank: true }),
    )
    assert.equal(match, null)
  })
})
