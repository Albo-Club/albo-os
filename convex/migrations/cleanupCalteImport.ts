/**
 * One-shot cleanup of the `calte` portfolio inherited from the Airtable import.
 *
 * Context — why the portfolio needs this. The Airtable base had no deal and no
 * investing entity: only companies and bank movements tagged with a `Type
 * d'invest`. `airtableImport:runImport` therefore BUILT the deals, by merging
 * every movement sharing a company and a tag into a single line
 * (`1 deal = Entreprise × instrumentKind`). Whatever their real object. An
 * audit of the 247 imported deals, movement by movement, and the Drive note
 * « Calte — remise au propre des données » (04/08/2026) agree on four defects:
 *
 *   1. Companies exist twice — the import created a `portfolio` card for every
 *      Airtable company, including the group's own entities, which already had
 *      their `group_*` card (Caltimo, RDB, the SCIs, Banco 2, Relais Chapelle).
 *   2. Some deals are duplicated: a repayment landed on its own empty line
 *      instead of the deal it repays (Sezame Immo 1, C/C Flexliving, C/C BAP).
 *   3. Three lines are not investments at all: the Wormser loan CALTE is
 *      repaying (the Iroko units are pledged against it — cf. the 31/12/2025
 *      asset granularity), an Anaxago cash-account withdrawal, and a sale of
 *      30 B shares to a third party.
 *   4. 27 deals aggregate several distinct operations — successive rounds years
 *      apart, or unrelated objects (an acquisition and the current account that
 *      funds the subsidiary; a share sale and an employee's BSPCE).
 *
 * What this migration does, in order:
 *   1. Renames « Sant Roch » to « Sant Roch - Contrast » (commercial name and
 *      SAS name — the pointed movement and Attio both say Contrast).
 *   2. Fills the missing signature dates on Parallel SPV24 / SPV25.
 *   3. Creates RM Expansion and its share deal (27 995,82 €, 03/07/2026).
 *   4. Merges 10 duplicate company cards onto the card to keep, and archives
 *      2 empty Batch shells. The Batch funds themselves are legitimate: four
 *      funds, four cards, four deals.
 *   5. Merges 3 duplicate deal pairs.
 *   6. Takes the 3 non-investment lines out of the portfolio, returning their
 *      movements to the pointage queue so they can be qualified properly.
 *   7. Splits the 27 aggregated deals: the existing line keeps the earliest
 *      operation (its `airtableId`, its incoming movements and its history stay
 *      put), and each later operation becomes its own deal carrying its own
 *      movements. Incoming movements are NEVER redistributed — an exit usually
 *      covers all the securities, not one round.
 *
 * Conventions (cf. convex/schema.ts): amounts in CENTS, dates in ms epoch UTC.
 * Every written key is recorded in `manuallyEditedFields` so a re-run of
 * `airtableImport:runImport` cannot clobber it (cf. KNOWN_ISSUES.md « Édition
 * manuelle deals »).
 *
 * Idempotent & guarded: every company and deal is anchored by its prod `_id`
 * and cross-checked against its exact current name before anything is written;
 * any mismatch skips the row and is reported rather than guessed. Movements are
 * matched by (date, amount) inside their own deal and consumed once, so a part
 * whose movements are ambiguous or missing skips the whole deal. A company is
 * archived, never deleted — `archivedAt` is a reversible soft delete, and it
 * only runs on a card with zero incoming reference, counting EVERY table that
 * can name a company (including `transfers` and the `matchedCompanies` array of
 * the report-inbox rows). A deal has no such field, so the emptied ones are
 * hard-deleted:
 *   - on a merge (step 5), every transaction, valuation, projection, document,
 *     forecast, rule, entry and matching decision moves to the surviving deal
 *     first — same invariant as `deals.remove`;
 *   - on a removal (step 6) there is nowhere to move them, so the deal is
 *     deleted ONLY if it carries nothing but transactions. Anything else and
 *     the row is left untouched and reported. `dryRun` shows those counts under
 *     `otherRowsAttached`, so the stopping point can catch it.
 * Hence the mandatory snapshot below.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/cleanupCalteImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/cleanupCalteImport:apply
 *   pnpm exec convex run --prod migrations/cleanupCalteImport:verify
 *   # Reports moved between cards: rebuild the denormalized freshness fields.
 *   pnpm exec convex run --prod migrations/backfillReportFreshness:apply
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>
type MutCtx = GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** Midnight UTC of an ISO date, as ms epoch — the schema's date convention. */
const iso = (date: string) => Date.parse(`${date}T00:00:00.000Z`)

// ─── 1. Rename ───────────────────────────────────────────────────────────────

const RENAME = {
  companyId: 'jx791zxbc2hqn667jzgcjhcrs987sbm9',
  expectedName: 'Sant Roch',
  newName: 'Sant Roch - Contrast',
} as const

// ─── 2. Missing signature dates ──────────────────────────────────────────────

const SIGNED_DATES: Array<{
  dealId: string
  expectedTarget: string
  signedDate: number
}> = [
  {
    dealId: 'k570nrfhw2tb7mp3jr2gcb9efn8b26en',
    expectedTarget: 'Parallel Invest SPV24 (Mozaïk Investment)',
    signedDate: iso('2026-07-07'),
  },
  {
    dealId: 'k574mbvb50zvq5m57bpwg70mfh8b392n',
    expectedTarget: 'Parallel Invest SPV25 (YOUSE La Fraternelle)',
    signedDate: iso('2026-06-05'),
  },
]

// ─── 3. Missing company + deal ───────────────────────────────────────────────

/**
 * RM Expansion — subscribed 03/07/2026 from Qonto, present in the bank and in
 * the Drive note, absent from Albo OS. The subscription bulletin is in the
 * Drive. Idempotent: skipped when a company already carries this name.
 */
const RM_EXPANSION = {
  companyName: 'RM Expansion',
  paidAmount: 27_995_82,
  signedDate: iso('2026-07-03'),
} as const

// ─── 4. Duplicate company cards ──────────────────────────────────────────────

type CompanyMerge = {
  /** Card created by the import, emptied then archived. */
  fromId: string
  expectedFrom: string
  /** Card to keep. */
  toId: string
  expectedTo: string
  why: string
}

