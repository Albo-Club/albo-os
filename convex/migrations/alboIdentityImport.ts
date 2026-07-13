/**
 * One-shot import of company identity data for the portfolio companies of
 * the `albo` org, extracted from the legal documents stored in the Google
 * Drive folder « ⚠️ Investissements » (statuts, pactes d'associés,
 * bulletins de souscription, cap tables, PV d'AG, contrats d'émission,
 * contrats de royalties).
 *
 * Fields covered per company: siren, legalName, sector (canonical slug from
 * the participations sector list), totalShares, domain, registrationNumber /
 * countryCode (foreign entities), and people (founders / board members /
 * co-investors). Natural persons were resolved against the Attio `people`
 * object: entries carrying `attioRecordId` render as clickable links to the
 * Attio record; funds/companies and unresolved persons stay as plain text.
 *
 * Every value was extracted with a source document + supporting quote
 * (session extraction files + review table shared with Benjamin on
 * 13/07/2026). All SIRENs pass the Luhn checksum. Deliberate exclusions:
 *   - totalShares NOT imported when Albo holds the position via an SPV
 *     (Ziwig, Eben Home, Hectarea…): the ownership % would divide SPV
 *     shares by the target's share count.
 *   - totalShares NOT imported when the last documented figure is stale
 *     (Waro pre-OCA-conversion, Bleen pre-2026 issuance).
 *   - Parallel SPVs: 100-share variable-capital base not imported (bond
 *     deals, the figure is meaningless for ownership).
 *   - "La Vie de Quartier - Bdv Voltaire": no legal document exists yet
 *     (3rd épicerie tranche not deployed) — nothing to import.
 *
 * Idempotent & non-destructive:
 *   - scalar fields are written only when currently `undefined` on the
 *     company (hand-entered values are never touched);
 *   - `people` is written only when the company has no people yet
 *     (undefined or empty array) — a hand-curated list is never merged over;
 *   - `siren` respects the org-level uniqueness rule (skipped with a
 *     report entry if another company of the org already carries it);
 *   - companies are anchored by prod `_id`, cross-checked against the org
 *     slug and the exact company name — any mismatch skips the company.
 *
 * Execution order (prod, manual):
 *   pnpm exec convex export --prod --path ./albo-backup-$(date +%Y%m%d-%H%M).zip
 *   pnpm exec convex run --prod migrations/alboIdentityImport:dryRun
 *   # STOP: validate the report, then and only then:
 *   pnpm exec convex run --prod migrations/alboIdentityImport:apply
 *   pnpm exec convex run --prod migrations/alboIdentityImport:verify
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc, Id } from '../_generated/dataModel'
import type { PersonRole } from '../lib/people'

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const ORG_SLUG = 'albo'

type PersonEntry = { role: PersonRole; name: string; attioRecordId?: string }

type CompanyPatch = {
  companyId: string
  /** Exact prod company name — safety cross-check before patching. */
  expectedName: string
  /** Scalar fields written only if currently undefined on the company. */
  fields?: Record<string, string | number>
  /** Written only if the company has no people yet (undefined or []). */
  people?: Array<PersonEntry>
}

