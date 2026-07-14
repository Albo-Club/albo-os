/**
 * One-shot import of the short one-liner pitch (`oneLiner`) for the operating
 * portfolio companies of the `albo` org, plus the `sector` values that were
 * still missing after alboIdentityImport, plus one deliberate sector
 * reclassification (D2C consumer brands → the new `consumer` slug).
 *
 * One-liners are in FR, YC-style (short, ~3-7 words), grounded on each
 * company's official website (research session 14/07/2026, review table shared
 * with Benjamin). Scope = operating startups only: real-estate SPVs (Parallel
 * Invest, Sezame Immo, La Vie de Quartier store sub-entities) and pure
 * investment vehicles (Hexa Sprint fund, Oprtrs & Co) get NO one-liner — a
 * pitch is meaningless for a holding vehicle. Oprtrs & Co is nonetheless
 * classified `fund` here (its sector was missing).
 *
 * Two write semantics:
 *   - ENTRIES (oneLiner + sector): ADDITIVE — a field is written only when
 *     currently `undefined` on the company, so any hand-entered value is left
 *     untouched.
 *   - SECTOR_OVERRIDES: EXPLICIT reclassification — sector is forced to the
 *     target value even when already set. The four D2C brands move from
 *     `marketplace` to the new `consumer` slug (ACT Running had no sector yet).
 *
 * Idempotent & non-destructive: re-running writes nothing new (ENTRIES skip
 * already-set fields; overrides re-set the same value). Companies are anchored
 * by prod `_id`, cross-checked against the org slug and the exact company
 * name — any mismatch skips the company.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/alboOneLinerImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/alboOneLinerImport:apply
 *   pnpm exec convex run --prod migrations/alboOneLinerImport:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'albo'

/** Additive: each provided field is written only if currently undefined. */
type Entry = {
  companyId: string
  /** Exact prod company name — safety cross-check before patching. */
  expectedName: string
  oneLiner?: string
  sector?: string
}

/** Overwrite: sector is forced to `sector` even if already set. */
type SectorOverride = {
  companyId: string
  expectedName: string
  sector: string
  /** Previous value, informational for the report. */
  from: string
}