const COMPANY_MERGES: Array<CompanyMerge> = [
  {
    fromId: 'jx7csv9vhzp57p969aypf9kyvs87srhe',
    expectedFrom: 'CALTIMO',
    toId: 'jx77kvg3gycghzafbrazbe008587ftsk',
    expectedTo: 'Caltimo',
    why: 'group entity of the org, duplicated as a portfolio card by the import',
  },
  {
    fromId: 'jx7eqe5g16qvnvhbqp0k4jf8q587sta9',
    expectedFrom: 'RDB',
    toId: 'jx770dksqzb9y7rc8jaag6qdws87f5z1',
    expectedTo: 'RDB',
    why: 'group entity of the org, duplicated as a portfolio card by the import',
  },
  {
    fromId: 'jx73k3xwa1f614jaddg7k630q587r53r',
    expectedFrom: 'RDB',
    toId: 'jx770dksqzb9y7rc8jaag6qdws87f5z1',
    expectedTo: 'RDB',
    why: 'second portfolio duplicate of the same group entity',
  },
  {
    fromId: 'jx7978c94sfxzm1kgt76wjfrqn87rn8h',
    expectedFrom: 'SCI CHAPELLE',
    toId: 'jx7fbcpn7g58vpkfr4bsc4pacn87fws3',
    expectedTo: 'SCI Chapelle',
    why: 'group entity of the org, duplicated as a portfolio card by the import',
  },
  {
    fromId: 'jx7c4zdph7td0n2s3vjd21k7m987s0nz',
    expectedFrom: 'SCI CHAPELLE 2',
    toId: 'jx75sxwtxqskf1qmbk0qq11res87fx01',
    expectedTo: 'SCI Chapelle 2',
    why: 'group entity of the org, duplicated as a portfolio card by the import',
  },
  {
    fromId: 'jx72qvytrs5egcqstx42dcp0m587r859',
    expectedFrom: 'SCI UPLOAD',
    toId: 'jx77vqa8a3jpa2tts6wfs8nr2n87eeej',
    expectedTo: 'SCI Upload',
    why: 'group entity of the org, duplicated as a portfolio card by the import',
  },
  {
    fromId: 'jx7bce9j3trcf03jpe9asqtre587swjw',
    expectedFrom: 'SAS RELAIS CHAPELLE',
    toId: 'jx756ntfs3d02mghk5h0ananwd87ee7g',
    expectedTo: 'Relais Chapelle',
    why: 'group entity of the org, under a different spelling',
  },
  {
    fromId: 'jx7ah4wkse7bnqh0yq13mtd0n587rcxa',
    expectedFrom: 'Banco 2',
    toId: 'jx75zaq5bvt6h21t0erkq70r4187fpbm',
    expectedTo: 'Banco 2',
    why: 'group entity of the org (ManCo Morning), duplicated by the import',
  },
  {
    fromId: 'jx7dxbp40qfy14pky4fkqybt8987rakm',
    expectedFrom: 'COEUR PIGALLE',
    toId: 'jx7bw98edracbjs9kcqw2dpnrs87rebe',
    expectedTo: 'COEUR PIGALLE',
    why: 'two portfolio cards for the same company',
  },
  {
    fromId: 'jx7cjv10jz9n1ez90vswy0z5rd87snx5',
    expectedFrom: 'ASTERION SIDE ONIMA (ex:YEASTY)',
    toId: 'jx7csjxyd8kne6mq1s03pb307587sveg',
    expectedTo: 'ASTERION SIDE ONIMA (ex:YEASTY)',
    why: 'two portfolio cards for the same company',
  },
  {
    fromId: 'jx728qebawmwfj08h49z37110s87rs66',
    expectedFrom: 'FLEX LIVING',
    toId: 'jx79rp6ptbzz6yvn2nscv16h3587sw9n',
    expectedTo: 'FLEXLIVING',
    why: 'two spellings of the same company',
  },
]

/**
 * Empty shells: no deal, no domain, no note, no person. Verified one by one —
 * the four real Batch funds (Fund 1, Fund n°2 2025, CTO Fund, YC 2026) each
 * keep their own card and their own deal.
 */
const EMPTY_COMPANIES: Array<{ id: string; expectedName: string }> = [
  {
    id: 'jx7131pf4dfsrs4577xr7fe1nx87r0h1',
    expectedName: 'Batch Ventures - 2026 fund',
  },
  { id: 'jx73rcrg1y8cqwed853s8v7rk587rwcr', expectedName: 'batchVent' },
]

// ─── 5. Duplicate deal pairs ─────────────────────────────────────────────────

type DealMerge = {
  fromId: string
  toId: string
  /** Exact current target name of the deal being absorbed. */
  expectedTarget: string
  /** Exact current target name of the surviving deal — they can differ when
   * the duplicate lives on a second spelling of the same company. */
  expectedTargetTo: string
  why: string
}

const DEAL_MERGES: Array<DealMerge> = [
  {
    fromId: 'k578rmjbyz06jmg212fq5d23dd87sjry',
    toId: 'k579z2tdrmk02asp8qrb8z1g1x87r6r8',
    expectedTarget: 'SEZAME IMMO 1',
    expectedTargetTo: 'SEZAME IMMO 1',
    why: 'empty bond line carrying only the 61 254 € repayment of the share deal',
  },
  {
    fromId: 'k574b27n34astmgxq4mbrazdgx87sttv',
    toId: 'k579xrf4c1be41gmymx8qtkc1s87ssgd',
    expectedTarget: 'FLEX LIVING',
    expectedTargetTo: 'FLEXLIVING',
    why: 'current-account repayments landed on the duplicate spelling of the company',
  },
  {
    fromId: 'k570g8kwr8jp0geh0dhcpvjx9h87syfh',
    toId: 'k5767zbwge5wdhzp7mx4t1nybn87r1b9',
    expectedTarget: 'BUREAUX A PARTAGE - REMB C/C',
    expectedTargetTo: 'BUREAUX A PARTAGER (Ubiq / Morning)',
    why: 'second, empty current-account line for Bureaux à Partager',
  },
]

// ─── 6. Lines that are not investments ───────────────────────────────────────

/**
 * Their movements go back to the pointage queue (`dealId` cleared,
 * `matchStatus: 'unmatched'`) so they can be qualified for what they are —
 * a loan repayment, a cash-account withdrawal, a share sale. The deal is
 * archived, and its company too when nothing else points at it.
 */
const DEAL_REMOVALS: Array<{
  dealId: string
  expectedTarget: string
  why: string
}> = [
  {
    dealId: 'k575mzdkh2hm2gzwydttj8jdbn87shag',
    expectedTarget: 'Wormser Prêt pour Iroko',
    why: '40 monthly outgoing instalments and no inflow: a loan CALTE repays, secured on the Iroko units',
  },
  {
    dealId: 'k5781dbeamkpckdhft06jqjamn87stj0',
    expectedTarget: 'Anaxago retrait cagnotte',
    why: 'two « ANAXAGO Compte espèce » inflows and no outflow: a cash-account withdrawal',
  },
  {
    dealId: 'k57dn18b25a6a6kf5bj8f45s5587rxr5',
    expectedTarget: 'POLACK CAMILLE - ACHAT 30 TITRES B',
    why: 'a single inflow: the sale of 30 B shares to a third party',
  },
]

// ─── 7. Deals aggregating several operations ─────────────────────────────────

type SplitPart = {
  /** Written to `deals.name` so each operation stays readable. */
  name: string
  /** Outgoing movements of this operation, matched by (date, amount). */
  movements: Array<{ date: number; amount: number }>
}

type Split = {
  dealId: Id<'deals'>
  parts: Array<SplitPart>
}

/**
 * One row per aggregated deal, parts in chronological order. The FIRST part
 * stays on the existing deal (keeping `airtableId`, the incoming movements and
 * the history); the others become new deals with the same investor, target and
 * instrument. Amounts and dates are read off the movements themselves, never
 * retyped. A part with no movement means the dossier is still under arbitration
 * (Bureaux à Partager) — such a deal is skipped whole.
 */
