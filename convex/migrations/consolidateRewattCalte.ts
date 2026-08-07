/**
 * One-shot consolidation of the REWATT lines of the `calte` org onto a single
 * company, and requalification of the instrument behind each operation.
 *
 * Context — what the Drive documents actually say (folder « REWATT ») :
 *   - REWATT is ONE legal entity (SAS, SIREN 950 792 473, 139 rue d'Aboukir
 *     75002 Paris) that carries every operation on its own balance sheet. There
 *     is no SPV per operation, so the target model "1 legal entity = 1 company"
 *     was broken here: calte held 8 companies for what is a single counterparty.
 *   - 7 of the 8 operations are NOT bonds. They are drawdowns on a single
 *     `Convention d'avance en compte courant d'associés` signed 20/04/2023
 *     between Calte (lender, 10 % of the capital) and Rewatt, capped at
 *     1 000 000 €, drawn via numbered `Appel de fonds #N` letters and repaid via
 *     matching `Remboursement #N` letters. They are stored as `os` (plain bonds)
 *     — wrong instrument, requalified to `cca` here.
 *   - Only 92 bd de Port-Royal (May 2025) is a real bond issue: it has its own
 *     `Contrat d'émission` + `Bulletin de souscription` (7 %). It keeps `os`,
 *     and is closed here (repayment letter of 30/12/2025).
 *
 * What this migration does, in order:
 *   1. Fills the legal identity on the surviving `REWATT` company (siren,
 *      legalName, legalForm, countryCode, sector) — empty fields only.
 *   2. Re-points the 8 operation deals to that company and names each one after
 *      its address (`deals.name`), so the operation stays readable once the
 *      per-address companies are gone.
 *   3. Requalifies the 7 current-account operations `os` → `cca` and fills their
 *      rate + principal from the letters.
 *   4. Closes the Port-Royal deal (`fully_exited`, 30/12/2025, 41 866,67 €).
 *   5. Archives the 8 emptied companies + the `Rewatt - Port Royal 5éme` orphan
 *      (a duplicate of 92 bd de Port-Royal: no deal, no document, no report).
 *
 * The equity deal already on `REWATT` (2023 capital increase) is NOT touched.
 *
 * Conventions (cf. convex/schema.ts): amounts in CENTS, rates in BASIS POINTS,
 * dates in ms epoch UTC. Every written key is recorded in
 * `manuallyEditedFields` so a re-run of `airtableImport:runImport` cannot
 * clobber it (same convention as deals.update / vasco.applyInstrumentBridgePatch
 * — cf. KNOWN_ISSUES.md « Édition manuelle deals »).
 *
 * Idempotent & guarded: deals and companies are anchored by their prod `_id`,
 * each cross-checked against the exact current name before anything is written;
 * any mismatch skips the row and is reported. Fields that already carry a value
 * are left untouched and surfaced as `mismatches` when they differ from the
 * document. Archiving is a reversible soft delete (`archivedAt`) and only runs
 * once the company has zero incoming reference.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./calte-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/consolidateRewattCalte:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/consolidateRewattCalte:apply
 *   pnpm exec convex run --prod migrations/consolidateRewattCalte:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'calte'

/** Midnight UTC of an ISO date, as ms epoch — the schema's date convention. */
const iso = (date: string) => Date.parse(`${date}T00:00:00.000Z`)

/** The surviving company: the bare REWATT line, which already holds the equity. */
const CANONICAL = {
  companyId: 'jx7ep9hwbtszjac1bv7q2v88c987r9y0',
  expectedName: 'REWATT',
}

/**
 * Legal identity of REWATT SAS, read off the emission contracts, the current
 * account convention and every appel de fonds / remboursement letter. Written
 * only where the field is currently empty. `sector` mirrors the value the same
 * company already carries in the `albo` org.
 */
const IDENTITY = {
  siren: '950792473',
  legalName: 'REWATT',
  legalForm: 'SAS',
  countryCode: 'FR',
  sector: 'realestate',
} as const

