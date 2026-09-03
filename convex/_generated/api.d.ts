/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agent from "../agent.js";
import type * as agentTools from "../agentTools.js";
import type * as agentToolsDebt from "../agentToolsDebt.js";
import type * as agentToolsDocuments from "../agentToolsDocuments.js";
import type * as agentToolsForecasts from "../agentToolsForecasts.js";
import type * as agentToolsIntelligence from "../agentToolsIntelligence.js";
import type * as agentToolsLiabilities from "../agentToolsLiabilities.js";
import type * as agentToolsPointage from "../agentToolsPointage.js";
import type * as agentToolsProductDocs from "../agentToolsProductDocs.js";
import type * as agentToolsProjections from "../agentToolsProjections.js";
import type * as agentToolsReports from "../agentToolsReports.js";
import type * as agentToolsValuations from "../agentToolsValuations.js";
import type * as agentmail from "../agentmail.js";
import type * as aggregate from "../aggregate.js";
import type * as airtableImport from "../airtableImport.js";
import type * as attio from "../attio.js";
import type * as attioSync from "../attioSync.js";
import type * as auth from "../auth.js";
import type * as cash from "../cash.js";
import type * as chat from "../chat.js";
import type * as companies from "../companies.js";
import type * as companyEnrichment from "../companyEnrichment.js";
import type * as companyReports from "../companyReports.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deals from "../deals.js";
import type * as documents from "../documents.js";
import type * as documentsClassify from "../documentsClassify.js";
import type * as documentsExtract from "../documentsExtract.js";
import type * as email from "../email.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as files from "../files.js";
import type * as forecasts from "../forecasts.js";
import type * as guarantees from "../guarantees.js";
import type * as http from "../http.js";
import type * as intelligence from "../intelligence.js";
import type * as investments from "../investments.js";
import type * as invitations from "../invitations.js";
import type * as kpis from "../kpis.js";
import type * as liabilities from "../liabilities.js";
import type * as lib_agentScope from "../lib/agentScope.js";
import type * as lib_airtableForecasts from "../lib/airtableForecasts.js";
import type * as lib_amortization from "../lib/amortization.js";
import type * as lib_attioSync from "../lib/attioSync.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authInvite from "../lib/authInvite.js";
import type * as lib_bankAccounts from "../lib/bankAccounts.js";
import type * as lib_categories from "../lib/categories.js";
import type * as lib_categoryRules from "../lib/categoryRules.js";
import type * as lib_connectors from "../lib/connectors.js";
import type * as lib_docBackfill from "../lib/docBackfill.js";
import type * as lib_docsend from "../lib/docsend.js";
import type * as lib_documentBlobs from "../lib/documentBlobs.js";
import type * as lib_documentTexts from "../lib/documentTexts.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_duplicates from "../lib/duplicates.js";
import type * as lib_emailIdentify from "../lib/emailIdentify.js";
import type * as lib_excel from "../lib/excel.js";
import type * as lib_fileText from "../lib/fileText.js";
import type * as lib_guarantees from "../lib/guarantees.js";
import type * as lib_instructions from "../lib/instructions.js";
import type * as lib_instrumentMapping from "../lib/instrumentMapping.js";
import type * as lib_instruments from "../lib/instruments.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_liabilities from "../lib/liabilities.js";
import type * as lib_matchingLog from "../lib/matchingLog.js";
import type * as lib_metricCatalog from "../lib/metricCatalog.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_modelRetry from "../lib/modelRetry.js";
import type * as lib_modules from "../lib/modules.js";
import type * as lib_notificationPrefs from "../lib/notificationPrefs.js";
import type * as lib_notion from "../lib/notion.js";
import type * as lib_ocr from "../lib/ocr.js";
import type * as lib_people from "../lib/people.js";
import type * as lib_pitch from "../lib/pitch.js";
import type * as lib_pointage from "../lib/pointage.js";
import type * as lib_powensAccounts from "../lib/powensAccounts.js";
import type * as lib_productDocs from "../lib/productDocs.js";
import type * as lib_properties from "../lib/properties.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_reportAnalysis from "../lib/reportAnalysis.js";
import type * as lib_reportFreshness from "../lib/reportFreshness.js";
import type * as lib_reportLinks from "../lib/reportLinks.js";
import type * as lib_reportNotifyArgs from "../lib/reportNotifyArgs.js";
import type * as lib_reportPeriod from "../lib/reportPeriod.js";
import type * as lib_reportPrompts from "../lib/reportPrompts.js";
import type * as lib_reportRecipients from "../lib/reportRecipients.js";
import type * as lib_reportRouting from "../lib/reportRouting.js";
import type * as lib_reportSenders from "../lib/reportSenders.js";
import type * as lib_reportSource from "../lib/reportSource.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_sectors from "../lib/sectors.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_transfers from "../lib/transfers.js";
import type * as lib_userPrefs from "../lib/userPrefs.js";
import type * as lib_vat from "../lib/vat.js";
import type * as lib_vectorizeErrors from "../lib/vectorizeErrors.js";
import type * as lib_weeklyDigest from "../lib/weeklyDigest.js";
import type * as lib_xirr from "../lib/xirr.js";
import type * as loans from "../loans.js";
import type * as mcp_queries from "../mcp/queries.js";
import type * as mcp_registry from "../mcp/registry.js";
import type * as mcp_server from "../mcp/server.js";
import type * as migrations_alboDocBackfill from "../migrations/alboDocBackfill.js";
import type * as migrations_alboIdentityImport from "../migrations/alboIdentityImport.js";
import type * as migrations_alboInstrumentImport from "../migrations/alboInstrumentImport.js";
import type * as migrations_alboOneLinerImport from "../migrations/alboOneLinerImport.js";
import type * as migrations_alboReportsImport from "../migrations/alboReportsImport.js";
import type * as migrations_alboSummaryImport from "../migrations/alboSummaryImport.js";
import type * as migrations_archiveCalteBlockedCards from "../migrations/archiveCalteBlockedCards.js";
import type * as migrations_attioAlboImport from "../migrations/attioAlboImport.js";
import type * as migrations_backfillCompanyEnrichment from "../migrations/backfillCompanyEnrichment.js";
import type * as migrations_backfillReportFreshness from "../migrations/backfillReportFreshness.js";
import type * as migrations_calteInstrumentImport from "../migrations/calteInstrumentImport.js";
import type * as migrations_cleanupCalteImport from "../migrations/cleanupCalteImport.js";
import type * as migrations_cleanupCalteOrphanCompanies from "../migrations/cleanupCalteOrphanCompanies.js";
import type * as migrations_collapseGroupKinds from "../migrations/collapseGroupKinds.js";
import type * as migrations_consolidateRewattCalte from "../migrations/consolidateRewattCalte.js";
import type * as migrations_createSubsidiaryOrgs from "../migrations/createSubsidiaryOrgs.js";
import type * as migrations_externalConnections from "../migrations/externalConnections.js";
import type * as migrations_fixLoanDirection from "../migrations/fixLoanDirection.js";
import type * as migrations_fixSpvPitches from "../migrations/fixSpvPitches.js";
import type * as migrations_legalDocsImport from "../migrations/legalDocsImport.js";
import type * as migrations_mergePalatineAccount from "../migrations/mergePalatineAccount.js";
import type * as migrations_normalizeCompanyDomains from "../migrations/normalizeCompanyDomains.js";
import type * as migrations_normalizeSectors from "../migrations/normalizeSectors.js";
import type * as migrations_purgeStrayOrgs from "../migrations/purgeStrayOrgs.js";
import type * as migrations_reassignClimateHouseCofoDeals from "../migrations/reassignClimateHouseCofoDeals.js";
import type * as migrations_reassignDealOrg from "../migrations/reassignDealOrg.js";
import type * as migrations_splitAlboSponsorSpvs from "../migrations/splitAlboSponsorSpvs.js";
import type * as migrations_unifyDomainPitches from "../migrations/unifyDomainPitches.js";
import type * as modules from "../modules.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as powens from "../powens.js";
import type * as projections from "../projections.js";
import type * as properties from "../properties.js";
import type * as publicConfig from "../publicConfig.js";
import type * as rateLimiters from "../rateLimiters.js";
import type * as reportExtract from "../reportExtract.js";
import type * as reportIdentify from "../reportIdentify.js";
import type * as reportInbox from "../reportInbox.js";
import type * as reportNotify from "../reportNotify.js";
import type * as reportStore from "../reportStore.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as telegram from "../telegram.js";
import type * as todo from "../todo.js";
import type * as transactions from "../transactions.js";
import type * as transfers from "../transfers.js";
import type * as users from "../users.js";
import type * as valuations from "../valuations.js";
import type * as vasco from "../vasco.js";
import type * as vascoNotify from "../vascoNotify.js";
import type * as vectorize from "../vectorize.js";
import type * as warmup from "../warmup.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agent: typeof agent;
  agentTools: typeof agentTools;
  agentToolsDebt: typeof agentToolsDebt;
  agentToolsDocuments: typeof agentToolsDocuments;
  agentToolsForecasts: typeof agentToolsForecasts;
  agentToolsIntelligence: typeof agentToolsIntelligence;
  agentToolsLiabilities: typeof agentToolsLiabilities;
  agentToolsPointage: typeof agentToolsPointage;
  agentToolsProductDocs: typeof agentToolsProductDocs;
  agentToolsProjections: typeof agentToolsProjections;
  agentToolsReports: typeof agentToolsReports;
  agentToolsValuations: typeof agentToolsValuations;
  agentmail: typeof agentmail;
  aggregate: typeof aggregate;
  airtableImport: typeof airtableImport;
  attio: typeof attio;
  attioSync: typeof attioSync;
  auth: typeof auth;
  cash: typeof cash;
  chat: typeof chat;
  companies: typeof companies;
  companyEnrichment: typeof companyEnrichment;
  companyReports: typeof companyReports;
  connections: typeof connections;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deals: typeof deals;
  documents: typeof documents;
  documentsClassify: typeof documentsClassify;
  documentsExtract: typeof documentsExtract;
  email: typeof email;
  emailTemplates: typeof emailTemplates;
  files: typeof files;
  forecasts: typeof forecasts;
  guarantees: typeof guarantees;
  http: typeof http;
  intelligence: typeof intelligence;
  investments: typeof investments;
  invitations: typeof invitations;
  kpis: typeof kpis;
  liabilities: typeof liabilities;
  "lib/agentScope": typeof lib_agentScope;
  "lib/airtableForecasts": typeof lib_airtableForecasts;
  "lib/amortization": typeof lib_amortization;
  "lib/attioSync": typeof lib_attioSync;
  "lib/auth": typeof lib_auth;
  "lib/authInvite": typeof lib_authInvite;
  "lib/bankAccounts": typeof lib_bankAccounts;
  "lib/categories": typeof lib_categories;
  "lib/categoryRules": typeof lib_categoryRules;
  "lib/connectors": typeof lib_connectors;
  "lib/docBackfill": typeof lib_docBackfill;
  "lib/docsend": typeof lib_docsend;
  "lib/documentBlobs": typeof lib_documentBlobs;
  "lib/documentTexts": typeof lib_documentTexts;
  "lib/domain": typeof lib_domain;
  "lib/duplicates": typeof lib_duplicates;
  "lib/emailIdentify": typeof lib_emailIdentify;
  "lib/excel": typeof lib_excel;
  "lib/fileText": typeof lib_fileText;
  "lib/guarantees": typeof lib_guarantees;
  "lib/instructions": typeof lib_instructions;
  "lib/instrumentMapping": typeof lib_instrumentMapping;
  "lib/instruments": typeof lib_instruments;
  "lib/invitations": typeof lib_invitations;
  "lib/liabilities": typeof lib_liabilities;
  "lib/matchingLog": typeof lib_matchingLog;
  "lib/metricCatalog": typeof lib_metricCatalog;
  "lib/metrics": typeof lib_metrics;
  "lib/modelRetry": typeof lib_modelRetry;
  "lib/modules": typeof lib_modules;
  "lib/notificationPrefs": typeof lib_notificationPrefs;
  "lib/notion": typeof lib_notion;
  "lib/ocr": typeof lib_ocr;
  "lib/people": typeof lib_people;
  "lib/pitch": typeof lib_pitch;
  "lib/pointage": typeof lib_pointage;
  "lib/powensAccounts": typeof lib_powensAccounts;
  "lib/productDocs": typeof lib_productDocs;
  "lib/properties": typeof lib_properties;
  "lib/recurrence": typeof lib_recurrence;
  "lib/reportAnalysis": typeof lib_reportAnalysis;
  "lib/reportFreshness": typeof lib_reportFreshness;
  "lib/reportLinks": typeof lib_reportLinks;
  "lib/reportNotifyArgs": typeof lib_reportNotifyArgs;
  "lib/reportPeriod": typeof lib_reportPeriod;
  "lib/reportPrompts": typeof lib_reportPrompts;
  "lib/reportRecipients": typeof lib_reportRecipients;
  "lib/reportRouting": typeof lib_reportRouting;
  "lib/reportSenders": typeof lib_reportSenders;
  "lib/reportSource": typeof lib_reportSource;
  "lib/searchText": typeof lib_searchText;
  "lib/sectors": typeof lib_sectors;
  "lib/storage": typeof lib_storage;
  "lib/transfers": typeof lib_transfers;
  "lib/userPrefs": typeof lib_userPrefs;
  "lib/vat": typeof lib_vat;
  "lib/vectorizeErrors": typeof lib_vectorizeErrors;
  "lib/weeklyDigest": typeof lib_weeklyDigest;
  "lib/xirr": typeof lib_xirr;
  loans: typeof loans;
  "mcp/queries": typeof mcp_queries;
  "mcp/registry": typeof mcp_registry;
  "mcp/server": typeof mcp_server;
  "migrations/alboDocBackfill": typeof migrations_alboDocBackfill;
  "migrations/alboIdentityImport": typeof migrations_alboIdentityImport;
  "migrations/alboInstrumentImport": typeof migrations_alboInstrumentImport;
  "migrations/alboOneLinerImport": typeof migrations_alboOneLinerImport;
  "migrations/alboReportsImport": typeof migrations_alboReportsImport;
  "migrations/alboSummaryImport": typeof migrations_alboSummaryImport;
  "migrations/archiveCalteBlockedCards": typeof migrations_archiveCalteBlockedCards;
  "migrations/attioAlboImport": typeof migrations_attioAlboImport;
  "migrations/backfillCompanyEnrichment": typeof migrations_backfillCompanyEnrichment;
  "migrations/backfillReportFreshness": typeof migrations_backfillReportFreshness;
  "migrations/calteInstrumentImport": typeof migrations_calteInstrumentImport;
  "migrations/cleanupCalteImport": typeof migrations_cleanupCalteImport;
  "migrations/cleanupCalteOrphanCompanies": typeof migrations_cleanupCalteOrphanCompanies;
  "migrations/collapseGroupKinds": typeof migrations_collapseGroupKinds;
  "migrations/consolidateRewattCalte": typeof migrations_consolidateRewattCalte;
  "migrations/createSubsidiaryOrgs": typeof migrations_createSubsidiaryOrgs;
  "migrations/externalConnections": typeof migrations_externalConnections;
  "migrations/fixLoanDirection": typeof migrations_fixLoanDirection;
  "migrations/fixSpvPitches": typeof migrations_fixSpvPitches;
  "migrations/legalDocsImport": typeof migrations_legalDocsImport;
  "migrations/mergePalatineAccount": typeof migrations_mergePalatineAccount;
  "migrations/normalizeCompanyDomains": typeof migrations_normalizeCompanyDomains;
  "migrations/normalizeSectors": typeof migrations_normalizeSectors;
  "migrations/purgeStrayOrgs": typeof migrations_purgeStrayOrgs;
  "migrations/reassignClimateHouseCofoDeals": typeof migrations_reassignClimateHouseCofoDeals;
  "migrations/reassignDealOrg": typeof migrations_reassignDealOrg;
  "migrations/splitAlboSponsorSpvs": typeof migrations_splitAlboSponsorSpvs;
  "migrations/unifyDomainPitches": typeof migrations_unifyDomainPitches;
  modules: typeof modules;
  notifications: typeof notifications;
  organizations: typeof organizations;
  powens: typeof powens;
  projections: typeof projections;
  properties: typeof properties;
  publicConfig: typeof publicConfig;
  rateLimiters: typeof rateLimiters;
  reportExtract: typeof reportExtract;
  reportIdentify: typeof reportIdentify;
  reportInbox: typeof reportInbox;
  reportNotify: typeof reportNotify;
  reportStore: typeof reportStore;
  search: typeof search;
  seed: typeof seed;
  telegram: typeof telegram;
  todo: typeof todo;
  transactions: typeof transactions;
  transfers: typeof transfers;
  users: typeof users;
  valuations: typeof valuations;
  vasco: typeof vasco;
  vascoNotify: typeof vascoNotify;
  vectorize: typeof vectorize;
  warmup: typeof warmup;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
