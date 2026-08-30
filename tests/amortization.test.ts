/**
 * Pure tests for the amortization engine (convex/lib/amortization.ts).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 *
 * Deliberately OUTSIDE convex/: a `node:test` import inside convex/ would
 * break the Convex deployment bundle.
 *
 * The reference figures come from the SPEC's own example (Prêt Palatine
 * 2021: 500 000 € over 240 months at 1,85 %, monthly instalment ≈ 2 494 €),
 * plus hand-checkable cases for the three other kinds.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  annuityCents,
  applicableRateBps,
  attributeActuals,
  buildSchedule,
  outstandingAt,
  periodicRate,
  summarize,
} from '../convex/lib/amortization'
import type { LoanTerms, RateStep } from '../convex/lib/amortization'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const EUR = (cents: number) => cents / 100

/** Loan of the SPEC example, with everything overridable per test. */
function loan(over: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principalCents: 500_000_00,
    firstPaymentDate: utc(2021, 7, 5),
    durationMonths: 240,
    amortizationKind: 'constant_annuity',
    rateBps: 185,
    rateKind: 'fixed',
    paymentFrequency: 'monthly',
    ...over,
  }
}

describe('applicableRateBps — le taux à une date', () => {
  const steps: Array<RateStep> = [
    { fromDate: utc(2026, 4, 1), rateBps: 435, kind: 'actual' },
    { fromDate: utc(2026, 7, 1), rateBps: 410, kind: 'actual' },
    { fromDate: utc(2028, 1, 1), rateBps: 380, kind: 'forecast' },
  ]

  it('retombe sur le taux de signature avant toute révision', () => {
    assert.equal(applicableRateBps(steps, utc(2026, 1, 1), 500), 500)
  })

  it('prend le dernier palier dont la date d’effet est passée', () => {
    assert.equal(applicableRateBps(steps, utc(2026, 5, 15), 500), 435)
    assert.equal(applicableRateBps(steps, utc(2026, 12, 31), 500), 410)
    assert.equal(applicableRateBps(steps, utc(2030, 1, 1), 500), 380)
  })

  it('inclut le jour même de la date d’effet', () => {
    assert.equal(applicableRateBps(steps, utc(2026, 7, 1), 500), 410)
  })

  it('ne suppose aucun ordre dans la série', () => {
    const shuffled = [steps[2], steps[0], steps[1]]
    assert.equal(applicableRateBps(shuffled, utc(2026, 8, 1), 500), 410)
  })

  it('sans aucun palier, c’est le taux de signature — un prêt à taux fixe', () => {
    assert.equal(applicableRateBps([], utc(2030, 1, 1), 185), 185)
  })
})

describe('annuité constante', () => {
  it('produit la mensualité du tableau de la banque (500 k€, 240 m, 1,85 %)', () => {
    const rows = buildSchedule(loan())
    assert.equal(rows.length, 240)
    // SPEC § 6.4 : 2 494 € — on tolère l’arrondi au centime.
    assert.ok(
      Math.abs(EUR(rows[0].paymentCents) - 2494) < 1,
      `mensualité attendue ≈ 2 494 €, obtenue ${EUR(rows[0].paymentCents)}`,
    )
  })

  it('rembourse exactement le capital emprunté, au centime', () => {
    const rows = buildSchedule(loan())
    const capital = rows.reduce((sum, row) => sum + row.capitalCents, 0)
    assert.equal(capital, 500_000_00)
    assert.equal(rows[rows.length - 1].remainingCents, 0)
  })

  it('fait croître la part de capital et décroître les intérêts', () => {
    const rows = buildSchedule(loan())
    assert.ok(rows[0].capitalCents < rows[100].capitalCents)
    assert.ok(rows[0].interestCents > rows[100].interestCents)
    // La mensualité, elle, ne bouge pas (à un centime d’arrondi près).
    assert.ok(
      Math.abs(rows[0].paymentCents - rows[100].paymentCents) <= 1,
      'la mensualité doit rester constante',
    )
  })

  it('mensualité = capital + intérêts sur chaque ligne', () => {
    for (const row of buildSchedule(loan())) {
      assert.equal(row.paymentCents, row.capitalCents + row.interestCents)
    }
  })

  it('à taux nul, la mensualité est le capital divisé par la durée', () => {
    const rows = buildSchedule(
      loan({ principalCents: 120_000_00, durationMonths: 12, rateBps: 0 }),
    )
    assert.equal(rows.length, 12)
    assert.equal(rows[0].paymentCents, 10_000_00)
    assert.equal(rows[0].interestCents, 0)
    assert.equal(rows[11].remainingCents, 0)
  })
})

