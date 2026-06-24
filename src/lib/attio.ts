/**
 * Attio deep links.
 *
 * The Attio web URL for a record needs the workspace URL slug, which is NOT
 * derivable from the record id alone (the REST API returns no `web_url`). It
 * therefore comes from the public `VITE_ATTIO_WORKSPACE_URL` env var, e.g.
 * "https://app.attio.com/albo". When unset, callers degrade gracefully and
 * surface the bridge id instead of a (possibly wrong) guessed URL.
 */
const ATTIO_WORKSPACE_URL = import.meta.env.VITE_ATTIO_WORKSPACE_URL as
  | string
  | undefined

/** Deep link to an Attio company record, or null when no workspace base is set. */
export function attioCompanyUrl(attioCompanyId: string): string | null {
  if (!ATTIO_WORKSPACE_URL) return null
  return `${ATTIO_WORKSPACE_URL.replace(/\/$/, '')}/company/${attioCompanyId}`
}

/** Deep link to an Attio person record, or null when no workspace base is set.
 * Mirror of attioCompanyUrl; the person object uses the `person` URL segment. */
export function attioPersonUrl(attioRecordId: string): string | null {
  if (!ATTIO_WORKSPACE_URL) return null
  return `${ATTIO_WORKSPACE_URL.replace(/\/$/, '')}/person/${attioRecordId}`
}