const ENTRIES: Array<Entry> = [
  { companyId: 'jx77eqqaeggwwdemjgy20xa4k187r7cv', expectedName: 'Ziwig', oneLiner: "Test salivaire de diagnostic de l'endométriose" },
  { companyId: 'jx7c2j6x8zm19cg2dky1nfdv6x87sfy5', expectedName: 'BackMarket', oneLiner: 'Marketplace de produits électroniques reconditionnés' },
  { companyId: 'jx73memhv6nh8qhtpt3e8ytqjx87rvxh', expectedName: 'Resilience', oneLiner: 'Télésuivi des patients en oncologie' },
  { companyId: 'jx78rdch9avsme496sqg8pw88x87rchk', expectedName: 'Wandercraft', oneLiner: 'Exosquelettes de marche et robots humanoïdes', sector: 'industry' },
  { companyId: 'jx787ry5qajvmtxmpxn6zzqzf187r6bb', expectedName: 'AZmed', oneLiner: "IA d'aide à l'interprétation des radiographies", sector: 'health' },
  { companyId: 'jx72ej20pak0mqq05hshae3ayn87rjvy', expectedName: 'Goodvest', oneLiner: 'Assurance-vie responsable alignée climat' },
  { companyId: 'jx7f66x612xx0zrzce4k41a9rh87shkp', expectedName: 'CarbonFarm', oneLiner: 'Certification carbone des rizières par satellite' },
  { companyId: 'jx7d25nz1ed4q0p9xd875py76587r4g3', expectedName: 'Genomines', oneLiner: 'Nickel pour batteries extrait de plantes', sector: 'industry' },
  { companyId: 'jx71te1271bdq9qt5qpny56zw187rz88', expectedName: 'Versant', oneLiner: 'Identification de parcelles pour compensation écologique', sector: 'climate' },
  { companyId: 'jx7c3wgzp70vn1hftqb1p6wv9987ranq', expectedName: 'Keenest', oneLiner: "Club d'investissement dans les startups climat" },
  { companyId: 'jx79z9rcha003f9910kh88f64s87rs51', expectedName: 'Hectarea', oneLiner: 'Investissement participatif dans les terres agricoles' },
  { companyId: 'jx78qs3pr8tq0ksxtywz5rrq6587rdmt', expectedName: 'Beyond Green', oneLiner: 'Marques alimentaires finançant la transition bio' },
  { companyId: 'jx77vx2npwy75w80xdmcgrs04987s3ea', expectedName: 'Cockpit Agriculture', oneLiner: 'Logiciel de pilotage de la performance agricole' },
  { companyId: 'jx72f9jrbntwwvhvcj026dd7z987sz2n', expectedName: 'The Fat Broccoli', oneLiner: 'Restauration rapide 100 % végétarienne' },
  { companyId: 'jx78h5ac4qbqva6bdfqz9kbn7d87smbh', expectedName: 'Komeet', oneLiner: "Plateforme d'engagement solidaire des salariés" },
  { companyId: 'jx7cmgm1g90cyhsyprdsfxbqzd87r8vm', expectedName: 'RGOODS', oneLiner: 'Boutiques e-commerce clé en main pour associations' },
  { companyId: 'jx78942c82np78n3gvyy7s4e5187s975', expectedName: 'Ouisub', oneLiner: 'Logiciel de recherche de subventions pour associations' },
  { companyId: 'jx7dn3qdmqpxthb16q338v2trd87smzy', expectedName: 'Waro', oneLiner: "Mesure d'empreinte environnementale des produits" },
  { companyId: 'jx72bsqr4wr6j5wqzeb2zbwkex87s6tx', expectedName: 'Upcyclea', oneLiner: "Plateforme d'économie circulaire pour le bâtiment" },
  { companyId: 'jx71fa19ezp2vzaaj0k09gkmzn87rq97', expectedName: 'Reekom', oneLiner: 'Reconditionnement industriel de produits pour marques' },
  { companyId: 'jx728f588hby64q8y4c7twcb9587sz2v', expectedName: 'Losanje', oneLiner: 'Upcycling industriel de chutes textiles' },
  { companyId: 'jx71nk6w56zzbngapd4pzvj59x87r7d2', expectedName: 'Eben Home', oneLiner: "Marketplace de mobilier pour architectes d'intérieur" },
  { companyId: 'jx7fda6mb1dmpej8zaq9tzy6gd8a7nzw', expectedName: 'Redesk', oneLiner: 'Mobilier de bureau reconditionné' },
  { companyId: 'jx7fgc6r15rydb31jpn4jyvc6x88dkmp', expectedName: 'Wheelee - Loewi', oneLiner: 'Vélos et trottinettes électriques reconditionnés' },
  { companyId: 'jx774qf54r5v58sxaew582x76587rtmt', expectedName: 'RegenSchool', oneLiner: 'École de management de la transition écologique' },
  { companyId: 'jx7ez9pt7m8a6jab1zyfseawgd87rgxf', expectedName: 'Jeen', oneLiner: 'Centres de santé dédiés aux femmes', sector: 'health' },
  { companyId: 'jx75dbb7q4zp0p1234ayc6zy8187wq18', expectedName: 'Auxicare', oneLiner: 'Aide à domicile pour personnes âgées' },
  { companyId: 'jx79jwd3y9rmsakghwagm48st187skyz', expectedName: 'Tango', oneLiner: 'Jeunes compagnons pour personnes âgées' },
  { companyId: 'jx7agg7khvm20qt2pryer2rxb987r8w5', expectedName: 'La vie de Quartier - Holding', oneLiner: "Réseau d'épiceries de quartier" },
  { companyId: 'jx7901c7f8zvbm3vryrkgcssmh87rhh3', expectedName: 'Les constructeurs du bois', oneLiner: 'Promotion immobilière en construction bois' },
  { companyId: 'jx74fyn7n16pchhsq7eby61dss87sphz', expectedName: 'Rewatt', oneLiner: 'Rénovation énergétique de passoires thermiques' },
  { companyId: 'jx7dazc018z5t2g9pf75my07k987rbt1', expectedName: 'ACT Running', oneLiner: 'Vêtements de running éco-conçus' },
  { companyId: 'jx78d1g9n2868k4g9az7ag4b8s87sk5t', expectedName: 'Eclo Beauty', oneLiner: 'Maquillage naturel et régénératif' },
  { companyId: 'jx770j9q5sqva04t4gkq3fyerd87s6fz', expectedName: 'Bleen', oneLiner: 'Engrais gazon naturel sur-mesure par abonnement' },
  { companyId: 'jx7e35h5h91mmk8nw531yq482s87r1nn', expectedName: 'JOONE Paris', oneLiner: 'Couches et cosmétiques sains pour bébé' },
  // Sector-only (investment vehicles / not-yet-imported entity) — no one-liner.
  { companyId: 'jx75rezn2rwshzyn7k2s3tq70d88pv9q', expectedName: 'Oprtrs & Co', sector: 'fund' },
  { companyId: 'jx720ph745f5wx0ba2nchad8xd89kjfv', expectedName: 'La Vie de Quartier - Bdv Voltaire', sector: 'services' },
]

