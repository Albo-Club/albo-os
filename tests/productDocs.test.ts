/**
 * Pure tests for the product documentation module (convex/lib/productDocs.ts):
 * the bundled pages are well-formed, the keyword search folds accents and
 * ranks the obvious page first, excerpts and highlights are usable.
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PRODUCT_DOC_INDEX,
  fold,
  getProductDoc,
  productDocs,
  productDocsSummary,
  queryTerms,
  searchProductDocs,
  splitByTerms,
} from '../convex/lib/productDocs'

describe('productDocs (pages)', () => {
  it('chaque page a un slug unique, un titre et un contenu', () => {
    assert.ok(productDocs.length > 0)
    const slugs = new Set(productDocs.map((doc) => doc.slug))
    assert.equal(slugs.size, productDocs.length)
    for (const doc of productDocs) {
      assert.ok(doc.title.length > 0, doc.slug)
      assert.ok(doc.markdown.length > 0, doc.slug)
    }
  })

  it('le README est le sommaire, hors de la liste des pages', () => {
    assert.equal(productDocsSummary.slug, 'README')
    assert.ok(productDocsSummary.markdown.length > 0)
    assert.ok(!productDocs.some((doc) => doc.slug === 'README'))
  })

  it('getProductDoc → la page, ou undefined sur un slug inconnu', () => {
    assert.equal(getProductDoc('05-deals')?.title, 'Deals')
    assert.equal(getProductDoc('99-nope'), undefined)
    assert.equal(getProductDoc('README'), undefined)
  })

  it("l'index du prompt : une ligne « slug — titre » par page", () => {
    const lines = PRODUCT_DOC_INDEX.split('\n')
    assert.equal(lines.length, productDocs.length)
    assert.ok(lines.includes('08-pointage — Pointage'))
  })
})

describe('fold / queryTerms', () => {
  it('plie casse et accents', () => {
    assert.equal(fold('Prévisionnel'), 'previsionnel')
    assert.equal(fold('Trésorerie — À faire'), 'tresorerie — a faire')
  })

  it('ignore les mots vides et les termes de moins de 2 caractères', () => {
    assert.deepEqual(queryTerms('annuler un deal'), ['annuler', 'deal'])
    assert.deepEqual(queryTerms('comment marche le pointage ?'), ['pointage'])
    assert.deepEqual(queryTerms('deal, valorisation!'), [
      'deal',
      'valorisation',
    ])
    assert.deepEqual(queryTerms('  a  Deal '), ['deal'])
    assert.deepEqual(queryTerms(''), [])
  })
})

describe('searchProductDocs', () => {
  it('« previsionnel » sans accent classe la page Prévisionnel en tête', () => {
    const hits = searchProductDocs('previsionnel')
    assert.equal(hits[0]?.slug, '09-previsionnel')
    assert.ok(hits[0].excerpt.length > 0)
  })

  it('« pointage » → la page Pointage en tête', () => {
    assert.equal(searchProductDocs('pointage')[0]?.slug, '08-pointage')
  })

  it('« annuler un deal » → la page Deals en tête, extrait sur l’annulation', () => {
    const [top] = searchProductDocs('annuler un deal')
    assert.equal(top.slug, '05-deals')
    assert.ok(fold(top.excerpt).includes('annul'), top.excerpt)
  })

  it('une longue page ne gagne pas au volume : le titre prime', () => {
    // 18-dette-et-garanties says « prévisionnel » many times; the page whose
    // H1 is « Prévisionnel » must still come first.
    const slugs = searchProductDocs('previsionnel').map((hit) => hit.slug)
    assert.ok(
      slugs.indexOf('09-previsionnel') < slugs.indexOf('18-dette-et-garanties'),
    )
  })

  it('requête vide ou trop courte → aucun résultat', () => {
    assert.deepEqual(searchProductDocs(''), [])
    assert.deepEqual(searchProductDocs('a'), [])
  })

  it('un terme absent partout → aucun résultat', () => {
    assert.deepEqual(searchProductDocs('xyzzyqwv'), [])
  })

  it('respecte la limite', () => {
    assert.ok(searchProductDocs('deal').length > 3)
    assert.equal(searchProductDocs('deal', 3).length, 3)
  })

  it('chaque hit porte un extrait non vide et un titre', () => {
    for (const hit of searchProductDocs('org')) {
      assert.ok(hit.title.length > 0)
      assert.ok(hit.excerpt.length > 0)
    }
  })
})

describe('splitByTerms', () => {
  it('découpe en segments marqués / non marqués, sans tenir compte des accents', () => {
    const segments = splitByTerms('Le prévisionnel de cash', ['previsionnel'])
    assert.deepEqual(segments, [
      { text: 'Le ', match: false },
      { text: 'prévisionnel', match: true },
      { text: ' de cash', match: false },
    ])
  })

  it('sans terme → un seul segment ; texte vide → aucun', () => {
    assert.deepEqual(splitByTerms('abc', []), [{ text: 'abc', match: false }])
    assert.deepEqual(splitByTerms('', ['a']), [])
  })
})
