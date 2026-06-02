/**
 * Import one-shot Attio -> Convex : portefeuille Albo Club.
 *
 * Donnees figees depuis Attio le 2026-05-28 (objet `deals` filtre sur
 * label "Albo" + stages Invested/Exit Win, et les `companies` liees).
 * + AUXICARE ajoute post-snapshot (closing 27/05/2026, invest 29/05/2026).
 * Montants en cents EUR, dates en ms epoch UTC (cf. CLAUDE.md).
 *
 * Idempotent : re-upsert sur les ancres natives `attioCompanyId` /
 * `attioDealId` (indexes `by_attio_company_id` / `by_attio_deal_id`).
 * Relancer ne cree aucun doublon.
 *
 *   npx convex run --prod migrations/attioAlboImport:run
 *   npx convex run --prod migrations/attioAlboImport:verify
 *
 * Note : la table `deals` n'a pas de champ `name` ; le nom Attio du deal
 * est prefixe dans `notes` pour ne rien perdre.
 */
import { ConvexError } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

type InstrumentKind = 'share' | 'spv_share' | 'os' | 'oc' | 'royalty' | 'bsa_air'
type DealStatus = 'active' | 'fully_exited'

type AttioCompany = {
  attioCompanyId: string
  name: string
  domain?: string
  countryCode?: string
}

type AttioDeal = {
  attioDealId: string
  attioCompanyId: string
  instrumentKind: InstrumentKind
  status: DealStatus
  committedAmount?: number
  paidAmount?: number
  roundSize?: number
  entryValuation?: number
  signedDate?: number
  exitedDate?: number
  exitProceeds?: number
  notes?: string
}

