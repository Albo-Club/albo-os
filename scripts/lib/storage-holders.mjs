/**
 * Who still points at a stored blob — the only question that makes deleting
 * one safe (ALB-234).
 *
 * Six places in the Convex schema can hold a storage reference. "This blob
 * has no `documents` row" therefore proves nothing: an attachment on a
 * received email is in use and invisible to that join. These helpers turn the
 * reverse index (blob → holder tables) into the four buckets a human can
 * decide on.
 *
 * `documentTexts` is NOT a holder: it is the text extracted FROM a blob, so
 * it can never be the reason to keep one. It travels with the deletion.
 *
 * Pure, no clock, no I/O — the sweep lives in `scripts/storage-audit.mjs`.
 */

/** Holder tables, most telling first. The order IS the ranking. */
export const HOLDER_TABLES = [
  'documents',
  'inboundEmails',
  'companyEmails',
  'users',
  'organizations',
]

export const HOLDER_LABEL = {
  documents: 'une fiche (document)',
  inboundEmails: 'un mail reçu, sans document',
  companyEmails: 'la timeline email RETIRÉE',
  users: 'un avatar',
  organizations: 'un logo',
  none: 'plus rien du tout',
}

/**
 * The most telling holder of a blob, or 'none'. An unknown table name is
 * ignored rather than trusted: a holder the ranking does not know about must
 * not silently outrank a real one.
 */
export function classify(storageId, holders) {
  const held = holders.get(storageId)
  if (!held || held.size === 0) return 'none'
  return HOLDER_TABLES.find((t) => held.has(t)) ?? 'none'
}

/** Sum {count, bytes} per holder category over the given blobs. */
export function tally(ids, holders, meta) {
  const out = new Map()
  for (const id of ids) {
    const key = classify(id, holders)
    const cur = out.get(key) ?? { count: 0, bytes: 0 }
    cur.count += 1
    cur.bytes += meta.get(id)?.size ?? 0
    out.set(key, cur)
  }
  return out
}

/**
 * The copies of a duplicate group that could go, keeping the ONE that is best
 * referenced: deleting the copy a fiche shows to keep an orphan would be the
 * exact opposite of the intent. Ties break on the oldest blob, so the surviving
 * copy is the one the rest of the base has had the longest.
 */
export function extraCopies(ids, holders, meta) {
  const rank = (id) => {
    const i = HOLDER_TABLES.indexOf(classify(id, holders))
    return i === -1 ? HOLDER_TABLES.length : i
  }
  const ranked = [...ids].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (meta.get(a)?.createdAt ?? 0) - (meta.get(b)?.createdAt ?? 0),
  )
  return ranked.slice(1)
}

/**
 * How young a blob may be and still be spared. An upload is a TWO-STEP dance:
 * the browser PUTs the bytes, and only then does the mutation create the row
 * pointing at them. In between, a perfectly legitimate file has no holder and
 * looks exactly like an orphan. Deleting it there breaks the upload the user
 * is doing right now.
 *
 * A day is absurdly generous for a dance that lasts seconds — and costs
 * nothing, since the blobs being purged are months old.
 */
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The blobs a purge may delete: no holder at all, AND old enough that no
 * in-flight upload can be hiding among them.
 *
 * Returns ids only — the caller re-checks each one server-side before
 * deleting, because this list is computed from a sweep that finished a while
 * ago.
 */
export function purgeableOrphans(meta, holders, opts = {}) {
  const now = opts.now ?? Date.now()
  const minAgeMs = opts.minAgeMs ?? MIN_ORPHAN_AGE_MS
  const out = []
  for (const [id, { createdAt }] of meta) {
    if (classify(id, holders) !== 'none') continue
    // A blob with no creation date is not provably old: spare it.
    if (typeof createdAt !== 'number') continue
    if (now - createdAt < minAgeMs) continue
    out.push(id)
  }
  return out
}