type Operation = {
  /** Prod deal `_id`. */
  dealId: string
  /** Exact current target company name — safety cross-check. */
  expectedTarget: string
  /** Prod `_id` of that company, archived once the deal has moved. */
  sourceCompanyId: string
  /** Written to `deals.name`: the company no longer carries the address. */
  label: string
  /** Requalification, written whenever the current value differs. */
  instrumentKind?: 'cca'
  /** Written only where the deal currently has no value. */
  fields: Record<string, number>
  /** Exit recorded by a repayment letter. Written only where empty. */
  exit?: { exitedDate: number; exitProceeds: number }
  /** Set `status` too — only Port-Royal is still open. */
  closeStatus?: boolean
}

/**
 * One row per operation. Amounts and rates come from the repayment letters
 * (`Remboursement #N`), which restate the principal drawn and the rate applied;
 * `principalAmount` is the "Montant de l'emprunt" line, `exitProceeds` the
 * "Total remboursement" line. Both reconcile to the cent with the cash already
 * recorded against each deal.
 */
const OPERATIONS: Array<Operation> = [
  {
    // Appels de fonds #1 (10 750 €, 26/04/2023) + #2 (250 000 €) = 260 750 €.
    // Repaid in three letters, the last one 13/02/2024.
    dealId: 'k57fjfk90y0jff1ptftpye08nd87r5kc',
    expectedTarget: 'REWATT 129 rue de Clignancourt',
    sourceCompanyId: 'jx71zf931vgm393aab6zxdz9bh87r1ve',
    label: '129 rue de Clignancourt',
    instrumentKind: 'cca',
    fields: { interestRate: 300, principalAmount: 260_750_00 },
    exit: { exitedDate: iso('2024-02-13'), exitProceeds: 265_325_88 },
  },
  {
    // Appel de fonds #2 (280 000 €, mise à disposition 29/05/2023). The
    // repayment letter is missing from the Drive folder — the deal is already
    // `fully_exited` and its cash is recorded, so no exit is written here.
    dealId: 'k574y2k3mf6xky3rnjqjfps8hd87re5n',
    expectedTarget: 'REWATT 43 rue Esquirol',
    sourceCompanyId: 'jx78kd5645gemjc0wf65wqgpz587rgn6',
    label: '43 rue Esquirol',
    instrumentKind: 'cca',
    fields: { interestRate: 300, principalAmount: 280_000_00 },
  },
  {
    // Remboursement #4, 18/03/2024 — 290 000 € à 3 % sur 257 jours.
    dealId: 'k573b4evyvxw8p10f6618z758x87rgqw',
    expectedTarget: 'REWATT - 115 boulevard Ney',
    sourceCompanyId: 'jx79v27ev1rwtfa7ys739s0ek587rr99',
    label: '115 boulevard Ney',
    instrumentKind: 'cca',
    fields: { interestRate: 300, principalAmount: 290_000_00 },
    exit: { exitedDate: iso('2024-03-18'), exitProceeds: 296_210_83 },
  },
  {
    // Remboursement #9, 19/05/2025 — 440 000 € à 4 % sur 385 jours.
    dealId: 'k571nhztnbb7fcarddb6h0dvdx87rrna',
    expectedTarget: 'REWATT - 38 rue Bargue',
    sourceCompanyId: 'jx71cp2s7q4ax332nsea8sx3wh87sd9j',
    label: '38 rue Bargue',
    instrumentKind: 'cca',
    fields: { interestRate: 400, principalAmount: 440_000_00 },
    exit: { exitedDate: iso('2025-05-19'), exitProceeds: 458_822_22 },
  },
  {
    // Remboursement #7, 31/03/2025 — 600 000 € à 4 % sur 336 jours.
    // ⚠ The current company name carries a trailing space; match it exactly.
    dealId: 'k5727a0rzmbn8ve32epdm66vbd87r5b7',
    expectedTarget: "REWATT - 33 chaussée d'Antin ",
    sourceCompanyId: 'jx746s90ve9a55dn51xq2pt54s87sb3f',
    label: "33 rue de la Chaussée d'Antin",
    instrumentKind: 'cca',
    fields: { interestRate: 400, principalAmount: 600_000_00 },
    exit: { exitedDate: iso('2025-03-31'), exitProceeds: 622_400_00 },
  },
  {
    // Remboursement #5, 07/02/2025 — 690 000 € à 4 % sur 284 jours.
    dealId: 'k579nepw6zsndh5zw712yd7thh87rwpt',
    expectedTarget: 'REWATT - 5 rue Froment',
    sourceCompanyId: 'jx76njk558jmbspd2zcqbpt2cn87ry6d',
    label: '5 rue Froment',
    instrumentKind: 'cca',
    fields: { interestRate: 400, principalAmount: 690_000_00 },
    exit: { exitedDate: iso('2025-02-07'), exitProceeds: 711_773_33 },
  },
  {
    // Two half-nominal repayments: #6 (21/02/2025, sur cour) and #8
    // (30/04/2025, côté rue), 410 000 € each. The only floating rate of the
    // lot: « €STR + 3 % soit au 30/05/2024 6,909 % » — stored as the 691 bps
    // fixed at drawdown, the formula itself has no field.
    dealId: 'k578kh4a3jhw3a0qwnrge30rv187r8qb',
    expectedTarget: 'REWATT - 112 Rue Monge',
    sourceCompanyId: 'jx79kkjx96n6c9y705w85zzp0d87sbvc',
    label: '112 rue Monge',
    instrumentKind: 'cca',
    fields: { interestRate: 691, principalAmount: 820_000_00 },
    exit: { exitedDate: iso('2025-04-30'), exitProceeds: 866_582_02 },
  },
  {
    // The one real bond of the lot: contrat d'émission + bulletin de
    // souscription, 40 obligations de 1 000 € à 7 %. Keeps `os`. Repayment
    // letter of 30/12/2025 — still flagged `active` in prod, closed here.
    dealId: 'k573esm5nj4j0wbtxeewmdex6x87sc3s',
    expectedTarget: 'REWATT - 92 boulevard de Port-Royal',
    sourceCompanyId: 'jx724a4tvms9cfpzfxsjyf9tv987sjfg',
    label: '92 boulevard de Port-Royal',
    fields: { interestRate: 700, principalAmount: 40_000_00 },
    exit: { exitedDate: iso('2025-12-30'), exitProceeds: 41_866_67 },
    closeStatus: true,
  },
]