const SPLITS: Array<Split> = [
  {
    dealId: 'k57ev8yhtdbnn8v1jsv3ets65587s6d5' as Id<'deals'>, // RDB
    parts: [
      {
        name: 'RDB — acquisition',
        movements: [
          { date: 1765843200000, amount: 13155500 },
          { date: 1765843200000, amount: 60000 },
          { date: 1768435200000, amount: 100000 },
          { date: 1771286400000, amount: 1000000 },
          { date: 1771545600000, amount: 262500000 },
        ],
      },
      {
        name: 'C/C RDB',
        movements: [
          { date: 1784764800000, amount: 2500000 },
          { date: 1785801600000, amount: 2500000 },
          { date: 1785801600000, amount: 2500000 },
        ],
      },
    ],
  },
  {
    dealId: 'k57dxv8ft57jfwtxge6jm6kv5h87r7t3' as Id<'deals'>, // BUREAUX A PARTAGER (Ubiq / Morning)
    parts: [
      { name: 'BAP — titres', movements: [] }, // à trancher avec Clément
      {
        name: 'BAP — BSPCE Marie Piquemil',
        movements: [
          { date: 1577145600000, amount: 1155000 },
          { date: 1577145600000, amount: 5502000 },
        ],
      },
    ],
  },
  {
    dealId: 'k57cfn8nsp30eyw5xwgrm7xbcn87s1x7' as Id<'deals'>, // COEUR PIGALLE
    parts: [
      {
        name: 'Prêt Cœur Pigalle',
        movements: [{ date: 1742860800000, amount: 100000000 }],
      },
      {
        name: 'Cœur Pigalle — 2e engagement',
        movements: [{ date: 1771200000000, amount: 8569100 }],
      },
    ],
  },
  {
    dealId: 'k579a16xvcyn95rdk8a060m21187rxhr' as Id<'deals'>, // Eben Home
    parts: [
      {
        name: 'Eben Home — seed',
        movements: [{ date: 1703548800000, amount: 20002300 }],
      },
      {
        name: 'Eben Home — via SPV Roundtable WPS VC NewCo 12',
        movements: [{ date: 1757462400000, amount: 12500000 }],
      },
      {
        name: 'Eben Home — augmentation de capital',
        movements: [{ date: 1760400000000, amount: 2497980 }],
      },
    ],
  },
  {
    dealId: 'k570y3ssbhjz8k9wvf68fgzp7s87rvfm' as Id<'deals'>, // VIASANA
    parts: [
      {
        name: 'Viasana — 2021',
        movements: [{ date: 1620000000000, amount: 22496402 }],
      },
      {
        name: 'Viasana — 2024',
        movements: [{ date: 1714694400000, amount: 3175184 }],
      },
    ],
  },
  {
    dealId: 'k5781s2aydwzr1c2sck4213pen87rwa2' as Id<'deals'>, // I ARTISAN (renovation man)
    parts: [
      {
        name: 'I Artisan — 2019',
        movements: [{ date: 1556496000000, amount: 9996000 }],
      },
      {
        name: 'I Artisan — 2020',
        movements: [{ date: 1591315200000, amount: 1499400 }],
      },
      {
        name: 'I Artisan — 2021',
        movements: [{ date: 1637539200000, amount: 4998000 }],
      },
      {
        name: 'I Artisan — 2023',
        movements: [{ date: 1676937600000, amount: 2499000 }],
      },
    ],
  },
  {
    dealId: 'k57csxf9cpedct58cmb3gknvh587s2cz' as Id<'deals'>, // OSOL
    parts: [
      {
        name: 'OSOL — 2021',
        movements: [{ date: 1634515200000, amount: 5001300 }],
      },
      {
        name: 'OSOL — juin 2025',
        movements: [{ date: 1750636800000, amount: 1199700 }],
      },
      {
        name: 'OSOL — décembre 2025',
        movements: [{ date: 1765238400000, amount: 9999945 }],
      },
    ],
  },
  {
    dealId: 'k5703efaajk10swa73wde3t6ks87rk1a' as Id<'deals'>, // SIDE EVERPING
    parts: [
      {
        name: 'Side Everping — 2021',
        movements: [{ date: 1627603200000, amount: 5000000 }],
      },
      {
        name: 'Side Everping — 2024',
        movements: [{ date: 1718755200000, amount: 10009200 }],
      },
    ],
  },
  {
    dealId: 'k5771n54g6ggr8answsqn238z987s9a3' as Id<'deals'>, // VELVET
    parts: [
      {
        name: 'Velvet — 2024',
        movements: [{ date: 1713916800000, amount: 9999000 }],
      },
      {
        name: 'Velvet — seed 2026',
        movements: [{ date: 1774569600000, amount: 4998990 }],
      },
    ],
  },
  {
    dealId: 'k5776d9gav2kq7bbb90m3m9mvh87s9mn' as Id<'deals'>, // SIDE - INTERSTIS
    parts: [
      {
        name: 'Side Interstis — 2020',
        movements: [{ date: 1588464000000, amount: 2500000 }],
      },
      {
        name: 'Side Interstis — 2023',
        movements: [{ date: 1676246400000, amount: 5100900 }],
      },
      {
        name: 'Side Interstis — 2024',
        movements: [{ date: 1722556800000, amount: 5000900 }],
      },
    ],
  },
  {
    dealId: 'k57b4d37afg2vqhp6670b0y06x87scpe' as Id<'deals'>, // REVOLTE
    parts: [
      {
        name: 'Revolte — 2022',
        movements: [{ date: 1661385600000, amount: 2505000 }],
      },
      {
        name: 'Revolte — 2024',
        movements: [{ date: 1713744000000, amount: 7999200 }],
      },
    ],
  },
  {
    dealId: 'k57ahgnw8ns247r0zbh48xpvt187r4kq' as Id<'deals'>, // LAYAN
    parts: [
      {
        name: 'Layan — 2024',
        movements: [{ date: 1705017600000, amount: 5004720 }],
      },
      {
        name: 'Layan — 2025',
        movements: [{ date: 1740441600000, amount: 5005152 }],
      },
    ],
  },
  {
    dealId: 'k57be9k8mb8dvbsb5gfvaacdyd87sjm9' as Id<'deals'>, // CLIMATE CLUB
    parts: [
      {
        name: 'Climate Club — 2023',
        movements: [{ date: 1690761600000, amount: 5000000 }],
      },
      {
        name: 'Climate Club — 2024',
        movements: [{ date: 1720742400000, amount: 5000000 }],
      },
    ],
  },
  {
    dealId: 'k573vbvjmmat1vh18s6671p0t187s1df' as Id<'deals'>, // SIDE WENABI
    parts: [
      {
        name: 'Side Wenabi — 2019',
        movements: [{ date: 1558310400000, amount: 2000000 }],
      },
      {
        name: 'Side Wenabi — bridge 2021',
        movements: [{ date: 1633910400000, amount: 2392000 }],
      },
      {
        name: 'Side Wenabi — 2025',
        movements: [{ date: 1766361600000, amount: 5003100 }],
      },
    ],
  },
  {
    dealId: 'k5751zvvs8n9ajkekwygsqw8nx87sf4d' as Id<'deals'>, // SIDE EMPRUNTE MON TOUTOU
    parts: [
      {
        name: 'Emprunte mon Toutou — 2019',
        movements: [{ date: 1556409600000, amount: 2500000 }],
      },
      {
        name: 'Emprunte mon Toutou — 2021',
        movements: [{ date: 1625616000000, amount: 2992500 }],
      },
      {
        name: 'Emprunte mon Toutou — 2024',
        movements: [{ date: 1734652800000, amount: 1800036 }],
      },
    ],
  },
  {
    dealId: 'k57ch0pzc6qamrhy22kbsgew7n87s08z' as Id<'deals'>, // SIDE FEELI
    parts: [
      {
        name: 'Side Feeli — 2022',
        movements: [{ date: 1645660800000, amount: 3000000 }],
      },
      {
        name: 'Side Feeli — 2023',
        movements: [{ date: 1703635200000, amount: 4118000 }],
      },
    ],
  },
  {
    dealId: 'k577zazka2tw5ag03qgehjq7xx87shn4' as Id<'deals'>, // SIDE - ADEQUA (POTIONS) - AB tasty
    parts: [
      {
        name: 'Side Adequa — 2021',
        movements: [{ date: 1610409600000, amount: 3200000 }],
      },
      {
        name: 'Side Adequa — 2022',
        movements: [{ date: 1667001600000, amount: 3610000 }],
      },
    ],
  },
  {
    dealId: 'k574naqqwr9dm4pr2x9h4w299n87sq7r' as Id<'deals'>, // SIDE DOINSPORT
    parts: [
      {
        name: 'Side Doinsport — 2020',
        movements: [{ date: 1590710400000, amount: 2500000 }],
      },
      {
        name: 'Side Doinsport — bridge 2021',
        movements: [{ date: 1639353600000, amount: 4100000 }],
      },
    ],
  },
  {
    dealId: 'k575mgm9wnbqasb5szvbzps3jd87rt3v' as Id<'deals'>, // CEINTURE VERT GROUP
    parts: [
      {
        name: 'Ceinture Verte — 2022',
        movements: [{ date: 1645920000000, amount: 5000880 }],
      },
      {
        name: 'Ceinture Verte — 2024',
        movements: [{ date: 1721347200000, amount: 843370 }],
      },
    ],
  },
  {
    dealId: 'k571xqhzm40wj3ya9nfq11456h87s2yh' as Id<'deals'>, // SPACELY STOCKAGE (STOCKOSS)
    parts: [
      {
        name: 'Spacely — BSA 2021',
        movements: [{ date: 1634515200000, amount: 2000000 }],
      },
      {
        name: 'Spacely — BSA 2022',
        movements: [{ date: 1660435200000, amount: 2000000 }],
      },
      {
        name: 'Spacely — BSA 2023',
        movements: [{ date: 1696982400000, amount: 1453962 }],
      },
    ],
  },
  {
    dealId: 'k578dgfmw6s2k5wsdqsa76dtjn87sh2y' as Id<'deals'>, // SIDE MSA
    parts: [
      {
        name: 'Side MSA — 2020',
        movements: [{ date: 1580688000000, amount: 2505000 }],
      },
      {
        name: 'Side MSA — LBO 2025',
        movements: [{ date: 1753142400000, amount: 2500000 }],
      },
    ],
  },
  {
    dealId: 'k57bp3g0bc6y2kwn37en3h7ypn87rsvb' as Id<'deals'>, // LE TRICYCLE (KIDIBAM)
    parts: [
      {
        name: 'Le Tricycle — 2023',
        movements: [{ date: 1680048000000, amount: 2500000 }],
      },
      {
        name: 'Le Tricycle — 2024',
        movements: [{ date: 1718150400000, amount: 2496000 }],
      },
    ],
  },
  {
    dealId: 'k571adeb637wg7c6k08q8dadwn87sdg0' as Id<'deals'>, // Side Live Tonight
    parts: [
      {
        name: 'Side Live Tonight — 2019',
        movements: [{ date: 1569196800000, amount: 2250000 }],
      },
      {
        name: 'Side Live Tonight — 2024',
        movements: [{ date: 1705449600000, amount: 2516000 }],
      },
    ],
  },
  {
    dealId: 'k576b0pj89k5jaqxx1tr7dfdz187r3my' as Id<'deals'>, // SIDE ASTERION WEEFIN
    parts: [
      {
        name: 'Side Asterion Weefin — 2022',
        movements: [{ date: 1651363200000, amount: 2000000 }],
      },
      {
        name: 'Side Asterion Weefin — 2023',
        movements: [{ date: 1699920000000, amount: 1907100 }],
      },
    ],
  },
  {
    // ⚠ the target name carries a trailing space in prod ("… PHARMACIES ").
    // Harmless here — a split is anchored on the deal `_id` and its org, never
    // on the name — but do not "fix" the name without re-reading this list.
    dealId: 'k5789yeg80cygsaxxbatq5mj7d87sm7a' as Id<'deals'>, // SIDE - COMPTOIR DES PHARMACIES
    parts: [
      {
        name: 'Comptoir des Pharmacies — 2019',
        movements: [{ date: 1563148800000, amount: 1500000 }],
      },
      {
        name: 'Comptoir des Pharmacies — 2023',
        movements: [{ date: 1676246400000, amount: 2007500 }],
      },
    ],
  },
  {
    dealId: 'k5765tgbjzrxed4rj83w12s93987rq7t' as Id<'deals'>, // CLIMATE HOUSE
    parts: [
      {
        name: 'Climate House — 2024',
        movements: [{ date: 1721174400000, amount: 2000000 }],
      },
      {
        name: 'Climate House — cofondateurs 2025',
        movements: [{ date: 1763337600000, amount: 1000000 }],
      },
    ],
  },
  {
    dealId: 'k572846mb89y620t2jfwntcjrx87sv14' as Id<'deals'>, // SIDE ASTERION EVERDYE
    parts: [
      {
        name: 'Side Asterion Ever Dye — 2022',
        movements: [{ date: 1646611200000, amount: 1000000 }],
      },
      {
        name: 'Side Asterion Ever Dye — 2024',
        movements: [{ date: 1708560000000, amount: 252300 }],
      },
    ],
  },
]

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function getOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .first()
  if (!org) throw new ConvexError('calte_org_absent')
  return org
}