const PATCHES: Array<CompanyPatch> = [
  {
    companyId: "jx7dazc018z5t2g9pf75my07k987rbt1",
    expectedName: "ACT Running",
    fields: { siren: "953877495", totalShares: 37500 },
    people: [
      { role: "founder", name: "ONAPP" },
      { role: "coinvestor", name: "ADNEB" },
      { role: "coinvestor", name: "Antoine Planque" },
      { role: "coinvestor", name: "François Planque" },
      { role: "coinvestor", name: "François-Xavier Caille" },
      { role: "coinvestor", name: "Amélie Caille" },
      { role: "coinvestor", name: "Diane Caille" },
      { role: "coinvestor", name: "Dimitri Moulin" },
      { role: "coinvestor", name: "Bernd Loder" },
      { role: "coinvestor", name: "Dirk Lange" },
      { role: "coinvestor", name: "SOAILI INVEST" },
      { role: "coinvestor", name: "NOPEUNTEO" },
      { role: "coinvestor", name: "MHW" },
    ],
  },
  {
    companyId: "jx75dbb7q4zp0p1234ayc6zy8187wq18",
    expectedName: "Auxicare",
    fields: { siren: "930844105", sector: "services", totalShares: 548943 },
    people: [
      { role: "founder", name: "Jean-Guillaume Nillameyom", attioRecordId: "c2d3c735-4f8f-483b-bfa0-1a2ea819e663" },
      { role: "founder", name: "Hugo Genin" },
      { role: "founder", name: "George Plant" },
      { role: "coinvestor", name: "Mathieu Boespflug", attioRecordId: "d25091e9-d0eb-4046-856a-1a727df0e57d" },
      { role: "coinvestor", name: "François Dubrule" },
      { role: "coinvestor", name: "HTH – Hexagon Technologies Holding" },
      { role: "coinvestor", name: "AYMACO Luxembourg" },
      { role: "coinvestor", name: "182 Ventures" },
      { role: "coinvestor", name: "Watchhouse Holdings Pte. Ltd." },
      { role: "coinvestor", name: "Lats Group Pte. Ltd." },
      { role: "coinvestor", name: "Balule Development" },
      { role: "coinvestor", name: "ANTLER CE I FUND GmbH & Co. KG" },
    ],
  },
  {
    companyId: "jx787ry5qajvmtxmpxn6zzqzf187r6bb",
    expectedName: "AZmed",
    fields: { siren: "841673601" },
  },
  {
    companyId: "jx7c2j6x8zm19cg2dky1nfdv6x87sfy5",
    expectedName: "BackMarket",
    fields: { siren: "804049476", legalName: "JUNG S.A.S", sector: "marketplace" },
  },
  {
    companyId: "jx78qs3pr8tq0ksxtywz5rrq6587rdmt",
    expectedName: "Beyond Green",
    fields: { siren: "843718024", sector: "agrifood", totalShares: 125868 },
    people: [
      { role: "founder", name: "Stéphane Delebassé", attioRecordId: "2b709f42-396b-4631-987d-36e93b209f62" },
      { role: "founder", name: "Maxime Durand", attioRecordId: "a8a28bf6-5255-44af-8fe2-67f8932ba24b" },
      { role: "coinvestor", name: "SENSECUBE SEED I" },
      { role: "coinvestor", name: "FINORPA SCR" },
      { role: "coinvestor", name: "CW Transition" },
      { role: "coinvestor", name: "NORD FRANCE AMORCAGE" },
      { role: "coinvestor", name: "LAITIERE DE SAINT DENIS DE L'HOTEL" },
      { role: "coinvestor", name: "Xavier Van Campenhout", attioRecordId: "37a28479-4875-43a0-b279-3a7057691ef0" },
      { role: "coinvestor", name: "LATKES" },
      { role: "coinvestor", name: "ANKATA" },
      { role: "coinvestor", name: "1001PACT BEYOND GREEN 2" },
    ],
  },
  {
    companyId: "jx770j9q5sqva04t4gkq3fyerd87s6fz",
    expectedName: "Bleen",
    fields: { siren: "898600085", legalName: "Get Eden", sector: "marketplace" },
    people: [
      { role: "founder", name: "Quentin Lanthier", attioRecordId: "f7c54da2-6bb3-4f96-9a0b-183469aa29e6" },
      { role: "coinvestor", name: "A.C.H" },
      { role: "coinvestor", name: "OC 2 HOLDING" },
      { role: "coinvestor", name: "LISE INVEST" },
      { role: "coinvestor", name: "KOBE INVEST" },
      { role: "coinvestor", name: "NATURAL GRASS" },
      { role: "coinvestor", name: "DUF HOLDING" },
      { role: "coinvestor", name: "HMN HOLDING" },
      { role: "coinvestor", name: "JDP PARTICIPATIONS" },
      { role: "coinvestor", name: "BAR CAPITAL" },
      { role: "coinvestor", name: "KAWAII" },
      { role: "coinvestor", name: "Thibault Lanthier" },
      { role: "coinvestor", name: "Gatien Cantais" },
    ],
  },
  {
    companyId: "jx7f66x612xx0zrzce4k41a9rh87shkp",
    expectedName: "CarbonFarm",
    fields: { siren: "912160389", legalName: "CarbonFarm Technology", sector: "climate", domain: "carbonfarm.tech", totalShares: 354551 },
    people: [
      { role: "founder", name: "Vassily Carantino", attioRecordId: "a5789489-1d21-4120-bc73-920627aceaa9" },
      { role: "founder", name: "James Hastwell", attioRecordId: "65bc0e8d-2615-45d6-a355-71bfd718e5d2" },
      { role: "board", name: "Vassily Carantino", attioRecordId: "a5789489-1d21-4120-bc73-920627aceaa9" },
      { role: "board", name: "James Hastwell", attioRecordId: "65bc0e8d-2615-45d6-a355-71bfd718e5d2" },
      { role: "board", name: "Olivier Tilloy", attioRecordId: "50e2d49b-b341-4130-afc7-74318e3d2317" },
      { role: "board", name: "Eric Gossart", attioRecordId: "b0f2980c-14c9-46e4-84b0-afd19afe1491" },
      { role: "board", name: "Benjamine Friederich" },
      { role: "board", name: "Xavier Sanchez" },
      { role: "coinvestor", name: "Techmind" },
      { role: "coinvestor", name: "THNK I" },
      { role: "coinvestor", name: "Racine²" },
      { role: "coinvestor", name: "FPCI Entrepreneurs A+" },
      { role: "coinvestor", name: "FPCI Entrepreneurs A+ 2025" },
      { role: "coinvestor", name: "Colam Impact" },
      { role: "coinvestor", name: "SC CLIMATE TECH VENTURES I, F.C.R.E." },
      { role: "coinvestor", name: "SC CLIMATE TECH VENTURES I, F.C.R.E., S.A." },
    ],
  },
  {
    companyId: "jx77vx2npwy75w80xdmcgrs04987s3ea",
    expectedName: "Cockpit Agriculture",
    fields: { siren: "989273222", sector: "agrifood", totalShares: 15738 },
    people: [
      { role: "founder", name: "David Pineau", attioRecordId: "288ab9f5-0124-489e-b72e-f18112614fee" },
      { role: "founder", name: "BLOOM AGRO" },
      { role: "board", name: "David Pineau", attioRecordId: "288ab9f5-0124-489e-b72e-f18112614fee" },
      { role: "board", name: "BLOOM AGRO" },
      { role: "board", name: "IM2" },
      { role: "coinvestor", name: "IM2" },
      { role: "coinvestor", name: "PSL FUTURES" },
      { role: "coinvestor", name: "Hélène Le Petit Rontani", attioRecordId: "679ab1c1-cf0c-4c3f-b05f-87724b690f6c" },
      { role: "coinvestor", name: "INTELLAGRI SA" },
    ],
  },
  {
    companyId: "jx71nk6w56zzbngapd4pzvj59x87r7d2",
    expectedName: "Eben Home",
    fields: { siren: "901627208", sector: "marketplace", domain: "ebenhome.co" },
    people: [
      { role: "founder", name: "Lucas Watrin", attioRecordId: "8cad4edf-dab9-4311-ae04-5ad0c93e4aca" },
      { role: "founder", name: "Pierre Dard", attioRecordId: "99c4b9b0-7516-4f51-91f3-b63d1ba80628" },
      { role: "board", name: "Lucas Watrin", attioRecordId: "8cad4edf-dab9-4311-ae04-5ad0c93e4aca" },
      { role: "board", name: "Pierre Dard", attioRecordId: "99c4b9b0-7516-4f51-91f3-b63d1ba80628" },
      { role: "board", name: "Clément Alteresco", attioRecordId: "6a5ee326-f052-4c26-ad65-037ab308ec0c" },
      { role: "coinvestor", name: "FPCI BLUEBERRY" },
      { role: "coinvestor", name: "HOLDING EBNH" },
      { role: "coinvestor", name: "CALTE" },
      { role: "coinvestor", name: "Benoist Grossmann", attioRecordId: "168b3705-593b-4a1c-b96a-c965dbbb92d4" },
      { role: "coinvestor", name: "ODIN Investment Limited" },
      { role: "coinvestor", name: "Grant Aarons" },
      { role: "coinvestor", name: "Guillaume Bertaud", attioRecordId: "6b2ab6e7-e4e7-4ac7-8eb6-979b606392f3" },
      { role: "coinvestor", name: "TWA INVEST" },
      { role: "coinvestor", name: "MINDX" },
      { role: "coinvestor", name: "MAISON ALEXA" },
      { role: "coinvestor", name: "Alban Peltier" },
    ],
  },
  {
    companyId: "jx78d1g9n2868k4g9az7ag4b8s87sk5t",
    expectedName: "Eclo Beauty",
    fields: { siren: "899132203", legalName: "SUSTAINABLE BEAUTY", sector: "marketplace", domain: "eclobeauty.com" },
    people: [
      { role: "founder", name: "Priscille Jobard" },
      { role: "founder", name: "Julien Callede", attioRecordId: "b9a7542b-088a-4812-b118-37b38a351f4e" },
      { role: "founder", name: "Marin Susac" },
    ],
  },
  {
    companyId: "jx7d25nz1ed4q0p9xd875py76587r4g3",
    expectedName: "Genomines",
    fields: { siren: "902178235" },
  },
  {
    companyId: "jx72ej20pak0mqq05hshae3ayn87rjvy",
    expectedName: "Goodvest",
    fields: { siren: "889263117", sector: "fintech", domain: "goodvest.fr", totalShares: 251607 },
    people: [
      { role: "founder", name: "Antoine Bénéteau", attioRecordId: "304478f5-fff1-4daf-88bd-914128ba2168" },
      { role: "founder", name: "Joseph Choueifaty", attioRecordId: "0020f312-9842-5053-a9b3-76c37389045e" },
      { role: "coinvestor", name: "Polytechnique Ventures" },
      { role: "coinvestor", name: "ALM Innovation" },
      { role: "coinvestor", name: "Ring Mission Venture Capital 1" },
      { role: "coinvestor", name: "Generali Vie" },
      { role: "coinvestor", name: "FPCI InnovAllianz III" },
      { role: "coinvestor", name: "FPCI EntrepreneurA+" },
    ],
  },
  {
    companyId: "jx79z9rcha003f9910kh88f64s87rs51",
    expectedName: "Hectarea",
    fields: { siren: "921590279", sector: "fintech" },
    people: [
      { role: "founder", name: "Paul Rodrigues", attioRecordId: "03797967-d1eb-4932-b2c1-e47d9d95cd75" },
      { role: "founder", name: "PRDEV" },
      { role: "founder", name: "Abdoul Adime Amoukou Ibrahim", attioRecordId: "c4803a03-8903-45ea-95fb-8c3d182473db" },
      { role: "founder", name: "ACACIAS CAPITAL" },
      { role: "board", name: "PRDEV" },
      { role: "board", name: "ACACIAS CAPITAL" },
      { role: "board", name: "Timothée Metz", attioRecordId: "926ba895-272f-4bef-9340-2269e0d86cd3" },
      { role: "board", name: "Benjamin Bouquet", attioRecordId: "2d42471c-037c-4434-a09d-fd48209d79ba" },
      { role: "board", name: "Sébastien Tricaud", attioRecordId: "6f4e3bfc-e608-44f4-a673-a79f16df168c" },
      { role: "coinvestor", name: "FPCI Invess Ile-de-France Amorçage" },
      { role: "coinvestor", name: "KISS STUDIO" },
      { role: "coinvestor", name: "F.A.M.M" },
      { role: "coinvestor", name: "PARM II" },
      { role: "coinvestor", name: "Antoine Jeanjean" },
    ],
  },
  {
    companyId: "jx70wzjrfpp4cfn1aq9ex127qd8ada3z",
    expectedName: "Hexa Sprint Carbone Zero",
    fields: { legalName: "Hexa Sprint Climate SSi", sector: "fund", registrationNumber: "1037595835", countryCode: "BE" },
    people: [
      { role: "founder", name: "Hexa" },
      { role: "founder", name: "eClub Administration" },
    ],
  },
  {
    companyId: "jx7ez9pt7m8a6jab1zyfseawgd87rgxf",
    expectedName: "Jeen",
    fields: { siren: "907996748" },
    people: [
      { role: "coinvestor", name: "Tristan Investissements" },
      { role: "coinvestor", name: "PAF KAPITAL" },
      { role: "coinvestor", name: "LUNKER" },
      { role: "coinvestor", name: "ENDHEO" },
      { role: "coinvestor", name: "PATH" },
      { role: "coinvestor", name: "Pierre Lassarat" },
      { role: "coinvestor", name: "Fonds de dotation PACCTE" },
      { role: "coinvestor", name: "Chloé Lassarat" },
      { role: "coinvestor", name: "Capucine Lassarat" },
      { role: "coinvestor", name: "Timothée Lassarat" },
      { role: "coinvestor", name: "Augustin Lassarat" },
    ],
  },
  {
    companyId: "jx7e35h5h91mmk8nw531yq482s87r1nn",
    expectedName: "JOONE Paris",
    fields: { siren: "824500797", legalName: "NOO CORP", sector: "marketplace", domain: "joone.fr" },
    people: [
      { role: "founder", name: "Carole Juge", attioRecordId: "a2dd964f-88d9-4f1f-b68a-28142b60bbfe" },
    ],
  },
  {
    companyId: "jx7c3wgzp70vn1hftqb1p6wv9987ranq",
    expectedName: "Keenest",
    fields: { siren: "951398957", legalName: "KEEN IMPACT", sector: "fintech", domain: "keenest.co", totalShares: 722044 },
    people: [
      { role: "founder", name: "Jérémie Sicsic", attioRecordId: "b974ac19-e5a4-4bbe-9c5d-97c778058fd6" },
      { role: "founder", name: "Adrien Hubert", attioRecordId: "047c0c17-4ba9-4a95-846a-728da5a444df" },
      { role: "founder", name: "SMARTIMPACT" },
      { role: "coinvestor", name: "MOTY INVEST" },
      { role: "coinvestor", name: "Yannick Chamming'S", attioRecordId: "0d52b79c-4d89-48d6-b409-22f1874fb3ce" },
      { role: "coinvestor", name: "CERES MANAGEMENT" },
      { role: "coinvestor", name: "Benjamin Marchal", attioRecordId: "6e783402-a81c-4cd3-ac57-2728f8d20270" },
      { role: "coinvestor", name: "Clément Levassor" },
      { role: "coinvestor", name: "Paul-Olivier Raynaud-Lacroze" },
      { role: "coinvestor", name: "Marine Wurtz", attioRecordId: "c8992d8f-d161-47fd-82ae-45079722e68b" },
      { role: "coinvestor", name: "François Aramburu" },
      { role: "coinvestor", name: "Solène Boudot" },
      { role: "coinvestor", name: "Thibault Boiron" },
      { role: "coinvestor", name: "TERRE CIEL ENERGIES" },
      { role: "coinvestor", name: "HUB612 PARTICIPATIONS" },
      { role: "coinvestor", name: "STATION F" },
      { role: "coinvestor", name: "HUBBER INC" },
      { role: "coinvestor", name: "Paul Perié" },
    ],
  },
  {
    companyId: "jx78h5ac4qbqva6bdfqz9kbn7d87smbh",
    expectedName: "Komeet",
    fields: { siren: "843941733", legalName: "WORK FOR GOOD", sector: "saas", totalShares: 2337296 },
    people: [
      { role: "founder", name: "Félix de Monts", attioRecordId: "3904ea37-a7e2-4a16-9205-75016d703c6c" },
      { role: "founder", name: "Julian Guerin", attioRecordId: "8618fed1-62d3-437c-b77f-0347ad052d69" },
      { role: "founder", name: "Emmanuel Bentejac", attioRecordId: "ea7131dd-2aee-54e3-83d9-c348759276c6" },
      { role: "founder", name: "Thomas Soucaille", attioRecordId: "91ef6d2d-d303-48f5-87cb-1cc3b01938f0" },
      { role: "founder", name: "Aristide Flandrin", attioRecordId: "364f14a6-7b3a-4a20-9e50-54069edadc54" },
      { role: "coinvestor", name: "ABEILLE IMPACT INVESTING FRANCE" },
      { role: "coinvestor", name: "EVOLEM START" },
      { role: "coinvestor", name: "Side Wenabi" },
      { role: "coinvestor", name: "SIDE Invest 3" },
      { role: "coinvestor", name: "Tomcat Wen" },
      { role: "coinvestor", name: "Tomcat Capital" },
    ],
  },
  {
    companyId: "jx7agg7khvm20qt2pryer2rxb987r8w5",
    expectedName: "La vie de Quartier - Holding",
    fields: { siren: "952406973", legalName: "Groupe La Vie de Quartier", sector: "services", domain: "laviedequartier.fr" },
    people: [
      { role: "founder", name: "Vladimir Pierens", attioRecordId: "da5265d5-e31a-45bd-9b9a-9c3fcf9afeeb" },
      { role: "founder", name: "Marion Desmaison" },
      { role: "board", name: "ABSCIS" },
      { role: "board", name: "TUDI HOLDING 155" },
      { role: "coinvestor", name: "Deco Conseil" },
      { role: "coinvestor", name: "ACHERTE" },
      { role: "coinvestor", name: "Clément Hérout", attioRecordId: "86e2ee04-d5cf-4641-97e8-f230c7c9376e" },
      { role: "coinvestor", name: "FX9" },
      { role: "coinvestor", name: "François-Xavier Germain" },
      { role: "coinvestor", name: "Yannick Raba", attioRecordId: "d6a7e8d5-d582-4edb-87d3-3d603941855c" },
    ],
  },
  {
    companyId: "jx7332wvprgbtksfsnsnbvd35d8990c2",
    expectedName: "La Vie de Quartier - Rue du RDV",
    fields: { siren: "103180592", sector: "services" },
  },
  {
    companyId: "jx74e2822v5aazcewpmy94bhb1898xv0",
    expectedName: "La Vie de Quartier - Rue St Maur",
    fields: { siren: "989312145", sector: "services" },
  },
  {
    companyId: "jx7901c7f8zvbm3vryrkgcssmh87rhh3",
    expectedName: "Les constructeurs du bois",
    fields: { siren: "533622775", sector: "realestate" },
  },
  {
    companyId: "jx728f588hby64q8y4c7twcb9587sz2v",
    expectedName: "Losanje",
    fields: { siren: "887845485", sector: "industry", totalShares: 327674 },
    people: [
      { role: "founder", name: "Simon Peyronnaud", attioRecordId: "1f715beb-6f4b-4453-89d6-4dd5933b658e" },
      { role: "founder", name: "Mathieu Khouri", attioRecordId: "f4d65b8e-4fec-4063-9979-59caa808c71f" },
      { role: "board", name: "Simon Peyronnaud", attioRecordId: "1f715beb-6f4b-4453-89d6-4dd5933b658e" },
      { role: "board", name: "Mathieu Khouri", attioRecordId: "f4d65b8e-4fec-4063-9979-59caa808c71f" },
      { role: "board", name: "Alexis Angot", attioRecordId: "8c01ac41-9e42-462a-ba3b-e303a04758ed" },
      { role: "board", name: "Guillaume Blanchet", attioRecordId: "6811915f-fad7-42f0-b1d6-1ca405e5012a" },
      { role: "board", name: "Natacha Prieur", attioRecordId: "802bc76b-e7d5-4b01-8a07-7dff3fd50f25" },
      { role: "board", name: "Julie Resplendino", attioRecordId: "bb4cea32-8a0e-4c19-a3dc-b8416d8ad96e" },
      { role: "board", name: "Pierre-Armand Hurstel", attioRecordId: "1b8a2439-b70d-4d66-baa2-cbbfc63f5a88" },
      { role: "coinvestor", name: "INVEST CREATION 5.0" },
      { role: "coinvestor", name: "CENTRE LOIRE EXPANSION" },
      { role: "coinvestor", name: "HDKL" },
      { role: "coinvestor", name: "OSER BOURGOGNE-FRANCHE-COMTE" },
      { role: "coinvestor", name: "EVOLEM" },
      { role: "coinvestor", name: "GOLDEN SQUARE I" },
      { role: "coinvestor", name: "1001PACT LOSANJE" },
    ],
  },
  {
    companyId: "jx75rezn2rwshzyn7k2s3tq70d88pv9q",
    expectedName: "Oprtrs & Co",
    fields: { siren: "978364602", totalShares: 365000 },
  },
  {
    companyId: "jx78942c82np78n3gvyy7s4e5187s975",
    expectedName: "Ouisub",
    fields: { siren: "939932422", sector: "saas", domain: "ouisub.fr", totalShares: 123332 },
    people: [
      { role: "founder", name: "Éloïse Langer", attioRecordId: "90b62792-cce9-4f49-bce4-11a865924412" },
      { role: "founder", name: "Sylvain Langer", attioRecordId: "d84e31bf-0111-4ced-bb7c-fff3c1566c11" },
      { role: "founder", name: "Thomas Bremond", attioRecordId: "502365b2-e6cf-4423-883d-ad8ac7f7218a" },
      { role: "board", name: "GOOD ONLY VENTURES" },
      { role: "board", name: "Fondation Roi Baudouin" },
      { role: "coinvestor", name: "GOOD ONLY VENTURES" },
      { role: "coinvestor", name: "Fondation Roi Baudouin" },
      { role: "coinvestor", name: "BHAM" },
      { role: "coinvestor", name: "Francisco Hein", attioRecordId: "8ad597a7-33b5-44d3-b275-d81b81b354f0" },
    ],
  },
  {
    companyId: "jx7echr63zj3xb96dbj9tx9wjs87wb01",
    expectedName: "Parallel Invest SPV 10 (Arcachon)",
    fields: { siren: "934104001", legalName: "Parallel Invest SPV10", sector: "realestate" },
    people: [
      { role: "founder", name: "Parallel Invest" },
    ],
  },
  {
    companyId: "jx79g4gypc6wyzq942aecygdmn87wdy6",
    expectedName: "Parallel Invest SPV 13 (Bernay)",
    fields: { siren: "940902265", legalName: "Parallel Invest SPV13", sector: "realestate" },
    people: [
      { role: "founder", name: "Parallel Invest" },
    ],
  },
  {
    companyId: "jx78cdpd6w065rdrxhhh6aryt587xthp",
    expectedName: "Parallel Invest SPV 18 (Bour)",
    fields: { siren: "944179068", legalName: "Parallel Invest SPV18", sector: "realestate" },
    people: [
      { role: "founder", name: "Parallel Invest" },
    ],
  },
  {
    companyId: "jx7dqfnm4j150d7by280axae4x87x15z",
    expectedName: "Parallel Invest SPV 23 (STOA - Pessac)",
    fields: { siren: "999671878", legalName: "Parallel Invest SPV23", sector: "realestate" },
    people: [
      { role: "founder", name: "Parallel Invest" },
    ],
  },
  {
    companyId: "jx7fda6mb1dmpej8zaq9tzy6gd8a7nzw",
    expectedName: "Redesk",
    fields: { siren: "953667987", sector: "marketplace", totalShares: 360000 },
    people: [
      { role: "coinvestor", name: "Pretop" },
      { role: "coinvestor", name: "Clara Lafond", attioRecordId: "0a93496a-f57a-4fa3-b8f7-dd489cdf3a57" },
      { role: "coinvestor", name: "Ticaneo" },
      { role: "coinvestor", name: "STAB Invest" },
    ],
  },
  {
    companyId: "jx71fa19ezp2vzaaj0k09gkmzn87rq97",
    expectedName: "Reekom",
    fields: { siren: "903910396", legalName: "GPConsulting", sector: "services", totalShares: 3025 },
    people: [
      { role: "founder", name: "Guillaume Perret du Cray", attioRecordId: "adbcaca4-971f-490e-aef9-48441fdef996" },
      { role: "founder", name: "Hélène Feugier", attioRecordId: "db8e49a2-26d5-41e4-a90a-e6234b72a8db" },
      { role: "coinvestor", name: "ALPHA STAR S.à r.l." },
    ],
  },
  {
    companyId: "jx774qf54r5v58sxaew582x76587rtmt",
    expectedName: "RegenSchool",
    fields: { siren: "948565759", legalName: "REGEN SCHOOL", sector: "edtech", domain: "regen-school.com", totalShares: 158059 },
    people: [
      { role: "founder", name: "Marie-Sarah Mailliard", attioRecordId: "89c48a3c-2a55-4802-a2f9-4aea2ac0955d" },
      { role: "founder", name: "Arthur Samuel", attioRecordId: "24bdc2d7-3ee5-41a5-8fb6-396ac438cc76" },
      { role: "founder", name: "Piemoutons Holding" },
      { role: "founder", name: "Uvita Partner" },
      { role: "coinvestor", name: "Indefi Capital Management" },
      { role: "coinvestor", name: "Harbour Holding" },
      { role: "coinvestor", name: "BJ Partners" },
      { role: "coinvestor", name: "Financière de Baumont" },
      { role: "coinvestor", name: "Grine Holding" },
      { role: "coinvestor", name: "BEE Holding" },
      { role: "coinvestor", name: "Claude Marie Joseph" },
      { role: "coinvestor", name: "Rodolphe Landemaine", attioRecordId: "08bdf257-8df9-419f-acb9-f2075e73a700" },
      { role: "coinvestor", name: "Laurent Babikian", attioRecordId: "5ba0e472-333b-4318-ad1c-4cbd05d75812" },
      { role: "coinvestor", name: "TM8" },
      { role: "coinvestor", name: "Euthénia" },
      { role: "coinvestor", name: "Aurore Blanc", attioRecordId: "1a78ff45-2dcd-4ef7-8322-944927d2bde0" },
      { role: "coinvestor", name: "FPYMSO" },
      { role: "coinvestor", name: "Bird & Co" },
      { role: "coinvestor", name: "Adrien Roux de Bezieux", attioRecordId: "14dbd370-5948-4ad6-b0ea-b54168dedc87" },
      { role: "coinvestor", name: "Thibault Massiet" },
      { role: "coinvestor", name: "Valérie Loze", attioRecordId: "e1db9107-5d00-4e36-8b18-79debffc6099" },
      { role: "coinvestor", name: "Valérie Michel" },
      { role: "coinvestor", name: "Anouck Barcat", attioRecordId: "1b696d7c-05c1-41e8-b0f4-df8cc2b7b22f" },
      { role: "coinvestor", name: "Bastien Resse", attioRecordId: "c3a4c6a6-247d-41b3-9a6c-115bb1c3d821" },
      { role: "coinvestor", name: "Laurent Blaisonneau", attioRecordId: "7396e209-294e-4c73-a2de-6f18bfb75b82" },
    ],
  },
  {
    companyId: "jx73memhv6nh8qhtpt3e8ytqjx87rvxh",
    expectedName: "Resilience",
    fields: { siren: "893834713", sector: "health", domain: "resilience.care", totalShares: 1887296 },
    people: [
      { role: "founder", name: "Jonathan Benhamou", attioRecordId: "87cd59a1-4dc2-4763-9ba8-beaa340d2f6d" },
      { role: "founder", name: "Nicolas Helleringer" },
      { role: "coinvestor", name: "FPCI Singular Ventures I" },
      { role: "coinvestor", name: "FPCI Sino French Innovation Fund II" },
      { role: "coinvestor", name: "Exor Seeds, LP" },
      { role: "coinvestor", name: "Picus Venture Fund II GmbH & Co. KG" },
      { role: "coinvestor", name: "Picus Capital GmbH" },
      { role: "coinvestor", name: "RRW II Growth SLP" },
      { role: "coinvestor", name: "Seaya Ventures III" },
      { role: "coinvestor", name: "Bijoux Ventures" },
      { role: "coinvestor", name: "Kernel Investissements" },
      { role: "coinvestor", name: "PINCH" },
      { role: "coinvestor", name: "S2D2" },
      { role: "coinvestor", name: "Charles Ferté" },
      { role: "coinvestor", name: "Maria Paz Guzman" },
      { role: "coinvestor", name: "Sacha Poignonnec" },
      { role: "coinvestor", name: "Jean-Marc Bellaiche" },
      { role: "coinvestor", name: "Gregory Swick" },
      { role: "coinvestor", name: "Frédéric Montagnon" },
    ],
  },
  {
    companyId: "jx74fyn7n16pchhsq7eby61dss87sphz",
    expectedName: "Rewatt",
    fields: { siren: "950792473", sector: "realestate" },
    people: [
      { role: "founder", name: "Stephen Morello", attioRecordId: "b72a8ac6-0f7c-4169-878b-22a48fcc2fc9" },
      { role: "founder", name: "Mamoun Idrissi", attioRecordId: "4116bc48-158d-4122-ad8d-c3af03fee350" },
      { role: "board", name: "Clément Alteresco", attioRecordId: "6a5ee326-f052-4c26-ad65-037ab308ec0c" },
    ],
  },
  {
    companyId: "jx7cmgm1g90cyhsyprdsfxbqzd87r8vm",
    expectedName: "RGOODS",
    fields: { siren: "893293969", sector: "saas", domain: "rgoods.com", totalShares: 7200 },
    people: [
      { role: "founder", name: "Marc Ruff", attioRecordId: "b8bfdbe6-5c03-45a4-a49c-dbd078931139" },
      { role: "founder", name: "Marc Pfohl", attioRecordId: "4fa89948-a675-41da-873c-5a256a1ed460" },
      { role: "founder", name: "Antoine-Marie Martel", attioRecordId: "09d71876-cf9e-49c5-a139-e189c07b5b47" },
      { role: "founder", name: "Fabien Bourdier" },
      { role: "coinvestor", name: "NOUVELLE-AQUITAINE CO-INVESTISSEMENT" },
      { role: "coinvestor", name: "WEAVING INVEST" },
      { role: "coinvestor", name: "BETTER ANGLE" },
      { role: "coinvestor", name: "VIVISIO SAS" },
      { role: "coinvestor", name: "FAIR-EQUITY" },
      { role: "coinvestor", name: "ML CAPITAL" },
    ],
  },
  {
    companyId: "jx7fdmxmrmm12w20mydzkdn7fx87xxdd",
    expectedName: "Sezame Immo 2",
    fields: { siren: "942308834", sector: "realestate" },
    people: [
      { role: "founder", name: "Sezame" },
      { role: "coinvestor", name: "AD2C CONSULTING" },
      { role: "coinvestor", name: "CHARLY ANGEL" },
      { role: "coinvestor", name: "Guillaume Autier", attioRecordId: "d43548cc-15dd-49a8-bdd0-7dccb32209a4" },
      { role: "coinvestor", name: "LA FORGE" },
      { role: "coinvestor", name: "SOFIA-FIDES" },
      { role: "coinvestor", name: "Sophie Baly", attioRecordId: "6eb1fd4f-b4ea-41e0-b018-76ef6256208f" },
      { role: "coinvestor", name: "DEVELOPPEMENT ET FINANCE" },
    ],
  },
  {
    companyId: "jx7d3vsve9fqx891gbk6phqgf587wgdn",
    expectedName: "Sezame Immo 6",
    fields: { siren: "102176153", sector: "realestate", totalShares: 1280100 },
    people: [
      { role: "founder", name: "SEZAME" },
      { role: "coinvestor", name: "Financière XT" },
      { role: "coinvestor", name: "Benoit Perrusset", attioRecordId: "4c7b3ab5-da83-469c-9974-ac974ff5f5b2" },
      { role: "coinvestor", name: "MenJo Capital" },
      { role: "coinvestor", name: "DF DEVELOPPEMENT" },
      { role: "coinvestor", name: "ESCADRY" },
      { role: "coinvestor", name: "Yang Zhou" },
      { role: "coinvestor", name: "Rigelia" },
      { role: "coinvestor", name: "XJE Conseil" },
      { role: "coinvestor", name: "Mathieu Batby" },
      { role: "coinvestor", name: "Victoria Sette" },
      { role: "coinvestor", name: "Aurore Bonnet", attioRecordId: "64635a71-c6f6-4ae7-b147-20c33cc3f8b8" },
      { role: "coinvestor", name: "Jordane Giuly" },
      { role: "coinvestor", name: "AD2C Consulting" },
      { role: "coinvestor", name: "DEFI DEVELOPPEMENT ET FINANCE" },
    ],
  },
  {
    companyId: "jx79jwd3y9rmsakghwagm48st187skyz",
    expectedName: "Tango",
    fields: { siren: "978289619", sector: "services" },
    people: [
      { role: "founder", name: "Léa Felix", attioRecordId: "40a36d73-72da-4586-b4a8-6a1bfc6be6ab" },
      { role: "board", name: "Léa Felix", attioRecordId: "40a36d73-72da-4586-b4a8-6a1bfc6be6ab" },
      { role: "board", name: "Pierre Andre", attioRecordId: "cee3cc00-9451-4e24-81a3-18d006af04d2" },
      { role: "board", name: "SURALTA" },
      { role: "board", name: "Frédéric Walther", attioRecordId: "514af859-f20b-40d2-9940-02df0161eebf" },
      { role: "coinvestor", name: "FIREFLIES HOLDING" },
      { role: "coinvestor", name: "Christophe Auger" },
      { role: "coinvestor", name: "Donatien Hastings" },
      { role: "coinvestor", name: "HELIOS" },
      { role: "coinvestor", name: "YOLO" },
      { role: "coinvestor", name: "Giorgio Ricco" },
      { role: "coinvestor", name: "Grégory Schuber", attioRecordId: "e0ba60ee-1af6-4259-8792-ae5fd36c726d" },
      { role: "coinvestor", name: "Marion Lecornu-Monnot" },
      { role: "coinvestor", name: "MAA CONSEIL" },
      { role: "coinvestor", name: "SPARTEL CAPITAL" },
      { role: "coinvestor", name: "Patrick Maurel" },
      { role: "coinvestor", name: "Philippe Tapie" },
      { role: "coinvestor", name: "Pierre Andre", attioRecordId: "cee3cc00-9451-4e24-81a3-18d006af04d2" },
      { role: "coinvestor", name: "GROUPE MONTANA" },
      { role: "coinvestor", name: "KILTERRY" },
      { role: "coinvestor", name: "INFINITE IMPROBABILITY" },
      { role: "coinvestor", name: "BLUE ZONE CAPITAL" },
      { role: "coinvestor", name: "Éric Castelnau" },
      { role: "coinvestor", name: "SURALTA SAS" },
    ],
  },
  {
    companyId: "jx72f9jrbntwwvhvcj026dd7z987sz2n",
    expectedName: "The Fat Broccoli",
    fields: { siren: "981118961", legalName: "The Broccoli Company", sector: "agrifood", totalShares: 158188 },
    people: [
      { role: "founder", name: "MONEYQUE" },
      { role: "founder", name: "Charlotte Chenevier", attioRecordId: "0f1658ca-b374-4e88-bd3b-33e8a321c531" },
      { role: "founder", name: "Antoine Prenaud", attioRecordId: "4f20c479-2f97-4e59-b285-c370364ebfaa" },
      { role: "coinvestor", name: "PYRAMID" },
      { role: "coinvestor", name: "LATKES" },
      { role: "coinvestor", name: "Benjamin Viard", attioRecordId: "0f7f470f-5a11-4ff1-9928-a10d59ae93d5" },
      { role: "coinvestor", name: "NOBIIS" },
      { role: "coinvestor", name: "Marc Durand-Perdriel", attioRecordId: "3f08a15d-0e91-4592-936d-419394edb8a0" },
    ],
  },
  {
    companyId: "jx72bsqr4wr6j5wqzeb2zbwkex87s6tx",
    expectedName: "Upcyclea",
    fields: { siren: "820645091", sector: "climate" },
    people: [
      { role: "founder", name: "Christine Guinebretiere", attioRecordId: "a2a71de0-1610-4460-ae64-b48c712d3dfc" },
    ],
  },
  {
    companyId: "jx71te1271bdq9qt5qpny56zw187rz88",
    expectedName: "Versant",
    fields: { siren: "952014678", legalName: "Sylva AI" },
  },
  {
    companyId: "jx78rdch9avsme496sqg8pw88x87rchk",
    expectedName: "Wandercraft",
    fields: { siren: "788627198" },
  },
  {
    companyId: "jx7dn3qdmqpxthb16q338v2trd87smzy",
    expectedName: "Waro",
    fields: { siren: "899645956", sector: "saas" },
    people: [
      { role: "coinvestor", name: "PYRAMID" },
      { role: "coinvestor", name: "BDH INDUSTRIE" },
      { role: "coinvestor", name: "LEEDO HOLDING LTD" },
      { role: "coinvestor", name: "SPRINGBOARD FINANCE" },
      { role: "coinvestor", name: "SPFPL CAPPUCCIO" },
      { role: "coinvestor", name: "Jean Despax", attioRecordId: "d30f7e73-c59d-43f5-8b41-aed570a6f4d9" },
      { role: "coinvestor", name: "Philippe Centa" },
      { role: "coinvestor", name: "Perrine Fiocchi" },
      { role: "coinvestor", name: "Jacques Calvel" },
      { role: "coinvestor", name: "François Richard" },
      { role: "coinvestor", name: "Aruna Richard" },
    ],
  },
  {
    companyId: "jx7fgc6r15rydb31jpn4jyvc6x88dkmp",
    expectedName: "Wheelee - Loewi",
    fields: { siren: "899308191", legalName: "WHEELEE", sector: "mobility", totalShares: 28443 },
    people: [
      { role: "founder", name: "Diego Level", attioRecordId: "208bb49f-95ab-4bcc-8456-29f8938ca792" },
      { role: "founder", name: "Tanguy Lastennet", attioRecordId: "052ae9a7-d5c8-4d90-85eb-102b668cb7c2" },
      { role: "founder", name: "Vivien Maraquin", attioRecordId: "51f385ae-9efa-49b5-9807-cf09a6e5e10b" },
      { role: "coinvestor", name: "Pierre Castela" },
      { role: "coinvestor", name: "Olivier Garrigue", attioRecordId: "462fccd8-2154-4ab8-a7a8-45b67de4e849" },
      { role: "coinvestor", name: "Guillaume Bonpun" },
      { role: "coinvestor", name: "Valérie Gueulle" },
      { role: "coinvestor", name: "Marie Lafouge" },
      { role: "coinvestor", name: "Keli" },
      { role: "coinvestor", name: "Nathalie Richard" },
      { role: "coinvestor", name: "Roundtable - Loewi - Satgana" },
      { role: "coinvestor", name: "Satgana Fund I SCSp" },
      { role: "coinvestor", name: "ANTLER CE I Fund GmbH & Co. KG" },
      { role: "coinvestor", name: "CENTRALESUPELEC SEED FUND" },
    ],
  },
  {
    companyId: "jx77eqqaeggwwdemjgy20xa4k187r7cv",
    expectedName: "Ziwig",
    fields: { siren: "848079075", sector: "health" },
    people: [
      { role: "founder", name: "Yahya El Mir", attioRecordId: "897fe7f0-87b5-47f4-b4ca-ddbec180f418" },
      { role: "coinvestor", name: "FINANCIERE IDAT" },
      { role: "coinvestor", name: "MALMOUSQUE INVEST" },
      { role: "coinvestor", name: "GAROM FINANCES" },
      { role: "coinvestor", name: "SAINT DIZIER PARTICIPATIONS" },
      { role: "coinvestor", name: "BLUEPRINT INVESTISSEMENTS" },
      { role: "coinvestor", name: "SOLAR BOYZ" },
      { role: "coinvestor", name: "TWISTCORP" },
      { role: "coinvestor", name: "GF MDB" },
      { role: "coinvestor", name: "SUPER SAIYAN MONKEY" },
      { role: "coinvestor", name: "Vincent Fevrier" },
      { role: "coinvestor", name: "Liza Korn" },
      { role: "coinvestor", name: "Alexis de Roquefeuil" },
      { role: "coinvestor", name: "Adrien Fourrier" },
      { role: "coinvestor", name: "Christophe Vattier" },
    ],
  },]