/**
 * Companies with no deal of their own, archived as-is. `Rewatt - Port Royal
 * 5éme` duplicates `REWATT - 92 boulevard de Port-Royal` (92 bd de Port-Royal
 * is in the 5th): same one-liner, same summary, same « Terminé » note, but no
 * deal, no document and no report — and no matching folder in the Drive, which
 * holds exactly 8 operation folders.
 */
const ORPHANS = [
  {
    companyId: 'jx78hgxhbr4htfrh26w4v974xx87r3qj',
    expectedName: 'Rewatt - Port Royal 5éme',
  },
]

async function getCalteOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('calte_org_not_found')
  return org
}

/**
 * Incoming references that must be zero before a company can be archived.
 * Same coverage as `companies.listBlockingRefs` (not exported), plus the
 * report-side tables, which matter here because the consolidation moves deals
 * away but never moves a report.
 */
async function blockingRefs(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: Id<'companies'>,
) {
  const [
    asTarget,
    asInvestor,
    relParent,
    relChild,
    kpis,
    accounts,
    docs,
    reports,
    intel,
    orgDeals,
  ] = await Promise.all([
    ctx.db
      .query('deals')
      .withIndex('by_org_target', (q) =>
        q.eq('orgId', orgId).eq('targetCompanyId', companyId),
      )
      .collect(),
    ctx.db
      .query('deals')
      .withIndex('by_org_investor', (q) =>
        q.eq('orgId', orgId).eq('investorCompanyId', companyId),
      )
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_parent', (q) =>
        q.eq('orgId', orgId).eq('parentCompanyId', companyId),
      )
      .collect(),
    ctx.db
      .query('companyRelations')
      .withIndex('by_child', (q) =>
        q.eq('orgId', orgId).eq('childCompanyId', companyId),
      )
      .collect(),
    ctx.db
      .query('kpiSnapshots')
      .withIndex('by_company_metric', (q) => q.eq('companyId', companyId))
      .collect(),
    ctx.db
      .query('bankAccounts')
      .withIndex('by_owner', (q) =>
        q.eq('orgId', orgId).eq('ownerCompanyId', companyId),
      )
      .collect(),
    ctx.db
      .query('documents')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect(),
    ctx.db
      .query('companyReports')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect(),
    ctx.db
      .query('companyIntelligence')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect(),
    // No index on viaSpvCompanyId: scan the org's deals (low volume).
    ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect(),
  ])
  return {
    dealsAsTarget: asTarget.length,
    dealsAsInvestor: asInvestor.length,
    dealsAsViaSpv: orgDeals.filter((d) => d.viaSpvCompanyId === companyId)
      .length,
    companyRelations: relParent.length + relChild.length,
    kpiSnapshots: kpis.length,
    bankAccounts: accounts.length,
    documents: docs.length,
    companyReports: reports.length,
    companyIntelligence: intel.length,
  }
}

