import { ArrowUpRight, Linkedin, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { attioCompanyUrl } from '~/lib/attio'
import { Badge } from '~/components/ui/badge'

/**
 * Shared, read-only building blocks for the entity fiche skeleton (header →
 * identity block → reporting/KPIs → documents). Used by the company fiche.
 * No mutation here — editing comes in a later lot.
 */

export type EntityNature = 'company'

/** Nature badge shown in the header. */
export function EntityNatureBadge({ nature }: { nature: EntityNature }) {
  const { t } = useTranslation('participations')
  return <Badge variant="default">{t(`nature.${nature}`)}</Badge>
}

/** One labelled identity field; shows an em dash when the value is empty. */
export function IdentityField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value == null || value === '' ? '—' : value}</span>
    </div>
  )
}

/** Titled section wrapper used across the skeleton, with an optional action. */
export function IdentitySection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
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
    <ul className="space-y-1.5">
      {people.map((p) => (
        <li key={p.name} className="flex items-center gap-2 text-sm">
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

/** Reserved zone: a titled placeholder kept in the skeleton for a surface that
 * has no data source yet (e.g. group-level documents). */
export function ReservedSection({
  title,
  note,
}: {
  title: string
  note: string
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        {note}
      </div>
    </section>
  )
}