const COMPANIES: Array<AttioCompany> = [
  { attioCompanyId: "0eeeaa1d-dd39-485b-ae49-38a69e4e9dd5", name: "Reekom", domain: "reekom.fr", countryCode: "FR" },
  { attioCompanyId: "13c90826-4b76-4beb-9458-8495f5f22a89", name: "Ziwig", domain: "ziwig.com", countryCode: "FR" },
  { attioCompanyId: "18040c51-3ac2-41b5-ac63-452e9d8bc65f", name: "BackMarket", domain: "backmarket.com", countryCode: "FR" },
  { attioCompanyId: "1b983a83-6a07-4253-8ab3-0a6e4c908103", name: "Sezame", domain: "hellosezame.com", countryCode: "FR" },
  { attioCompanyId: "1c5aa51f-a87f-4c0e-a741-19e0bfaf2ab1", name: "Auxicare", domain: "auxicare.fr" },
  { attioCompanyId: "221b8dc1-cfac-4fd4-99b6-4008f95b5a5b", name: "Komeet", domain: "komeet.cc", countryCode: "FR" },
  { attioCompanyId: "222761b9-8f1c-4042-bca0-81646bab05ef", name: "RGOODS", domain: "rgoods.com", countryCode: "FR" },
  { attioCompanyId: "24e4e90d-1b7f-440b-b099-5232113d48f5", name: "Keenest", domain: "keenest.co" },
  { attioCompanyId: "3070ff5d-df62-4b57-b70c-2a1b8c865ca5", name: "Hectarea", domain: "hectarea.io" },
  { attioCompanyId: "315554ad-1087-4e6f-b739-fac4226e4dd0", name: "Genomines", domain: "genomines.com", countryCode: "FR" },
  { attioCompanyId: "35389e11-4c46-45e5-82f3-170fb201586d", name: "Versant", domain: "versant.earth" },
  { attioCompanyId: "39b176b0-8437-454d-920d-c5d5018efb48", name: "Eben Home", domain: "ebenhome.co", countryCode: "FR" },
  { attioCompanyId: "3a01b04c-dd5f-44f5-ad3e-7384667913ca", name: "Cockpit Agriculture", domain: "cockpit-agriculture.com" },
  { attioCompanyId: "3b410d44-3a53-4001-a2f9-006a297f5dc7", name: "Parallel Invest", domain: "parallel-invest.com" },
  { attioCompanyId: "4bd6e544-da31-4733-9de5-3bc2689e3a63", name: "Ouisub", domain: "ouisub.fr", countryCode: "FR" },
  { attioCompanyId: "5ac61b47-c178-47f2-bbc5-2b5a00024bd5", name: "Resilience", domain: "resilience.care", countryCode: "FR" },
  { attioCompanyId: "66948533-a20a-4896-97ec-1f82944730bd", name: "La vie de quartier", domain: "laviedequartier.fr", countryCode: "FR" },
  { attioCompanyId: "76774d0b-0fda-4f38-a0e0-14d53fba7728", name: "ACT Running", domain: "act-running.com", countryCode: "US" },
  { attioCompanyId: "84041054-6ac6-4fbc-8fe3-f2aac4247569", name: "Waro", domain: "waro.io", countryCode: "FR" },
  { attioCompanyId: "8ab58305-917f-43d2-b254-b7f8206e264e", name: "Wandercraft", domain: "wandercraft.eu", countryCode: "FR" },
  { attioCompanyId: "916561ed-1a5b-56a1-9d95-0cf9dc0666f6", name: "Goodvest", domain: "goodvest.fr", countryCode: "FR" },
  { attioCompanyId: "a081436a-5a22-438d-8d1d-d3c0d7d3d64c", name: "Les constructeurs du bois", domain: "lesconstructeursdubois.fr", countryCode: "FR" },
  { attioCompanyId: "a7ca5478-f12f-48d7-8076-e2192968f69e", name: "CarbonFarm", domain: "carbonfarm.tech", countryCode: "FR" },
  { attioCompanyId: "ad47dda2-d87a-4e2e-82eb-d8461e266e16", name: "AZmed", domain: "azmed.co", countryCode: "FR" },
  { attioCompanyId: "b61572d7-bffd-47e3-b5c4-c45f635334ef", name: "Beyond Green", domain: "beyond-green.org" },
  { attioCompanyId: "b8e2cb65-7319-45f6-b9f7-6a0b831b31f1", name: "Rewatt", domain: "rewatt.fr" },
  { attioCompanyId: "b9f86c9f-3473-488f-be70-99272f5038b3", name: "Upcyclea", domain: "upcyclea.com", countryCode: "GB" },
  { attioCompanyId: "be86640b-5a05-43c4-ba81-ba26e0ae9434", name: "JOONE Paris", domain: "joone.fr", countryCode: "FR" },
  { attioCompanyId: "c3ebdfd2-cb53-44df-91c4-ad8151a8c163", name: "Tango", domain: "tango.fr", countryCode: "FR" },
  { attioCompanyId: "c3fe2650-8003-4b9e-b361-8d19fdc645ba", name: "Losanje", domain: "losanje.com", countryCode: "FR" },
  { attioCompanyId: "d5b7a0a1-a940-4cf1-b430-3b40dffd6415", name: "The Fat Broccoli", domain: "thefatbroccoli.com", countryCode: "FR" },
  { attioCompanyId: "d8dfc419-396d-46a2-b48c-9c6a778b798d", name: "RegenSchool", domain: "regen-school.com", countryCode: "FR" },
  { attioCompanyId: "f12eb314-25fd-47f7-b7e4-1dcd9227cfec", name: "Eclo Beauty", domain: "eclobeauty.com", countryCode: "FR" },
  { attioCompanyId: "fc6463e3-e19d-40a2-a170-93454a98c3a3", name: "Bleen", domain: "mybleen.com", countryCode: "FR" },
  { attioCompanyId: "fe5adb94-c4b6-4782-9bd2-3d1d29353b54", name: "Jeen", domain: "jeen.care", countryCode: "FR" },
]

