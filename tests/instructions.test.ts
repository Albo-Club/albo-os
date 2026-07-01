/**
 * Pure tests for the agent system prompt (convex/lib/instructions.ts):
 * the page context (route + org) is injected after the base instructions,
 * and cleanly omitted when absent.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BASE_INSTRUCTIONS,
  buildInstructions,
} from '../convex/lib/instructions'

describe('buildInstructions', () => {
  it('sans contexte → instructions de base inchangées', () => {
    assert.equal(buildInstructions(), BASE_INSTRUCTIONS)
    assert.equal(buildInstructions({}), BASE_INSTRUCTIONS)
  })

  it('avec orgName → mentionne l’organisation après la base', () => {
    const out = buildInstructions({ orgName: 'CALTE' })
    assert.ok(out.startsWith(BASE_INSTRUCTIONS))
    assert.ok(out.includes('Current organization: CALTE.'))
    assert.ok(!out.includes('currently on the app page'))
  })

  it('avec route → mentionne la page courante', () => {
    const out = buildInstructions({ route: '/app/calte/pointage' })
    assert.ok(out.startsWith(BASE_INSTRUCTIONS))
    assert.ok(out.includes('"/app/calte/pointage"'))
  })

  it('avec route + orgName → les deux, org avant route', () => {
    const out = buildInstructions({
      route: '/app/calte/cash',
      orgName: 'CALTE',
    })
    const orgIdx = out.indexOf('Current organization')
    const routeIdx = out.indexOf('currently on the app page')
    assert.ok(orgIdx > 0)
    assert.ok(routeIdx > orgIdx)
  })

  it('avec entity deal → grounde sur ce deal + son id', () => {
    const out = buildInstructions({
      entity: { kind: 'deal', id: 'deal_123' },
    })
    assert.ok(out.startsWith(BASE_INSTRUCTIONS))
    assert.ok(out.includes('viewing the deal with id "deal_123"'))
    assert.ok(out.includes('listValuations'))
  })

  it('avec entity company → grounde sur cette société', () => {
    const out = buildInstructions({
      entity: { kind: 'company', id: 'company_456' },
    })
    assert.ok(out.includes('viewing the company with id "company_456"'))
    assert.ok(out.includes('listCompanyDocuments'))
  })
})
