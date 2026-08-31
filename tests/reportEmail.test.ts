/**
 * Pure tests for the report confirmation email (convex/emailTemplates.ts) —
 * the "Report rangé" mail sent once an investor update is filed.
 *
 * Both regressions pinned here were seen in a real mail:
 *  - the KPI tiles carried fixed row heights, so a value long enough to wrap
 *    overflowed its box and painted over the context line below;
 *  - vertical alignment relied on the `valign` HTML attribute alone, which
 *    some clients strip — cells then fall back to middle alignment and the
 *    bullets and the good/bad columns drift out of line.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { reportConfirmationHtml } from '../convex/emailTemplates'
import type { ReportConfirmationData } from '../convex/emailTemplates'

/** A synthesis whose texts are as long as the model realistically makes them. */
const HOSTILE: ReportConfirmationData = {
  reportPeriod: 'January 2026',
  highlights: [
    "Création d'une holding faîtière Estime détenant 100% d'Auxicare et les futures filiales régionales.",
    'Objectif : diversifier le risque de perte d\'agrément en dotant chaque filiale de ses propres agréments départementaux.',
  ],
  entities: [
    {
      name: 'Auxicare',
      orgName: 'Albo Club',
      logoUrl: null,
      url: 'https://example.test/app/albo/participations/x',
      synthesis: {
        score: 7,
        scoreLabel: 'En bonne voie',
        summary: 'Création de la holding Estime, détenant 100% d\'Auxicare.',
        goodPoints: ['Holding Estime', 'Antler CE au capital', 'Risque diversifié'],
        badPoints: ['Aucun chiffre financier reporté'],
        insights: [
          { label: 'CA mensuel', value: '86k€', trend: '-11%', direction: 'down', context: 'MoM' },
          {
            label: 'Expansion régionale',
            value: 'Holding Estime (100% Auxicare)',
            context: 'Filiales régionales dotées d\'agréments départementaux propres',
          },
          { label: 'Gouvernance', value: "Répliquée à l'identique", context: 'Droits identiques' },
        ],
      },
    },
  ],
}

describe('reportConfirmationHtml', () => {
  const html = reportConfirmationHtml(HOSTILE)

  it('never clips or boxes a tile with a fixed height', () => {
    // The score square and the logo are the only fixed boxes, and they hold a
    // single glyph. Nothing that carries model-written text may be sized.
    assert.equal(html.includes('overflow:hidden'), false)
    assert.equal(/line-height:28px/.test(html), false)
    for (const size of ['height:14px', 'height:24px', 'height:28px']) {
      assert.equal(html.includes(size), false, `${size} is a fixed text box`)
    }
  })

  it('shows long values in full, at a smaller size', () => {
    assert.match(html, /Holding Estime \(100% Auxicare\)/)
    assert.match(html, /Répliquée à l&#39;identique/)
    // Short figure stays big, long sentence shrinks.
    assert.match(html, /font-size:21px;font-weight:600;[^"]*">86k€/)
    assert.match(html, /font-size:15px;font-weight:600;[^"]*">Holding Estime/)
  })

  it('expresses every alignment in CSS, not only in the valign attribute', () => {
    for (const [tag, want] of html.matchAll(/<td[^>]*\svalign="(top|middle)"[^>]*>/g)) {
      assert.match(
        tag,
        new RegExp(`vertical-align:${want}`),
        `valign="${want}" without an inline style: ${tag}`,
      )
    }
  })
})
