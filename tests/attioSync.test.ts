/**
 * Pure tests for the Attio → Albo OS sync decision logic
 * (convex/lib/attioSync.ts). The Convex mutation (convex/attioSync.ts) is a
 * thin DB shell around these functions, so testing them here locks the two
 * invariants the feature rests on — never create on Invested (no duplicate of
 * the already-imported portfolio) and forward-only status. Run via
 * `pnpm test:unit` (node:test + tsx, same pattern as recurrence.test.ts).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  INVESTED_STATUS_ID,
  TERM_SHEET_STATUS_ID,
  advancesStatus,
  dealForecastKey,
  decideSyncAction,
  orgSlugFromOption,
  resolveInstrumentKind,
  secondaryRoundFromInstrumentRaw,
  shouldReplaceInstrument,
} from '../convex/lib/attioSync'

import type { DealStatus } from '../convex/lib/attioSync'

describe('decideSyncAction — anti-duplicate + forward-only invariants', () => {
  it('Invested with NO existing deal is skipped (never creates → the imported/existing portfolio is never duplicated)', () => {
    assert.deepEqual(decideSyncAction(INVESTED_STATUS_ID, null), {
      kind: 'skip',
      reason: 'invested_no_deal',
    })
  })

  it('Invested on an existing deal confirms it in place (no create), whatever its current status', () => {
    const statuses: Array<DealStatus> = [
      'pending',
      'active',
      'partially_exited',
      'fully_exited',
      'written_off',
    ]
    for (const status of statuses) {
      assert.deepEqual(decideSyncAction(INVESTED_STATUS_ID, status), {
        kind: 'invested',
      })
    }
  })

  it('Term Sheet creates a deal when none exists', () => {
    assert.deepEqual(decideSyncAction(TERM_SHEET_STATUS_ID, null), {
      kind: 'termsheet_create',
    })
  })

  it('Term Sheet refreshes a deal still pending (pre-investment)', () => {
    assert.deepEqual(decideSyncAction(TERM_SHEET_STATUS_ID, 'pending'), {
      kind: 'termsheet_refresh',
    })
  })

  it('Term Sheet never overwrites a deal Albo OS already owns (post-signature)', () => {
    const owned: Array<DealStatus> = [
      'active',
      'partially_exited',
      'fully_exited',
      'written_off',
    ]
    for (const status of owned) {
      assert.deepEqual(decideSyncAction(TERM_SHEET_STATUS_ID, status), {
        kind: 'skip',
        reason: 'termsheet_on_owned_deal',
      })
    }
  })

  it('any other stage is a no-op', () => {
    assert.deepEqual(decideSyncAction('some-other-stage-id', null), {
      kind: 'skip',
      reason: 'unhandled_stage',
    })
    assert.deepEqual(decideSyncAction('some-other-stage-id', 'pending'), {
      kind: 'skip',
      reason: 'unhandled_stage',
    })
  })
})

describe('advancesStatus — forward-only lifecycle', () => {
  it('advances pending → active', () => {
    assert.equal(advancesStatus('pending', 'active'), true)
  })
  it('is a no-op re-confirming an already active deal', () => {
    assert.equal(advancesStatus('active', 'active'), false)
  })
  it('never revives an exited/written-off deal on an Invested event', () => {
    assert.equal(advancesStatus('fully_exited', 'active'), false)
    assert.equal(advancesStatus('partially_exited', 'active'), false)
    assert.equal(advancesStatus('written_off', 'active'), false)
  })
})

describe('resolveInstrumentKind — Attio type_d_invest → instrumentKind', () => {
  it('maps every known Attio option title', () => {
    const cases: Array<[string, string]> = [
      ['Share', 'share'],
      ['Fund', 'fund_lp'],
      ['OCA', 'oc'],
      ['Obligation', 'os'],
      ['BSA', 'bsa'],
      ['BSA Air', 'bsa_air'],
      ['CCA', 'cca'],
      ['Royalties', 'royalty'],
      ['Secondary Shares', 'share'],
      ['Convertible Note', 'convertible_note'],
      ['SPV SAFE', 'safe'],
      ['SPV Share', 'spv_share'],
    ]
    for (const [title, kind] of cases) {
      assert.equal(resolveInstrumentKind(title), kind)
    }
  })

  it('falls back to unknown for an absent or unmapped instrument (never guesses)', () => {
    assert.equal(resolveInstrumentKind(null), 'unknown')
    assert.equal(resolveInstrumentKind('Something new'), 'unknown')
  })
})

describe('secondaryRoundFromInstrumentRaw — Secondary Shares presets a secondary round', () => {
  it('returns the secondary round only for Secondary Shares', () => {
    assert.equal(secondaryRoundFromInstrumentRaw('Secondary Shares'), 'secondary')
    assert.equal(secondaryRoundFromInstrumentRaw('Share'), undefined)
    assert.equal(secondaryRoundFromInstrumentRaw(null), undefined)
  })
})

describe('shouldReplaceInstrument — patch never downgrades a known instrument', () => {
  it('keeps the known instrument when Attio sends unknown', () => {
    assert.equal(shouldReplaceInstrument('unknown', 'share'), false)
  })
  it('replaces when the incoming instrument is known and different', () => {
    assert.equal(shouldReplaceInstrument('os', 'share'), true)
  })
  it('is a no-op when unchanged', () => {
    assert.equal(shouldReplaceInstrument('share', 'share'), false)
  })
})

describe('orgSlugFromOption — Attio albo_or_calte option → org slug', () => {
  it('maps the two known options', () => {
    assert.equal(
      orgSlugFromOption('18a7bf8e-bc09-4750-9b07-0539f2179ac1'),
      'calte',
    )
    assert.equal(
      orgSlugFromOption('77b86c7e-ced4-4c34-b2e2-3278591ad00f'),
      'albo',
    )
  })
  it('is undefined for an absent or unknown option (deal is then skipped)', () => {
    assert.equal(orgSlugFromOption(null), undefined)
    assert.equal(orgSlugFromOption('unknown-option-id'), undefined)
  })
})

describe('dealForecastKey — stable, dateless key', () => {
  it('is one key per deal, independent of the date (survives TS → Invested)', () => {
    assert.equal(dealForecastKey('deal_abc'), 'deal:deal_abc')
  })
})
