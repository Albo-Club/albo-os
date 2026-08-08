/**
 * One-shot cleanup of the `calte` companies the Airtable import created for
 * something that is not a portfolio company, plus the three holdings it never
 * gave a deal to.
 *
 * Context. The import created a `portfolio` card for EVERY row of the Airtable
 * `Entreprise` table, whatever the movement behind it was for — a donation, a
 * lawyer's fee, a tax payment, a transfer label. After
 * `cleanupCalteImport:apply`, 44 of those cards carried no deal at all. Each
 * was arbitrated against the bank movements and against the signed 31/12/2025
 * accounts (`plaquette ECGE`, attestation of 07/04/2026):
 *
 *   - 41 are not portfolio companies and are archived here. The evidence is
 *     recorded per row in `kind`: a donation, a supplier invoiced monthly with
 *     VAT, the tax office, a bank/technical label, an import artefact, a natural
 *     person, a dealflow card or a holding of the other vehicle. None of them
 *     appears in the balance sheet's asset detail.
 *   - 3 ARE real positions that simply never got a deal — the accounts or the
 *     bank movements carry them, the tool did not. They get their deal here.
 *
 * Two of the archived rows deserve their own line, because they are NOT
 * nothing — they are simply not participations:
 *   - `Clement ALTERESCO` is the shareholder current account the balance sheet
 *     shows at 70 700 € on the LIABILITY side. Archiving the portfolio card
 *     does not delete that debt; it just stops presenting it as an investment.
 *   - `NANTISSEMENT CASH DEPOSIT PRET B` is the 3 280 000 € cash collateral
 *     pledged against a loan. A real asset, but a blocked account — not a
 *     company one can invest in.
 *
 * What this migration does:
 *   1. Archives the 41 cards (`archivedAt`), each guarded on its exact current
 *      name and refused outright if anything still points at it.
 *   2. Creates three deals on their existing cards, with CALTE's `group_root` as
 *      investor: `PRIV. EQUITY ROTHSCHILD` (387 321 €, `fund_lp`),
 *      `INVEST FOR PLANET` (5 000 €, `share`) — both verbatim from the asset
 *      detail of the signed accounts — and `LE CHAPTAL` (10 000 €, `cca`,
 *      signed 01/10/2025, repaid 15/07/2026, so `fully_exited` at 10 000 € of
 *      proceeds), read off the two bank movements.
 *   3. Points every declared movement to its new deal: Invest for Planet's
 *      single one (5 000 €, 11/01/2021, HSBC) and Le Chaptal's two (out then
 *      back). Rothschild has NO movement in the base — the money went out before
 *      the imported period — so its deal carries the balance-sheet amount and no
 *      signature date rather than an invented one.
 *
 * Conventions (cf. convex/schema.ts): amounts in CENTS, dates in ms epoch UTC.
 * Idempotent & guarded: cards are anchored by their prod `_id` and cross-checked
 * against their exact current name; an already-archived card is a no-op, and a
 * card that gained a reference since the audit is reported instead of archived.
 * Nothing is hard-deleted.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/cleanupCalteOrphanCompanies:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/cleanupCalteOrphanCompanies:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** Midnight UTC of an ISO date, as ms epoch — the schema's date convention. */
const iso = (date: string) => Date.parse(`${date}T00:00:00.000Z`)

/**
 * Why each card is not a portfolio company. `kind` is the evidence, kept in the
 * code so a later reader does not have to re-derive it:
 *   donation        — a gift; the movement is a `Don …` or an association
 *   supplier        — invoiced services, most already qualified as `charge`
 *   tax             — the tax office
 *   banking         — a bank, a pledged account or a transfer label
 *   import_artefact — a duplicate, or a card left behind by a deleted deal
 *   not_a_company   — a natural person, or CALTE itself
 *   dealflow        — a company looked at, never invested in: no movement, no
 *                     line in the balance sheet. Its place is Attio.
 *   wrong_org       — a holding of the OTHER vehicle, created here by mistake
 */
type Archive = {
  id: string
  expectedName: string
  kind:
    | 'donation'
    | 'supplier'
    | 'tax'
    | 'banking'
    | 'import_artefact'
    | 'not_a_company'
    | 'dealflow'
    | 'wrong_org'
}