/** Records the written keys, so a re-run of the Airtable import can't clobber. */
function withManualFlags(deal: Doc<'deals'>, keys: Array<string>) {
  const edited = new Set(deal.manuallyEditedFields ?? [])
  for (const key of keys) edited.add(key)
  return [...edited]
}

/**
 * The org-wide tables that carry no per-company / per-deal index. They are read
 * ONCE per run and filtered in memory: `companyRefs` runs 16 times and
 * `dealRefs` 33 times in a single `apply`, and re-collecting these inside every
 * call would multiply the read volume by that much — straight into Convex's
 * per-transaction read ceiling, which would abort the whole one-shot.
 *
 * `apply` mutates some of these rows, so every write below also updates the
 * in-memory document: the scope must not go stale between two blocks.
 */
async function loadScope(ctx: Ctx, orgId: Id<'organizations'>) {
  const [allDeals, kpis, todos, transfers, rules, decisions, inbox] =
    await Promise.all([
      ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
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
      ctx.db
        .query('forecastRules')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
      ctx.db
        .query('matchingDecisions')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
      // Bounded on purpose: only the queue still shown to a human can name an
      // archived card, and the full table carries every rawContent/cleanedHtml
      // (cf. CLAUDE.md, « un gros champ texte sur une ligne lue en liste »).
      ctx.db
        .query('inboundEmails')
        .withIndex('by_status', (q) => q.eq('status', 'needs_review'))
        .collect(),
    ])
  return { allDeals, kpis, todos, transfers, rules, decisions, inbox }
}

type Scope = Awaited<ReturnType<typeof loadScope>>