const totalRefs = (refs: Awaited<ReturnType<typeof blockingRefs>>) =>
  Object.values(refs).reduce((n, count) => n + count, 0)

/** Loads a company by prod `_id` and cross-checks org + exact current name. */
async function resolveCompany(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  companyId: string,
  expectedName: string,
): Promise<{ company: Doc<'companies'> } | { skip: string }> {
  const company = await ctx.db.get('companies', companyId as Id<'companies'>)
  if (!company) return { skip: 'company_not_found' }
  if (company.orgId !== orgId) return { skip: 'wrong_org' }
  if (company.name !== expectedName)
    return { skip: `name_mismatch (found: ${company.name})` }
  return { company }
}

/**
 * Resolves one operation to the exact subset of fields that would be written.
 * `fields` and `exit` are fill-only (never overwrite); `name`, `targetCompanyId`,
 * `instrumentKind` and the closing `status` are requalifications, written
 * whenever the current value differs — so a second run is a no-op.
 */
async function resolveOperation(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  canonicalId: Id<'companies'>,
  spec: Operation,
): Promise<
  | {
      deal: Doc<'deals'>
      toWrite: Record<string, unknown>
      alreadySet: Array<string>
      mismatch: Array<{ field: string; current: unknown; document: unknown }>
    }
  | { skip: string }
> {
  const deal = await ctx.db.get('deals', spec.dealId as Id<'deals'>)
  if (!deal) return { skip: 'deal_not_found' }
  if (deal.orgId !== orgId) return { skip: 'wrong_org' }

  // The target is either still the per-address company (first run) or already
  // the canonical one (re-run). Anything else means the anchors went stale.
  const target = await ctx.db.get('companies', deal.targetCompanyId)
  const onSource =
    deal.targetCompanyId === (spec.sourceCompanyId as Id<'companies'>)
  const onCanonical = deal.targetCompanyId === canonicalId
  if (!onSource && !onCanonical)
    return { skip: `target_mismatch (found: ${target?.name ?? 'none'})` }
  if (onSource && target?.name !== spec.expectedTarget)
    return { skip: `source_name_mismatch (found: ${target?.name ?? 'none'})` }

  const record = deal as unknown as Record<string, unknown>
  const toWrite: Record<string, unknown> = {}
  const alreadySet: Array<string> = []
  const mismatch: Array<{
    field: string
    current: unknown
    document: unknown
  }> = []

  if (deal.targetCompanyId !== canonicalId)
    toWrite.targetCompanyId = canonicalId
  if (deal.name !== spec.label) toWrite.name = spec.label
  if (spec.instrumentKind && deal.instrumentKind !== spec.instrumentKind)
    toWrite.instrumentKind = spec.instrumentKind

  for (const [key, value] of Object.entries(spec.fields)) {
    if (record[key] === undefined) toWrite[key] = value
    else {
      alreadySet.push(key)
      if (record[key] !== value)
        mismatch.push({ field: key, current: record[key], document: value })
    }
  }
  if (spec.exit) {
    for (const [key, value] of Object.entries(spec.exit)) {
      if (record[key] === undefined) toWrite[key] = value
      else {
        alreadySet.push(key)
        if (record[key] !== value)
          mismatch.push({ field: key, current: record[key], document: value })
      }
    }
  }
  // Only Port-Royal is still open. Never downgrade a deal that is already
  // terminal for another reason (written_off / cancelled).
  if (spec.closeStatus && deal.status === 'active')
    toWrite.status = 'fully_exited'

  return { deal, toWrite, alreadySet, mismatch }
}