const ARCHIVE: Array<Archive> = [
  // — donation —
  {
    id: 'jx71snpz9xchq8pa7q563bzzes87rfd7',
    expectedName: 'ARSLA Association',
    kind: 'donation',
  },
  {
    id: 'jx70mq6514wkpd7cynw4j7vm3587sprc',
    expectedName: 'Association Dividendes Climat',
    kind: 'donation',
  },
  {
    id: 'jx7djz6w5y4g30vdyst25v1dh187se11',
    expectedName: 'Don Stand with Ukraine',
    kind: 'donation',
  },
  {
    id: 'jx7f37w5fhcc9q7k96hj9n7ztn87ssdy',
    expectedName: 'Eclosion Association',
    kind: 'donation',
  },
  {
    id: 'jx78nw0ae8p5v23j84rcbr7y0h87rgn9',
    expectedName: 'Fondation Concorde',
    kind: 'donation',
  },
  {
    id: 'jx79nry1t3g29qka17vwdsmdx587rbbz',
    expectedName: 'Fondation de France',
    kind: 'donation',
  },
  {
    id: 'jx7brvsa5pt42webx3a606eq8987sckh',
    expectedName: 'Fondation de la Mer',
    kind: 'donation',
  },
  {
    id: 'jx79a91jb08qh5gmgaqvvzm2nd87rg2j',
    expectedName: 'Fondation Ecole M',
    kind: 'donation',
  },
  {
    id: 'jx76egyd6jcf1m4s3725gtrqax87rpxw',
    expectedName: 'Le rire Médecin',
    kind: 'donation',
  },
  {
    id: 'jx75rmdhff060x08tjtm30k8td87sb80',
    expectedName: 'MOINA association jeunesse',
    kind: 'donation',
  },
  {
    id: 'jx7e8627mpyvzkhk6bs2mhqfts87rvw1',
    expectedName: 'Petits frères des pauvres',
    kind: 'donation',
  },
  {
    id: 'jx78ej7xvjaer0f3r1v7ea7xts87rsfd',
    expectedName: 'PETITS PRINCES ASSOCIATION',
    kind: 'donation',
  },
  // — supplier —
  {
    id: 'jx79zv1gytrb5pang0eh6ma8z187rcr1',
    expectedName:
      'Caisse des Reglements Pecuniaire - AARPI Mc Dermott Will + Emery',
    kind: 'supplier',
  },
  {
    id: 'jx7fny7qjm49xvdr89dpfxrsrx87rnca',
    expectedName: 'D&A Corporate Finance',
    kind: 'supplier',
  },
  {
    id: 'jx7cqne5h0dyj2xpgvcwfdf4yn87r5wx',
    expectedName: 'JEY - Commissariat aux comptes',
    kind: 'supplier',
  },
  {
    id: 'jx7768khnmpk9rev86bkrt68e987rdzh',
    expectedName: 'NÉNERT NOTAIRES',
    kind: 'supplier',
  },
  {
    id: 'jx72j1b6n378ncrwvp50chv1h987scy6',
    expectedName: 'SCP DE BRANQUILANGES',
    kind: 'supplier',
  },
  {
    id: 'jx7b47kamz0rbgygw6gpcmgq3s87spq5',
    expectedName: 'WALTER BILLET AVOCATS',
    kind: 'supplier',
  },
  {
    id: 'jx780ndh2n8m0xfjdmm729nxzs87rarm',
    expectedName: 'Sodexo Charges',
    kind: 'supplier',
  },
  {
    id: 'jx71cyggzcham0f7tkme8n09js87s4zp',
    expectedName: 'ANTESE',
    kind: 'supplier',
  },
  {
    id: 'jx748nmkrcmhqhq4ah9krrmm6x87s7s4',
    expectedName: 'La Carafe',
    kind: 'supplier',
  },
  {
    id: 'jx75kg528xq6pba9rqvb2tyn4s87sn18',
    expectedName: 'ON LOCATION',
    kind: 'supplier',
  },
  {
    id: 'jx70kpj0ztb70rdcdh8vnqm1ed87rbqr',
    expectedName: 'LABEL EXPERIENCE',
    kind: 'supplier',
  },
  // — tax —
  {
    id: 'jx766d0gfrx2bqyfx7ta6jzdqn87rp6y',
    expectedName: 'DGFIP',
    kind: 'tax',
  },
  // — banking —
  {
    id: 'jx7e62njqqewjb5p6kneftpjvs87rd04',
    expectedName: 'CURRENCIES DIRECT LTD ONE CANADA',
    kind: 'banking',
  },
  {
    id: 'jx73jhzj18ytyg1mdz0sqqvk5987sn0t',
    expectedName: 'MANGOPAY',
    kind: 'banking',
  },
  {
    id: 'jx71cryap5ytkpt89ckqfs4hxs87reg8',
    expectedName: 'NANTISSEMENT CASH DEPOSIT PRET B',
    kind: 'banking',
  },
  {
    id: 'jx70m1mqz3dy9c77vt443ynjtn87skh2',
    expectedName: 'VIR CRCAM - COMPTE DE PASSAGE',
    kind: 'banking',
  },
  {
    id: 'jx7dt8ptwxzh352hf5dq5ke9b587r6ye',
    expectedName: 'VIR SEPAA COMPTE DE PASSAGE TITRE',
    kind: 'banking',
  },
  {
    id: 'jx73wcf131weema7hstxxx1ags87s59r',
    expectedName: 'VIR BANCO 2',
    kind: 'banking',
  },
  // — import_artefact —
  {
    id: 'jx7c0mpeva5rshcb7r5kp5tee187ray3',
    expectedName: 'Anaxago - Retrait Cagnotte',
    kind: 'import_artefact',
  },
  {
    id: 'jx7bb4pwdwkgfs2svyhy20bnrh87rjvk',
    expectedName: 'BUREAUX A PARTAGE - REMB C/C',
    kind: 'import_artefact',
  },
  {
    id: 'jx7b6y0atwxdg37fepq8fr88gd87sr0r',
    expectedName: 'SIDE - ADEQUA (POTIONS)',
    kind: 'import_artefact',
  },
  {
    id: 'jx70hsyj0ee37t1wev3hjqhvh587sr2n',
    expectedName: 'TECH LAB (The Good factory)',
    kind: 'import_artefact',
  },
  {
    id: 'jx76pjqehg2t0acyj10mds5z5d87rc9e',
    expectedName: 'SERENDIP INVEST',
    kind: 'import_artefact',
  },
  {
    id: 'jx77qfttd3btmrdq2xb0xc60jn87shhd',
    expectedName: 'Calte Bidart Beach',
    kind: 'import_artefact',
  },
  // — not_a_company —
  {
    id: 'jx76j3y4eamvm8wvw4kkv2j7ah87stq7',
    expectedName: 'Clement ALTERESCO',
    kind: 'not_a_company',
  },
  {
    id: 'jx74qmpaf8ac7ap29x417qzhd587re17',
    expectedName: 'Hugo Rocard',
    kind: 'not_a_company',
  },
  {
    id: 'jx7e0eyv2gmzmh1mcsrcez09pd87rarm',
    expectedName: 'Calte SASU',
    kind: 'not_a_company',
  },
  // — dealflow —
  {
    // Enriched card (site + pitch) but not a single euro left the accounts and
    // the balance sheet ignores it: a file that was looked at, not an
    // investment.
    id: 'jx76b6ed08sra315psj5dcmdq587skx8',
    expectedName: 'Upcyclea',
    kind: 'dealflow',
  },
  // — wrong_org —
  {
    // No movement and nothing in the CALTE balance sheet, but it sends its
    // investor reports to the `albo` org, where its own card lives.
    id: 'jx71cfp12542nze5743bh4t3e987rjpn',
    expectedName: 'The Fat Broccoli',
    kind: 'wrong_org',
  },
]

