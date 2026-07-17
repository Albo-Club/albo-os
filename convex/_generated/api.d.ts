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
import type * as agentmail from "../agentmail.js";
import type * as agentTools from "../agentTools.js";
import type * as agentToolsIntelligence from "../agentToolsIntelligence.js";
import type * as agentToolsForecasts from "../agentToolsForecasts.js";
import type * as agentToolsLiabilities from "../agentToolsLiabilities.js";
import type * as agentToolsPointage from "../agentToolsPointage.js";
import type * as agentToolsProjections from "../agentToolsProjections.js";
import type * as agentToolsValuations from "../agentToolsValuations.js";
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
import type * as dashboard from "../dashboard.js";
import type * as deals from "../deals.js";
import type * as documents from "../documents.js";
import type * as email from "../email.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as files from "../files.js";
import type * as forecasts from "../forecasts.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as kpis from "../kpis.js";
import type * as liabilities from "../liabilities.js";
import type * as lib_agentScope from "../lib/agentScope.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_excel from "../lib/excel.js";
import type * as lib_instructions from "../lib/instructions.js";
import type * as lib_metricCatalog from "../lib/metricCatalog.js";
import type * as lib_notion from "../lib/notion.js";
import type * as lib_reportPeriod from "../lib/reportPeriod.js";
import type * as lib_ocr from "../lib/ocr.js";
import type * as lib_reportLinks from "../lib/reportLinks.js";
import type * as lib_reportPrompts from "../lib/reportPrompts.js";
import type * as lib_instruments from "../lib/instruments.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_liabilities from "../lib/liabilities.js";
import type * as lib_matchingLog from "../lib/matchingLog.js";
import type * as lib_pointage from "../lib/pointage.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_suggest from "../lib/suggest.js";
import type * as lib_userPrefs from "../lib/userPrefs.js";
import type * as lib_vat from "../lib/vat.js";
import type * as mcp_queries from "../mcp/queries.js";
import type * as mcp_registry from "../mcp/registry.js";
import type * as mcp_server from "../mcp/server.js";
import type * as migrations_attioAlboImport from "../migrations/attioAlboImport.js";
import type * as migrations_splitAlboSponsorSpvs from "../migrations/splitAlboSponsorSpvs.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as powens from "../powens.js";
import type * as projections from "../projections.js";
import type * as intelligence from "../intelligence.js";
import type * as reportExtract from "../reportExtract.js";
import type * as reportIdentify from "../reportIdentify.js";
import type * as reportInbox from "../reportInbox.js";
import type * as reportNotify from "../reportNotify.js";
import type * as reportStore from "../reportStore.js";
import type * as publicConfig from "../publicConfig.js";
import type * as rateLimiters from "../rateLimiters.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as telegram from "../telegram.js";
import type * as todo from "../todo.js";
import type * as transactions from "../transactions.js";
import type * as users from "../users.js";
import type * as valuations from "../valuations.js";
import type * as vasco from "../vasco.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agent: typeof agent;
  agentmail: typeof agentmail;
  agentTools: typeof agentTools;
  agentToolsIntelligence: typeof agentToolsIntelligence;
  agentToolsForecasts: typeof agentToolsForecasts;
  agentToolsLiabilities: typeof agentToolsLiabilities;
  agentToolsPointage: typeof agentToolsPointage;
  agentToolsProjections: typeof agentToolsProjections;
  agentToolsValuations: typeof agentToolsValuations;
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
  dashboard: typeof dashboard;
  deals: typeof deals;
  documents: typeof documents;
  email: typeof email;
  emailTemplates: typeof emailTemplates;
  files: typeof files;
  forecasts: typeof forecasts;
  http: typeof http;
  invitations: typeof invitations;
  kpis: typeof kpis;
  liabilities: typeof liabilities;
  "lib/agentScope": typeof lib_agentScope;
  "lib/auth": typeof lib_auth;
  "lib/excel": typeof lib_excel;
  "lib/instructions": typeof lib_instructions;
  "lib/metricCatalog": typeof lib_metricCatalog;
  "lib/notion": typeof lib_notion;
  "lib/reportPeriod": typeof lib_reportPeriod;
  "lib/ocr": typeof lib_ocr;
  "lib/reportLinks": typeof lib_reportLinks;
  "lib/reportPrompts": typeof lib_reportPrompts;
  "lib/instruments": typeof lib_instruments;
  "lib/invitations": typeof lib_invitations;
  "lib/liabilities": typeof lib_liabilities;
  "lib/matchingLog": typeof lib_matchingLog;
  "lib/pointage": typeof lib_pointage;
  "lib/recurrence": typeof lib_recurrence;
  "lib/searchText": typeof lib_searchText;
  "lib/storage": typeof lib_storage;
  "lib/suggest": typeof lib_suggest;
  "lib/userPrefs": typeof lib_userPrefs;
  "lib/vat": typeof lib_vat;
  "mcp/queries": typeof mcp_queries;
  "mcp/registry": typeof mcp_registry;
  "mcp/server": typeof mcp_server;
  "migrations/attioAlboImport": typeof migrations_attioAlboImport;
  "migrations/splitAlboSponsorSpvs": typeof migrations_splitAlboSponsorSpvs;
  notifications: typeof notifications;
  organizations: typeof organizations;
  powens: typeof powens;
  projections: typeof projections;
  intelligence: typeof intelligence;
  reportExtract: typeof reportExtract;
  reportIdentify: typeof reportIdentify;
  reportInbox: typeof reportInbox;
  reportNotify: typeof reportNotify;
  reportStore: typeof reportStore;
  publicConfig: typeof publicConfig;
  rateLimiters: typeof rateLimiters;
  search: typeof search;
  seed: typeof seed;
  telegram: typeof telegram;
  todo: typeof todo;
  transactions: typeof transactions;
  users: typeof users;
  valuations: typeof valuations;
  vasco: typeof vasco;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
