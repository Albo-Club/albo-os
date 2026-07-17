/**
 * Pure detection of internal-transfer pairs among unmatched transactions:
 * two legs of the same wire between two accounts of the org — same amount,
 * opposite directions, DIFFERENT bank accounts, dates within a few days.
 * No Convex import so it stays testable via node:test
 * (cf. tests/transferPairs.test.ts).
 *
 * Greedy nearest-date pairing: each leg pairs at most once, closest dates
 * first — two same-amount wires the same week pair with their own leg, not
 * across. High precision by design: a missed pair is a non-event (the
 * human classifies), a wrong pair would suggest nonsense.
 */

export type TransferLeg = {
  id: string
  bankAccountId: string
  direction: 'in' | 'out'
  amountCents: number
  dateMs: number
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Max date gap between the two legs of a wire (bank posting delays). */
export const TRANSFER_PAIR_WINDOW_MS = 4 * DAY_MS

/** Ids of every transaction that belongs to a detected pair. */
export function detectInternalTransferPairs(
  legs: Array<TransferLeg>,
): Set<string> {
  // Candidate (out, in) combinations per exact amount.
  const byAmount = new Map<number, { outs: Array<TransferLeg>; ins: Array<TransferLeg> }>()
  for (const leg of legs) {
    const group = byAmount.get(leg.amountCents) ?? { outs: [], ins: [] }
    ;(leg.direction === 'out' ? group.outs : group.ins).push(leg)
    byAmount.set(leg.amountCents, group)
  }

  const paired = new Set<string>()
  for (const { outs, ins } of byAmount.values()) {
    if (outs.length === 0 || ins.length === 0) continue
    const combos: Array<{ out: TransferLeg; in_: TransferLeg; gap: number }> =
      []
    for (const out of outs) {
      for (const in_ of ins) {
        if (out.bankAccountId === in_.bankAccountId) continue
        const gap = Math.abs(out.dateMs - in_.dateMs)
        if (gap > TRANSFER_PAIR_WINDOW_MS) continue
        combos.push({ out, in_, gap })
      }
    }
    combos.sort((a, b) => a.gap - b.gap)
    for (const combo of combos) {
      if (paired.has(combo.out.id) || paired.has(combo.in_.id)) continue
      paired.add(combo.out.id)
      paired.add(combo.in_.id)
    }
  }
  return paired
}
