import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isSpreadsheet } from '../convex/lib/fileText'

// A manual upload carries a user-chosen title that may have lost its
// extension, so the content type has to answer on its own — and an email
// attachment carries the filename but sometimes no content type at all.

describe('isSpreadsheet', () => {
  it('recognises workbooks by extension', () => {
    assert.equal(isSpreadsheet('Budget PnL Cash 30.06.2025.xlsx'), true)
    assert.equal(isSpreadsheet('vieux-modele.xls'), true)
    assert.equal(isSpreadsheet('macro.xlsm'), true)
    assert.equal(isSpreadsheet('export.csv'), true)
  })

  it('recognises them by content type when the title has no extension', () => {
    assert.equal(
      isSpreadsheet(
        'Budget',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
      true,
    )
    assert.equal(isSpreadsheet('Budget', 'application/vnd.ms-excel'), true)
    assert.equal(isSpreadsheet('Transactions', 'text/csv'), true)
  })

  it('leaves the documents semantic search is good at alone', () => {
    assert.equal(isSpreadsheet('Pacte d’actionnaires.pdf'), false)
    assert.equal(isSpreadsheet('Term sheet.docx'), false)
    assert.equal(isSpreadsheet('board-deck.pdf', 'application/pdf'), false)
    assert.equal(isSpreadsheet('logo.png', 'image/png'), false)
  })

  it('is not fooled by a name that merely mentions a spreadsheet', () => {
    assert.equal(isSpreadsheet('Analyse du fichier xlsx de Sezame.pdf'), false)
  })
})
