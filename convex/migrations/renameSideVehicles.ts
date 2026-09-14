/**
 * One-shot rename of the Calte fiches whose name carries the VEHICLE in
 * front of the company: `SIDE  TIMELEFT`, `ASTERION SIDE BOCOLOCO`,
 * `Asterion Side - Projet Orus Energy`… The vehicle moves to a trailing
 * parenthetical — `TIMELEFT (SIDE)` — which is the naming convention the
 * report pipeline already assumes.
 *
 * Why it matters: a report is attached to a fiche on two deterministic
 * proofs (`convex/lib/emailIdentify.ts`) — the author's domain equals the
 * fiche's, or the fiche's name is written IN FULL in the mail. A founder
 * never writes "SIDE TIMELEFT", so the second proof could not fire; and the
 * mail is often forwarded by a third party (an investor relations contact,
 * a co-investor), so the first one could not either. 48 participations were
 * therefore structurally unattachable and landed in the review queue every
 * month. `matchableName` drops a TRAILING parenthetical — that is our own
 * annotation, never a word the sender writes — so `TIMELEFT (SIDE)` is
 * looked up as `TIMELEFT` and matches.
 *
 * NOT renamed: the six `SIDE …` / two `ASTERION F…` fiches on
 * `side-capital.com` / `asterionventures.com`. There, the fund IS the
 * participation (we are a subscriber), so "SIDE" is its real name, not a
 * prefix. Renaming them would break the very lookup this migration fixes.
 *
 * Anchored on the prod `_id`, with the stored name as a guard — 8 of these
 * fiches carry a double or trailing space (`SIDE  TIMELEFT`,
 * `SIDE KAZADEN `), so the guard compares on collapsed whitespace: a name
 * matched character by character would refuse the very rows it targets.
 *
 * Write semantics: patches only when the stored name is still the expected
 * one, so re-running is a no-op. A fiche whose name no longer matches is
 * REPORTED (`anchorMismatch`), never rewritten — someone renamed it by hand
 * in the meantime and that choice wins.
 *
 * Execution (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/renameSideVehicles:dryRun
 *   # STOP: eyeball the before→after list, then:
 *   pnpm exec convex run --prod migrations/renameSideVehicles:apply
 *   pnpm exec convex run --prod migrations/renameSideVehicles:report
 */
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

/**
 * The renames, anchored by prod `_id` + name guard. `to` is the label the
 * company writes itself, the vehicle in a trailing parenthetical.
 */