describe('capital constant', () => {
  const terms = loan({
    amortizationKind: 'constant_capital',
    principalCents: 120_000_00,
    durationMonths: 12,
    rateBps: 1200,
  })

  it('amortit une part de capital fixe', () => {
    const rows = buildSchedule(terms)
    assert.equal(rows.length, 12)
    for (const row of rows) assert.equal(row.capitalCents, 10_000_00)
  })

  it('fait décroître la mensualité, les intérêts suivant le restant dû', () => {
    const rows = buildSchedule(terms)
    // 1 % par mois sur 120 000 € = 1 200 € d’intérêts la première échéance.
    assert.equal(rows[0].interestCents, 1_200_00)
    assert.equal(rows[0].paymentCents, 11_200_00)
    // Dernière échéance : 1 % sur les 10 000 € restants.
    assert.equal(rows[11].interestCents, 100_00)
    assert.equal(rows[11].paymentCents, 10_100_00)
  })

  it('solde le capital exactement', () => {
    const rows = buildSchedule(terms)
    assert.equal(rows[11].remainingCents, 0)
    assert.equal(
      rows.reduce((sum, row) => sum + row.capitalCents, 0),
      120_000_00,
    )
  })
})

describe('in fine (bullet)', () => {
  const terms = loan({
    amortizationKind: 'bullet',
    principalCents: 6_600_000_00,
    durationMonths: 24,
    rateBps: 410,
  })

  it('ne paie que des intérêts jusqu’à l’avant-dernière échéance', () => {
    const rows = buildSchedule(terms)
    assert.equal(rows.length, 24)
    for (const row of rows.slice(0, 23)) {
      assert.equal(row.capitalCents, 0)
      assert.equal(row.remainingCents, 6_600_000_00)
      assert.equal(row.isBalloon, false)
    }
  })

  it('porte tout le capital sur la dernière ligne — le ballon', () => {
    const rows = buildSchedule(terms)
    const last = rows[23]
    assert.equal(last.isBalloon, true)
    assert.equal(last.capitalCents, 6_600_000_00)
    assert.equal(last.remainingCents, 0)
    assert.ok(last.paymentCents > 6_600_000_00)
  })

  it('garde un restant dû égal au capital emprunté jusqu’au terme', () => {
    const rows = buildSchedule(terms)
    assert.equal(outstandingAt(terms, rows, utc(2022, 12, 5)), 6_600_000_00)
    assert.equal(outstandingAt(terms, rows, utc(2030, 1, 1)), 0)
  })
})

describe('révolving (lombard)', () => {
  const terms = loan({
    amortizationKind: 'revolving',
    principalCents: 6_600_000_00,
    durationMonths: undefined,
    firstPaymentDate: utc(2026, 1, 5),
    rateBps: 410,
    rateKind: 'variable',
  })

  it('sans borne ni horizon, ne génère rien plutôt que de boucler', () => {
    assert.deepEqual(buildSchedule(terms), [])
  })

  it('projette des intérêts sur l’encours jusqu’à l’horizon', () => {
    const rows = buildSchedule(terms, [], { horizonDate: utc(2026, 12, 31) })
    assert.equal(rows.length, 12)
    for (const row of rows) {
      assert.equal(row.capitalCents, 0)
      assert.equal(row.remainingCents, 6_600_000_00)
    }
    // 4,10 % annuel sur 6,6 M€ = 22 550 € par mois.
    assert.equal(rows[0].interestCents, 22_550_00)
  })

  it('s’arrête à endDate quand elle est connue, sans regarder l’horizon', () => {
    const rows = buildSchedule({ ...terms, endDate: utc(2026, 6, 30) }, [], {
      horizonDate: utc(2030, 1, 1),
    })
    assert.equal(rows.length, 6)
  })

  it('le restant dû est l’encours saisi — la seule ligne stockée du module', () => {
    const rows = buildSchedule(terms, [], { horizonDate: utc(2026, 12, 31) })
    assert.equal(outstandingAt(terms, rows, utc(2026, 3, 1)), 6_600_000_00)
  })
})