/**
 * The three positions the accounts or the bank statements carry and the tool
 * does not. Rothschild and Invest for Planet come from the `Détail de l'Actif`
 * at 31/12/2025, unchanged since 31/12/2024; Le Chaptal is read off its two
 * movements, an advance in current account since repaid in full — hence the
 * `exit`, and a deal born already closed.
 */
type MissingDeal = {
  companyId: string
  expectedName: string
  instrumentKind: 'fund_lp' | 'share' | 'cca'
  paidAmount: number
  /** Absent when no movement dates the entry — never invented. */
  signedDate?: number
  /** Set when the position is already closed (an advance since repaid). */
  exit?: { exitedDate: number; exitProceeds: number }
  /** The movements to point at the new deal, guarded one by one. */
  movements?: Array<{
    transactionId: string
    date: number
    amount: number
    direction: 'in' | 'out'
  }>
  source: string
}

const MISSING_DEALS: Array<MissingDeal> = [
  {
    companyId: 'jx72vv9ywvdwe7z5mb2j3c41zn87rjv5',
    expectedName: 'PRIV. EQUITY ROTHSCHILD',
    instrumentKind: 'fund_lp',
    paidAmount: 387_321_00,
    source:
      "« TITRES PRIV. EQUITY ROTHSCHILD » — Autres titres immobilisés, 387 321 € au 31/12/2025 comme au 31/12/2024. Aucun mouvement dans la base : le versement précède la période importée, la date de signature reste donc vide plutôt qu'inventée.",
  },
  {
    companyId: 'jx7257065886ccbj879h4ep9ds87rkvs',
    expectedName: 'INVEST FOR PLANET',
    instrumentKind: 'share',
    paidAmount: 5_000_00,
    signedDate: iso('2021-01-11'),
    movements: [
      {
        transactionId: 'kh776hdhvj0mm51ts0px8sfces87s971',
        date: iso('2021-01-11'),
        amount: 5_000_00,
        direction: 'out',
      },
    ],
    source:
      '« TITRES INVEST FOR PLANET » — 5 000 € au bilan, et un mouvement sortant de 5 000 € du 11/01/2021 (HSBC) resté non pointé.',
  },
  {
    // Not a duplicate of the equity line: the balance sheet carries the shares
    // separately («BAR DES MAKS - YBB LE CHAPTAL», 453 €, which already has its
    // own deal). This is the current account — advanced, then repaid in full,
    // so the position closes the day the money comes back.
    companyId: 'jx7b99my7rxcj671en3wkneyx587r14b',
    expectedName: 'LE CHAPTAL',
    instrumentKind: 'cca',
    paidAmount: 10_000_00,
    signedDate: iso('2025-10-01'),
    exit: { exitedDate: iso('2026-07-15'), exitProceeds: 10_000_00 },
    movements: [
      {
        transactionId: 'kh72ad882jqtkrqc0yy0wpkzpx87sctb',
        date: iso('2025-10-01'),
        amount: 10_000_00,
        direction: 'out',
      },
      {
        transactionId: 'kh714vh4ntgmjp417ns1znhkmn8bf0he',
        date: iso('2026-07-15'),
        amount: 10_000_00,
        direction: 'in',
      },
    ],
    source:
      'Avance en compte courant : 10 000 € sortis le 01/10/2025 (« SAS YBB - LE CHAPTAL ») et 10 000 € revenus le 15/07/2026 (« ARNI rbt chaptal cca »), les deux non pointés. Le capital est porté à part au bilan.',
  },
]

