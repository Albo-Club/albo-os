/**
 * Registry of external platform connectors.
 *
 * One platform = one module; this file is the single place that DECLARES the
 * platforms Albo OS talks to, so nothing about "which platforms exist" is
 * hand-coded elsewhere. The common core (`convex/connections.ts`) manages the
 * shared storage/lifecycle for org-scoped credential connections
 * (`externalConnections` table) and dispatches per AUTH KIND — never per
 * platform — so adding a platform is: (1) a registry entry here, (2) a module
 * with the platform's pull/push logic (cf. `convex/vasco.ts` as the reference
 * credentials module).
 *
 * Auth kinds:
 * - `credentials` — org-scoped login stored at rest in `externalConnections`
 *   (config = non-secret settings, credentials = secrets). E.g. VASCO.
 * - `webview` — the connection is created on the platform's side (OAuth-like
 *   webview + webhooks); the module owns its own storage. E.g. Powens.
 * - `env` — global capability enabled by env var(s), no per-org rows.
 *   E.g. Notion rendering providers.
 * - `none` — global capability with no auth at all. E.g. DocSend conversion.
 */

import { ConvexError } from 'convex/values'

export type ConnectorScope = 'org' | 'global'
export type ConnectorAuth = 'credentials' | 'webview' | 'env' | 'none'

export interface ConnectorDefinition {
  platform: string
  label: string
  scope: ConnectorScope
  auth: ConnectorAuth
  /** auth `credentials`: non-secret config keys REQUIRED on each row. */
  configKeys?: ReadonlyArray<string>
  /** auth `credentials`: secret keys REQUIRED on each row. */
  credentialKeys?: ReadonlyArray<string>
  /** auth `env`: the connector is available when ANY of these env vars is set. */
  envKeys?: ReadonlyArray<string>
  /** The platform supports an on-demand pull, dispatched by
   * `connections.syncNow` (a syncable platform adds its case there). Off for
   * push-based platforms (webhooks) and passive capabilities. */
  manualSync?: boolean
  /** Portfolio entities can be linked to an object of this platform (e.g. a
   * VASCO issuer) from the entity page's « Intégrations » dialog. Off for
   * platforms whose data attaches elsewhere (Powens → bank accounts) and for
   * global capabilities. */
  entityLink?: boolean
  /** Dev-facing pointer to the module implementing the platform logic. */
  module: string
  description: string
}

export const CONNECTORS: ReadonlyArray<ConnectorDefinition> = [
  {
    platform: 'powens',
    label: 'Powens (bank aggregation)',
    scope: 'org',
    auth: 'webview',
    module: 'convex/powens.ts',
    description:
      'Bank connections created in the Powens webview; auth token in ' +
      '`powensUsers`, per-connection sync health in `powensConnections` ' +
      '(webhook + 6h polling cron).',
  },
  {
    platform: 'gmail',
    label: 'Gmail (portfolio email timeline)',
    scope: 'org',
    auth: 'webview',
    manualSync: true,
    module: 'convex/gmail.ts',
    description:
      'Org-scoped mailboxes connected via Google OAuth (one row per org × ' +
      'mailbox); refresh token + historyId cursor in `gmailAccounts`, ' +
      'matched emails + stored attachments in `companyEmails` (10-min ' +
      'polling cron, deterministic domain matching within the org).',
  },
  {
    platform: 'vasco',
    label: 'VASCO (fund-admin portals, e.g. Parallel)',
    scope: 'org',
    auth: 'credentials',
    configKeys: ['clientSlug'],
    credentialKeys: ['username', 'password'],
    manualSync: true,
    entityLink: true,
    module: 'convex/vasco.ts',
    description:
      'Investor-side pull (positions, communications, documents) from ' +
      '`api.<clientSlug>.vasco.fund` behind a username/password login.',
  },
  {
    platform: 'notion',
    label: 'Notion (public page extraction)',
    scope: 'global',
    auth: 'env',
    envKeys: ['BROWSERLESS_TOKEN', 'JINA_API_KEY'],
    module: 'convex/lib/notion.ts',
    description:
      'Public Notion page → text for the report content router, via a ' +
      'headless-rendering provider (browserless.io or Jina Reader).',
  },
  {
    platform: 'docsend',
    label: 'DocSend (deck extraction)',
    scope: 'global',
    auth: 'none',
    module: 'convex/lib/docsend.ts',
    description:
      'DocSend link → PDF for the report content router, via the public ' +
      'docsend2pdf.com conversion API (no key).',
  },
]

/** Registry lookup — throws on an undeclared platform so a typo can never
 * silently create an unmanaged connection kind. */
export function getConnector(platform: string): ConnectorDefinition {
  const def = CONNECTORS.find((c) => c.platform === platform)
  if (!def) throw new ConvexError(`unknown_connector:${platform}`)
  return def
}

export interface ParsedConnection {
  config: Record<string, string>
  credentials: Record<string, string>
}

/**
 * Validate a stored connection row against its connector's declared keys.
 * Modules read the returned records instead of hand-checking fields — the
 * registry is the single source of truth for what a valid row looks like.
 * Throws a machine code naming the first missing key.
 */
export function parseConnection(
  def: ConnectorDefinition,
  row: {
    config?: Record<string, string>
    credentials?: Record<string, string>
  },
): ParsedConnection {
  if (def.auth !== 'credentials') {
    throw new ConvexError(`connector_not_credentials:${def.platform}`)
  }
  const config = row.config ?? {}
  const credentials = row.credentials ?? {}
  for (const key of def.configKeys ?? []) {
    if (!config[key]) {
      throw new ConvexError(`connection_config_missing:${def.platform}:${key}`)
    }
  }
  for (const key of def.credentialKeys ?? []) {
    if (!credentials[key]) {
      throw new ConvexError(
        `connection_credential_missing:${def.platform}:${key}`,
      )
    }
  }
  return { config, credentials }
}