describe('différé', () => {
  const base = loan({
    principalCents: 100_000_00,
    durationMonths: 24,
    deferralMonths: 6,
    rateBps: 1200,
  })

  it('partiel : intérêts seuls, le capital reste à P', () => {
    const rows = buildSchedule({ ...base, deferralKind: 'partial' })
    for (const row of rows.slice(0, 6)) {
      assert.equal(row.isDeferred, true)
      assert.equal(row.capitalized, false)
      assert.equal(row.capitalCents, 0)
      assert.equal(row.interestCents, 1_000_00) // 1 % de 100 000 €
      assert.equal(row.paymentCents, 1_000_00)
      assert.equal(row.remainingCents, 100_000_00)
    }
    assert.equal(rows[23].remainingCents, 0)
  })

  it('total : rien n’est payé, les intérêts se capitalisent', () => {
    const rows = buildSchedule({ ...base, deferralKind: 'total' })
    for (const row of rows.slice(0, 6)) {
      assert.equal(row.capitalized, true)
      assert.equal(row.paymentCents, 0)
    }
    // 100 000 € capitalisés six fois à 1 % par mois. Les intérêts sont
    // arrondis au centime À CHAQUE période, comme le fait la banque — d'où
    // 106 152,01 € et non les 106 152,02 € de la formule fermée.
    assert.equal(rows[5].remainingCents, 106_152_01)
  })

  it('total : l’amortissement démarre AU-DESSUS du montant emprunté (C18)', () => {
    const rows = buildSchedule({ ...base, deferralKind: 'total' })
    const partial = buildSchedule({ ...base, deferralKind: 'partial' })
    assert.ok(rows[5].remainingCents > base.principalCents)
    // Et la mensualité d’amortissement est donc plus lourde.
    assert.ok(rows[6].paymentCents > partial[6].paymentCents)
  })

  it('amortit sur la durée restante, pas sur la durée totale', () => {
    const rows = buildSchedule({ ...base, deferralKind: 'partial' })
    assert.equal(rows.length, 24)
    assert.equal(rows.filter((row) => row.isDeferred).length, 6)
    assert.equal(rows.filter((row) => row.capitalCents > 0).length, 18)
  })

  it('un différé plus long que la durée est ramené à ce qui laisse une échéance', () => {
    const rows = buildSchedule({
      ...base,
      deferralMonths: 240,
      deferralKind: 'partial',
    })
    assert.equal(rows.length, 24)
    assert.equal(rows[23].remainingCents, 0)
  })
})

describe('taux variable', () => {
  const terms = loan({
    principalCents: 100_000_00,
    durationMonths: 24,
    rateBps: 1200,
    rateKind: 'variable',
    firstPaymentDate: utc(2026, 1, 5),
  })

  it('recalcule la mensualité au passage d’un palier', () => {
    const flat = buildSchedule(terms)
    const stepped = buildSchedule(terms, [
      { fromDate: utc(2026, 7, 1), rateBps: 2400, kind: 'actual' },
    ])
    // Jusqu’au palier, rien ne change.
    assert.equal(stepped[0].paymentCents, flat[0].paymentCents)
    // Après, le taux double et la mensualité monte.
    assert.equal(stepped[6].rateBps, 2400)
    assert.ok(stepped[6].paymentCents > flat[6].paymentCents)
    // Le capital reste soldé exactement.
    assert.equal(stepped[23].remainingCents, 0)
  })

  it('marque « projetées » les échéances au-delà de la dernière révision', () => {
    const rows = buildSchedule(terms, [
      { fromDate: utc(2026, 6, 1), rateBps: 1000, kind: 'actual' },
    ])
    assert.equal(rows[0].projected, false) // 05/01/2026, avant la révision
    assert.equal(rows[5].projected, true) // 05/06/2026, après
  })

  it('sans aucune révision constatée, rien n’est projeté — le taux de signature tient', () => {
    const rows = buildSchedule(terms)
    assert.ok(rows.every((row) => !row.projected))
  })

  it('un palier « forecast » rend ses échéances projetées', () => {
    const rows = buildSchedule(terms, [
      { fromDate: utc(2026, 9, 1), rateBps: 800, kind: 'forecast' },
    ])
    assert.equal(rows[0].projected, false)
    assert.equal(rows[8].projected, true) // 05/09/2026
  })

  it('un prêt à taux fixe n’a jamais d’échéance projetée', () => {
    const rows = buildSchedule({ ...terms, rateKind: 'fixed' }, [
      { fromDate: utc(2026, 6, 1), rateBps: 1000, kind: 'actual' },
    ])
    assert.ok(rows.every((row) => !row.projected))
  })
})