async function getAlboOrg(ctx: Ctx) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
    .unique()
  if (!org) throw new ConvexError('albo_org_not_found')
  return org
}

/**
 * Resolve a patch spec to its company + what would be written. Returns a
 * skip reason instead when the safety checks fail. `sirenConflict` reports
 * a siren that stays unwritten because another org company already uses it.
 */
async function resolvePatch(
  ctx: Ctx,
  orgId: Id<'organizations'>,
  spec: CompanyPatch,
): Promise<
  | {
      company: Doc<'companies'>
      toWrite: Record<string, string | number>
      alreadySet: Array<string>
      peopleToWrite: Array<PersonEntry> | null
      peopleSkipReason: string | null
      sirenConflict: string | null
    }
  | { skip: string }
> {
  const company = await ctx.db.get(
    'companies',
    spec.companyId as Id<'companies'>,
  )
  if (!company) return { skip: 'company_not_found' }
  if (company.orgId !== orgId) return { skip: 'wrong_org' }
  if (company.name !== spec.expectedName)
    return { skip: `name_mismatch (found: ${company.name})` }

  const record = company as unknown as Record<string, unknown>
  const toWrite: Record<string, string | number> = {}
  const alreadySet: Array<string> = []
  let sirenConflict: string | null = null
  for (const [key, value] of Object.entries(spec.fields ?? {})) {
    if (record[key] !== undefined) {
      alreadySet.push(key)
      continue
    }
    // Mirror companies.ts `assertSirenFree`: org-level uniqueness.
    if (key === 'siren') {
      const clash = await ctx.db
        .query('companies')
        .withIndex('by_org_siren', (q) =>
          q.eq('orgId', orgId).eq('siren', value as string),
        )
        .unique()
      if (clash && clash._id !== company._id) {
        sirenConflict = `siren ${value} already used by ${clash.name}`
        continue
      }
    }
    toWrite[key] = value
  }

  let peopleToWrite: Array<PersonEntry> | null = null
  let peopleSkipReason: string | null = null
  if (spec.people && spec.people.length > 0) {
    if (company.people === undefined || company.people.length === 0)
      peopleToWrite = spec.people
    else
      peopleSkipReason = `people already set (${company.people.length} entries)`
  }

  return {
    company,
    toWrite,
    alreadySet,
    peopleToWrite,
    peopleSkipReason,
    sirenConflict,
  }
}

