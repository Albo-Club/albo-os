import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Handshake,
  Loader2,
  Plus,
  User,
  Users,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConvexMutation } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../../convex/_generated/api'
// Single source of truth for people roles, and their display order.
import { PERSON_ROLES } from '../../../convex/lib/people'
import type { LucideIcon } from 'lucide-react'
import type { Id } from '../../../convex/_generated/dataModel'
import type { PersonRole } from '../../../convex/lib/people'
import { attioPersonUrl } from '~/lib/attio'
import { IdentitySection } from '~/components/companies/EntityFiche'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '~/components/ui/popover'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/**
 * The three people sections of the company identity panel (founders / board /
 * co-investors), edited in place: click a name to rename it, the ✕ to drop it,
 * the "+" chip to add one. Same gesture as the panel's other fields — no
 * dialog, no save button (cf. `InlineField`).
 *
 * `companies.update` takes the people list as a FULL replacement, so every
 * edit rewrites the whole array; `people` order is the storage order, which is
 * why each row carries its index in it.
 */

type Person = { role: PersonRole; name: string; attioRecordId?: string }

const ROLE_ICON: Record<PersonRole, LucideIcon> = {
  founder: User,
  board: Users,
  coinvestor: Handshake,
}

const ROLE_TITLE_KEY: Record<PersonRole, string> = {
  founder: 'identity.founders',
  board: 'identity.board',
  coinvestor: 'identity.coInvestors',
}

export function PeopleEditor({
  company,
  orgId,
}: {
  company: { _id: Id<'companies'>; people?: Array<Person> }
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('participations')
  const updateCompany = useConvexMutation(api.companies.update)
  const people = company.people ?? []

  async function save(next: Array<Person>) {
    try {
      await updateCompany({ id: company._id, patch: { people: next } })
      toast.success(t('edit.saved'))
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        t(
          code === 'invalid_person_name'
            ? 'edit.errors.invalid_person_name'
            : 'edit.errors.default',
        ),
      )
    }
  }

  return (
    <>
      {PERSON_ROLES.map((role) => {
        const Icon = ROLE_ICON[role]
        const rows = people
          .map((p, index) => ({ ...p, index }))
          .filter((p) => p.role === role)
        return (
          <IdentitySection
            key={role}
            title={t(ROLE_TITLE_KEY[role])}
            icon={<Icon className="size-3.5" />}
            count={rows.length}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {rows.map((p) => (
                <PersonChip
                  key={p.index}
                  person={p}
                  orgId={orgId}
                  // A hand-typed name breaks the Attio link (the record id no
                  // longer describes the person) — same rule as before.
                  onRename={(name, attioRecordId) =>
                    void save(
                      people.map((q, i) =>
                        i === p.index
                          ? {
                              role,
                              name,
                              ...(attioRecordId ? { attioRecordId } : {}),
                            }
                          : q,
                      ),
                    )
                  }
                  onRemove={() =>
                    void save(people.filter((_, i) => i !== p.index))
                  }
                />
              ))}
              <AddPerson
                orgId={orgId}
                onAdd={(name, attioRecordId) =>
                  void save([
                    ...people,
                    { role, name, ...(attioRecordId ? { attioRecordId } : {}) },
                  ])
                }
              />
            </div>
          </IdentitySection>
        )
      })}
    </>
  )
}

/** One person: initials, name (click to rename), Attio link, remove. */
function PersonChip({
  person,
  orgId,
  onRename,
  onRemove,
}: {
  person: Person
  orgId: Id<'organizations'>
  onRename: (name: string, attioRecordId?: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('participations')
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <PersonInput
        orgId={orgId}
        initial={person.name}
        onSubmit={(name, attioRecordId) => {
          setEditing(false)
          onRename(name, attioRecordId)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const url = person.attioRecordId ? attioPersonUrl(person.attioRecordId) : null

  return (
    <span className="bg-muted flex items-center gap-1.5 rounded-full border py-0.5 pr-1.5 pl-1 text-[13px]">
      <span
        aria-hidden="true"
        className="bg-background text-muted-foreground flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
      >
        {personInitials(person.name)}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={t('edit.inlineLabel', { field: person.name })}
        className="cursor-pointer underline-offset-4 hover:underline"
      >
        {person.name}
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={t('identity.attioOpen')}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('edit.peopleRemove')}
        className="text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}

/** "+ Ajouter" chip: swaps to the name input, back to the chip once saved. */
function AddPerson({
  orgId,
  onAdd,
}: {
  orgId: Id<'organizations'>
  onAdd: (name: string, attioRecordId?: string) => void
}) {
  const { t } = useTranslation('participations')
  const [adding, setAdding] = useState(false)

  if (adding) {
    return (
      <PersonInput
        orgId={orgId}
        onSubmit={(name, attioRecordId) => {
          setAdding(false)
          onAdd(name, attioRecordId)
        }}
        onCancel={() => setAdding(false)}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="text-muted-foreground hover:bg-muted hover:text-foreground flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[13px]"
    >
      <Plus className="size-3.5" />
      {t('identity.addPerson')}
    </button>
  )
}

/**
 * Name input shared by add and rename, with the Attio people search as an aid
 * (Lot 5c): typing debounces a backend search, picking a suggestion submits
 * name + attioRecordId, Enter or blur submits the typed name unlinked, Escape
 * cancels. The search only assists — manual entry keeps working when Attio is
 * down or unconfigured (the action degrades to an empty list + an error flag).
 */
function PersonInput({
  orgId,
  initial = '',
  onSubmit,
  onCancel,
}: {
  orgId: Id<'organizations'>
  initial?: string
  onSubmit: (name: string, attioRecordId?: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('participations')
  const searchPeople = useAction(api.attio.searchPeople)
  const [value, setValue] = useState(initial)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [results, setResults] = useState<
    Array<{ name: string; attioRecordId: string }>
  >([])
  const debounced = useDebouncedValue(value, 300)
  // The name we opened on is never searched: renaming must not pop the
  // suggestion list on a name that is already settled.
  const skipRef = useRef(initial)

  useEffect(() => {
    const q = debounced.trim()
    if (q.length < 2 || q === skipRef.current) {
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
    searchPeople({ orgId, query: q })
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
  }, [debounced, orgId, searchPeople])

  // Typed by hand: submit unlinked. Unchanged or emptied: nothing to write.
  function submitTyped() {
    const name = value.trim()
    if (name === '' || name === initial) {
      onCancel()
      return
    }
    onSubmit(name)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('edit.peopleNamePlaceholder')}
          className="h-7 w-48 text-[13px]"
          onBlur={submitTyped}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitTyped()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('edit.personSearching')}
          </div>
        ) : error ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.personSearchError')}
          </div>
        ) : results.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.personSearchNoResults')}
          </div>
        ) : (
          <ul>
            {results.map((s) => (
              <li key={s.attioRecordId}>
                <button
                  type="button"
                  // Keep the focus on the input: the blur would otherwise
                  // submit the typed name before this click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSubmit(s.name, s.attioRecordId)}
                  className="hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                >
                  <span className="truncate">{s.name}</span>
                  <Badge variant="secondary" className="shrink-0">
                    {t('edit.attioBadge')}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
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