/** Fields of the canonical company that are still empty and would be filled. */
function identityToWrite(company: Doc<'companies'>) {
  const record = company as unknown as Record<string, unknown>
  const toWrite: Record<string, string> = {}
  for (const [key, value] of Object.entries(IDENTITY)) {
    const current = record[key]
    if (current === undefined || current === null || current === '')
      toWrite[key] = value
  }
  return toWrite
}

/**
 * A SIREN must stay unique inside an org (no schema constraint — enforced in
 * mutations, cf. CLAUDE.md). Re-checked here because the migration writes one.
 */
async function sirenConflict(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  siren: string,
  selfId: Id<'companies'>,
) {
  const rows = await ctx.db
    .query('companies')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  return rows.find((c) => c.siren === siren && c._id !== selfId) ?? null
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    const canonical = await resolveCompany(
      ctx,
      org._id,
      CANONICAL.companyId,
      CANONICAL.expectedName,
    )
    if ('skip' in canonical)
      return { error: `canonical_${canonical.skip}`, canonical: CANONICAL }

    const conflict = await sirenConflict(
      ctx,
      org._id,
      IDENTITY.siren,
      canonical.company._id,
    )
    const identity = identityToWrite(canonical.company)

    const plan = []
    const skipped = []
    const mismatches = []
    for (const spec of OPERATIONS) {
      const resolved = await resolveOperation(
        ctx,
        org._id,
        canonical.company._id,
        spec,
      )
      if ('skip' in resolved) {
        skipped.push({
          dealId: spec.dealId,
          label: spec.label,
          reason: resolved.skip,
        })
        continue
      }
      plan.push({
        label: spec.label,
        dealId: spec.dealId,
        currentInstrument: resolved.deal.instrumentKind,
        currentStatus: resolved.deal.status,
        willWrite: resolved.toWrite,
        alreadySet: resolved.alreadySet,
      })
      if (resolved.mismatch.length > 0)
        mismatches.push({ label: spec.label, fields: resolved.mismatch })
    }

    // Companies to archive: the 8 sources (once emptied by the moves above)
    // plus the orphans. Reference counts are the CURRENT ones, so the sources
    // still show their deal here — `apply` re-checks after moving.
    const toArchive = []
    for (const spec of [
      ...OPERATIONS.map((o) => ({
        companyId: o.sourceCompanyId,
        expectedName: o.expectedTarget,
      })),
      ...ORPHANS,
    ]) {
      const resolved = await resolveCompany(
        ctx,
        org._id,
        spec.companyId,
        spec.expectedName,
      )
      if ('skip' in resolved) {
        toArchive.push({ name: spec.expectedName, reason: resolved.skip })
        continue
      }
      const refs = await blockingRefs(ctx, org._id, resolved.company._id)
      toArchive.push({
        name: resolved.company.name,
        alreadyArchived: resolved.company.archivedAt != null,
        currentRefs: refs,
        // Everything except the deal being moved must already be zero.
        blockingAfterMove: totalRefs(refs) - refs.dealsAsTarget > 0,
      })
    }

    return {
      org: org.slug,
      canonical: { name: canonical.company.name, identityToWrite: identity },
      sirenConflict: conflict
        ? { name: conflict.name, id: conflict._id }
        : null,
      dealsPlanned: plan.length,
      fieldsToWrite: plan.reduce(
        (n, p) => n + Object.keys(p.willWrite).length,
        0,
      ),
      // Fields already filled whose value differs from the document — NOT
      // overwritten; validate these by hand before deciding what to do.
      mismatches,
      skipped,
      plan,
      toArchive,
      note:
        'Lecture seule. Valider ce rapport (surtout `mismatches`, ' +
        '`sirenConflict` et `blockingAfterMove`) puis lancer ' +
        'migrations/consolidateRewattCalte:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    const canonical = await resolveCompany(
      ctx,
      org._id,
      CANONICAL.companyId,
      CANONICAL.expectedName,
    )
    if ('skip' in canonical)
      throw new ConvexError(`canonical_${canonical.skip}`)
    const canonicalId = canonical.company._id

    // 1. Legal identity on the surviving company (empty fields only).
    const identity = identityToWrite(canonical.company)
    if (identity.siren) {
      const conflict = await sirenConflict(
        ctx,
        org._id,
        IDENTITY.siren,
        canonicalId,
      )
      if (conflict) throw new ConvexError(`siren_already_used:${conflict.name}`)
    }
    if (Object.keys(identity).length > 0)
      await ctx.db.patch(
        'companies',
        canonicalId,
        identity as Partial<Doc<'companies'>>,
      )

    // 2-4. Move, name, requalify and close the operation deals.
    let dealsPatched = 0
    let fieldsWritten = 0
    const untouched: Array<string> = []
    const skipped: Array<{ dealId: string; label: string; reason: string }> = []
    for (const spec of OPERATIONS) {
      const resolved = await resolveOperation(ctx, org._id, canonicalId, spec)
      if ('skip' in resolved) {
        skipped.push({
          dealId: spec.dealId,
          label: spec.label,
          reason: resolved.skip,
        })
        continue
      }
      const keys = Object.keys(resolved.toWrite)
      if (keys.length === 0) {
        untouched.push(spec.label)
        continue
      }
      // Record every written key so the Airtable re-import treats them as
      // hand-edited and never clobbers them.
      const editedFields = new Set(resolved.deal.manuallyEditedFields ?? [])
      for (const key of keys) editedFields.add(key)
      await ctx.db.patch('deals', resolved.deal._id, {
        ...(resolved.toWrite as Partial<Doc<'deals'>>),
        manuallyEditedFields: [...editedFields],
      })
      dealsPatched++
      fieldsWritten += keys.length
    }

    // 5. Archive the emptied companies + the orphans (reversible soft delete),
    //    only once nothing points to them any more.
    const archived: Array<string> = []
    const archiveRefused: Array<{ name: string; refs: unknown }> = []
    for (const spec of [
      ...OPERATIONS.map((o) => ({
        companyId: o.sourceCompanyId,
        expectedName: o.expectedTarget,
      })),
      ...ORPHANS,
    ]) {
      const resolved = await resolveCompany(
        ctx,
        org._id,
        spec.companyId,
        spec.expectedName,
      )
      if ('skip' in resolved) {
        archiveRefused.push({ name: spec.expectedName, refs: resolved.skip })
        continue
      }
      if (resolved.company.archivedAt != null) continue
      const refs = await blockingRefs(ctx, org._id, resolved.company._id)
      if (totalRefs(refs) > 0) {
        archiveRefused.push({ name: resolved.company.name, refs })
        continue
      }
      await ctx.db.patch('companies', resolved.company._id, {
        archivedAt: Date.now(),
      })
      archived.push(resolved.company.name)
    }

    return {
      identityWritten: identity,
      dealsPatched,
      fieldsWritten,
      untouched,
      skipped,
      archived,
      archiveRefused,
    }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getCalteOrg(ctx)
    const canonical = await ctx.db.get(
      'companies',
      CANONICAL.companyId as Id<'companies'>,
    )
    if (!canonical) return { ok: false, error: 'canonical_not_found' }

    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org_target', (q) =>
        q.eq('orgId', org._id).eq('targetCompanyId', canonical._id),
      )
      .collect()

    const sources = []
    for (const spec of [
      ...OPERATIONS.map((o) => ({
        companyId: o.sourceCompanyId,
        expectedName: o.expectedTarget,
      })),
      ...ORPHANS,
    ]) {
      const company = await ctx.db.get(
        'companies',
        spec.companyId as Id<'companies'>,
      )
      sources.push({
        name: spec.expectedName,
        archived: company?.archivedAt != null,
        refs: company
          ? totalRefs(await blockingRefs(ctx, org._id, company._id))
          : null,
      })
    }

    const stillOnSource = OPERATIONS.filter(
      (o) => !deals.some((d) => d._id === (o.dealId as Id<'deals'>)),
    ).map((o) => o.label)

    return {
      ok:
        canonical.siren === IDENTITY.siren &&
        stillOnSource.length === 0 &&
        sources.every((s) => s.archived && s.refs === 0),
      canonical: {
        name: canonical.name,
        siren: canonical.siren ?? null,
        legalForm: canonical.legalForm ?? null,
        sector: canonical.sector ?? null,
      },
      dealsOnCanonical: deals.length,
      deals: deals.map((d) => ({
        label: d.name ?? null,
        instrumentKind: d.instrumentKind,
        status: d.status,
        interestRate: d.interestRate ?? null,
        principalAmount: d.principalAmount ?? null,
      })),
      stillOnSource,
      sources,
    }
  },
})
