/**
 * Who holds a blob (ALB-234). These tests are oriented toward the mistakes
 * that would cost data: calling a referenced blob an orphan, or dropping the
 * copy a fiche shows in favour of one nothing points at.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classify,
  extraCopies,
  purgeableOrphans,
  tally,
} from '../scripts/lib/storage-holders.mjs'

/** One day in ms — the age floor the purge uses. */
const DAY = 24 * 60 * 60 * 1000

const meta = (entries: Array<[string, number, number]>) =>
  new Map(entries.map(([id, size, createdAt]) => [id, { size, createdAt }]))

test('un blob que rien ne référence est un orphelin', () => {
  assert.equal(classify('a', new Map()), 'none')
})

test('un Set vide compte comme aucune référence', () => {
  assert.equal(classify('a', new Map([['a', new Set()]])), 'none')
})

test('une pièce jointe de mail N EST PAS un orphelin', () => {
  // The whole point: no `documents` row, yet perfectly in use.
  const holders = new Map([['a', new Set(['inboundEmails'])]])
  assert.equal(classify('a', holders), 'inboundEmails')
})

test('la fiche prime sur le mail quand les deux pointent', () => {
  const holders = new Map([['a', new Set(['inboundEmails', 'documents'])]])
  assert.equal(classify('a', holders), 'documents')
})

test('une table inconnue ne surclasse pas un vrai porteur', () => {
  const holders = new Map([['a', new Set(['zzz', 'documents'])]])
  assert.equal(classify('a', holders), 'documents')
})

test('une table inconnue seule ne vaut pas une référence', () => {
  // Being lenient here would hide an orphan instead of reporting it.
  assert.equal(classify('a', new Map([['a', new Set(['zzz'])]])), 'none')
})

test('tally ne perd aucun octet', () => {
  const m = meta([
    ['a', 100, 1],
    ['b', 250, 2],
    ['c', 30, 3],
  ])
  const holders = new Map([
    ['a', new Set(['documents'])],
    ['b', new Set(['companyEmails'])],
  ])
  const counts = tally([...m.keys()], holders, m)
  const total = [...counts.values()].reduce((n, s) => n + s.bytes, 0)
  assert.equal(total, 380)
  assert.equal(counts.get('none')?.count, 1)
  assert.equal(counts.get('none')?.bytes, 30)
})

test('tally compte un blob sans métadonnée sans planter', () => {
  const counts = tally(['ghost'], new Map(), new Map())
  assert.equal(counts.get('none')?.count, 1)
  assert.equal(counts.get('none')?.bytes, 0)
})

test('la copie conservée est celle que la fiche référence', () => {
  const m = meta([
    ['orphan', 10, 1],
    ['doc', 10, 2],
  ])
  const holders = new Map([['doc', new Set(['documents'])]])
  // 'orphan' is older, so a naive "keep the oldest" would drop the fiche.
  assert.deepEqual(extraCopies(['orphan', 'doc'], holders, m), ['orphan'])
})

test('à égalité de porteur, la plus ancienne survit', () => {
  const m = meta([
    ['young', 10, 200],
    ['old', 10, 100],
  ])
  const holders = new Map([
    ['young', new Set(['documents'])],
    ['old', new Set(['documents'])],
  ])
  assert.deepEqual(extraCopies(['young', 'old'], holders, m), ['young'])
})

test('un groupe de N rend exactement N-1 copies en trop', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const m = meta(ids.map((id, i) => [id, 10, i] as [string, number, number]))
  assert.equal(extraCopies(ids, new Map(), m).length, ids.length - 1)
})

test('un groupe entièrement orphelin garde quand même une copie', () => {
  // Nothing references any of them, but the bytes still exist once.
  const m = meta([
    ['a', 10, 1],
    ['b', 10, 2],
  ])
  assert.deepEqual(extraCopies(['a', 'b'], new Map(), m), ['b'])
})

test('extraCopies ne modifie pas le tableau reçu', () => {
  const ids = ['b', 'a']
  const m = meta([
    ['a', 10, 1],
    ['b', 10, 2],
  ])
  extraCopies(ids, new Map(), m)
  assert.deepEqual(ids, ['b', 'a'])
})

test('la purge ne prend que ce que rien ne référence', () => {
  const m = meta([
    ['held', 10, 0],
    ['orphan', 10, 0],
  ])
  const holders = new Map([['held', new Set(['documents'])]])
  assert.deepEqual(purgeableOrphans(m, holders, { now: DAY * 10 }), ['orphan'])
})

test('un upload en cours est épargné', () => {
  // The blob exists, the row pointing at it does not YET. Deleting it here
  // breaks an upload a user is doing right now — the whole reason for the age
  // floor.
  const m = meta([['uploading', 10, DAY * 10 - 1000]])
  assert.deepEqual(purgeableOrphans(m, new Map(), { now: DAY * 10 }), [])
})

test('un orphelin pile à la limite d âge passe', () => {
  const m = meta([['old', 10, 0]])
  assert.deepEqual(purgeableOrphans(m, new Map(), { now: DAY }), ['old'])
})

test('un blob sans date de création est épargné', () => {
  // Not provably old, so not provably safe.
  const m = new Map([['nodate', { size: 10 }]])
  assert.deepEqual(purgeableOrphans(m, new Map(), { now: DAY * 10 }), [])
})

test('la purge ne rend jamais un blob encore tenu, même très vieux', () => {
  const m = meta([['ancient', 10, 0]])
  const holders = new Map([['ancient', new Set(['companyEmails'])]])
  assert.deepEqual(purgeableOrphans(m, holders, { now: DAY * 1000 }), [])
})
