import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DealOption } from './DealCombobox'
import type { LiabilityOption } from '~/lib/liabilityOptions'
import { cn } from '~/lib/utils'
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

/** Selected pointage target: a deal OR a liability target. */
export type PointageTarget =
  | { kind: 'deal'; deal: DealOption }
  | { kind: 'liability'; liability: LiabilityOption }

/**
 * Searchable combobox of pointage targets (Popover + Command): three groups
 * Deals / Capitaux propres / Comptes courants, each fed directly from its
 * source (`api.deals.list` / `getLiabilities` via `buildLiabilityOptions`)
 * — never a flattened list re-filtered by kind.
 *
 * The three groups are ALWAYS rendered: a group with no target shows an
 * explicit empty state ("missing" and "empty" must stay distinguishable —
 * see KNOWN_ISSUES.md « Passif »). Extends the `DealCombobox` pattern
 * (still used on its own for deal → deal reassignment).
 */
export function TargetCombobox({
  deals,
  equityOptions,
  loanOptions,
  value,
  onSelect,
  disabled,
}: {
  deals: Array<DealOption> | undefined
  equityOptions: Array<LiabilityOption> | undefined
  loanOptions: Array<LiabilityOption> | undefined
  value: PointageTarget | null
  onSelect: (target: PointageTarget | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('pointage')
  const [open, setOpen] = useState(false)
  const dealTitle = useDealTitle()

  const valueId =
    value == null
      ? null
      : value.kind === 'deal'
        ? value.deal._id
        : value.liability.targetId
  const valueLabel =
    value == null
      ? null
      : value.kind === 'deal'
        ? (value.deal.target?.name ?? '—')
        : value.liability.label

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
            {valueLabel ?? t('pointage:combobox.placeholder')}
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
                    onSelect={() => {
                      onSelect(
                        deal._id === valueId ? null : { kind: 'deal', deal },
                      )
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'size-4',
                        deal._id === valueId ? 'opacity-100' : 'opacity-0',
                      )}
                    />
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
                      onSelect={() => {
                        onSelect(
                          option.targetId === valueId
                            ? null
                            : { kind: 'liability', liability: option },
                        )
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'size-4',
                          option.targetId === valueId
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                      />
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
