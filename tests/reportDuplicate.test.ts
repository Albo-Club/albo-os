/**
 * Pure tests for the duplicate detector (convex/lib/reportDuplicate.ts): the
 * two real cases that produced double fiches (QOMON and WARO, 09/2026), the
 * corrected re-send that must stay news, and the pairs that must NOT collide.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findDuplicate } from '../convex/lib/reportDuplicate'
import type { ComparableReport } from '../convex/lib/reportDuplicate'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 11, 10, 45)

/** The document itself — what both forwards carry, word for word. */
const UPDATE = `WARO - Summer update 2026
Chers investisseurs, voici les nouvelles de l'été.
L'ARR dépasse désormais 840 k€, en hausse de 30 % par rapport à l'atterrissage
de fin d'année dernière, et nous visons entre 950 k€ et 1 M€ à fin 2026.
La marge d'EBITDA ressort à -25 % au deuxième trimestre, la gross margin reste
stable autour de 70 %, et le dernier trimestre est visé à l'équilibre.
La demande est portée par l'échéance de l'affichage environnemental du
1er octobre 2026. Le pipe créé en France ralentit (675 k€ contre 1 M€ en 2025)
mais le taux de conversion est passé de 15 % à 25 %.
Des tests sur le marché UK démarreront au quatrième trimestre.
Merci de votre soutien, Paul`

/** Same document, forwarded by Clément — his client's wrapper on top. */
const FORWARD_CLEMENT = `---------- Forwarded message ---------
De : Paul Cappuccio <paul.cappuccio@waro.io>
Date: ven. 11 sept. 2026 à 11:07
Subject: WARO - Summer update
To: Clement Alteresco <clement@alboteam.com>

${UPDATE}`

/** Same document, forwarded by Benjamin three minutes later, with a note. */
const FORWARD_BENJAMIN = `Benjamin Bouquet +33 6 77 28 37 43

---------- Message transféré ---------
De : Paul Cappuccio <paul.cappuccio@waro.io>
Date: ven. 11 sept. 2026 à 11:07
Subject: WARO - Summer update
To: Benjamin Bouquet <benjamin@alboteam.com>

${UPDATE}`

const filed = (over: Partial<ComparableReport> = {}): ComparableReport => ({
  reportId: 'report-1',
  title: 'WARO - Summer update 2026',
  subject: 'Tr : WARO - Summer update',
  emailDate: NOW - 3 * 60 * 1000,
  rawContent: FORWARD_CLEMENT,
  metrics: { arr: 84_000_000, gross_margin: 7000 },
  ...over,
})

const incoming = (over: Record<string, unknown> = {}) => ({
  title: 'WARO - Summer update 2026',
  subject: 'Fwd: WARO - Summer update',
  receivedAt: NOW,
  rawContent: FORWARD_BENJAMIN,
  metrics: { arr: 84_000_000, gross_margin: 7000 },
  ...over,
})

describe('findDuplicate', () => {
  it('recognises the same update forwarded by two people (WARO 09/2026)', () => {
    const v = findDuplicate(incoming(), [filed()])
    assert.equal(v.kind, 'duplicate')
    assert.equal(v.reason, 'same_text')
    // Nothing moved at the source: the second forward announces nothing.
    assert.equal(v.sameSource, true)
  })

  it('still recognises it when the two readings disagree on the period', () => {
    // The bug itself: one reading said "S1 2026", the other saw no period at
    // all. The period plays no part in the comparison.
    const v = findDuplicate(incoming({ title: 'WARO — Summer update 2026' }), [
      filed({ reportPeriod: 'S1 2026' }),
    ])
    assert.equal(v.kind, 'duplicate')
  })

  it('treats a corrected re-send as the same document, but NOT the same source', () => {
    const corrected = FORWARD_BENJAMIN.replace('840 k€', '860 k€')
    const v = findDuplicate(incoming({ rawContent: corrected }), [filed()])
    assert.equal(v.kind, 'duplicate')
    assert.equal(v.sameSource, false)
  })

  it('recognises it on figures and title when the file only read once', () => {
    // The PDF OCR'd on one forward and failed on the other: no text to
    // compare, identical metrics under an identical title.
    const v = findDuplicate(incoming({ rawContent: undefined }), [filed()])
    assert.equal(v.kind, 'duplicate')
    assert.equal(v.reason, 'same_metrics_and_title')
  })

  it('asks a human when the subject comes back on another document', () => {
    const v = findDuplicate(
      incoming({
        title: 'WARO - Point de trésorerie',
        rawContent: `Bonjour, nous ouvrons un bridge de 500 k€ auprès de nos
        investisseurs historiques. Le closing est prévu pour la fin du mois
        d'octobre et nous revenons vers vous avec la documentation.`,
        metrics: {},
      }),
      [filed()],
    )
    assert.equal(v.kind, 'doubt')
    assert.equal(v.reason, 'same_subject')
  })

  it('leaves two different quarterly updates alone', () => {
    const q3 = `WARO Q3 2025 - Quarterly Update
      Chers investisseurs, voici les nouvelles du trimestre.
      Le trimestre est marqué par la signature de CHANEL et par l'entrée en
      vigueur du décret d'affichage environnemental le 1er octobre 2025.
      La croissance de l'ARR atteint 75 k€ sur le trimestre, pour une
      trajectoire vers 700 k€ à fin d'année.
      L'équipe s'est renforcée de deux personnes côté produit.
      Merci de votre soutien, Paul`
    const v = findDuplicate(
      incoming({
        title: 'WARO Q3 2025 - Quarterly Update',
        subject: 'WARO Q3 2025',
        rawContent: q3,
        metrics: { arr: 70_000_000 },
      }),
      [filed()],
    )
    assert.equal(v.kind, 'new')
  })

  it('lets the same courrier come back a year later', () => {
    const v = findDuplicate(incoming({ receivedAt: NOW + 365 * DAY }), [filed()])
    assert.equal(v.kind, 'new')
  })

  it('never matches a row with no date (legacy import)', () => {
    const v = findDuplicate(incoming(), [filed({ emailDate: undefined })])
    assert.equal(v.kind, 'new')
  })

  it('prefers the certain candidate over the merely similar one', () => {
    const v = findDuplicate(incoming(), [
      filed({ reportId: 'doubtful', rawContent: undefined, metrics: {} }),
      filed({ reportId: 'certain' }),
    ])
    assert.equal(v.kind, 'duplicate')
    assert.equal(v.reportId, 'certain')
  })
})
