import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DealOption } from './DealCombobox'
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

/**
 * Cible passif pointable : position de capital (`equity`) ou compte courant
 * inter-entités (`intercompany_loan`). `targetId` est l'_id de la cible en
 * string (convention `transactions.allocation`).
 */
export type LiabilityOption = {
  kind: 'equity' | 'intercompany_loan'
  targetId: string
  label: string
  sublabel: string
}

/** Cible de pointage sélectionnée : un deal OU une cible passif. */
export type PointageTarget =
  | { kind: 'deal'; deal: DealOption }
  | { kind: 'liability'; liability: LiabilityOption }

/**
 * Combobox cherchable de cibles de pointage (Popover + Command), groupées en
 * Deals / Capitaux propres / Comptes courants. Étend le pattern `DealCombobox`
 * (qui reste utilisé seul pour la réattribution deal → deal).
 */
export function TargetCombobox({
  deals,
  liabilities,
  value,
  onSelect,
  disabled,
}: {
  deals: Array<DealOption> | undefined
  liabilities: Array<LiabilityOption> | undefined
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
      kind: 'equity' as const,
      heading: t('pointage:combobox.groupEquity'),
      options: (liabilities ?? []).filter((option) => option.kind === 'equity'),
    },
    {
      kind: 'intercompany_loan' as const,
      heading: t('pointage:combobox.groupLoans'),
      options: (liabilities ?? []).filter(
        (option) => option.kind === 'intercompany_loan',
      ),
    },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={
            disabled || (deals === undefined && liabilities === undefined)
          }
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
            {(deals ?? []).length > 0 && (
              <CommandGroup heading={t('pointage:combobox.groupDeals')}>
                {(deals ?? []).map((deal) => (
                  <CommandItem
                    key={deal._id}
                    // L'_id garantit l'unicité cmdk quand deux deals partagent
                    // le même nom de boîte ; la recherche matche sur les noms,
                    // le nom personnalisé et l'instrument (comme la table
                    // Participations).
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
                ))}
              </CommandGroup>
            )}
            {liabilityGroups.map((group) =>
              group.options.length === 0 ? null : (
                <CommandGroup key={group.kind} heading={group.heading}>
                  {group.options.map((option) => (
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
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
