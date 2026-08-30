/**
 * Pure tests for the real-estate logic (convex/lib/properties.ts).
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
  costBasisTotalCents,
  exitCashflows,
  latentGainCents,
  netYield,
  operatingResult,
  resolveCostBasis,
} from '../convex/lib/properties'
import { xirr } from '../convex/lib/xirr'
import type { CostBasisEntry, PropertyFlow } from '../convex/lib/properties'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 30)

const flow = (
  over: Partial<PropertyFlow> & Pick<PropertyFlow, 'category'>,
): PropertyFlow => ({
  transactionDate: NOW - 30 * DAY,
  direction: 'out',
  amount: 100_00,
  ...over,
})

describe('prix de revient : une source par poste (D43)', () => {
  it('un poste `manual` prend le montant saisi, jamais les flux', () => {
    const basis: Array<CostBasisEntry> = [
      { poste: 'acquisition', source: 'manual', manualAmountCents: 658_800_00 },
    ]
    const flows = [flow({ category: 'acquisition', amount: 500_000_00 })]

    const [acquisition] = resolveCostBasis(basis, flows)
    assert.equal(acquisition.amountCents, 658_800_00)
    assert.equal(acquisition.source, 'manual')
    // Les flux existent, ils ne sont pas comptés — mais ils sont signalés
    // (C14), pour ne pas masquer de la donnée.
    assert.equal(acquisition.ignoredFlowCount, 1)
    assert.equal(acquisition.ignoredFlowCents, 500_000_00)
  })

  it('un poste `flows` somme les transactions et ignore le montant saisi', () => {
    const basis: Array<CostBasisEntry> = [
      // Le montant saisi est CONSERVÉ pour pouvoir rebasculer sans
      // ressaisir — il n'est simplement pas lu.
      { poste: 'travaux', source: 'flows', manualAmountCents: 999_999_00 },
    ]
    const flows = [
      flow({ category: 'travaux', amount: 40_000_00 }),
      flow({ category: 'travaux', amount: 24_900_00 }),
    ]

    const [, , travaux] = resolveCostBasis(basis, flows)
    assert.equal(travaux.amountCents, 64_900_00)
    assert.equal(travaux.flowCount, 2)
    assert.equal(travaux.ignoredFlowCount, 0)
  })

  it('un remboursement vient EN MOINS du poste, jamais en plus', () => {
    const basis: Array<CostBasisEntry> = [
      { poste: 'travaux', source: 'flows' },
    ]
    const flows = [
      flow({ category: 'travaux', amount: 40_000_00, direction: 'out' }),
      flow({ category: 'travaux', amount: 5_000_00, direction: 'in' }),
    ]

    const [, , travaux] = resolveCostBasis(basis, flows)
    assert.equal(travaux.amountCents, 35_000_00)
  })

  it('un poste absent vaut zéro en `manual` — pas trois lignes vides à saisir', () => {
    const postes = resolveCostBasis([], [])
    assert.deepEqual(
      postes.map((p) => [p.poste, p.source, p.amountCents]),
      [
        ['acquisition', 'manual', 0],
        ['frais_acquisition', 'manual', 0],
        ['travaux', 'manual', 0],
      ],
    )
  })

  it('le prix de revient additionne les trois postes, chacun à SA source', () => {
    const basis: Array<CostBasisEntry> = [
      { poste: 'acquisition', source: 'manual', manualAmountCents: 658_800_00 },
      {
        poste: 'frais_acquisition',
        source: 'manual',
        manualAmountCents: 18_300_00,
      },
      { poste: 'travaux', source: 'flows' },
    ]
    const flows = [flow({ category: 'travaux', amount: 64_900_00 })]

    const total = costBasisTotalCents(resolveCostBasis(basis, flows))
    assert.equal(total, 742_000_00)
  })

  it('ne mélange JAMAIS saisi et flux sur le même poste', () => {
    const basis: Array<CostBasisEntry> = [
      { poste: 'acquisition', source: 'manual', manualAmountCents: 100_000_00 },
    ]
    const flows = [flow({ category: 'acquisition', amount: 100_000_00 })]

    // 200 000 € serait le bug que D43 existe pour empêcher.
    assert.equal(costBasisTotalCents(resolveCostBasis(basis, flows)), 100_000_00)
  })
})

describe('exploitation : 12 mois glissants, flux pointés uniquement (D25)', () => {
  it('somme les loyers encaissés et les charges payées', () => {
    const flows = [
      flow({ category: 'loyer', direction: 'in', amount: 58_200_00 }),
      flow({ category: 'charges', direction: 'out', amount: 14_900_00 }),
    ]

    const result = operatingResult(flows, NOW)
    assert.equal(result.revenueCents, 58_200_00)
    assert.equal(result.chargesCents, 14_900_00)
    assert.equal(result.netCents, 43_300_00)
    assert.equal(result.flowCount, 2)
  })

  it('exclut ce qui est hors de la fenêtre', () => {
    const flows = [
      flow({
        category: 'loyer',
        direction: 'in',
        amount: 1_000_00,
        transactionDate: NOW - 400 * DAY,
      }),
    ]
    assert.equal(operatingResult(flows, NOW).revenueCents, 0)
  })

  it("n'agrège que loyer et charges — un poste de revient n'est pas une charge", () => {
    const flows = [
      flow({ category: 'travaux', amount: 40_000_00 }),
      flow({ category: 'acquisition', amount: 500_000_00 }),
    ]
    const result = operatingResult(flows, NOW)
    assert.equal(result.chargesCents, 0)
    assert.equal(result.flowCount, 0)
  })

  it('un bien sans flux pointé lit zéro, pas une estimation', () => {
    const result = operatingResult([], NOW)
    assert.equal(result.netCents, 0)
    assert.equal(result.flowCount, 0)
  })
})

describe('rendement et plus-value latente', () => {
  it('rendement net = résultat / prix de revient', () => {
    assert.equal(netYield(43_300_00, 742_000_00), 43_300_00 / 742_000_00)
  })

  it('un prix de revient nul ne donne pas un rendement nul, mais AUCUN', () => {
    assert.equal(netYield(43_300_00, 0), null)
  })

  it('une plus-value sans valorisation est inconnue, pas nulle', () => {
    assert.equal(latentGainCents(null, 742_000_00), null)
    assert.equal(latentGainCents(860_000_00, 742_000_00), 118_000_00)
  })

  it('une moins-value est rendue telle quelle', () => {
    assert.equal(latentGainCents(600_000_00, 742_000_00), -142_000_00)
  })
})

describe('TRI de sortie (marchand de biens)', () => {
  const acquired = Date.UTC(2024, 0, 1)
  const sold = Date.UTC(2026, 0, 1)

  it('injecte les postes `manual` à la date d’acquisition et rend un TRI positif', () => {
    const basis: Array<CostBasisEntry> = [
      { poste: 'acquisition', source: 'manual', manualAmountCents: 500_000_00 },
    ]
    const postes = resolveCostBasis(basis, [])
    const flows = exitCashflows(postes, [], {
      acquiredDate: acquired,
      saleDate: sold,
      salePriceCents: 605_000_00,
    })

    assert.deepEqual(flows, [
      { date: acquired, amount: -500_000_00 },
      { date: sold, amount: 605_000_00 },
    ])
    const rate = xirr(flows.map((f) => ({ amount: f.amount, date: f.date })))
    assert.ok(rate !== null && rate > 0.09 && rate < 0.11)
  })

  it('ne compte pas deux fois la revente quand le prix de vente est saisi', () => {
    const postes = resolveCostBasis(
      [{ poste: 'acquisition', source: 'manual', manualAmountCents: 100_00 }],
      [],
    )
    const flows = exitCashflows(
      postes,
      [
        flow({
          category: 'revente',
          direction: 'in',
          amount: 605_000_00,
          transactionDate: sold,
        }),
      ],
      { acquiredDate: acquired, saleDate: sold, salePriceCents: 605_000_00 },
    )

    assert.equal(flows.filter((f) => f.amount === 605_000_00).length, 1)
  })

  it('ignore les flux d’un poste resté en `manual` — le TRI lit comme le prix de revient', () => {
    const postes = resolveCostBasis(
      [
        {
          poste: 'travaux',
          source: 'manual',
          manualAmountCents: 10_000_00,
        },
      ],
      [],
    )
    const flows = exitCashflows(
      postes,
      [flow({ category: 'travaux', amount: 40_000_00 })],
      { acquiredDate: acquired, saleDate: sold, salePriceCents: 100_000_00 },
    )

    // Les 40 000 € de flux ne sont pas là : le poste est saisi (C14).
    assert.ok(!flows.some((f) => f.amount === -40_000_00))
    assert.ok(flows.some((f) => f.amount === -10_000_00))
  })

  it('les flux sont rendus triés par date', () => {
    const postes = resolveCostBasis([{ poste: 'travaux', source: 'flows' }], [])
    const flows = exitCashflows(
      postes,
      [
        flow({
          category: 'loyer',
          direction: 'in',
          amount: 1_000_00,
          transactionDate: sold - 10 * DAY,
        }),
        flow({
          category: 'travaux',
          amount: 2_000_00,
          transactionDate: acquired + 10 * DAY,
        }),
      ],
      { acquiredDate: acquired, saleDate: sold, salePriceCents: 100_000_00 },
    )

    const dates = flows.map((f) => f.date)
    assert.deepEqual(dates, [...dates].sort((a, b) => a - b))
  })
})
