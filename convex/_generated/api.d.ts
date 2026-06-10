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
import type * as agentToolsForecasts from "../agentToolsForecasts.js";
import type * as agentToolsLiabilities from "../agentToolsLiabilities.js";
import type * as agentToolsPointage from "../agentToolsPointage.js";
import type * as agentToolsProjections from "../agentToolsProjections.js";
import type * as agentToolsValuations from "../agentToolsValuations.js";
import type * as aggregate from "../aggregate.js";
import type * as airtableImport from "../airtableImport.js";
import type * as auth from "../auth.js";
import type * as cash from "../cash.js";
import type * as chat from "../chat.js";
import type * as companies from "../companies.js";
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
import type * as lib_auth from "../lib/auth.js";
import type * as lib_liabilities from "../lib/liabilities.js";
import type * as lib_matchingLog from "../lib/matchingLog.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_searchText from "../lib/searchText.js";
import type * as lib_storage from "../lib/storage.js";
import type * as migrations_attioAlboImport from "../migrations/attioAlboImport.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as powens from "../powens.js";
import type * as projections from "../projections.js";
import type * as publicConfig from "../publicConfig.js";
import type * as rateLimiters from "../rateLimiters.js";
import type * as seed from "../seed.js";
import type * as transactions from "../transactions.js";
import type * as users from "../users.js";
import type * as valuations from "../valuations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agent: typeof agent;
  agentTools: typeof agentTools;
  agentToolsForecasts: typeof agentToolsForecasts;
  agentToolsLiabilities: typeof agentToolsLiabilities;
  agentToolsPointage: typeof agentToolsPointage;
  agentToolsProjections: typeof agentToolsProjections;
  agentToolsValuations: typeof agentToolsValuations;
  aggregate: typeof aggregate;
  airtableImport: typeof airtableImport;
  auth: typeof auth;
  cash: typeof cash;
  chat: typeof chat;
  companies: typeof companies;
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
  "lib/auth": typeof lib_auth;
  "lib/liabilities": typeof lib_liabilities;
  "lib/matchingLog": typeof lib_matchingLog;
  "lib/recurrence": typeof lib_recurrence;
  "lib/searchText": typeof lib_searchText;
  "lib/storage": typeof lib_storage;
  "migrations/attioAlboImport": typeof migrations_attioAlboImport;
  notifications: typeof notifications;
  organizations: typeof organizations;
  powens: typeof powens;
  projections: typeof projections;
  publicConfig: typeof publicConfig;
  rateLimiters: typeof rateLimiters;
  seed: typeof seed;
  transactions: typeof transactions;
  users: typeof users;
  valuations: typeof valuations;
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