const DEALS: Array<AttioDeal> = [
  { attioDealId: "01771c85-db7d-4de3-ad13-5badacbd63b8", attioCompanyId: "b8e2cb65-7319-45f6-b9f7-6a0b831b31f1", instrumentKind: "os", status: "active", committedAmount: 11500000, paidAmount: 11500000, roundSize: 52500000, signedDate: 1771977600000, notes: "Rewatt - 16 rue Boursault" },
  { attioDealId: "0aa17f81-32a7-4bf1-a92e-37a6e6c21254", attioCompanyId: "a7ca5478-f12f-48d7-8076-e2192968f69e", instrumentKind: "share", status: "active", committedAmount: 15000000, paidAmount: 15000000, roundSize: 400000000, entryValuation: 2000000000, notes: "Carbonfarm - Seed - Intro Racine 2" },
  { attioDealId: "109888bb-02c0-4a7b-92ec-96b25ad40943", attioCompanyId: "fe5adb94-c4b6-4782-9bd2-3d1d29353b54", instrumentKind: "oc", status: "active", committedAmount: 5000000, paidAmount: 5000000, roundSize: 75000000, signedDate: 1766016000000, notes: "Jeen" },
  { attioDealId: "11eefcc0-6ce6-45a3-bde1-a78060572024", attioCompanyId: "8ab58305-917f-43d2-b254-b7f8206e264e", instrumentKind: "spv_share", status: "active", committedAmount: 5000000, paidAmount: 5000000, roundSize: 5000000000, entryValuation: 15000000000, signedDate: 1745798400000, notes: "Wandercraft\npas de CA" },
  { attioDealId: "143fc41d-474d-4985-b9f7-862d59c6c1bd", attioCompanyId: "66948533-a20a-4896-97ec-1f82944730bd", instrumentKind: "royalty", status: "active", committedAmount: 5000000, paidAmount: 5000000, signedDate: 1776297600000, notes: "La vie de quartier - Royalites Tranche 2" },
  { attioDealId: "23482814-6d03-4355-8849-16ef12bccf31", attioCompanyId: "76774d0b-0fda-4f38-a0e0-14d53fba7728", instrumentKind: "share", status: "active", committedAmount: 2504000, paidAmount: 2504000, roundSize: 14392000, entryValuation: 240000000, signedDate: 1757030400000, notes: "ACT Running\nCA d'après report SS25" },
  { attioDealId: "246d894b-19b3-4750-ba3d-757b775bd867", attioCompanyId: "39b176b0-8437-454d-920d-c5d5018efb48", instrumentKind: "spv_share", status: "active", committedAmount: 1060000, paidAmount: 1060000, roundSize: 35000000, signedDate: 1775001600000, notes: "Pro-rata SPV (maintient régime mère-fille)" },
  { attioDealId: "24a1198f-372c-41a9-b5a3-db09ad25e65f", attioCompanyId: "1b983a83-6a07-4253-8ab3-0a6e4c908103", instrumentKind: "share", status: "fully_exited", committedAmount: 10000000, paidAmount: 10000000, signedDate: 1743120000000, exitedDate: 1775001600000, exitProceeds: 1000, notes: "Sezame immo 2 - Albo" },
  { attioDealId: "386f6fba-6d90-4b0d-bbd5-d34635fae64f", attioCompanyId: "fc6463e3-e19d-40a2-a170-93454a98c3a3", instrumentKind: "share", status: "active", committedAmount: 5022000, paidAmount: 5022000, roundSize: 39196800, entryValuation: 500004200, signedDate: 1734307200000, notes: "Bleen\nCA 2024" },
  { attioDealId: "3922494a-44a4-4da4-8f6d-4232b072a413", attioCompanyId: "35389e11-4c46-45e5-82f3-170fb201586d", instrumentKind: "spv_share", status: "active", committedAmount: 2500000, paidAmount: 2500000, roundSize: 40000000, entryValuation: 250000000, signedDate: 1736726400000, notes: "Versant\npas de CA" },
  { attioDealId: "3d2d9ae5-5078-4e6a-a971-7f7e22c49032", attioCompanyId: "d5b7a0a1-a940-4cf1-b430-3b40dffd6415", instrumentKind: "royalty", status: "active", committedAmount: 5000000, paidAmount: 5000000, roundSize: 60000000, signedDate: 1750032000000, notes: "The Fat Broccoli" },
  { attioDealId: "3e78f73d-28dc-4219-8718-89f056c3e48d", attioCompanyId: "3b410d44-3a53-4001-a2f9-006a297f5dc7", instrumentKind: "os", status: "active", committedAmount: 10000000, paidAmount: 10000000, roundSize: 180000000, signedDate: 1765411200000, notes: "Parallel - SPV18 Bour" },
  { attioDealId: "4067a83c-d76e-4fb0-bc65-ea8a45f76a32", attioCompanyId: "1c5aa51f-a87f-4c0e-a741-19e0bfaf2ab1", instrumentKind: "share", status: "active", committedAmount: 10000200, paidAmount: 10000200, roundSize: 56000000, entryValuation: 370955200, signedDate: 1780012800000, notes: "Auxicare - Seed - 14 286 Actions S3 à 7€ = 2,34% FD post-money. Lead Antler. Closing 27/05/2026, pacte DocuSign signé." },
  { attioDealId: "45a91814-87fc-4f5a-b9f1-ad438c84e3da", attioCompanyId: "5ac61b47-c178-47f2-bbc5-2b5a00024bd5", instrumentKind: "share", status: "active", committedAmount: 24997760, paidAmount: 24997760, roundSize: 400014740, entryValuation: 12000000000, signedDate: 1730332800000, notes: "Resilience\nturnover ARR forceast deck" },
  { attioDealId: "46b513b2-e234-425b-b9ab-2b9bd4acec9b", attioCompanyId: "a081436a-5a22-438d-8d1d-d3c0d7d3d64c", instrumentKind: "os", status: "active", committedAmount: 20000000, paidAmount: 20000000, roundSize: 50000000, signedDate: 1738195200000, notes: "Les constructeurs du bois" },
  { attioDealId: "49b441fe-da97-4b2b-98e8-9482be950e06", attioCompanyId: "be86640b-5a05-43c4-ba81-ba26e0ae9434", instrumentKind: "royalty", status: "active", committedAmount: 30000000, paidAmount: 30000000, roundSize: 200000000, signedDate: 1753747200000, notes: "JOONE Paris - Royalties" },
  { attioDealId: "56cb86ac-e7eb-4ac1-944d-b10ce746f552", attioCompanyId: "f12eb314-25fd-47f7-b7e4-1dcd9227cfec", instrumentKind: "bsa_air", status: "active", committedAmount: 10000000, paidAmount: 10000000, roundSize: 40000000, entryValuation: 400000000, signedDate: 1744934400000, notes: "Eclo Beauty" },
  { attioDealId: "5caddfc5-3895-4956-b981-8b115bfc1637", attioCompanyId: "18040c51-3ac2-41b5-ac63-452e9d8bc65f", instrumentKind: "spv_share", status: "active", committedAmount: 8500000, paidAmount: 8500000, roundSize: 60000000, entryValuation: 300000000000, signedDate: 1765929600000, notes: "BackMarket - SPV Teampact" },
  { attioDealId: "63a703a2-1eb5-4f59-9f29-c95a8680604b", attioCompanyId: "c3fe2650-8003-4b9e-b361-8d19fdc645ba", instrumentKind: "share", status: "active", committedAmount: 2500567, paidAmount: 2500567, roundSize: 162507600, entryValuation: 573738844, signedDate: 1743465600000, notes: "Losanje - Serie A\nturnover CA deck" },
  { attioDealId: "69576e33-9b99-4165-8d8e-994e88d5241e", attioCompanyId: "4bd6e544-da31-4733-9de5-3bc2689e3a63", instrumentKind: "share", status: "active", committedAmount: 10000000, paidAmount: 10000000, roundSize: 50000000, entryValuation: 185000000, signedDate: 1763078400000, notes: "Ouisub - Financements publics et privés pour les associations" },
  { attioDealId: "7043bc69-8a63-444f-a2ce-1193e88112a5", attioCompanyId: "b9f86c9f-3473-488f-be70-99272f5038b3", instrumentKind: "spv_share", status: "active", committedAmount: 7500000, paidAmount: 7500000, roundSize: 120000000, entryValuation: 590000000, signedDate: 1731024000000, notes: "Upcyclea\nturnover deck" },
  { attioDealId: "704c7cfe-5057-4545-add1-a277160651ea", attioCompanyId: "0eeeaa1d-dd39-485b-ae49-38a69e4e9dd5", instrumentKind: "share", status: "active", committedAmount: 9915256, paidAmount: 9915256, roundSize: 200000000, entryValuation: 450000000, signedDate: 1744848000000, notes: "Reekom\nturnover CA BP" },
  { attioDealId: "7c5b3e47-2437-4b4e-bd2c-c38c6f65252a", attioCompanyId: "c3ebdfd2-cb53-44df-91c4-ad8151a8c163", instrumentKind: "share", status: "active", committedAmount: 2499000, paidAmount: 2499000, roundSize: 35000000, entryValuation: 210000000, signedDate: 1765843200000, notes: "Tango - Seed" },
  { attioDealId: "80fca1ca-1882-4496-8fdd-ba86f069f2ef", attioCompanyId: "3070ff5d-df62-4b57-b70c-2a1b8c865ca5", instrumentKind: "spv_share", status: "active", committedAmount: 15000000, paidAmount: 15000000, roundSize: 130000000, entryValuation: 400000000, signedDate: 1774828800000, notes: "Hectarea SPV - Albo Club" },
  { attioDealId: "8275865b-ecd4-456f-9dd6-5505a94e76d9", attioCompanyId: "3a01b04c-dd5f-44f5-ad3e-7384667913ca", instrumentKind: "share", status: "active", committedAmount: 4995200, paidAmount: 4995200, roundSize: 100000000, entryValuation: 280000000, signedDate: 1754611200000, notes: "Cockpit Agriculture\npas de CA" },
  { attioDealId: "830988b4-5eaf-4b71-9f87-74923a2aeee5", attioCompanyId: "66948533-a20a-4896-97ec-1f82944730bd", instrumentKind: "royalty", status: "active", committedAmount: 5000000, paidAmount: 5000000, signedDate: 1750032000000, notes: "La vie de quartier - Royalties tranche 1" },
  { attioDealId: "87ef672c-bcbc-4f0e-9a38-3d6dcaa065f1", attioCompanyId: "ad47dda2-d87a-4e2e-82eb-d8461e266e16", instrumentKind: "spv_share", status: "active", committedAmount: 7500000, paidAmount: 7500000, roundSize: 100000000, entryValuation: 2100000000, signedDate: 1731369600000, notes: "AZmed\nrevenues pas accessibles sur BP" },
  { attioDealId: "8954c5d0-08d8-4486-9390-8d9f3ede17f1", attioCompanyId: "3b410d44-3a53-4001-a2f9-006a297f5dc7", instrumentKind: "os", status: "active", committedAmount: 10000000, paidAmount: 10000000, roundSize: 250000000, signedDate: 1741219200000, notes: "Parallel Invest SPV 13 - Bernay - Albo" },
  { attioDealId: "9a420950-4521-47c6-aa5b-506665d15416", attioCompanyId: "13c90826-4b76-4beb-9458-8495f5f22a89", instrumentKind: "spv_share", status: "active", committedAmount: 25263777, paidAmount: 25263777, roundSize: 974992304, entryValuation: 9584132400, signedDate: 1733356800000, notes: "Ziwig - Serie A" },
  { attioDealId: "9ed05e0a-b0eb-48ce-bb45-55e45e7ed2ee", attioCompanyId: "39b176b0-8437-454d-920d-c5d5018efb48", instrumentKind: "spv_share", status: "active", committedAmount: 100000, paidAmount: 100000, roundSize: 50000000, signedDate: 1760313600000, notes: "SPV Eben home - Albo Club" },
  { attioDealId: "aba09139-1635-46e7-b69b-15ba81911303", attioCompanyId: "3b410d44-3a53-4001-a2f9-006a297f5dc7", instrumentKind: "os", status: "active", committedAmount: 20000000, paidAmount: 20000000, roundSize: 400000000, signedDate: 1733702400000, notes: "Parallel Invest SPV 10 - Arcachon" },
  { attioDealId: "b90481c0-8edd-4738-a758-c16dc3d51f10", attioCompanyId: "315554ad-1087-4e6f-b739-fac4226e4dd0", instrumentKind: "spv_share", status: "active", committedAmount: 3000000, paidAmount: 3000000, roundSize: 4000000000, entryValuation: 4136000000, signedDate: 1752969600000, notes: "Genomines - Série B\npas de CA" },
  { attioDealId: "c0bcbc8d-dea8-4512-8860-b95ee7b4babe", attioCompanyId: "222761b9-8f1c-4042-bca0-81646bab05ef", instrumentKind: "share", status: "active", committedAmount: 9225000, paidAmount: 9225000, roundSize: 45000000, entryValuation: 500000000, signedDate: 1733097600000, notes: "RGOODS\nturnover : deck" },
  { attioDealId: "c63d85fb-788d-4eea-9fe1-99f286fd4dc6", attioCompanyId: "221b8dc1-cfac-4fd4-99b6-4008f95b5a5b", instrumentKind: "share", status: "active", committedAmount: 7500000, paidAmount: 7500000, roundSize: 55000000, entryValuation: 2160000000, signedDate: 1765152000000, notes: "Komeet - Buildup externe" },
  { attioDealId: "dae23ceb-e178-49ff-8b98-a9306b126436", attioCompanyId: "b8e2cb65-7319-45f6-b9f7-6a0b831b31f1", instrumentKind: "os", status: "fully_exited", committedAmount: 31000000, paidAmount: 31000000, roundSize: 40000000, entryValuation: 58000000, signedDate: 1746144000000, exitedDate: 1772236800000, exitProceeds: 32627500, notes: "Rewatt - Albo Club\nmontant du retour + colonne calcul : 326275 / date exit 8 février 2026" },
  { attioDealId: "dea72272-ca6a-4ab6-8b14-f8d42d6cfb19", attioCompanyId: "3b410d44-3a53-4001-a2f9-006a297f5dc7", instrumentKind: "os", status: "active", committedAmount: 10000000, paidAmount: 10000000, roundSize: 200000000, signedDate: 1777420800000, notes: "SPV 23 STOA - Pessac (Dette Senior via Parallel)" },
  { attioDealId: "e2d8ea09-1280-40a1-9f51-d8b0a835c290", attioCompanyId: "66948533-a20a-4896-97ec-1f82944730bd", instrumentKind: "share", status: "active", committedAmount: 5350700, paidAmount: 5350700, roundSize: 50002500, entryValuation: 270000000, signedDate: 1749081600000, notes: "La vie de quartier - Share\nturnover dans BP" },
  { attioDealId: "e462e96d-5c51-4ebf-90bc-0306667cdb2a", attioCompanyId: "84041054-6ac6-4fbc-8fe3-f2aac4247569", instrumentKind: "share", status: "active", committedAmount: 7500000, paidAmount: 7500000, roundSize: 39000000, entryValuation: 340000000, signedDate: 1732752000000, notes: "Waro - Seed\nConversion OCA2024(1) → 240 actions ordinaires (15/04/2026). Principal 75k€ + intérêts 6 203,37€ = créance compensée 81 203,37€. Soulte rompu à recevoir : 69,95€. Valo conversion : 3.4M€ post-décote (25%). ⚠️ DocuSign envelope A7EC7126 à signer (lettre conversion + bulletin souscription)." },
  { attioDealId: "ed54959b-055e-4af0-a4e6-4c858c9ae9b3", attioCompanyId: "24e4e90d-1b7f-440b-b099-5232113d48f5", instrumentKind: "spv_share", status: "active", committedAmount: 2500000, paidAmount: 2500000, roundSize: 50000000, entryValuation: 450000000, signedDate: 1741910400000, notes: "Keenest - Pre-Seed" },
  { attioDealId: "f1f5daf6-ef86-46fe-a57c-3b9dcaed3b8a", attioCompanyId: "1b983a83-6a07-4253-8ab3-0a6e4c908103", instrumentKind: "spv_share", status: "active", committedAmount: 8000000, paidAmount: 8000000, roundSize: 128000000, entryValuation: 120000000, signedDate: 1776124800000, notes: "Sezame immo 6" },
  { attioDealId: "f5eac901-44c9-44c9-8145-c1d43b28dde8", attioCompanyId: "d5b7a0a1-a940-4cf1-b430-3b40dffd6415", instrumentKind: "share", status: "active", committedAmount: 500000, paidAmount: 500000, roundSize: 5950400, entryValuation: 120000000, signedDate: 1752796800000, notes: "The Fat Broccoli\nturnover dans BP super capital" },
  { attioDealId: "f81bc9ec-1ac8-4092-82d3-212dcc47ca37", attioCompanyId: "d8dfc419-396d-46a2-b48c-9c6a778b798d", instrumentKind: "share", status: "active", committedAmount: 4997680, paidAmount: 4997680, roundSize: 200000280, entryValuation: 1000000000, signedDate: 1749081600000, notes: "RegenSchool\nturnover : expected revenus sur deck" },
  { attioDealId: "f9bfdfd7-7d98-4156-a16a-a3f02ade7c84", attioCompanyId: "b61572d7-bffd-47e3-b5c4-c45f635334ef", instrumentKind: "share", status: "active", committedAmount: 4997856, paidAmount: 4997856, roundSize: 109072400, entryValuation: 539336144, signedDate: 1739923200000, notes: "Beyond Green\nturnover : CA sur deck" },
  { attioDealId: "f9f901e4-94a8-4548-84d4-20045cf22f6b", attioCompanyId: "916561ed-1a5b-56a1-9d95-0cf9dc0666f6", instrumentKind: "share", status: "active", committedAmount: 25005840, paidAmount: 25005840, roundSize: 1200000000, entryValuation: 2582511700, signedDate: 1754006400000, notes: "Goodvest" },
]

