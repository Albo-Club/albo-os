import type { ReactNode } from 'react'

/**
 * Shared building blocks for the fiche skeleton (header → identity panel →
 * reporting/KPIs → documents), used by both the company and the deal fiche.
 * These primitives stay display-only: an editable field is an `InlineField`
 * — or, for the sections that need their own control, `PeopleEditor` and
 * `AttioCompanyField` — dropped inside them.
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
