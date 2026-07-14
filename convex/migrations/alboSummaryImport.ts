/**
 * One-shot import of the 2-3 line `summary` for the operating portfolio
 * companies of the `albo` org (the longer companion of `oneLiner`, shown
 * under the fiche header), plus the two domains that were still missing
 * (Redesk, Wheelee - Loewi — found during the same research session).
 *
 * Summaries are in FR, 2-3 factual sentences (~30-50 words), grounded on
 * each company's official website (research session 14/07/2026; ACT Running
 * and JOONE relied on press/Wikipedia — their sites were unreachable).
 * Scope = the same operating startups as alboOneLinerImport: real-estate
 * SPVs and pure investment vehicles get NO summary.
 *
 * Write semantics: ADDITIVE — every field (summary, domain) is written only
 * when currently `undefined` on the company, so any hand-entered value is
 * left untouched. Idempotent & non-destructive: re-running writes nothing
 * new. Companies are anchored by prod `_id`, cross-checked against the org
 * slug and the exact company name — any mismatch skips the company.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/alboSummaryImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/alboSummaryImport:apply
 *   pnpm exec convex run --prod migrations/alboSummaryImport:verify
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
  summary?: string
  domain?: string
}

const ENTRIES: Array<Entry> = [
  { companyId: 'jx71fa19ezp2vzaaj0k09gkmzn87rq97', expectedName: 'Reekom', summary: "Reekom opère un centre industriel de revalorisation textile pour les marques de mode : collecte, inspection, réparation et reconditionnement des retours, invendus et produits de seconde main. Les marques externalisent ainsi ces opérations et se conforment à la loi AGEC." },
  { companyId: 'jx77eqqaeggwwdemjgy20xa4k187r7cv', expectedName: 'Ziwig', summary: "Ziwig développe des solutions de diagnostic en santé féminine combinant biologie moléculaire et intelligence artificielle. Son Endotest diagnostique l'endométriose par analyse des ARN salivaires, sans intervention invasive, à destination des laboratoires et des professionnels de santé." },
  { companyId: 'jx7c2j6x8zm19cg2dky1nfdv6x87sfy5', expectedName: 'BackMarket', summary: "Back Market opère une marketplace mondiale de produits électroniques reconditionnés (smartphones, ordinateurs, tablettes) reliant reconditionneurs certifiés et consommateurs. Le modèle repose sur des commissions et une garantie qualité : inspection des vendeurs, garantie d'un an, retours." },
  { companyId: 'jx78h5ac4qbqva6bdfqz9kbn7d87smbh', expectedName: 'Komeet', summary: "Komeet, née de la fusion de Vendredi et Wenabi, édite une plateforme d'engagement solidaire des salariés : missions de terrain, mécénat de compétences, mentorat et collectes. Elle relie les entreprises abonnées à un catalogue d'associations et mesure l'impact des actions." },
  { companyId: 'jx7cmgm1g90cyhsyprdsfxbqzd87r8vm', expectedName: 'RGOODS', summary: "RGOODS conçoit et gère des boutiques e-commerce en marque blanche pour les associations et ONG : sourcing, design, hébergement, logistique et support. Sa charte impose des produits éco-conçus fabriqués en Europe, pour convertir les sympathisants en acheteurs-donateurs." },
  { companyId: 'jx7c3wgzp70vn1hftqb1p6wv9987ranq', expectedName: 'Keenest', summary: "Keenest est une plateforme d'investissement participatif dédiée aux startups de la décarbonation : elle relie investisseurs particuliers et cleantech européennes via des levées en actions ou en obligations, en mesurant l'impact climatique de chaque projet." },
  { companyId: 'jx79z9rcha003f9910kh88f64s87rs51', expectedName: 'Hectarea', summary: "Hectarea permet aux particuliers d'investir dans les terres agricoles via des obligations : la société acquiert le foncier, le loue à des agriculteurs et reverse les revenus de fermage aux investisseurs. Entreprise à mission, elle finance l'installation d'exploitants et les pratiques durables." },
  { companyId: 'jx7d25nz1ed4q0p9xd875py76587r4g3', expectedName: 'Genomines', summary: "Genomines produit du nickel par agromine : des plantes hyperaccumulatrices génétiquement optimisées extraient le métal de sols pauvres, exploités en fermes métallurgiques. La société vise les filières batteries et inox, avec des coûts et une empreinte carbone inférieurs à la mine classique." },
  { companyId: 'jx71te1271bdq9qt5qpny56zw187rz88', expectedName: 'Versant', summary: "Versant développe une plateforme d'identification de parcelles pour la compensation écologique, à destination des développeurs d'énergies renouvelables, d'infrastructures et des collectivités. Ses modèles environnementaux évaluent le potentiel écologique des sites et documentent chaque sélection." },
  { companyId: 'jx71nk6w56zzbngapd4pzvj59x87r7d2', expectedName: 'Eben Home', summary: "Eben Home édite une plateforme de sourcing et de gestion de projets pour architectes et décorateurs d'intérieur : sélection, devis et commande de mobilier auprès de plus de 300 marques, fichiers 3D intégrés à SketchUp et livraisons groupées." },
  { companyId: 'jx77vx2npwy75w80xdmcgrs04987s3ea', expectedName: 'Cockpit Agriculture', summary: "Cockpit Agriculture édite un logiciel de pilotage de la performance agricole destiné aux agriculteurs et aux filières. La plateforme analyse les données d'exploitation pour éclairer les décisions techniques et économiques." },
  { companyId: 'jx78942c82np78n3gvyy7s4e5187s975', expectedName: 'Ouisub', summary: "Ouisub propose aux associations un logiciel de recherche et de gestion de subventions par abonnement. Sa base d'environ 5 000 financements, actualisée quotidiennement et couplée à un matching par IA, identifie les dispositifs pertinents et centralise le suivi des demandes." },
  { companyId: 'jx73memhv6nh8qhtpt3e8ytqjx87rvxh', expectedName: 'Resilience', summary: "Resilience développe une solution de télésuivi des patients en oncologie, étendue à la psychiatrie et à la gastro-entérologie. La plateforme collecte les données rapportées par les patients pour ajuster la prise en charge, au service des établissements de santé et des laboratoires." },
  { companyId: 'jx7agg7khvm20qt2pryer2rxb987r8w5', expectedName: 'La vie de Quartier - Holding', summary: "La Vie de Quartier exploite un réseau d'épiceries de proximité de petit format centrées sur les produits frais, majoritairement bio pour les fruits et légumes. Présente à Paris et Bordeaux, l'enseigne cible les citadins et les entreprises via la livraison au bureau." },
  { companyId: 'jx7dazc018z5t2g9pf75my07k987rbt1', expectedName: 'ACT Running', summary: "ACT Running conçoit des vêtements techniques de course à pied à partir de matériaux biosourcés, dont un nylon issu de graines de ricin. La marque développe ses propres tissus et affiche l'empreinte carbone de chaque produit." },
  { companyId: 'jx7dn3qdmqpxthb16q338v2trd87smzy', expectedName: 'Waro', summary: "Waro édite une plateforme SaaS de mesure de l'empreinte environnementale des produits, destinée aux marques textiles et aux retailers. Elle couvre la conformité réglementaire (loi AGEC, affichage environnemental), le bilan GES scope 3 et l'écoconception, selon les méthodologies ADEME et PEF." },
  { companyId: 'jx78rdch9avsme496sqg8pw88x87rchk', expectedName: 'Wandercraft', summary: "Wandercraft développe des exosquelettes de marche auto-équilibrés : Atalante X pour la rééducation en milieu hospitalier et Eve pour l'usage personnel sans béquilles. La société décline sa technologie dans Calvin-40, un robot humanoïde destiné aux usines et à la logistique." },
  { companyId: 'jx72ej20pak0mqq05hshae3ayn87rjvy', expectedName: 'Goodvest', summary: "Goodvest est un courtier en ligne proposant assurance-vie, PER et livret d'épargne en gestion pilotée, investis uniquement dans des fonds alignés avec l'Accord de Paris. Les portefeuilles excluent énergies fossiles, armement et tabac, avec une mesure d'impact fondée sur Carbon4 Finance." },
  { companyId: 'jx7901c7f8zvbm3vryrkgcssmh87rhh3', expectedName: 'Les constructeurs du bois', summary: "Les Constructeurs du Bois conçoit et réalise des bâtiments en bois et matériaux biosourcés : écoquartiers, maisons médicales, résidences gérées pour seniors, crèches et écoles. Basée à Épinal, l'entreprise s'approvisionne en bois du massif des Vosges et opère dans le Grand Est." },
  { companyId: 'jx7f66x612xx0zrzce4k41a9rh87shkp', expectedName: 'CarbonFarm', summary: "CarbonFarm certifie des projets de décarbonation de la riziculture en combinant imagerie satellite et IA. Sa technologie détecte les pratiques agricoles à l'échelle de la parcelle et vérifie les réductions d'émissions de méthane sans collecte manuelle de données, pour des agro-industriels." },
  { companyId: 'jx787ry5qajvmtxmpxn6zzqzf187r6bb', expectedName: 'AZmed', summary: "AZmed développe Rayvolve, une suite d'IA d'aide à l'interprétation des radiographies destinée aux radiologues et aux urgentistes : détection de fractures, analyse thoracique, mesures osseuses. Ses solutions, certifiées CE et FDA, sont déployées dans plus de 2 500 centres de santé." },
  { companyId: 'jx78qs3pr8tq0ksxtywz5rrq6587rdmt', expectedName: 'Beyond Green', summary: "Beyond Green développe des marques alimentaires (PourDemain, Transition, Vivants) distribuées en magasins bio et grande distribution. Les ventes financent l'accompagnement des agriculteurs vers l'agroécologie, avec débouchés garantis et rémunération équitable." },
  { companyId: 'jx74fyn7n16pchhsq7eby61dss87sphz', expectedName: 'Rewatt', summary: "Rewatt achète, rénove et remet aux normes énergétiques des logements anciens mal isolés (passoires thermiques), destinés à la revente ou à la location. La société propose aussi une offre clé en main d'investissement locatif : recherche du bien, rénovation thermique et mise en location." },
  { companyId: 'jx72bsqr4wr6j5wqzeb2zbwkex87s6tx', expectedName: 'Upcyclea', summary: "Upcyclea édite une plateforme logicielle d'économie circulaire pour l'immobilier, destinée aux propriétaires, promoteurs et collectivités. L'outil cartographie les matériaux des bâtiments via des passeports produits, connecte gisements et besoins de réemploi, et intègre le reporting ESG." },
  { companyId: 'jx7e35h5h91mmk8nw531yq482s87r1nn', expectedName: 'JOONE Paris', summary: "JOONE Paris conçoit des couches et des cosmétiques fabriqués en France pour les bébés et les jeunes mères, vendus en ligne par abonnement sans engagement. La marque mise sur la transparence des compositions et publie les analyses toxicologiques de ses produits." },
  { companyId: 'jx79jwd3y9rmsakghwagm48st187skyz', expectedName: 'Tango', summary: "Tango met en relation des jeunes compagnons et des personnes âgées, à domicile ou en établissement, pour des visites régulières mêlant compagnie, sorties et aide pratique. Les binômes sont constitués selon les affinités, avec un service facturé à l'heure éligible au crédit d'impôt." },
  { companyId: 'jx728f588hby64q8y4c7twcb9587sz2v', expectedName: 'Losanje', summary: "Losanje industrialise l'upcycling textile : elle transforme les stocks dormants et textiles en fin de vie de marques, grands groupes et collectivités en nouveaux vêtements et accessoires. Sa technologie de découpe automatisée permet une production en série, réalisée en France et en Europe." },
  { companyId: 'jx72f9jrbntwwvhvcj026dd7z987sz2n', expectedName: 'The Fat Broccoli', summary: "The Fat Broccoli est une enseigne parisienne de restauration rapide 100 % végétarienne. Elle propose une street food à base de plats végétaux, sur place et en livraison, avec un positionnement gourmand visant à rendre la cuisine végétale attractive au quotidien." },
  { companyId: 'jx774qf54r5v58sxaew582x76587rtmt', expectedName: 'RegenSchool', summary: "RegenSchool est une école de management dédiée à la transition écologique et sociale. Elle propose des cursus Bachelor, Mastère et MBA en alternance, sur ses campus de Paris puis Marseille, avec une pédagogie qui intègre les limites planétaires aux disciplines de gestion." },
  { companyId: 'jx78d1g9n2868k4g9az7ag4b8s87sk5t', expectedName: 'Eclo Beauty', summary: "Eclo Beauty conçoit du maquillage et des soins 100 % naturels fabriqués en France (teint, yeux, lèvres). La marque, certifiée B Corp, vend en ligne et en points de vente, avec des formules dites régénératives et des emballages éco-conçus." },
  { companyId: 'jx770j9q5sqva04t4gkq3fyerd87s6fz', expectedName: 'Bleen', summary: "Bleen vend en ligne des produits d'entretien extérieur écoresponsables pour particuliers, autour de programmes d'engrais gazon sur-mesure établis après un diagnostic gratuit, complétés d'une gamme anti-nuisibles naturelle." },
  { companyId: 'jx7ez9pt7m8a6jab1zyfseawgd87rgxf', expectedName: 'Jeen', summary: "Jeen exploite des centres de santé dédiés aux femmes en Île-de-France (Paris, Montreuil) : consultations médicales et paramédicales (gynécologie, fertilité, post-partum, ménopause), ateliers et cours de sport adaptés, dans une approche pluridisciplinaire de la santé féminine." },
  { companyId: 'jx75dbb7q4zp0p1234ayc6zy8187wq18', expectedName: 'Auxicare', summary: "Auxicare propose de l'aide à domicile pour personnes âgées en perte d'autonomie en Île-de-France : assistance quotidienne, compagnie et stimulation cognitive, accompagnement post-hospitalisation et aides spécialisées (Alzheimer, Parkinson), en mode mandataire avec des auxiliaires certifiées." },
  { companyId: 'jx7fda6mb1dmpej8zaq9tzy6gd8a7nzw', expectedName: 'Redesk', summary: "Redesk vend aux entreprises du mobilier de bureau reconditionné de grandes marques (bureaux, assises, rangements, cabines acoustiques) à prix réduit par rapport au neuf. Le reconditionnement s'appuie sur des ateliers partenaires et des ESAT, avec livraison et installation incluses.", domain: 'redesk.fr' },
  { companyId: 'jx7fgc6r15rydb31jpn4jyvc6x88dkmp', expectedName: 'Wheelee - Loewi', summary: "Loewi reconditionne et vend des vélos électriques d'occasion (ville, VTC, VTT, cargo) pour particuliers et entreprises, à l'achat ou en location. Chaque vélo passe une trentaine de points de contrôle avec diagnostic de la batterie et bénéficie d'une garantie d'un an.", domain: 'loewi.fr' },
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
  for (const key of ['summary', 'domain'] as const) {
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
    return {
      org: org.slug,
      summariesToWrite: plan.filter((p) => 'summary' in p.willWrite).length,
      domainsToWrite: plan.filter((p) => 'domain' in p.willWrite).length,
      skipped,
      plan,
      note:
        'Lecture seule. Valider ce rapport puis lancer ' +
        'migrations/alboSummaryImport:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    let summariesWritten = 0
    let domainsWritten = 0
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
      if ('summary' in resolved.toWrite) summariesWritten++
      if ('domain' in resolved.toWrite) domainsWritten++
    }

    return { summariesWritten, domainsWritten, skipped }
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
    return {
      org: org.slug,
      allOk: issues.length === 0,
      entriesChecked: ENTRIES.length,
      issues,
    }
  },
})