/** Every row pointing at a company, per table — used to guard archiving. */
async function companyRefs(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  id: Id<'companies'>,
  scope: Scope,
) {
  const [
    asTarget,
    asInvestor,
    relParent,
    relChild,
    docs,
    reports,
    intel,
    links,
    banks,
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
  ])
  return {
    asTarget,
    asInvestor,
    asViaSpv: scope.allDeals.filter((d) => d.viaSpvCompanyId === id),
    relParent,
    relChild,
    docs,
    reports,
    intel,
    links,
    banks,
    kpis: scope.kpis.filter((k) => k.companyId === id),
    todos: scope.todos.filter((t) => t.companyId === id),
    transfers: scope.transfers.filter((t) => t.ownerCompanyId === id),
    inbox: scope.inbox.filter((e) =>
      (e.matchedCompanies ?? []).some((m) => m.companyId === id),
    ),
  }
}

/** Every row pointing at a deal, per table. */
async function dealRefs(
  ctx: Ctx,
  _orgId: Id<'organizations'>,
  id: Id<'deals'>,
  scope: Scope,
) {
  const [txs, valuations, projections, docs, forecasts, entries] =
    await Promise.all([
      ctx.db
        .query('transactions')
        .withIndex('by_deal', (q) => q.eq('dealId', id))
        .collect(),
      ctx.db
        .query('valuations')
        .withIndex('by_deal_asof', (q) => q.eq('dealId', id))
        .collect(),
      ctx.db
        .query('dealProjections')
        .withIndex('by_deal_version', (q) => q.eq('dealId', id))
        .collect(),
      ctx.db
        .query('documents')
        .withIndex('by_deal', (q) => q.eq('dealId', id))
        .collect(),
      ctx.db
        .query('forecasts')
        .withIndex('by_deal', (q) => q.eq('dealId', id))
        .collect(),
      ctx.db
        .query('forecastEntries')
        .withIndex('by_deal', (q) => q.eq('dealId', id))
        .collect(),
    ])
  return {
    txs,
    valuations,
    projections,
    docs,
    forecasts,
    entries,
    rules: scope.rules.filter((r) => r.dealId === id),
    decisions: scope.decisions.filter((d) => d.dealId === id),
  }
}

/**
 * Everything attached to a deal EXCEPT its transactions. A merge re-points all
 * of it; a removal has no destination for it, so it must find zero here before
 * deleting anything.
 */
function otherDealRefCounts(refs: Awaited<ReturnType<typeof dealRefs>>) {
  const counts = {
    valuations: refs.valuations.length,
    projections: refs.projections.length,
    documents: refs.docs.length,
    forecasts: refs.forecasts.length,
    forecastEntries: refs.entries.length,
    forecastRules: refs.rules.length,
    matchingDecisions: refs.decisions.length,
  }
  return {
    ...counts,
    total: Object.values(counts).reduce((s, n) => s + n, 0),
  }
}

const describeCounts = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([key, n]) => key !== 'total' && n > 0)
    .map(([key, n]) => `${n} ${key}`)
    .join(', ')

/**
 * Assigns each part's declared movements to an actual outgoing transaction of
 * the deal, matched on (date, amount) and consumed once — two identical
 * movements on the same day are handled. Returns a reason instead when a
 * declared movement matches nothing, OR when an outgoing transaction of the
 * deal is left unclaimed: in both cases the picture in the code and the picture
 * in the database disagree, and a partial split would silently under-count the
 * amount left on the first part.
 */
function assignMovements(
  parts: Array<SplitPart>,
  txs: Array<Doc<'transactions'>>,
): { assignment: Array<Array<Doc<'transactions'>>> } | { skip: string } {
  const pool = txs.filter((t) => t.direction === 'out')
  const used = new Set<Id<'transactions'>>()
  const assignment: Array<Array<Doc<'transactions'>>> = []
  for (const part of parts) {
    if (part.movements.length === 0) return { skip: 'part_without_movement' }
    const picked: Array<Doc<'transactions'>> = []
    for (const m of part.movements) {
      const hit = pool.find(
        (t) =>
          !used.has(t._id) &&
          t.transactionDate === m.date &&
          t.amount === m.amount,
      )
      if (!hit) {
        return {
          skip: `movement_not_found (${new Date(m.date).toISOString().slice(0, 10)}, ${m.amount} cents)`,
        }
      }
      used.add(hit._id)
      picked.push(hit)
    }
    assignment.push(picked)
  }
  if (used.size !== pool.length) {
    return {
      skip: `unclaimed_movements (${pool.length - used.size} outgoing transaction(s) belong to no part)`,
    }
  }
  return { assignment }
}

const sum = (txs: Array<Doc<'transactions'>>) =>
  txs.reduce((s, t) => s + t.amount, 0)
const earliest = (txs: Array<Doc<'transactions'>>) =>
  txs.reduce(
    (min, t) => Math.min(min, t.transactionDate),
    Number.POSITIVE_INFINITY,
  )