const ORG_SLUG = 'albo'

/** Strip `undefined` keys so patch() never deletes optional fields on re-run. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
      .unique()
    if (!org) throw new ConvexError('albo_org_not_found')

    const investor = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'group_root'),
      )
      .first()
    if (!investor) throw new ConvexError('albo_group_root_not_found')

    // ── companies ──────────────────────────────────────────────────────────
    const companyIdByAttio = new Map<string, Id<'companies'>>()
    let companiesInserted = 0
    let companiesPatched = 0
    for (const c of COMPANIES) {
      const fields = clean({
        orgId: org._id,
        name: c.name,
        kind: 'portfolio' as const,
        attioCompanyId: c.attioCompanyId,
        domain: c.domain,
        countryCode: c.countryCode,
      })
      const existing = await ctx.db
        .query('companies')
        .withIndex('by_attio_company_id', (q) =>
          q.eq('attioCompanyId', c.attioCompanyId),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        companyIdByAttio.set(c.attioCompanyId, existing._id)
        companiesPatched++
      } else {
        const id = await ctx.db.insert('companies', fields)
        companyIdByAttio.set(c.attioCompanyId, id)
        companiesInserted++
      }
    }

    // ── deals ──────────────────────────────────────────────────────────────
    let dealsInserted = 0
    let dealsPatched = 0
    for (const d of DEALS) {
      const targetCompanyId = companyIdByAttio.get(d.attioCompanyId)
      if (!targetCompanyId) {
        throw new ConvexError(`target_company_not_found:${d.attioCompanyId}`)
      }
      const fields = clean({
        orgId: org._id,
        investorCompanyId: investor._id,
        targetCompanyId,
        instrumentKind: d.instrumentKind,
        currency: 'EUR',
        committedAmount: d.committedAmount,
        paidAmount: d.paidAmount,
        roundSize: d.roundSize,
        entryValuation: d.entryValuation,
        signedDate: d.signedDate,
        exitedDate: d.exitedDate,
        exitProceeds: d.exitProceeds,
        status: d.status,
        attioDealId: d.attioDealId,
        notes: d.notes,
      })
      const existing = await ctx.db
        .query('deals')
        .withIndex('by_attio_deal_id', (q) =>
          q.eq('attioDealId', d.attioDealId),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, fields)
        dealsPatched++
      } else {
        await ctx.db.insert('deals', fields)
        dealsInserted++
      }
    }

    return {
      companiesInserted,
      companiesPatched,
      dealsInserted,
      dealsPatched,
      sourceCompanies: COMPANIES.length,
      sourceDeals: DEALS.length,
    }
  },
})

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', ORG_SLUG))
      .unique()
    if (!org) throw new ConvexError('albo_org_not_found')

    const portfolio = await ctx.db
      .query('companies')
      .withIndex('by_org_kind', (q) =>
        q.eq('orgId', org._id).eq('kind', 'portfolio'),
      )
      .collect()
    const portfolioWithAttio = portfolio.filter((c) => c.attioCompanyId)

    const deals = await ctx.db
      .query('deals')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .collect()
    const dealsWithAttio = deals.filter((d) => d.attioDealId)

    const sample = []
    for (const d of dealsWithAttio.slice(0, 6)) {
      const target = await ctx.db.get(d.targetCompanyId)
      sample.push({
        attioDealId: d.attioDealId,
        target: target?.name ?? null,
        status: d.status,
        instrumentKind: d.instrumentKind,
        committedAmount: d.committedAmount,
        exitProceeds: d.exitProceeds,
      })
    }

    return {
      portfolioCompanies: portfolioWithAttio.length,
      deals: dealsWithAttio.length,
      exited: dealsWithAttio.filter((d) => d.status === 'fully_exited').length,
      sample,
    }
  },
})