async function getOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError('calte_org_absent')
  return org
}

/**
 * Everything that can name a company. An orphan card should score zero on all
 * of it — anything else means the audit went stale and the row is reported
 * instead of archived.
 */
async function incomingRefs(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  id: Id<'companies'>,
) {
  const [
    asTarget,
    asInvestor,
    allDeals,
    relParent,
    relChild,
    docs,
    reports,
    intel,
    links,
    banks,
    kpis,
    todos,
    transfers,
  ] = await Promise.all([
    ctx.db
      .query('deals')
      .withIndex('by_org_target', (q) =>
        q.eq('orgId', orgId).eq('targetCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org_investor', (q) =>
        q.eq('orgId', orgId).eq('investorCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_parent', (q) =>
        q.eq('orgId', orgId).eq('parentCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_child', (q) =>
        q.eq('orgId', orgId).eq('childCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('documents')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('companyEmailLinks')
      .withIndex('by_company_and_sentAt', (q) => q.eq('companyId', id))
      .collect(),
    ctx.db
      .query('bankAccounts')
      .withIndex('by_owner', (q) =>
        q.eq('orgId', orgId).eq('ownerCompanyId', id),
      )
      .collect(),
    ctx.db
      .query('kpiSnapshots')
      .withIndex('by_org_period', (q) => q.eq('orgId', orgId))
      .collect(),
    ctx.db
      .query('todos')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
    ctx.db
      .query('transfers')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
  ])
  return {
    deals:
      asTarget.length +
      asInvestor.length +
      allDeals.filter((d) => d.viaSpvCompanyId === id).length,
    relations: relParent.length + relChild.length,
    documents: docs.length,
    reports: reports.length,
    intelligence: intel.length,
    emailLinks: links.length,
    bankAccounts: banks.length,
    kpiSnapshots: kpis.filter((k) => k.companyId === id).length,
    todos: todos.filter((t) => t.companyId === id).length,
    transfers: transfers.filter((t) => t.ownerCompanyId === id).length,
  }
}

const totalRefs = (refs: Record<string, number>) =>
  Object.values(refs).reduce((s, n) => s + n, 0)

// ─── dryRun ──────────────────────────────────────────────────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id

    const archive = await Promise.all(
      ARCHIVE.map(async (spec) => {
        const company = await ctx.db.get(
          'companies',
          spec.id as Id<'companies'>,
        )
        if (!company) return { ...spec, skip: 'not_found' }
        if (company.orgId !== orgId) return { ...spec, skip: 'wrong_org' }
        if (company.archivedAt != null)
          return { ...spec, skip: 'already_archived' }
        if (company.name !== spec.expectedName) {
          return { ...spec, skip: `name_mismatch (${company.name})` }
        }
        const refs = await incomingRefs(ctx, orgId, company._id)
        const total = totalRefs(refs)
        return {
          name: spec.expectedName,
          kind: spec.kind,
          willArchive: total === 0,
          ...(total > 0 ? { blockedBy: refs } : {}),
        }
      }),
    )

    const creations = await Promise.all(
      MISSING_DEALS.map(async (spec) => {
        const company = await ctx.db.get(
          'companies',
          spec.companyId as Id<'companies'>,
        )
        if (!company) return { ...spec, skip: 'company_not_found' }
        if (company.orgId !== orgId) return { ...spec, skip: 'wrong_org' }
        if (company.name !== spec.expectedName) {
          return { ...spec, skip: `name_mismatch (${company.name})` }
        }
        const existing = await ctx.db
          .query('deals')
          .withIndex('by_org_target', (q) =>
            q.eq('orgId', orgId).eq('targetCompanyId', company._id),
          )
          .collect()
        const movements = await Promise.all(
          (spec.movements ?? []).map(async (m) => {
            const tx = await ctx.db.get(
              'transactions',
              m.transactionId as Id<'transactions'>,
            )
            return {
              date: new Date(m.date).toISOString().slice(0, 10),
              amount: m.amount,
              direction: m.direction,
              found: tx != null,
              matches:
                tx?.orgId === orgId &&
                tx.transactionDate === m.date &&
                tx.amount === m.amount &&
                tx.direction === m.direction,
              stillFree:
                tx?.matchStatus === 'unmatched' && tx.allocation == null,
            }
          }),
        )
        return {
          name: spec.expectedName,
          instrumentKind: spec.instrumentKind,
          paidAmount: spec.paidAmount,
          signedDate: spec.signedDate
            ? new Date(spec.signedDate).toISOString().slice(0, 10)
            : null,
          willCreate: existing.length === 0,
          alreadyHasDeals: existing.length,
          exit: spec.exit
            ? new Date(spec.exit.exitedDate).toISOString().slice(0, 10)
            : null,
          movements,
          source: spec.source,
        }
      }),
    )

    const byKind: Record<string, number> = {}
    for (const row of archive) {
      if ('willArchive' in row && row.willArchive) {
        byKind[row.kind] = (byKind[row.kind] ?? 0) + 1
      }
    }
    return {
      org: { slug: org.slug, id: orgId },
      archive,
      creations,
      totals: {
        willArchive: archive.filter((r) => 'willArchive' in r && r.willArchive)
          .length,
        byKind,
        blocked: archive.filter(
          (r) => 'skip' in r || ('willArchive' in r && !r.willArchive),
        ).length,
        dealsCreated: creations.filter((c) => 'willCreate' in c && c.willCreate)
          .length,
      },
    }
  },
})

// ─── apply ───────────────────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const archived: Array<string> = []
    const created: Array<string> = []
    const skipped: Array<string> = []

    for (const spec of ARCHIVE) {
      const company = await ctx.db.get('companies', spec.id as Id<'companies'>)
      if (!company) {
        skipped.push(`${spec.expectedName}: anchor not found`)
        continue
      }
      if (company.archivedAt != null) continue // already archived
      if (company.orgId !== orgId) {
        skipped.push(`${spec.expectedName}: wrong org`)
        continue
      }
      if (company.name !== spec.expectedName) {
        skipped.push(`${spec.expectedName}: name mismatch (${company.name})`)
        continue
      }
      const refs = await incomingRefs(ctx, orgId, company._id)
      if (totalRefs(refs) > 0) {
        skipped.push(
          `${spec.expectedName}: still referenced (${Object.entries(refs)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${n} ${k}`)
            .join(', ')})`,
        )
        continue
      }
      await ctx.db.patch('companies', company._id, { archivedAt: Date.now() })
      archived.push(spec.expectedName)
    }

    const root = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', 'group_root'),
      )
      .first()
    if (!root) throw new ConvexError('group_root_absent')

    for (const spec of MISSING_DEALS) {
      const company = await ctx.db.get(
        'companies',
        spec.companyId as Id<'companies'>,
      )
      if (!company || company.orgId !== orgId) {
        skipped.push(`${spec.expectedName}: company anchor not found`)
        continue
      }
      if (company.name !== spec.expectedName) {
        skipped.push(`${spec.expectedName}: name mismatch (${company.name})`)
        continue
      }
      const existing = await ctx.db
        .query('deals')
        .withIndex('by_org_target', (q) =>
          q.eq('orgId', orgId).eq('targetCompanyId', company._id),
        )
        .collect()
      if (existing.length > 0) continue // already created
      const dealId = await ctx.db.insert('deals', {
        orgId,
        investorCompanyId: root._id,
        targetCompanyId: company._id,
        instrumentKind: spec.instrumentKind,
        currency: 'EUR',
        status: spec.exit ? ('fully_exited' as const) : ('active' as const),
        paidAmount: spec.paidAmount,
        signedDate: spec.signedDate,
        exitedDate: spec.exit?.exitedDate,
        exitProceeds: spec.exit?.exitProceeds,
        notes: spec.source,
        manuallyEditedFields: [
          'paidAmount',
          'signedDate',
          'notes',
          ...(spec.exit ? ['status', 'exitedDate', 'exitProceeds'] : []),
        ],
      })
      created.push(spec.expectedName)

      for (const m of spec.movements ?? []) {
        const tx = await ctx.db.get(
          'transactions',
          m.transactionId as Id<'transactions'>,
        )
        // Point it only if it is still the movement the audit saw, and free —
        // free meaning still in the queue AND carrying no allocation, since a
        // liability leg is `matched` without a `dealId` (convex/liabilities.ts).
        if (
          !tx ||
          tx.orgId !== orgId ||
          tx.matchStatus !== 'unmatched' ||
          tx.allocation != null ||
          tx.transactionDate !== m.date ||
          tx.amount !== m.amount ||
          tx.direction !== m.direction
        ) {
          skipped.push(
            `${spec.expectedName}: movement ${new Date(m.date).toISOString().slice(0, 10)} not pointed (changed since the audit)`,
          )
          continue
        }
        // Same shape as `applyMatchToDeal` (convex/lib/pointage.ts): VAT and
        // category only exist on the charge/product statuses. No
        // `matchingDecisions` row and no `reconciledBy` — that dataset records
        // HUMAN pointing decisions, and a migration is not one.
        await ctx.db.patch('transactions', tx._id, {
          dealId,
          allocation: { kind: 'deal' as const, targetId: dealId },
          matchStatus: 'matched' as const,
          reconciled: true,
          reconciledAt: Date.now(),
          vatRateBps: undefined,
          category: undefined,
        })
      }
    }

    return { archived, created, skipped }
  },
})