/** Resolves one split against the live rows, without writing. */
async function resolveSplit(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: Split,
  scope: Scope,
) {
  const deal = await ctx.db.get('deals', spec.dealId)
  if (!deal) return { skip: 'deal_not_found', spec }
  if (deal.orgId !== orgId) return { skip: 'wrong_org', spec }
  const target = await ctx.db.get('companies', deal.targetCompanyId)

  // Re-run guard: once split, the later parts exist as their own deals.
  const siblings = await ctx.db
    .query('deals')
    .withIndex('by_org_target', (q) =>
      q.eq('orgId', orgId).eq('targetCompanyId', deal.targetCompanyId),
    )
    .collect()
  const alreadyDone = spec.parts
    .slice(1)
    .every((p) => siblings.some((s) => s.name === p.name))
  if (alreadyDone) return { skip: 'already_split', spec }

  const refs = await dealRefs(ctx, orgId, deal._id, scope)
  const assigned = assignMovements(spec.parts, refs.txs)
  if ('skip' in assigned) return { skip: assigned.skip, spec }

  return {
    deal,
    targetName: target?.name ?? null,
    parts: spec.parts.map((p, i) => ({
      name: p.name,
      txs: assigned.assignment[i],
      paidAmount: sum(assigned.assignment[i]),
      signedDate: earliest(assigned.assignment[i]),
      keepsExisting: i === 0,
    })),
  }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const scope = await loadScope(ctx, orgId)

    const renameTarget = await ctx.db.get(
      'companies',
      RENAME.companyId as Id<'companies'>,
    )
    const rename = {
      found: Boolean(renameTarget),
      current: renameTarget?.name ?? null,
      willWrite:
        renameTarget?.name === RENAME.expectedName ? RENAME.newName : null,
      note:
        renameTarget?.name === RENAME.newName
          ? 'already renamed'
          : renameTarget?.name === RENAME.expectedName
            ? null
            : 'name mismatch — skipped',
    }

    const dates = await Promise.all(
      SIGNED_DATES.map(async (spec) => {
        const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
        const target = deal
          ? await ctx.db.get('companies', deal.targetCompanyId)
          : null
        return {
          expectedTarget: spec.expectedTarget,
          found: Boolean(deal),
          currentTarget: target?.name ?? null,
          currentSignedDate: deal?.signedDate ?? null,
          willWrite:
            deal &&
            target?.name === spec.expectedTarget &&
            deal.signedDate == null
              ? new Date(spec.signedDate).toISOString().slice(0, 10)
              : null,
        }
      }),
    )

    const existingRm = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const rmExists = existingRm.some((c) => c.name === RM_EXPANSION.companyName)

    const companyMerges = await Promise.all(
      COMPANY_MERGES.map(async (spec) => {
        const from = await ctx.db.get(
          'companies',
          spec.fromId as Id<'companies'>,
        )
        const to = await ctx.db.get('companies', spec.toId as Id<'companies'>)
        if (!from || !to) return { ...spec, skip: 'company_not_found' }
        if (from.archivedAt != null)
          return { ...spec, skip: 'already_archived' }
        if (from.name !== spec.expectedFrom || to.name !== spec.expectedTo) {
          return {
            ...spec,
            skip: `name_mismatch (from: ${from.name}, to: ${to.name})`,
          }
        }
        const refs = await companyRefs(ctx, orgId, from._id, scope)
        return {
          expectedFrom: spec.expectedFrom,
          expectedTo: spec.expectedTo,
          why: spec.why,
          moves: {
            dealsAsTarget: refs.asTarget.length,
            dealsAsInvestor: refs.asInvestor.length,
            dealsAsViaSpv: refs.asViaSpv.length,
            relations: refs.relParent.length + refs.relChild.length,
            documents: refs.docs.length,
            reports: refs.reports.length,
            intelligence: refs.intel.length,
            emailLinks: refs.links.length,
            bankAccounts: refs.banks.length,
            kpiSnapshots: refs.kpis.length,
            todos: refs.todos.length,
          },
        }
      }),
    )

    const shells = await Promise.all(
      EMPTY_COMPANIES.map(async (spec) => {
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
        const refs = await companyRefs(ctx, orgId, company._id, scope)
        const total = Object.values(refs).reduce((s, arr) => s + arr.length, 0)
        return { ...spec, incomingReferences: total, willArchive: total === 0 }
      }),
    )

    const dealMerges = await Promise.all(
      DEAL_MERGES.map(async (spec) => {
        const from = await ctx.db.get('deals', spec.fromId as Id<'deals'>)
        const to = await ctx.db.get('deals', spec.toId as Id<'deals'>)
        if (!to) return { ...spec, skip: 'target_deal_not_found' }
        if (!from) return { ...spec, skip: 'already_merged' }
        // `by_deal` has no org component: without this check a stale id would
        // re-point another org's transactions and then delete its deal.
        if (from.orgId !== orgId || to.orgId !== orgId) {
          return { ...spec, skip: 'wrong_org' }
        }
        const [fromTarget, toTarget] = await Promise.all([
          ctx.db.get('companies', from.targetCompanyId),
          ctx.db.get('companies', to.targetCompanyId),
        ])
        if (
          fromTarget?.name !== spec.expectedTarget ||
          toTarget?.name !== spec.expectedTargetTo
        ) {
          return {
            ...spec,
            skip: `target_mismatch (from: ${fromTarget?.name ?? 'none'}, to: ${toTarget?.name ?? 'none'})`,
          }
        }
        const refs = await dealRefs(ctx, orgId, from._id, scope)
        return {
          expectedTarget: spec.expectedTarget,
          why: spec.why,
          moves: {
            transactions: refs.txs.length,
            valuations: refs.valuations.length,
            projections: refs.projections.length,
            documents: refs.docs.length,
            forecasts:
              refs.forecasts.length + refs.entries.length + refs.rules.length,
            matchingDecisions: refs.decisions.length,
          },
        }
      }),
    )

    const removals = await Promise.all(
      DEAL_REMOVALS.map(async (spec) => {
        const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
        if (!deal) return { ...spec, skip: 'already_removed' }
        if (deal.orgId !== orgId) return { ...spec, skip: 'wrong_org' }
        const target = await ctx.db.get('companies', deal.targetCompanyId)
        if (target?.name !== spec.expectedTarget) {
          return {
            ...spec,
            skip: `target_mismatch (${target?.name ?? 'none'})`,
          }
        }
        const refs = await dealRefs(ctx, orgId, deal._id, scope)
        const attached = otherDealRefCounts(refs)
        return {
          expectedTarget: spec.expectedTarget,
          why: spec.why,
          movementsReturnedToQueue: refs.txs.length,
          paidAmount: deal.paidAmount ?? 0,
          // Non-zero here means apply will refuse the removal: there is
          // nowhere to re-point these rows, and deleting would orphan them.
          otherRowsAttached: attached,
          blocked: attached.total > 0,
        }
      }),
    )

    const splits = await Promise.all(
      SPLITS.map(async (spec) => {
        const resolved = await resolveSplit(ctx, orgId, spec, scope)
        if ('skip' in resolved) {
          return {
            target: null,
            skip: resolved.skip,
            name: spec.parts[0]?.name ?? null,
          }
        }
        return {
          target: resolved.targetName,
          instrument: resolved.deal.instrumentKind,
          currentPaidAmount: resolved.deal.paidAmount ?? 0,
          parts: resolved.parts.map((p) => ({
            name: p.name,
            paidAmount: p.paidAmount,
            signedDate: new Date(p.signedDate).toISOString().slice(0, 10),
            movements: p.txs.length,
            action: p.keepsExisting ? 'keeps the existing deal' : 'new deal',
          })),
        }
      }),
    )

    const skipped = [
      ...companyMerges.filter((m) => 'skip' in m),
      ...dealMerges.filter((m) => 'skip' in m),
      ...removals.filter((m) => 'skip' in m),
      ...splits.filter((s) => 'skip' in s && s.skip !== 'already_split'),
    ]

    return {
      org: { slug: org.slug, id: orgId },
      rename,
      signedDates: dates,
      rmExpansion: { willCreate: !rmExists, alreadyPresent: rmExists },
      companyMerges,
      emptyCompanies: shells,
      dealMerges,
      removals,
      splits,
      totals: {
        companiesArchived:
          companyMerges.filter((m) => !('skip' in m)).length +
          shells.filter((s) => !('skip' in s) && s.willArchive).length,
        dealsDeleted:
          dealMerges.filter((m) => !('skip' in m)).length +
          removals.filter((r) => !('skip' in r)).length,
        dealsCreated:
          (rmExists ? 0 : 1) +
          splits
            .filter(
              (s): s is Extract<typeof s, { parts: unknown }> => 'parts' in s,
            )
            .reduce((n, s) => n + s.parts.length - 1, 0),
        blocking: skipped.length,
      },
    }
  },
})

