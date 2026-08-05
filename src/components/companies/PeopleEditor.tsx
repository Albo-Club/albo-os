import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
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
import type { AttioRecordType, PersonRole } from '../../../convex/lib/people'
import { attioCompanyUrl, attioPersonUrl } from '~/lib/attio'
import { IdentitySection } from '~/components/companies/EntityFiche'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '~/components/ui/popover'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'

/**
 * The three people sections of the company identity panel (founders / board /
 * co-investors), edited in place: the ✕ drops a chip, the "+" chip adds one.
 *
 * A chip carries exactly ONE gesture: opening its Attio record, on the whole
 * chip when it is linked (nothing at all when it isn't). It used to double as
 * a rename button while also carrying the Attio arrow, so a click on it was
 * ambiguous — open the CRM, or edit the name? Renaming is gone: fixing a name
 * means dropping the chip and adding a new one, which is also the only way to
 * re-point its Attio link.
 *
 * `companies.update` takes the people list as a FULL replacement, so every
 * edit rewrites the whole array; `people` order is the storage order, which is
 * why each row carries its index in it.
 */

type Person = {
  role: PersonRole
  name: string
  attioRecordId?: string
  attioRecordType?: AttioRecordType
}

/** An Attio record picked from the search, before it lands on a `Person`. */
type AttioLink = { recordId: string; type: AttioRecordType }

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
                  onRemove={() =>
                    void save(people.filter((_, i) => i !== p.index))
                  }
                />
              ))}
              <AddPerson
                orgId={orgId}
                onAdd={(name, attio) =>
                  void save([
                    ...people,
                    {
                      role,
                      name,
                      ...(attio
                        ? {
                            attioRecordId: attio.recordId,
                            attioRecordType: attio.type,
                          }
                        : {}),
                    },
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

/** One person: initials + name (the Attio link when there is one), remove. */
function PersonChip({
  person,
  onRemove,
}: {
  person: Person
  onRemove: () => void
}) {
  const { t } = useTranslation('participations')

  // The record type decides the deep link: a co-investor fund lives in Attio's
  // `companies` object, so a /person/… URL would 404. Absent = person.
  const url = person.attioRecordId
    ? person.attioRecordType === 'company'
      ? attioCompanyUrl(person.attioRecordId)
      : attioPersonUrl(person.attioRecordId)
    : null

  const avatar = (
    <span
      aria-hidden="true"
      className="bg-background text-muted-foreground flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
    >
      {personInitials(person.name)}
    </span>
  )

  return (
    // The whole chip opens Attio when the entry is linked — a 14px arrow is a
    // needlessly small target, and the chip has no competing gesture since it
    // stopped renaming. The ✕ stays OUTSIDE the anchor: a <button> can't nest
    // in an <a>, and removing must not be one misclick away from the CRM.
    <span className="bg-muted has-[a:hover]:bg-accent flex items-center gap-1.5 rounded-full border py-0.5 pr-1.5 pl-1 text-[13px] transition-colors">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={t('identity.attioOpen')}
          className="group flex min-w-0 items-center gap-1.5"
        >
          {avatar}
          <span className="truncate underline-offset-2 group-hover:underline">
            {person.name}
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        </a>
      ) : (
        <>
          {avatar}
          <span className="truncate">{person.name}</span>
        </>
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
  onAdd: (name: string, attio?: AttioLink) => void
}) {
  const { t } = useTranslation('participations')
  const [adding, setAdding] = useState(false)

  if (adding) {
    return (
      <PersonInput
        orgId={orgId}
        onSubmit={(name, attio) => {
          setAdding(false)
          onAdd(name, attio)
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
 * Name input backing "+ Ajouter", with the Attio search as an aid (Lot 5c):
 * typing debounces a backend search, picking a suggestion submits name + Attio
 * link, Enter or blur submits the typed name unlinked, Escape cancels. The
 * search only assists — manual entry keeps working when Attio is down or
 * unconfigured (the actions degrade to an empty list + an error flag).
 *
 * Both Attio objects are searched: a founder is a `people` record, but a
 * co-investor is usually a fund, i.e. a `companies` one. Results carry their
 * type so the two never get confused — visually here, and in the stored link.
 */
function PersonInput({
  orgId,
  onSubmit,
  onCancel,
}: {
  orgId: Id<'organizations'>
  onSubmit: (name: string, attio?: AttioLink) => void
  onCancel: () => void
}) {
  const { t } = useTranslation('participations')
  const searchPeople = useAction(api.attio.searchPeople)
  const searchCompanies = useAction(api.attio.searchCompanies)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [results, setResults] = useState<Array<{ name: string } & AttioLink>>(
    [],
  )
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
    Promise.all([
      searchPeople({ orgId, query: q }),
      searchCompanies({ orgId, query: q }),
    ])
      .then(([people, companies]) => {
        if (cancelled) return
        setResults([
          ...people.results.map((r) => ({
            name: r.name,
            recordId: r.attioRecordId,
            type: 'person' as const,
          })),
          ...companies.results.map((r) => ({
            name: r.name,
            recordId: r.attioRecordId,
            type: 'company' as const,
          })),
        ])
        // Only a double failure is worth reporting: one object still answering
        // gives usable suggestions.
        setError(people.error != null && companies.error != null)
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
  }, [debounced, orgId, searchPeople, searchCompanies])

  // Typed by hand: submit unlinked. Emptied: nothing to write.
  function submitTyped() {
    const name = value.trim()
    if (name === '') {
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
            {t('edit.attioSearching')}
          </div>
        ) : error ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.attioSearchError')}
          </div>
        ) : results.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            {t('edit.attioSearchNoResults')}
          </div>
        ) : (
          <ul>
            {results.map((s) => {
              const TypeIcon = s.type === 'company' ? Building2 : User
              return (
                <li key={`${s.type}:${s.recordId}`}>
                  <button
                    type="button"
                    // Keep the focus on the input: the blur would otherwise
                    // submit the typed name before this click lands.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSubmit(s.name, s)}
                    className="hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <TypeIcon
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-label={t(
                          s.type === 'company'
                            ? 'edit.attioTypeCompany'
                            : 'edit.attioTypePerson',
                        )}
                      />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {t('edit.attioBadge')}
                    </Badge>
                  </button>
                </li>
              )
            })}
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
