/**
 * Pure tests for the recurrence logic (convex/lib/recurrence.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 *
 * Deliberately OUTSIDE convex/: a `node:test` import inside convex/ would
 * break the Convex deployment bundle.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addMonthsUtc,
  buildMonthlyBalance,
  buildMonthlyHistory,
  entryUpsertAction,
  expandOccurrences,
  isoDay,
  monthKey,
  ruleDerivedKey,
} from '../convex/lib/recurrence'
import type { BalanceEntry, ExistingEntryState } from '../convex/lib/recurrence'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

describe('expandOccurrences — monthly', () => {
  it('génère une occurrence par mois sur le anchorDay', () => {
    const occ = expandOccurrences(
      {
        frequency: 'monthly',
        interval: 1,
        anchorDay: 5,
        startDate: utc(2026, 1, 1),
      },
      utc(2026, 1, 1),
      utc(2026, 4, 30),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ])
  })

  it('clampe anchorDay 31 au dernier jour des mois courts (et revient à 31)', () => {
    const occ = expandOccurrences(
      {
        frequency: 'monthly',
        interval: 1,
        anchorDay: 31,
        startDate: utc(2026, 1, 1),
      },
      utc(2026, 1, 1),
      utc(2026, 4, 30),
    )
    // 2026 is not a leap year → February = 28.
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('clampe au 29 février les années bissextiles', () => {
    const occ = expandOccurrences(
      {
        frequency: 'monthly',
        interval: 1,
        anchorDay: 30,
        startDate: utc(2028, 2, 1),
      },
      utc(2028, 2, 1),
      utc(2028, 3, 1),
    )
    assert.deepEqual(occ.map(isoDay), ['2028-02-29'])
  })

  it('respecte interval = 2 (tous les 2 mois, ancré sur startDate)', () => {
    const occ = expandOccurrences(
      {
        frequency: 'monthly',
        interval: 2,
        anchorDay: 15,
        startDate: utc(2026, 1, 10),
      },
      utc(2026, 1, 1),
      utc(2026, 7, 31),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-15',
      '2026-03-15',
      '2026-05-15',
      '2026-07-15',
    ])
  })

  it("n'émet rien avant startDate ni avant le début de fenêtre", () => {
    const rule = {
      frequency: 'monthly' as const,
      interval: 1,
      anchorDay: 1,
      startDate: utc(2026, 3, 15), // anchorDay 1 in March already past → April 1
    }
    const occ = expandOccurrences(rule, utc(2026, 1, 1), utc(2026, 6, 30))
    assert.deepEqual(occ.map(isoDay), [
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ])

    // Window starting after startDate: earlier occurrences drop out.
    const occ2 = expandOccurrences(rule, utc(2026, 5, 15), utc(2026, 7, 31))
    assert.deepEqual(occ2.map(isoDay), ['2026-06-01', '2026-07-01'])
  })

  it('respecte endDate comme borne incluse', () => {
    const occ = expandOccurrences(
      {
        frequency: 'monthly',
        interval: 1,
        anchorDay: 10,
        startDate: utc(2026, 1, 1),
        endDate: utc(2026, 3, 10), // exactly on the 3rd occurrence
      },
      utc(2026, 1, 1),
      utc(2026, 12, 31),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ])
  })

  it('retourne [] si la fenêtre est vide ou hors plage', () => {
    const rule = {
      frequency: 'monthly' as const,
      interval: 1,
      anchorDay: 1,
      startDate: utc(2026, 1, 1),
      endDate: utc(2026, 6, 30),
    }
    assert.deepEqual(
      expandOccurrences(rule, utc(2027, 1, 1), utc(2027, 6, 30)),
      [],
    )
    assert.deepEqual(
      expandOccurrences(rule, utc(2026, 3, 1), utc(2026, 2, 1)),
      [],
    )
  })
})

describe('expandOccurrences — quarterly / yearly', () => {
  it('trimestriel : ancré sur le mois de startDate', () => {
    const occ = expandOccurrences(
      {
        frequency: 'quarterly',
        interval: 1,
        anchorDay: 1,
        startDate: utc(2026, 3, 1), // March → June → Sept. → Dec.
      },
      utc(2026, 1, 1),
      utc(2026, 12, 31),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-03-01',
      '2026-06-01',
      '2026-09-01',
      '2026-12-01',
    ])
  })

  it('annuel : une occurrence par an, clampée si 29 février', () => {
    const occ = expandOccurrences(
      {
        frequency: 'yearly',
        interval: 1,
        anchorDay: 29,
        startDate: utc(2028, 2, 1), // Feb. 2028, leap year
      },
      utc(2028, 1, 1),
      utc(2030, 12, 31),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ])
  })
})

describe('expandOccurrences — weekly', () => {
  it('tombe sur le jour ISO demandé (1 = lundi … 7 = dimanche)', () => {
    // Jan 1, 2026 is a Thursday (ISO 4). anchorDay 1 → Monday Jan 5.
    const occ = expandOccurrences(
      {
        frequency: 'weekly',
        interval: 1,
        anchorDay: 1,
        startDate: utc(2026, 1, 1),
      },
      utc(2026, 1, 1),
      utc(2026, 1, 31),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ])
    // All Mondays.
    for (const ms of occ) assert.equal(new Date(ms).getUTCDay(), 1)
  })

  it('inclut startDate si elle tombe pile sur le anchorDay', () => {
    // Jan 4, 2026 is a Sunday (ISO 7).
    const occ = expandOccurrences(
      {
        frequency: 'weekly',
        interval: 1,
        anchorDay: 7,
        startDate: utc(2026, 1, 4),
      },
      utc(2026, 1, 1),
      utc(2026, 1, 18),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-04',
      '2026-01-11',
      '2026-01-18',
    ])
  })

  it('respecte interval = 2 (toutes les 2 semaines)', () => {
    const occ = expandOccurrences(
      {
        frequency: 'weekly',
        interval: 2,
        anchorDay: 5, // Friday
        startDate: utc(2026, 1, 1),
      },
      utc(2026, 1, 1),
      utc(2026, 2, 28),
    )
    assert.deepEqual(occ.map(isoDay), [
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
      '2026-02-13',
      '2026-02-27',
    ])
  })
})

describe('idempotence des clés et bucketing', () => {
  it('ruleDerivedKey est stable et formatée "rule:{id}:{YYYY-MM-DD}" en UTC', () => {
    const ms = utc(2026, 2, 28)
    assert.equal(ruleDerivedKey('abc123', ms), 'rule:abc123:2026-02-28')
    // Stable: the same input yields the same key.
    assert.equal(ruleDerivedKey('abc123', ms), ruleDerivedKey('abc123', ms))
    // Insensitive to the time of day within the UTC day.
    assert.equal(
      ruleDerivedKey('abc123', ms + 23 * 60 * 60 * 1000),
      'rule:abc123:2026-02-28',
    )
  })

  it('deux runs de expandOccurrences produisent les mêmes clés (déterminisme)', () => {
    const rule = {
      frequency: 'monthly' as const,
      interval: 1,
      anchorDay: 31,
      startDate: utc(2026, 1, 1),
    }
    const keys1 = expandOccurrences(
      rule,
      utc(2026, 1, 1),
      utc(2026, 12, 31),
    ).map((ms) => ruleDerivedKey('r1', ms))
    const keys2 = expandOccurrences(
      rule,
      utc(2026, 1, 1),
      utc(2026, 12, 31),
    ).map((ms) => ruleDerivedKey('r1', ms))
    assert.deepEqual(keys1, keys2)
    // No duplicate key within a single run.
    assert.equal(new Set(keys1).size, keys1.length)
  })

  it('monthKey bucketise par mois UTC', () => {
    assert.equal(monthKey(utc(2026, 1, 31)), '2026-01')
    assert.equal(monthKey(utc(2026, 12, 1)), '2026-12')
  })

  it('addMonthsUtc clampe le jour en fin de mois', () => {
    assert.equal(isoDay(addMonthsUtc(utc(2026, 1, 31), 1)), '2026-02-28')
    assert.equal(isoDay(addMonthsUtc(utc(2026, 1, 15), 12)), '2027-01-15')
  })
})

describe('entryUpsertAction — protection des entries', () => {
  it("crée si aucune entry n'existe pour la derivedKey", () => {
    assert.equal(entryUpsertAction(null), 'create')
  })

  it('resynchronise une entry dérivée intacte (pending, non éditée)', () => {
    assert.equal(
      entryUpsertAction({ overridden: false, status: 'pending' }),
      'update',
    )
  })

  it('SKIP une entry éditée à la main (overridden) — quel que soit son status', () => {
    assert.equal(
      entryUpsertAction({ overridden: true, status: 'pending' }),
      'skip',
    )
    assert.equal(
      entryUpsertAction({ overridden: true, status: 'realized' }),
      'skip',
    )
  })

  it('SKIP une entry réalisée ou annulée (décision humaine figée)', () => {
    assert.equal(
      entryUpsertAction({ overridden: false, status: 'realized' }),
      'skip',
    )
    assert.equal(
      entryUpsertAction({ overridden: false, status: 'cancelled' }),
      'skip',
    )
  })
})

describe('simulation de régénération (expandRules sans DB)', () => {
  // Reproduces the expandRules loop over an in-memory store keyed by
  // derivedKey: occurrences → entryUpsertAction → create/update/skip.
  // This is exactly the glue of convex/forecasts.ts, without Convex.
  type StoredEntry = ExistingEntryState & { amountCents: number; label: string }

  const rule = {
    frequency: 'monthly' as const,
    interval: 1,
    anchorDay: 1,
    startDate: utc(2026, 1, 1),
  }
  const window = [utc(2026, 1, 1), utc(2026, 6, 30)] as const

  function runExpand(
    store: Map<string, StoredEntry>,
    ruleAmountCents: number,
  ): { created: number; updated: number; skipped: number } {
    let created = 0
    let updated = 0
    let skipped = 0
    for (const occ of expandOccurrences(rule, window[0], window[1])) {
      const key = ruleDerivedKey('rule1', occ)
      const existing = store.get(key) ?? null
      const action = entryUpsertAction(existing)
      if (action === 'create') {
        store.set(key, {
          overridden: false,
          status: 'pending',
          amountCents: ruleAmountCents,
          label: 'Loyer SCI',
        })
        created += 1
      } else if (action === 'update') {
        store.set(key, { ...existing!, amountCents: ruleAmountCents })
        updated += 1
      } else {
        skipped += 1
      }
    }
    return { created, updated, skipped }
  }

  it('run 1 crée, run 2 ne duplique rien (idempotence)', () => {
    const store = new Map<string, StoredEntry>()
    const run1 = runExpand(store, 100000)
    assert.equal(run1.created, 6) // Jan → June
    assert.equal(store.size, 6)

    const run2 = runExpand(store, 100000)
    assert.deepEqual(run2, { created: 0, updated: 6, skipped: 0 })
    assert.equal(store.size, 6) // still 6 — no duplicate
  })

  it('une entry éditée à la main survit à la régénération, les autres suivent la règle', () => {
    const store = new Map<string, StoredEntry>()
    runExpand(store, 100000)

    // Manual edit of the March occurrence: custom amount + overridden.
    const marchKey = ruleDerivedKey('rule1', utc(2026, 3, 1))
    store.set(marchKey, {
      overridden: true,
      status: 'pending',
      amountCents: 123456,
      label: 'Loyer SCI (négocié)',
    })

    // The rule's amount changes, then regeneration.
    const run2 = runExpand(store, 200000)
    assert.deepEqual(run2, { created: 0, updated: 5, skipped: 1 })

    // The manual edit survived.
    assert.equal(store.get(marchKey)?.amountCents, 123456)
    assert.equal(store.get(marchKey)?.label, 'Loyer SCI (négocié)')
    // The other occurrences were indeed resynced.
    const aprilKey = ruleDerivedKey('rule1', utc(2026, 4, 1))
    assert.equal(store.get(aprilKey)?.amountCents, 200000)
  })

  it('une entry réalisée (pointée) survit elle aussi à la régénération', () => {
    const store = new Map<string, StoredEntry>()
    runExpand(store, 100000)

    const janKey = ruleDerivedKey('rule1', utc(2026, 1, 1))
    store.set(janKey, {
      overridden: false,
      status: 'realized',
      amountCents: 99500, // amount actually received
      label: 'Loyer SCI',
    })

    const run2 = runExpand(store, 200000)
    assert.deepEqual(run2, { created: 0, updated: 5, skipped: 1 })
    assert.equal(store.get(janKey)?.amountCents, 99500)
    assert.equal(store.get(janKey)?.status, 'realized')
  })
})

describe('buildMonthlyBalance — solde projeté mensuel', () => {
  const entry = (over: Partial<BalanceEntry>): BalanceEntry => ({
    date: utc(2026, 1, 15),
    amountCents: 100000, // 1 000 €
    direction: 'in',
    confidence: 'confirmed',
    status: 'pending',
    currency: 'EUR',
    ...over,
  })

  it('agrège in/out par mois et cumule le solde projeté', () => {
    const { months } = buildMonthlyBalance({
      entries: [
        entry({ date: utc(2026, 1, 5), direction: 'in', amountCents: 100000 }),
        entry({ date: utc(2026, 1, 20), direction: 'out', amountCents: 30000 }),
        entry({ date: utc(2026, 2, 5), direction: 'out', amountCents: 50000 }),
        // March: no flow → net 0, the balance stays flat
        entry({ date: utc(2026, 4, 1), direction: 'in', amountCents: 20000 }),
      ],
      startingBalanceCents: 500000, // 5 000 €
      windowStart: utc(2026, 1, 1),
      windowEnd: utc(2026, 4, 30),
    })

    assert.deepEqual(months, [
      {
        monthKey: '2026-01',
        inflowCents: 100000,
        outflowCents: 30000,
        netCents: 70000,
        projectedBalanceCents: 570000,
      },
      {
        monthKey: '2026-02',
        inflowCents: 0,
        outflowCents: 50000,
        netCents: -50000,
        projectedBalanceCents: 520000,
      },
      {
        monthKey: '2026-03',
        inflowCents: 0,
        outflowCents: 0,
        netCents: 0,
        projectedBalanceCents: 520000,
      },
      {
        monthKey: '2026-04',
        inflowCents: 20000,
        outflowCents: 0,
        netCents: 20000,
        projectedBalanceCents: 540000,
      },
    ])
  })

  it('filtre par minConfidence (confirmed seul, ou confirmed + expected)', () => {
    const entries = [
      entry({ confidence: 'confirmed', amountCents: 100 }),
      entry({ confidence: 'expected', amountCents: 1000 }),
      entry({ confidence: 'probable', amountCents: 10000 }),
    ]
    const window = {
      startingBalanceCents: 0,
      windowStart: utc(2026, 1, 1),
      windowEnd: utc(2026, 1, 31),
    }

    const confirmedOnly = buildMonthlyBalance({
      entries,
      ...window,
      minConfidence: 'confirmed',
    })
    assert.equal(confirmedOnly.months[0].inflowCents, 100)

    const confirmedExpected = buildMonthlyBalance({
      entries,
      ...window,
      minConfidence: 'expected',
    })
    assert.equal(confirmedExpected.months[0].inflowCents, 1100)

    const all = buildMonthlyBalance({ entries, ...window })
    assert.equal(all.months[0].inflowCents, 11100)
  })

  it('ignore les entries non-pending (réalisées/annulées) et hors fenêtre', () => {
    const { months } = buildMonthlyBalance({
      entries: [
        entry({ status: 'realized', amountCents: 999999 }),
        entry({ status: 'cancelled', amountCents: 999999 }),
        entry({ date: utc(2027, 6, 1), amountCents: 999999 }), // outside window
        entry({ amountCents: 100 }),
      ],
      startingBalanceCents: 0,
      windowStart: utc(2026, 1, 1),
      windowEnd: utc(2026, 1, 31),
    })
    assert.equal(months[0].inflowCents, 100)
  })

  it('compte les entries non-EUR sans les agréger (visibilité FX)', () => {
    const { months, ignoredNonEurEntries } = buildMonthlyBalance({
      entries: [
        entry({ currency: 'USD', amountCents: 999999 }),
        entry({ currency: 'CHF', amountCents: 999999 }),
        entry({ amountCents: 100 }),
      ],
      startingBalanceCents: 0,
      windowStart: utc(2026, 1, 1),
      windowEnd: utc(2026, 1, 31),
    })
    assert.equal(ignoredNonEurEntries, 2)
    assert.equal(months[0].inflowCents, 100)
  })

  it('un solde de départ négatif et des sorties donnent un projeté négatif (cents entiers)', () => {
    const { months } = buildMonthlyBalance({
      entries: [entry({ direction: 'out', amountCents: 12345 })],
      startingBalanceCents: -100,
      windowStart: utc(2026, 1, 1),
      windowEnd: utc(2026, 1, 31),
    })
    assert.equal(months[0].projectedBalanceCents, -12445)
    assert.ok(Number.isInteger(months[0].projectedBalanceCents))
  })
})

describe('buildMonthlyHistory — solde réel reconstruit à rebours', () => {
  const tx = (
    y: number,
    m: number,
    d: number,
    amountCents: number,
    direction: 'in' | 'out',
  ) => ({ transactionDate: utc(y, m, d), amountCents, direction })

  it('le dernier point est le mois courant au solde courant', () => {
    const points = buildMonthlyHistory({
      transactions: [],
      currentBalanceCents: 50000,
      monthsBack: 3,
      now: utc(2026, 6, 10),
    })
    assert.equal(points.length, 4)
    assert.deepEqual(
      points.map((p) => p.monthKey),
      ['2026-03', '2026-04', '2026-05', '2026-06'],
    )
    assert.equal(points.at(-1)?.balanceCents, 50000)
  })

  it('retire le net de chaque mois en remontant le temps', () => {
    // May: +1000; June (before now): −300. Current balance 50 000.
    const points = buildMonthlyHistory({
      transactions: [
        tx(2026, 5, 15, 1000, 'in'),
        tx(2026, 6, 5, 300, 'out'),
      ],
      currentBalanceCents: 50000,
      monthsBack: 2,
      now: utc(2026, 6, 10),
    })
    // End of June (now) = 50 000; end of May = 50 000 + 300 = 50 300;
    // end of April = 50 300 − 1 000 = 49 300.
    assert.deepEqual(
      points.map((p) => [p.monthKey, p.balanceCents]),
      [
        ['2026-04', 49300],
        ['2026-05', 50300],
        ['2026-06', 50000],
      ],
    )
  })

  it('ignore les transactions hors fenêtre ou futures', () => {
    const points = buildMonthlyHistory({
      transactions: [
        tx(2025, 1, 1, 999999, 'in'), // too old
        tx(2026, 6, 20, 999999, 'out'), // after now
        tx(2026, 5, 2, 100, 'in'),
      ],
      currentBalanceCents: 1000,
      monthsBack: 1,
      now: utc(2026, 6, 10),
    })
    assert.deepEqual(
      points.map((p) => [p.monthKey, p.balanceCents]),
      [
        ['2026-05', 1000],
        ['2026-06', 1000],
      ],
    )
  })

  it('les mois sans transaction gardent un solde plat', () => {
    const points = buildMonthlyHistory({
      transactions: [tx(2026, 3, 1, 500, 'out')],
      currentBalanceCents: 0,
      monthsBack: 4,
      now: utc(2026, 6, 10),
    })
    assert.deepEqual(
      points.map((p) => p.balanceCents),
      [500, 0, 0, 0, 0],
    )
  })
})