// ─── apply — writes, guarded row by row ──────────────────────────────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx: MutCtx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const scope = await loadScope(ctx, orgId)
    const done: Record<string, Array<string>> = {
      renamed: [],
      datesSet: [],
      created: [],
      companiesMerged: [],
      companiesArchived: [],
      dealsMerged: [],
      dealsRemoved: [],
      dealsSplit: [],
      skipped: [],
    }

    // 1. Rename.
    const renameTarget = await ctx.db.get(
      'companies',
      RENAME.companyId as Id<'companies'>,
    )
    if (renameTarget && renameTarget.name === RENAME.expectedName) {
      await ctx.db.patch('companies', renameTarget._id, {
        name: RENAME.newName,
      })
      done.renamed.push(`${RENAME.expectedName} → ${RENAME.newName}`)
    } else if (renameTarget?.name !== RENAME.newName) {
      done.skipped.push(`rename: ${renameTarget?.name ?? 'not found'}`)
    }

    // 2. Missing signature dates — fill-only.
    for (const spec of SIGNED_DATES) {
      const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
      if (!deal || deal.orgId !== orgId) {
        done.skipped.push(`signedDate: ${spec.expectedTarget} not found`)
        continue
      }
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      if (target?.name !== spec.expectedTarget) {
        done.skipped.push(`signedDate: ${spec.expectedTarget} target mismatch`)
        continue
      }
      if (deal.signedDate != null) continue
      await ctx.db.patch('deals', deal._id, {
        signedDate: spec.signedDate,
        manuallyEditedFields: withManualFlags(deal, ['signedDate']),
      })
      done.datesSet.push(spec.expectedTarget)
    }

    // 3. RM Expansion — company + share deal.
    const companies = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    if (!companies.some((c) => c.name === RM_EXPANSION.companyName)) {
      const root = companies.find((c) => c.kind === 'group_root')
      if (!root) throw new ConvexError('group_root_absent')
      const companyId = await ctx.db.insert('companies', {
        orgId,
        name: RM_EXPANSION.companyName,
        kind: 'portfolio',
        countryCode: 'FR',
      })
      await ctx.db.insert('deals', {
        orgId,
        investorCompanyId: root._id,
        targetCompanyId: companyId,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'active',
        paidAmount: RM_EXPANSION.paidAmount,
        signedDate: RM_EXPANSION.signedDate,
      })
      done.created.push(RM_EXPANSION.companyName)
    }

    // 4. Duplicate company cards.
    for (const spec of COMPANY_MERGES) {
      const from = await ctx.db.get('companies', spec.fromId as Id<'companies'>)
      const to = await ctx.db.get('companies', spec.toId as Id<'companies'>)
      if (!from || !to) {
        done.skipped.push(
          `merge company: ${spec.expectedFrom} anchor not found`,
        )
        continue
      }
      if (from.archivedAt != null) continue // already merged
      if (from.orgId !== orgId || to.orgId !== orgId) {
        done.skipped.push(`merge company: ${spec.expectedFrom} wrong org`)
        continue
      }
      if (from.name !== spec.expectedFrom || to.name !== spec.expectedTo) {
        done.skipped.push(`merge company: ${spec.expectedFrom} name mismatch`)
        continue
      }
      const refs = await companyRefs(ctx, orgId, from._id, scope)
      for (const d of refs.asTarget) {
        await ctx.db.patch('deals', d._id, { targetCompanyId: to._id })
      }
      for (const d of refs.asInvestor) {
        await ctx.db.patch('deals', d._id, { investorCompanyId: to._id })
      }
      for (const d of refs.asViaSpv) {
        await ctx.db.patch('deals', d._id, { viaSpvCompanyId: to._id })
        d.viaSpvCompanyId = to._id // keep the scope truthful for later blocks
      }
      for (const r of refs.relParent) {
        await ctx.db.patch('companyRelations', r._id, {
          parentCompanyId: to._id,
        })
      }
      for (const r of refs.relChild) {
        await ctx.db.patch('companyRelations', r._id, {
          childCompanyId: to._id,
        })
      }
      for (const doc of refs.docs) {
        await ctx.db.patch('documents', doc._id, { companyId: to._id })
      }
      for (const r of refs.reports) {
        await ctx.db.patch('companyReports', r._id, { companyId: to._id })
      }
      for (const l of refs.links) {
        await ctx.db.patch('companyEmailLinks', l._id, { companyId: to._id })
      }
      for (const b of refs.banks) {
        await ctx.db.patch('bankAccounts', b._id, { ownerCompanyId: to._id })
      }
      for (const k of refs.kpis) {
        await ctx.db.patch('kpiSnapshots', k._id, { companyId: to._id })
        k.companyId = to._id
      }
      for (const t of refs.todos) {
        await ctx.db.patch('todos', t._id, { companyId: to._id })
        t.companyId = to._id
      }
      for (const t of refs.transfers) {
        await ctx.db.patch('transfers', t._id, { ownerCompanyId: to._id })
        t.ownerCompanyId = to._id
      }
      // The review queue names its matched companies inside an array: rewrite
      // the entry in place, or the row keeps pointing at the archived card
      // while its reports have moved to the survivor.
      for (const email of refs.inbox) {
        const rewritten = (email.matchedCompanies ?? []).map((m) =>
          m.companyId === from._id ? { ...m, companyId: to._id } : m,
        )
        await ctx.db.patch('inboundEmails', email._id, {
          matchedCompanies: rewritten,
        })
        email.matchedCompanies = rewritten
      }
      // One intelligence row per company — the reader takes `.first()` by
      // company, so a second row would be shadowed forever. The survivor keeps
      // its own synthesis and the loser's row is dropped rather than left
      // orphaned on an archived card; it is derived data, regenerated on demand.
      let keptIntel =
        (await ctx.db
          .query('companyIntelligence')
          .withIndex('by_company', (q) => q.eq('companyId', to._id))
          .first()) != null
      for (const row of refs.intel) {
        if (keptIntel) {
          await ctx.db.delete('companyIntelligence', row._id)
          continue
        }
        await ctx.db.patch('companyIntelligence', row._id, {
          companyId: to._id,
        })
        // The merged card may carry more than one row; only the first moves,
        // or the survivor would end up with several and the reader (`.first()`)
        // would shadow all but one forever.
        keptIntel = true
      }
      await ctx.db.patch('companies', from._id, { archivedAt: Date.now() })
      done.companiesMerged.push(`${spec.expectedFrom} → ${spec.expectedTo}`)
    }

    // 4b. Empty shells — archived only with zero incoming reference.
    for (const spec of EMPTY_COMPANIES) {
      const company = await ctx.db.get('companies', spec.id as Id<'companies'>)
      if (!company) {
        done.skipped.push(`shell: ${spec.expectedName} anchor not found`)
        continue
      }
      if (company.archivedAt != null) continue // already archived
      if (company.orgId !== orgId) {
        done.skipped.push(`shell: ${spec.expectedName} wrong org`)
        continue
      }
      if (company.name !== spec.expectedName) {
        done.skipped.push(`shell: ${spec.expectedName} name mismatch`)
        continue
      }
      const refs = await companyRefs(ctx, orgId, company._id, scope)
      const total = Object.values(refs).reduce((s, arr) => s + arr.length, 0)
      if (total > 0) {
        done.skipped.push(`shell: ${spec.expectedName} still referenced`)
        continue
      }
      await ctx.db.patch('companies', company._id, { archivedAt: Date.now() })
      done.companiesArchived.push(spec.expectedName)
    }

    // 5. Duplicate deal pairs.
    for (const spec of DEAL_MERGES) {
      const from = await ctx.db.get('deals', spec.fromId as Id<'deals'>)
      const to = await ctx.db.get('deals', spec.toId as Id<'deals'>)
      if (!to) {
        done.skipped.push(
          `merge deal: ${spec.expectedTarget} survivor not found`,
        )
        continue
      }
      if (!from) continue // already merged
      // `by_deal` carries no org component, so without these two checks a
      // stale anchor would re-point another org's transactions and then hard
      // delete its deal. The names are not unique across orgs either.
      if (from.orgId !== orgId || to.orgId !== orgId) {
        done.skipped.push(`merge deal: ${spec.expectedTarget} wrong org`)
        continue
      }
      const [fromTarget, toTarget] = await Promise.all([
        ctx.db.get('companies', from.targetCompanyId),
        ctx.db.get('companies', to.targetCompanyId),
      ])
      if (
        fromTarget?.name !== spec.expectedTarget ||
        toTarget?.name !== spec.expectedTargetTo
      ) {
        done.skipped.push(`merge deal: ${spec.expectedTarget} target mismatch`)
        continue
      }
      const refs = await dealRefs(ctx, orgId, from._id, scope)
      for (const t of refs.txs) {
        await ctx.db.patch('transactions', t._id, {
          dealId: to._id,
          allocation:
            t.allocation?.kind === 'deal'
              ? { kind: 'deal' as const, targetId: to._id }
              : t.allocation,
        })
      }
      for (const v of refs.valuations) {
        await ctx.db.patch('valuations', v._id, { dealId: to._id })
      }
      for (const p of refs.projections) {
        await ctx.db.patch('dealProjections', p._id, { dealId: to._id })
      }
      for (const doc of refs.docs) {
        await ctx.db.patch('documents', doc._id, { dealId: to._id })
      }
      for (const f of refs.forecasts) {
        await ctx.db.patch('forecasts', f._id, { dealId: to._id })
      }
      for (const e of refs.entries) {
        await ctx.db.patch('forecastEntries', e._id, { dealId: to._id })
      }
      for (const r of refs.rules) {
        await ctx.db.patch('forecastRules', r._id, { dealId: to._id })
        r.dealId = to._id
      }
      for (const dec of refs.decisions) {
        await ctx.db.patch('matchingDecisions', dec._id, { dealId: to._id })
        dec.dealId = to._id
      }
      // Same invariant as deals.remove: hard delete only once no transaction
      // is left attached — everything above has just been re-pointed.
      await ctx.db.delete('deals', from._id)
      done.dealsMerged.push(spec.expectedTarget)
    }

    // 6. Lines that are not investments.
    for (const spec of DEAL_REMOVALS) {
      const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
      if (!deal) continue // already removed
      if (deal.orgId !== orgId) {
        done.skipped.push(`removal: ${spec.expectedTarget} wrong org`)
        continue
      }
      const target = await ctx.db.get('companies', deal.targetCompanyId)
      if (target?.name !== spec.expectedTarget) {
        done.skipped.push(`removal: ${spec.expectedTarget} target mismatch`)
        continue
      }
      const refs = await dealRefs(ctx, orgId, deal._id, scope)
      // Unlike a merge, a removal has nowhere to re-point to. Anything other
      // than transactions attached to the deal (a valuation, a projection, a
      // document, a forecast, a matching decision) would be orphaned by the
      // delete, so the row is left alone and reported instead of guessed.
      const attached = otherDealRefCounts(refs)
      if (attached.total > 0) {
        done.skipped.push(
          `removal: ${spec.expectedTarget} still carries ${describeCounts(attached)}`,
        )
        continue
      }
      for (const t of refs.txs) {
        // Same shape as `applyUnmatch` (convex/lib/pointage.ts): a row put
        // back in the queue carries no allocation at all — keeping a
        // liability one while forcing `unmatched` would leave a phantom leg
        // in the current-account balances — and no VAT/category, which only
        // exist on the charge/product statuses.
        await ctx.db.patch('transactions', t._id, {
          dealId: undefined,
          allocation: undefined,
          matchStatus: 'unmatched' as const,
          reconciled: false,
          reconciledAt: undefined,
          reconciledBy: undefined,
          vatRateBps: undefined,
          category: undefined,
        })
      }
      await ctx.db.delete('deals', deal._id)
      // Same rule as the shells above: the card goes only when NOTHING points
      // at it any more — a partial check would archive a card still carrying
      // relations, KPIs, e-mail links or todos (cf. companies.archive).
      const remaining = await companyRefs(
        ctx,
        orgId,
        deal.targetCompanyId,
        scope,
      )
      const stillUsed = Object.values(remaining).reduce(
        (s, arr) => s + arr.length,
        0,
      )
      if (stillUsed === 0) {
        await ctx.db.patch('companies', target._id, { archivedAt: Date.now() })
      }
      done.dealsRemoved.push(spec.expectedTarget)
    }

    // 7. Splits.
    for (const spec of SPLITS) {
      const resolved = await resolveSplit(ctx, orgId, spec, scope)
      if ('skip' in resolved) {
        if (resolved.skip !== 'already_split') {
          done.skipped.push(`split: ${spec.parts[0]?.name} — ${resolved.skip}`)
        }
        continue
      }
      const { deal, parts } = resolved
      const [first, ...rest] = parts
      await ctx.db.patch('deals', deal._id, {
        name: first.name,
        paidAmount: first.paidAmount,
        signedDate: first.signedDate,
        manuallyEditedFields: withManualFlags(deal, [
          'name',
          'paidAmount',
          'signedDate',
        ]),
      })
      for (const part of rest) {
        const newDealId = await ctx.db.insert('deals', {
          orgId,
          investorCompanyId: deal.investorCompanyId,
          targetCompanyId: deal.targetCompanyId,
          viaSpvCompanyId: deal.viaSpvCompanyId,
          instrumentKind: deal.instrumentKind,
          currency: deal.currency,
          status: deal.status,
          name: part.name,
          paidAmount: part.paidAmount,
          signedDate: part.signedDate,
          manuallyEditedFields: ['name', 'paidAmount', 'signedDate'],
        })
        for (const t of part.txs) {
          await ctx.db.patch('transactions', t._id, {
            dealId: newDealId,
            allocation:
              t.allocation?.kind === 'deal'
                ? { kind: 'deal' as const, targetId: newDealId }
                : t.allocation,
          })
        }
      }
      done.dealsSplit.push(`${resolved.targetName} → ${parts.length} deals`)
    }

    return done
  },
})

