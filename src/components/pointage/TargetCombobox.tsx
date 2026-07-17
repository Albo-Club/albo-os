import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DealOption } from './DealCombobox'
import type { LiabilityOption } from '~/lib/liabilityOptions'
import { CHARGE_CATEGORIES, PRODUCT_CATEGORIES } from '~/lib/categories'
import { useDealTitle } from '~/components/participations/ParticipationsTable'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'

/**
 * Outcome of the unified « Affecter à… » picker: a deal, a liability
 * target, a charge/product category (null = to qualify later), or a plain
 * status (tax / internal transfer / ignored). One picker, one gesture —
 * the backend routing stays the caller's job (match vs allocate vs
 * categorize, cf. KNOWN_ISSUES « Pointage transaction → deal »).
 */
export type PointageTarget =
  | { kind: 'deal'; deal: DealOption }
  | { kind: 'liability'; liability: LiabilityOption }
  | { kind: 'category'; status: 'charge' | 'product'; category: string | null }
  | { kind: 'status'; status: 'tax' | 'internal_transfer' | 'ignored' }

/**
 * Unified searchable pointage picker (Popover + Command): Deals /
 * Capitaux propres / Comptes courants (fed from `listOptions`, never a
 * flattened re-filtered list), then the charge and product categories as
 * direct leaves, then Impôt / Virement interne / Ignorer. Selecting an
 * entry APPLIES it immediately (the undo banner covers mistakes) — there
 * is no armed selection nor confirm button anymore.
 *
 * Every group is ALWAYS rendered ("missing" and "empty" must stay
 * distinguishable — see KNOWN_ISSUES.md « Passif »); only the
 * charge/product order adapts to the transaction direction (out: Charges
 * first; in: Produits first).
 */
export function TargetCombobox({
  deals,
  equityOptions,
  loanOptions,
  direction,
  onSelect,
  disabled,
}: {
  deals: Array<DealOption> | undefined
  equityOptions: Array<LiabilityOption> | undefined
  loanOptions: Array<LiabilityOption> | undefined
  /** Transaction direction — orders the charge/product groups. */
  direction: 'in' | 'out'
  onSelect: (target: PointageTarget) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['pointage', 'common'])
  const [open, setOpen] = useState(false)
  const dealTitle = useDealTitle()

  const pick = (target: PointageTarget) => {
    onSelect(target)
    setOpen(false)
  }

  const liabilityGroups = [
    {
      key: 'equity',
      heading: t('pointage:combobox.groupEquity'),
      emptyLabel: t('pointage:combobox.emptyEquity'),
      options: equityOptions,
    },
    {
      key: 'intercompany_loan',
      heading: t('pointage:combobox.groupLoans'),
      emptyLabel: t('pointage:combobox.emptyLoans'),
      options: loanOptions,
    },
  ]

  // Charge/product categories as direct leaves — the two-step
  // « Écarter → Charge » then inline category is collapsed into one pick.
  const categoryGroups: Array<{
    key: 'charge' | 'product'
    heading: string
    unqualifiedLabel: string
    categories: ReadonlyArray<string>
  }> = [
    {
      key: 'charge',
      heading: t('pointage:combobox.groupCharges'),
      unqualifiedLabel: t('pointage:combobox.chargeUnqualified'),
      categories: CHARGE_CATEGORIES,
    },
    {
      key: 'product',
      heading: t('pointage:combobox.groupProducts'),
      unqualifiedLabel: t('pointage:combobox.productUnqualified'),
      categories: PRODUCT_CATEGORIES,
    },
  ]
  if (direction === 'in') categoryGroups.reverse()

  const statusLeaves: Array<{
    status: 'tax' | 'internal_transfer' | 'ignored'
    label: string
  }> = [
    { status: 'tax', label: t('pointage:actions.tax') },
    {
      status: 'internal_transfer',
      label: t('pointage:actions.internal_transfer'),
    },
    { status: 'ignored', label: t('pointage:actions.ignore') },
  ]

  const loading =
    deals === undefined &&
    equityOptions === undefined &&
    loanOptions === undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-44 justify-between font-normal"
        >
          <span className="truncate">
            {t('pointage:combobox.placeholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={t('pointage:combobox.search')} />
          <CommandList>
            <CommandEmpty>{t('pointage:combobox.empty')}</CommandEmpty>
            <CommandGroup heading={t('pointage:combobox.groupDeals')}>
              {(deals ?? []).length === 0 ? (
                <div className="text-muted-foreground px-2 py-1.5 text-xs">
                  {t('pointage:combobox.emptyDeals')}
                </div>
              ) : (
                (deals ?? []).map((deal) => (
                  <CommandItem
                    key={deal._id}
                    // The _id guarantees cmdk uniqueness when two deals share
                    // the same company name; search matches on the names, the
                    // custom name and the instrument (like the Participations
                    // table).
                    value={`${deal.target?.name ?? ''} ${dealTitle(deal)} ${deal.investor?.name ?? ''} ${deal._id}`}
                    onSelect={() => pick({ kind: 'deal', deal })}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {deal.target?.name ?? '—'}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {dealTitle(deal)}
                        {deal.investor ? ` · ${deal.investor.name}` : ''}
                      </span>
                    </span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
            {liabilityGroups.map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {(group.options ?? []).length === 0 ? (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    {group.emptyLabel}
                  </div>
                ) : (
                  (group.options ?? []).map((option) => (
                    <CommandItem
                      key={option.targetId}
                      value={`${option.label} ${option.sublabel} ${option.targetId}`}
                      onSelect={() =>
                        pick({ kind: 'liability', liability: option })
                      }
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {option.sublabel}
                        </span>
                      </span>
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            ))}
            {categoryGroups.map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.categories.map((slug) => (
                  <CommandItem
                    key={slug}
                    value={`${group.heading} ${t(`common:categories.${slug}`)} ${slug}`}
                    onSelect={() =>
                      pick({
                        kind: 'category',
                        status: group.key,
                        category: slug,
                      })
                    }
                  >
                    {t(`common:categories.${slug}`)}
                  </CommandItem>
                ))}
                <CommandItem
                  value={`${group.heading} ${group.unqualifiedLabel}`}
                  className="text-muted-foreground"
                  onSelect={() =>
                    pick({ kind: 'category', status: group.key, category: null })
                  }
                >
                  {group.unqualifiedLabel}
                </CommandItem>
              </CommandGroup>
            ))}
            <CommandGroup heading={t('pointage:combobox.groupOther')}>
              {statusLeaves.map((leaf) => (
                <CommandItem
                  key={leaf.status}
                  value={`${leaf.label} ${leaf.status}`}
                  onSelect={() => pick({ kind: 'status', status: leaf.status })}
                >
                  {leaf.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
