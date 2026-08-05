import { useEffect, useState } from 'react'
import { ArrowUpRight, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { attioCompanyUrl } from '~/lib/attio'
import { Input } from '~/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '~/components/ui/popover'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/**
 * The "Fiche Attio" row of the identity panel: the company's Attio anchor
 * (`companies.attioCompanyId`), linked and unlinked in place like every other
 * row of the panel. Laid out as an `IdentityField` (label left, value right,
 * hairline below) — it can't BE one, because the resting value is a link plus
 * an unlink button, not a plain click-to-edit value.
 *
 * The anchor is what the deal sync resolves against, so it can only be PICKED
 * from Attio, never typed: a wrong record id would silently mis-route the next
 * sync. Changing an existing link means unlinking then relinking — rare enough
 * not to deserve its own affordance.
 */
export function AttioCompanyField({
  company,
  orgId,
}: {
  company: { _id: Id<'companies'>; attioCompanyId?: string | null }
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('participations')
  const updateCompany = useConvexMutation(api.companies.update)
  const [editing, setEditing] = useState(false)

  // '' unlinks (the mutation drops the column).
  async function save(attioCompanyId: string) {
    try {
      await updateCompany({ id: company._id, patch: { attioCompanyId } })
      toast.success(t('edit.saved'))
    } catch {
      toast.error(t('edit.errors.default'))
    }
  }

  const url = company.attioCompanyId
    ? attioCompanyUrl(company.attioCompanyId)
    : null

  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground shrink-0 text-xs">
        {t('identity.attio')}
      </span>
      {editing ? (
        <div className="min-w-0 flex-1">
          <AttioCompanySearch
            orgId={orgId}
            onPick={(attioRecordId) => {
              setEditing(false)
              void save(attioRecordId)
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : company.attioCompanyId ? (
        <span className="flex min-w-0 items-center justify-end gap-1.5 text-sm font-medium">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              {t('identity.attioOpen')}
              <ArrowUpRight className="size-3.5" />
            </a>
          ) : (
            // No configured workspace base → the record id alone can't build a
            // URL, so the link degrades to a muted marker (cf. lib/attio.ts).
            <span
              className="text-muted-foreground text-xs"
              title={company.attioCompanyId}
            >
              {t('identity.attioLinked')}
            </span>
          )}
          <button
            type="button"
            onClick={() => void save('')}
            aria-label={t('identity.attioUnlink')}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t('identity.attioLink')}
          className="focus-visible:ring-ring hover:bg-muted/50 text-muted-foreground -mx-1 min-w-0 cursor-pointer rounded px-1 text-right text-sm italic focus-visible:ring-2 focus-visible:outline-none"
        >
          {t('identity.attioLink')}
        </button>
      )}
    </div>
  )
}

/**
 * Attio company picker: debounced backend search, results in a popover, pick to
 * commit. Same shape as `PersonInput` (PeopleEditor) minus the free-text path —
 * see the note above on why an anchor can only be picked. Escape or a blur
 * outside the popover cancels.
 */
function AttioCompanySearch({
  orgId,
  onPick,
  onCancel,
}: {
  orgId: Id<'organizations'>
  onPick: (attioRecordId: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('participations')
  const searchCompanies = useAction(api.attio.searchCompanies)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [results, setResults] = useState<
    Array<{ name: string; attioRecordId: string; domain?: string }>
  >([])
  const debounced = useDebouncedValue(value, 300)

  useEffect(() => {
    const q = debounced.trim()
    if (q.length < 2) {
      setResults([])
      setError(false)
      setLoading(false)
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    setOpen(true)
    searchCompanies({ orgId, query: q })
      .then((res) => {
        if (cancelled) return
        setResults(res.results)
        setError(res.error != null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setResults([])
        setError(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, orgId, searchCompanies])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('identity.attioLink')}
          className="h-7 text-[13px]"
          onBlur={onCancel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-72 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('edit.attioSearching')}
          </div>
        ) : error ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.attioSearchError')}
          </div>
        ) : results.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.companySearchNoResults')}
          </div>
        ) : (
          <ul>
            {results.map((c) => (
              <li key={c.attioRecordId}>
                <button
                  type="button"
                  // Keep the focus on the input: the blur would otherwise
                  // cancel before this click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(c.attioRecordId)}
                  className="hover:bg-accent hover:text-accent-foreground flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm"
                >
                  <span className="w-full truncate">{c.name}</span>
                  {c.domain && (
                    <span className="text-muted-foreground w-full truncate text-xs">
                      {c.domain}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