// ─── verify — read-only, after apply ─────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getOrg(ctx)
    const orgId = org._id
    const [companies, deals] = await Promise.all([
      ctx.db
        .query('companies')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
      ctx.db
        .query('deals')
        .withIndex('by_org', (q) => q.eq('orgId', orgId))
        .collect(),
    ])
    const live = deals
    const liveCompanies = companies.filter((c) => c.archivedAt == null)

    // No live deal may still point at an archived company.
    const archivedIds = new Set(
      companies.filter((c) => c.archivedAt != null).map((c) => c._id),
    )
    const danglingTargets = live.filter((d) =>
      archivedIds.has(d.targetCompanyId),
    )

    // Every split deal must carry a name, and the sum of its parts is checked
    // against the movements actually attached to it.
    const named = live.filter((d) => d.name != null)
    const mismatched: Array<{
      name: string
      paidAmount: number
      movements: number
    }> = []
    for (const d of named) {
      const txs = await ctx.db
        .query('transactions')
        .withIndex('by_deal', (q) => q.eq('dealId', d._id))
        .collect()
      const out = txs
        .filter((t) => t.direction === 'out')
        .reduce((s, t) => s + t.amount, 0)
      if ((d.paidAmount ?? 0) !== out) {
        mismatched.push({
          name: d.name ?? '',
          paidAmount: d.paidAmount ?? 0,
          movements: out,
        })
      }
    }

    return {
      counts: {
        companies: liveCompanies.length,
        companiesArchived: companies.length - liveCompanies.length,
        deals: live.length,
        namedDeals: named.length,
      },
      integrity: {
        // both must be empty
        liveDealsOnArchivedCompany: danglingTargets.map((d) => d.name ?? d._id),
        namedDealsWhoseAmountDiffersFromMovements: mismatched,
      },
    }
  },
})