const RENAMES: Array<{ companyId: string; expectedName: string; to: string }> = [
  // Plain vehicle prefix: SIDE / ASTERION / both. The prefix moves, the
  // company label is kept verbatim (casing included — the lookup is
  // case-insensitive, so recasing would be cosmetic churn).
  { companyId: 'jx70qc6emrxprchvf8w9042wg187r8g1', expectedName: 'Asterion Side -  QOMON', to: 'QOMON (Asterion Side)' },
  { companyId: 'jx7aqyk12f19aqae93jdfq7cp987rjft', expectedName: 'SIDE ASTERION BILLIV', to: 'BILLIV (SIDE ASTERION)' },
  { companyId: 'jx7epzmg2rvqxv7n8j9xpj2y7187ssmt', expectedName: 'SIDE - OGHJI', to: 'OGHJI (SIDE)' },
  { companyId: 'jx70ng7853e6ma6ckdak14wavn87sqr3', expectedName: 'SIDE WENABI', to: 'WENABI (SIDE)' },
  { companyId: 'jx7cfvpdwkrs3w7nvw47vv5s0x87s3jb', expectedName: 'ASTERION SIDE BOCOLOCO', to: 'BOCOLOCO (ASTERION SIDE)' },
  { companyId: 'jx730j9j7cxc69qfxyzewattj987rprs', expectedName: 'SIDE - COMPTOIR DES PHARMACIES', to: 'COMPTOIR DES PHARMACIES (SIDE)' },
  { companyId: 'jx7cc2wtssg3ejetg1ck2cxskn87rdvz', expectedName: 'SIDE  - CAPTE', to: 'CAPTE (SIDE)' },
  { companyId: 'jx70bz9yvagvbe3f7qnbq3gt6h87r1k5', expectedName: 'SIDE FEELI', to: 'FEELI (SIDE)' },
  { companyId: 'jx73j1qrrj266md86cg15vvv3s87ryde', expectedName: 'SIDE KIS', to: 'KIS (SIDE)' },
  { companyId: 'jx732vebx3k66t2ne4jp8sgwz587rzcf', expectedName: 'SIDE HOP3TEAM', to: 'HOP3TEAM (SIDE)' },
  { companyId: 'jx7bam5p13trrtq6rfjscyz1bh87reyw', expectedName: 'SIDE Elqano', to: 'Elqano (SIDE)' },
  { companyId: 'jx7az31n8vr9cmd9n9se304hgn87ryjm', expectedName: 'SIDE KAZADEN', to: 'KAZADEN (SIDE)' },
  { companyId: 'jx79ys6rwr9c1v5ht3t7av997987stgr', expectedName: 'SIDE EMPRUNTE MON TOUTOU', to: 'EMPRUNTE MON TOUTOU (SIDE)' },
  { companyId: 'jx757kabzy8kxnx2smk1aerwy187scgd', expectedName: 'SIDE ASTERION KEENAT', to: 'KEENAT (SIDE ASTERION)' },
  { companyId: 'jx790yzt7x19hzzrvt7416qc6587raf1', expectedName: 'SIDE MELTING SPOT', to: 'MELTING SPOT (SIDE)' },
  { companyId: 'jx7dpsybp7fxd0ndzxpz28fzgn87rnag', expectedName: 'SIDE Archidvisor', to: 'Archidvisor (SIDE)' },
  { companyId: 'jx78y9b14rmbw271816rb223gn87r7fy', expectedName: 'SIDE ASTERION WEEFIN', to: 'WEEFIN (SIDE ASTERION)' },
  { companyId: 'jx745tz1zqzc5p8s6mx2fn4kan87sg14', expectedName: 'SIDE EVERPING', to: 'EVERPING (SIDE)' },
  { companyId: 'jx7e7hdv1v100wt2nqyfpmr21h87s7km', expectedName: 'ASTERION SIDE URBYN', to: 'URBYN (ASTERION SIDE)' },
  { companyId: 'jx7aschz534c7cyz4vdjxjj3x187sdrx', expectedName: 'Asterion Side CAELI', to: 'CAELI (Asterion Side)' },
  { companyId: 'jx79gw4cdnk0wgqnz6h6vdg3ks87sf7m', expectedName: 'SIDE - INTERSTIS', to: 'INTERSTIS (SIDE)' },
  { companyId: 'jx7a7689wegfrby47b93cy4yk987rpmj', expectedName: 'SIDE  TIMELEFT', to: 'TIMELEFT (SIDE)' },
  { companyId: 'jx77kdnkvsvnb33dq1xzy8jzgx87rw4c', expectedName: 'SIDE  Seelab', to: 'Seelab (SIDE)' },
  { companyId: 'jx767rfyk66q93ptb7nrqmewcd87sn73', expectedName: 'SIDE ASTERION AKTIO', to: 'AKTIO (SIDE ASTERION)' },
  { companyId: 'jx755m6q3yymasxnbkq5kt8rn587rd13', expectedName: 'Side Live Tonight', to: 'Live Tonight (Side)' },
  { companyId: 'jx7fyw1xpej8ggc21b5wsvr2ms87rdy3', expectedName: 'SIDE DOINSPORT', to: 'DOINSPORT (SIDE)' },
  { companyId: 'jx7947e3bbk09gttb7gq71pnph87rg32', expectedName: 'SIDE MSA', to: 'MSA (SIDE)' },
  { companyId: 'jx792tg33apsbd6b7wmgmrd13h87r6k8', expectedName: 'SIDE ALLCOLIBRI', to: 'ALLCOLIBRI (SIDE)' },
  { companyId: 'jx76wtp3s2gdxh0f3eff51d0kn87smpf', expectedName: 'SIDE BAKERSTAFF', to: 'BAKERSTAFF (SIDE)' },
  { companyId: 'jx7cq6hv5634745qvtjt6vmxj987rkdt', expectedName: 'SIDE Tulip', to: 'Tulip (SIDE)' },
  { companyId: 'jx703xqvby05v83wgcb810hnpd87rznk', expectedName: 'SIDE WELYB', to: 'WELYB (SIDE)' },
  { companyId: 'jx73se1xz8w1mesfx32vw0vb0s87rxrf', expectedName: 'SIDE AGILITEST', to: 'AGILITEST (SIDE)' },
  { companyId: 'jx71s59bdp8s80n15nkxqr8z5587rpq2', expectedName: 'SIDE - DROPCONTACT', to: 'DROPCONTACT (SIDE)' },
  { companyId: 'jx764dr0zg8gxdasjaa1r5hemh87s7fw', expectedName: 'Asterion Side - Projet Orus Energy', to: 'Orus Energy (Asterion Side)' },
  { companyId: 'jx79bfkf01kgsajnphkjvxxyqs87s879', expectedName: 'SIDE Delicity', to: 'Delicity (SIDE)' },
  { companyId: 'jx7akm15fz7c07r9g2qgac4j6x87scam', expectedName: 'SIDE ASTERION EVERDYE', to: 'EVERDYE (SIDE ASTERION)' },
  { companyId: 'jx7a40533yc133x85h57h7sjbs87r4gh', expectedName: 'SIDE AXYN', to: 'AXYN (SIDE)' },

  // Three-part names: vehicle + co-investor (or former name) + company. The
  // parenthetical keeps both, so nothing that was written on the fiche is
  // lost — only the lookup changes.
  { companyId: 'jx72qbzzf84q375bv6gs3dcax187sxtx', expectedName: 'SIDE KLARA (MOOVEO)', to: 'KLARA (SIDE, ex MOOVEO)' },
  { companyId: 'jx7c2avkgmpqedc955wz64v22987r4ra', expectedName: 'SIDE  SuperCapital Thinkeo', to: 'Thinkeo (SIDE SuperCapital)' },
  { companyId: 'jx78t12eh9mcve46dmfpg3mngx87saxf', expectedName: 'ASTERION SIDE CREMERIES UNIES ( Bon dimanche)', to: 'Bon Dimanche (ASTERION SIDE, ex CREMERIES UNIES)' },
  { companyId: 'jx7csjxyd8kne6mq1s03pb307587sveg', expectedName: 'ASTERION SIDE ONIMA (ex:YEASTY)', to: 'ONIMA (ASTERION SIDE, ex YEASTY)' },
  { companyId: 'jx7bsj7nb7h16er1kq631magjn87r0xv', expectedName: 'SIDE FAMILY VENTURES BIB BATTERIES', to: 'BIB BATTERIES (SIDE FAMILY VENTURES)' },
  { companyId: 'jx7dvqekhzcxst4nm2s4zhw68s87rcza', expectedName: 'SIDE - OneGreen APNEE', to: 'APNEE (SIDE OneGreen)' },
  { companyId: 'jx72d10h397appehxfnh889z4h87r5v2', expectedName: 'SIDE - ADEQUA (POTIONS) - AB tasty', to: 'AB Tasty (SIDE - ADEQUA/POTIONS)' },
  { companyId: 'jx763dyzf9hj8j7gghpc7s2w4s87sym1', expectedName: 'SIDE LOGATIK V', to: 'LOGATIK (SIDE V)' },
  { companyId: 'jx77d8scs7m0q60raasxeyrz1h87ss0s', expectedName: 'SIDE INOVEXUS Ordalie', to: 'Ordalie (SIDE INOVEXUS)' },
  { companyId: 'jx70v5vj6nf4st73p7x98jtty187rhdt', expectedName: 'SIDE MONSTOCK (mon stock)', to: 'MONSTOCK (SIDE)' },

  // Same pattern outside the SIDE family: the fiche is named after the
  // vehicle, the company is in the parenthetical — so the lookup searched
  // "SPACELY STOCKAGE" while the sender writes "Stockoss".
  { companyId: 'jx76efk3zh3e2jyy7ev3kt5eqx87s144', expectedName: 'SPACELY STOCKAGE (STOCKOSS)', to: 'STOCKOSS (SPACELY STOCKAGE)' },
]