// D2C consumer brands: reclassified from `marketplace` (or unset) to the new
// `consumer` slug — a brand that sells its own product is not a marketplace.
const SECTOR_OVERRIDES: Array<SectorOverride> = [
  { companyId: 'jx7dazc018z5t2g9pf75my07k987rbt1', expectedName: 'ACT Running', sector: 'consumer', from: '(unset)' },
  { companyId: 'jx78d1g9n2868k4g9az7ag4b8s87sk5t', expectedName: 'Eclo Beauty', sector: 'consumer', from: 'marketplace' },
  { companyId: 'jx770j9q5sqva04t4gkq3fyerd87s6fz', expectedName: 'Bleen', sector: 'consumer', from: 'marketplace' },
  { companyId: 'jx7e35h5h91mmk8nw531yq482s87r1nn', expectedName: 'JOONE Paris', sector: 'consumer', from: 'marketplace' },
]

async function getAlboOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('albo_org_not_found')
  return org
}

/** Resolve an additive entry: what would be written (undefined fields only). */
async function resolveEntry(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: Entry,
): Promise<
  | { company: Doc<'companies'>; toWrite: Record<string, string>; alreadySet: Array<string> }
  | { skip: string }
> {
  const company = await ctx.db.get('companies', spec.companyId as Id<'companies'>)
  if (!company) return { skip: 'company_not_found' }
  if (company.orgId !== orgId) return { skip: 'wrong_org' }
  if (company.name !== spec.expectedName)
    return { skip: `name_mismatch (found: ${company.name})` }

  const record = company as unknown as Record<string, unknown>
  const toWrite: Record<string, string> = {}
  const alreadySet: Array<string> = []
  for (const key of ['oneLiner', 'sector'] as const) {
    const value = spec[key]
    if (value === undefined) continue
    if (record[key] !== undefined) {
      alreadySet.push(key)
      continue
    }
    toWrite[key] = value
  }
  return { company, toWrite, alreadySet }
}

/** Resolve a sector override: the forced value and the current one. */
async function resolveOverride(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: SectorOverride,
): Promise<
  | { company: Doc<'companies'>; current: string | null; alreadyEqual: boolean }
  | { skip: string }