// ─── dryRun — read-only, stopping point before any write ─────────────────────

export const dryRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const plan = []
    const skipped = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({
          companyId: spec.companyId,
          name: spec.expectedName,
          reason: resolved.skip,
        })
        continue
      }
      plan.push({
        name: spec.expectedName,
        companyId: spec.companyId,
        willWrite: resolved.toWrite,
        willWritePeople: resolved.peopleToWrite?.length ?? 0,
        alreadySet: resolved.alreadySet,
        peopleSkipReason: resolved.peopleSkipReason,
        sirenConflict: resolved.sirenConflict,
      })
    }
    return {
      org: org.slug,
      companiesPlanned: plan.length,
      fieldsToWrite: plan.reduce(
        (n, p) => n + Object.keys(p.willWrite).length,
        0,
      ),
      peopleToWrite: plan.reduce((n, p) => n + p.willWritePeople, 0),
      skipped,
      plan,
      note:
        'Lecture seule. Valider ce rapport puis lancer ' +
        'migrations/alboIdentityImport:apply',
    }
  },
})

// ─── apply — writes, idempotent, run after validating the dryRun ─────────────

export const apply = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    let companiesPatched = 0
    let fieldsWritten = 0
    let peopleWritten = 0
    const untouched: Array<string> = []
    const skipped: Array<{ companyId: string; name: string; reason: string }> =
      []
    const sirenConflicts: Array<{ name: string; conflict: string }> = []

    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        skipped.push({
          companyId: spec.companyId,
          name: spec.expectedName,
          reason: resolved.skip,
        })
        continue
      }
      if (resolved.sirenConflict)
        sirenConflicts.push({
          name: spec.expectedName,
          conflict: resolved.sirenConflict,
        })
      const patch: Record<string, unknown> = { ...resolved.toWrite }
      if (resolved.peopleToWrite) patch.people = resolved.peopleToWrite
      const keys = Object.keys(patch)
      if (keys.length === 0) {
        untouched.push(spec.expectedName)
        continue
      }
      await ctx.db.patch(
        'companies',
        resolved.company._id,
        patch as Partial<Doc<'companies'>>,
      )
      companiesPatched++
      fieldsWritten += Object.keys(resolved.toWrite).length
      peopleWritten += resolved.peopleToWrite?.length ?? 0
    }

    return {
      companiesPatched,
      fieldsWritten,
      peopleWritten,
      untouched,
      skipped,
      sirenConflicts,
    }
  },
})

// ─── verify — final post-apply report ────────────────────────────────────────

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await getAlboOrg(ctx)
    const issues = []
    for (const spec of PATCHES) {
      const resolved = await resolvePatch(ctx, org._id, spec)
      if ('skip' in resolved) {
        issues.push({
          name: spec.expectedName,
          companyId: spec.companyId,
          issue: resolved.skip,
        })
        continue
      }
      // After apply, every planned field must be set (toWrite empty except
      // legitimate siren conflicts) and people must be present when planned.
      const missing = Object.keys(resolved.toWrite)
      if (missing.length > 0)
        issues.push({
          name: spec.expectedName,
          companyId: spec.companyId,
          issue: `not_written: ${missing.join(', ')}`,
        })
      if (resolved.peopleToWrite)
        issues.push({
          name: spec.expectedName,
          companyId: spec.companyId,
          issue: 'people_not_written',
        })
      if (resolved.sirenConflict)
        issues.push({
          name: spec.expectedName,
          companyId: spec.companyId,
          issue: `siren_conflict: ${resolved.sirenConflict}`,
        })
    }
    return {
      org: org.slug,
      allOk: issues.length === 0,
      companiesChecked: PATCHES.length,
      issues,
    }
  },
})