/** The guard compares on collapsed whitespace — see the header. */
function normalize(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

type Resolved = {
  toRename: Array<{ company: Doc<'companies'>; orgSlug: string; to: string }>
  /** Anchor whose entity is no longer the one the rename was decided on. */
  anchorMismatch: Array<{ companyId: string; expected: string; found: string }>
  /** Anchor pointing at no company at all (deleted since). */
  missing: Array<{ companyId: string; expected: string }>
  alreadyRenamed: number
}

async function resolve(ctx: Ctx): Promise<Resolved> {
  const byId = new Map(RENAMES.map((r) => [r.companyId, r]))
  const seen = new Set<string>()
  const orgs = await ctx.db.query('organizations').collect()
  const toRename: Resolved['toRename'] = []
  const anchorMismatch: Resolved['anchorMismatch'] = []
  let alreadyRenamed = 0

  for (const org of orgs) {
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    for (const company of companies) {
      const rename = byId.get(company._id)
      if (!rename) continue
      seen.add(rename.companyId)
      if (company.name === rename.to) {
        alreadyRenamed++
        continue
      }
      if (normalize(company.name) !== normalize(rename.expectedName)) {
        anchorMismatch.push({
          companyId: rename.companyId,
          expected: rename.expectedName,
          found: company.name,
        })
        continue
      }
      toRename.push({ company, orgSlug: org.slug, to: rename.to })
    }
  }

  const missing = RENAMES.filter((r) => !seen.has(r.companyId)).map((r) => ({
    companyId: r.companyId,
    expected: r.expectedName,
  }))
  return { toRename, anchorMismatch, missing, alreadyRenamed }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toRename, anchorMismatch, missing, alreadyRenamed } = await resolve(ctx)
    return {
      toRenameCount: toRename.length,
      alreadyRenamed,
      anchorMismatch,
      missing,
      toRename: toRename.map((r) => ({
        org: r.orgSlug,
        from: r.company.name,
        to: r.to,
      })),
      note:
        'Lecture seule. Valider la liste from → to puis lancer ' +
        'migrations/renameSideVehicles:apply. Les entrées anchorMismatch ne ' +
        'sont pas touchées (la fiche a été renommée à la main depuis).',
    }
  },
})

// ─── apply — writes the new names, idempotent ────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { toRename, anchorMismatch, missing } = await resolve(ctx)
    for (const r of toRename) {
      await ctx.db.patch('companies', r.company._id, { name: r.to })
    }
    return {
      renamed: toRename.length,
      anchorMismatch,
      missing,
      note: 'Fiches renommées. Vérifier avec migrations/renameSideVehicles:report.',
    }
  },
})

// ─── report — post-apply: what is left ───────────────────────────────────────

export const report = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { toRename, anchorMismatch, missing, alreadyRenamed } = await resolve(ctx)
    return {
      stillToRename: toRename.length,
      alreadyRenamed,
      anchorMismatch,
      missing,
      note:
        toRename.length === 0
          ? 'Toutes les fiches du lot portent le véhicule en fin de nom.'
          : 'Des fiches restent à renommer — relancer apply.',
    }
  },
})