describe('trimestriel, assurance et dates', () => {
  it('une échéance trimestrielle couvre trois mois de taux', () => {
    const rows = buildSchedule(
      loan({
        principalCents: 120_000_00,
        durationMonths: 12,
        paymentFrequency: 'quarterly',
        amortizationKind: 'constant_capital',
        rateBps: 1200,
      }),
    )
    assert.equal(rows.length, 4)
    assert.equal(rows[0].capitalCents, 30_000_00)
    // 12 % annuel sur un trimestre = 3 % de 120 000 €.
    assert.equal(rows[0].interestCents, 3_600_00)
  })

  it('l’assurance est hors mensualité, au prorata de la période', () => {
    const monthly = buildSchedule(loan({ insuranceMonthlyCents: 42_00 }))
    assert.equal(monthly[0].insuranceCents, 42_00)
    const quarterly = buildSchedule(
      loan({ insuranceMonthlyCents: 42_00, paymentFrequency: 'quarterly' }),
    )
    assert.equal(quarterly[0].insuranceCents, 126_00)
    // Et elle n’entre jamais dans la mensualité du plan.
    assert.equal(
      monthly[0].paymentCents,
      monthly[0].capitalCents + monthly[0].interestCents,
    )
  })

  it('les dates ne dérivent pas depuis un ancrage en fin de mois', () => {
    const rows = buildSchedule(
      loan({ firstPaymentDate: utc(2026, 1, 31), durationMonths: 4 }),
    )
    const days = rows.map((row) => new Date(row.date).toISOString().slice(0, 10))
    assert.deepEqual(days, [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })
})

describe('lectures dérivées', () => {
  it('outstandingAt rend le capital emprunté avant la première échéance', () => {
    const terms = loan()
    const rows = buildSchedule(terms)
    assert.equal(outstandingAt(terms, rows, utc(2021, 1, 1)), 500_000_00)
  })

  it('outstandingAt décroît avec le temps et finit à zéro', () => {
    const terms = loan()
    const rows = buildSchedule(terms)
    const y5 = outstandingAt(terms, rows, utc(2026, 7, 5))
    const y10 = outstandingAt(terms, rows, utc(2031, 7, 5))
    assert.ok(y5 > y10)
    assert.equal(outstandingAt(terms, rows, utc(2050, 1, 1)), 0)
  })

  it('summarize expose la prochaine mensualité et le terme', () => {
    const terms = loan()
    const rows = buildSchedule(terms)
    const summary = summarize(terms, rows, utc(2026, 8, 10))
    assert.equal(summary.totalPeriods, 240)
    assert.equal(summary.elapsedPeriods, 62)
    assert.equal(summary.currentRateBps, 185)
    assert.equal(summary.lastPaymentDate, utc(2041, 6, 5))
    assert.ok(summary.remainingInterestCents > 0)
    assert.equal(summary.outstandingCents, rows[61].remainingCents)
  })
})

describe('termes incohérents — un échéancier vide plutôt qu’une exception', () => {
  it('pas de durée sur un prêt amortissable', () => {
    assert.deepEqual(buildSchedule(loan({ durationMonths: undefined })), [])
  })

  it('une durée nulle ou négative', () => {
    assert.deepEqual(buildSchedule(loan({ durationMonths: 0 })), [])
    assert.deepEqual(buildSchedule(loan({ durationMonths: -12 })), [])
  })
})

describe('helpers exposés', () => {
  it('periodicRate convertit des bps annuels en taux de période', () => {
    assert.equal(periodicRate(1200, 1), 0.01)
    assert.equal(periodicRate(1200, 3), 0.03)
    assert.equal(periodicRate(0, 1), 0)
  })

  it('annuityCents dégrade proprement à taux nul', () => {
    assert.equal(annuityCents(120_000_00, 0, 12), 10_000_00)
  })

  it('annuityCents rend 0 sur une durée nulle', () => {
    assert.equal(annuityCents(100_00, 0.01, 0), 0)
  })
})

/**
 * `attributeActuals` is the one place a « rapprochement » could sneak back
 * into the module. These tests pin what it IS — a calendar placement,
 * explainable from the dates alone — and, just as importantly, what it must
 * never become: a likelihood ranking, a proposal, a pre-selection. That
 * mechanism was removed from the repo in August 2026 and must not be
 * re-wired here (cf. CLAUDE.md, KNOWN_ISSUES.md « Pointage transaction →
 * deal »).
 */
describe('attribution du réel : un calendrier, jamais une suggestion', () => {
  const schedule = buildSchedule(loan({ durationMonths: 4 }))

  it("place chaque flux sur l'échéance dont il occupe la période", () => {
    const actuals = attributeActuals(schedule, [
      // Deux jours après la 2e échéance → il appartient à sa période.
      { transactionDate: schedule[1].date + 2 * 24 * 60 * 60 * 1000, amountCents: 2_536_00 },
    ])
    assert.deepEqual(actuals, [null, 2_536_00, null, null])
  })

  it('ne dépend QUE des dates — le montant n’influence jamais le placement', () => {
    const date = schedule[2].date + 1000
    const petit = attributeActuals(schedule, [
      { transactionDate: date, amountCents: 1 },
    ])
    const enorme = attributeActuals(schedule, [
      { transactionDate: date, amountCents: 999_999_00 },
    ])
    // Un moteur de vraisemblance aurait déplacé le montant aberrant vers
    // l'échéance « la plus probable ». Celui-ci ne bouge pas.
    assert.equal(petit.findIndex((v) => v !== null), 2)
    assert.equal(enorme.findIndex((v) => v !== null), 2)
  })

  it("est déterministe : l'ordre des flux ne change pas le résultat", () => {
    const flows = [
      { transactionDate: schedule[0].date, amountCents: 100_00 },
      { transactionDate: schedule[2].date, amountCents: 300_00 },
      { transactionDate: schedule[1].date, amountCents: 200_00 },
    ]
    const a = attributeActuals(schedule, flows)
    const b = attributeActuals(schedule, [...flows].reverse())
    assert.deepEqual(a, b)
    assert.deepEqual(a, [100_00, 200_00, 300_00, null])
  })

  it('cumule plusieurs flux tombés dans la même période', () => {
    const actuals = attributeActuals(schedule, [
      { transactionDate: schedule[1].date, amountCents: 2_000_00 },
      { transactionDate: schedule[1].date + 1000, amountCents: 536_00 },
    ])
    assert.equal(actuals[1], 2_536_00)
  })

  it('un paiement en retard reste sur la période où il est TOMBÉ', () => {
    // Il serait tentant de le ramener sur l'échéance qu'il était censé
    // couvrir. C'est exactement ce qu'on refuse : la lecture honnête laisse
    // l'échéance manquée visible.
    const actuals = attributeActuals(schedule, [
      { transactionDate: schedule[2].date + 1000, amountCents: 2_536_00 },
    ])
    assert.equal(actuals[1], null)
    assert.equal(actuals[2], 2_536_00)
  })

  it('un flux antérieur au plan va sur la première échéance, pas nulle part', () => {
    const actuals = attributeActuals(schedule, [
      { transactionDate: schedule[0].date - 90 * 24 * 60 * 60 * 1000, amountCents: 500_00 },
    ])
    assert.equal(actuals[0], 500_00)
  })

  it('un échéancier vide ne rend aucune ligne', () => {
    assert.deepEqual(attributeActuals([], [{ transactionDate: 0, amountCents: 1 }]), [])
  })
})
