import { ArrowUpRight, Linkedin, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { attioCompanyUrl } from '~/lib/attio'

/**
 * Shared, read-only building blocks for the entity fiche skeleton (header →
 * identity block → reporting/KPIs → documents). Used by the company fiche.
 * These primitives stay display-only: the editable Identity fields (sector /
 * SIREN / domain) are rendered inline by `InlineField` in the route, not here.
 */

/**
 * One labelled identity field, laid out as a row: label left, value right,
 * separated from the next field by a hairline. The row form is what keeps long
 * labels ("Nb d'actions consolidé") on a single line in the 320px side panel —
 * the previous two-column grid wrapped them and broke the value alignment.
 * Shows an em dash when the value is empty.
 */
export function IdentityField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium tabular-nums">
        {value == null || value === '' ? '—' : value}
      </span>
    </div>
  )
}

/**
 * Titled section wrapper used across the skeleton, with an optional action.
 * `icon` renders a small squared chip before the title and `count` a discreet
 * badge after it — both opt-in, so the plain sections (e.g. the deals table in
 * the main column) keep their bare title.
 */
export function IdentitySection({
  title,
  icon,
  count,
  action,
  children,
}: {
  title: string
  icon?: ReactNode
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && (
          <span className="bg-muted text-muted-foreground flex size-[22px] shrink-0 items-center justify-center rounded-md border">
            {icon}
          </span>
        )}
        <h2 className="text-sm font-medium">{title}</h2>
        {count != null && count > 0 && (
          <span className="bg-muted text-muted-foreground rounded-full border px-1.5 text-[10px] font-semibold tabular-nums">
            {count}
          </span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}

/** "Open in Attio" link when a workspace base is configured; otherwise a muted
 * marker (the bridge id alone can't build a reliable web URL). */
export function AttioCompanyLink({
  attioCompanyId,
}: {
  attioCompanyId?: string | null
}) {
  const { t } = useTranslation('participations')
  if (!attioCompanyId) return <>—</>
  const url = attioCompanyUrl(attioCompanyId)
  if (!url) {
    return (
      <span className="text-muted-foreground text-xs" title={attioCompanyId}>
        {t('identity.attioLinked')}
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
    >
      {t('identity.attioOpen')}
      <ArrowUpRight className="size-3.5" />
    </a>
  )
}

export type Person = {
  name: string
  attioUrl?: string | null
  linkedinUrl?: string | null
  email?: string | null
}

/**
 * People list (founders / board / co-investors), fed from `companies.people`
 * (Lot 5b). Each person shows their name; the name links to the Attio person
 * record when `attioUrl` is set, plain text otherwise. An empty list renders
 * the "to be filled in" state. The LinkedIn/mailto branches are inert — those
 * fields are not stored (see KNOWN_ISSUES "PeopleList — branches linkedin/email
 * non alimentées").
 */
export function PeopleList({ people }: { people: Array<Person> }) {
  const { t } = useTranslation('participations')
  if (people.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t('identity.empty')}</p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {people.map((p) => (
        <li
          key={p.name}
          className="bg-muted flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-[13px]"
        >
          <span
            aria-hidden="true"
            className="bg-background text-muted-foreground flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
          >
            {personInitials(p.name)}
          </span>
          {p.attioUrl ? (
            <a
              href={p.attioUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              {p.name}
              <ArrowUpRight className="size-3.5" />
            </a>
          ) : (
            <span>{p.name}</span>
          )}
          {p.linkedinUrl && (
            <a
              href={p.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label="LinkedIn"
            >
              <Linkedin className="size-3.5" />
            </a>
          )}
          {p.email && (
            <a
              href={`mailto:${p.email}`}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Email"
            >
              <Mail className="size-3.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

/** First letter of the first and last words of a name ("Marc Perrin" → "MP"). */
function personInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toUpperCase()
}