> {
  const company = await ctx.db.get('companies', spec.companyId as Id<'companies'>)
  if (!company) return { skip: 'company_not_found' }
  if (company.orgId !== orgId) return { skip: 'wrong_org' }
  if (company.name !== spec.expectedName)
    return { skip: `name_mismatch (found: ${company.name})` }
  const current = company.sector ?? null
  return { company, current, alreadyEqual: current === spec.sector }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const plan = []
    const skipped = []
    for (const spec of ENTRIES) {
      const resolved = await resolveEntry(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ name: spec.expectedName, reason: resolved.skip })
        continue
      }
      if (Object.keys(resolved.toWrite).length === 0 && resolved.alreadySet.length === 0)
        continue
      plan.push({
        name: spec.expectedName,
        willWrite: resolved.toWrite,
        alreadySet: resolved.alreadySet,
      })
    }
    const reclassify = []
    for (const spec of SECTOR_OVERRIDES) {
      const resolved = await resolveOverride(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ name: spec.expectedName, reason: resolved.skip })
        continue
      }
      reclassify.push({
        name: spec.expectedName,
        from: resolved.current ?? '(unset)',
        to: spec.sector,
        noop: resolved.alreadyEqual,
      })
    }
    return {
      org: org.slug,
      oneLinersToWrite: plan.filter((p) => 'oneLiner' in p.willWrite).length,
      sectorsToWrite: plan.filter((p) => 'sector' in p.willWrite).length,
      reclassifyToApply: reclassify.filter((r) => !r.noop).length,
      skipped,
      plan,
      reclassify,
      note:
        'Lecture seule. Valider ce rapport puis lancer ' +
        'migrations/alboOneLinerImport:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    let oneLinersWritten = 0
    let sectorsWritten = 0
    let reclassified = 0
    const skipped: Array<{ name: string; reason: string }> = []

    for (const spec of ENTRIES) {
      const resolved = await resolveEntry(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ name: spec.expectedName, reason: resolved.skip })
        continue
      }
      const keys = Object.keys(resolved.toWrite)
      if (keys.length === 0) continue
      await ctx.db.patch(
        'companies',
        resolved.company._id,
        resolved.toWrite as Partial<Doc<'companies'>>,
      )
      if ('oneLiner' in resolved.toWrite) oneLinersWritten++
      if ('sector' in resolved.toWrite) sectorsWritten++
    }

    for (const spec of SECTOR_OVERRIDES) {
      const resolved = await resolveOverride(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({ name: spec.expectedName, reason: resolved.skip })
        continue
      }
      if (resolved.alreadyEqual) continue
      await ctx.db.patch('companies', resolved.company._id, {
        sector: spec.sector,
      } as Partial<Doc<'companies'>>)
      reclassified++
    }

    return { oneLinersWritten, sectorsWritten, reclassified, skipped }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const issues = []
    for (const spec of ENTRIES) {
      const resolved = await resolveEntry(ctx, org._id, spec)
      if ('skip' in resolved) {
        issues.push({ name: spec.expectedName, issue: resolved.skip })
        continue
      }
      // Additive fields must all be set now (hand values are respected, so a
      // remaining toWrite key means the field is still unset — a real gap).
      const missing = Object.keys(resolved.toWrite)
      if (missing.length > 0)
        issues.push({ name: spec.expectedName, issue: `not_written: ${missing.join(', ')}` })
    }
    for (const spec of SECTOR_OVERRIDES) {
      const resolved = await resolveOverride(ctx, org._id, spec)
      if ('skip' in resolved) {
        issues.push({ name: spec.expectedName, issue: resolved.skip })
        continue
      }
      if (!resolved.alreadyEqual)
        issues.push({
          name: spec.expectedName,
          issue: `sector_not_${spec.sector} (found: ${resolved.current ?? 'unset'})`,
        })
    }
    return {
      org: org.slug,
      allOk: issues.length === 0,
      entriesChecked: ENTRIES.length,
      overridesChecked: SECTOR_OVERRIDES.length,
      issues,
    }
  },
})
