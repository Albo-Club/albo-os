import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/utils'
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
 * Cible de pointage passif : position de capital (`equity`) ou compte courant
 * inter-entités (`intercompany_loan`). `targetId` est l'_id de la cible en
 * string (convention `transactions.allocation`).
 */
export type LiabilityOption = {
  kind: 'equity' | 'intercompany_loan'
  targetId: string
  label: string
  sublabel: string
}

/**
 * Combobox cherchable de cibles passif (Popover + Command), groupées en
 * Capitaux propres / Comptes courants. Même pattern que `DealCombobox`.
 */
export function LiabilityCombobox({
  options,
  value,
  onSelect,
  disabled,
}: {
  options: Array<LiabilityOption> | undefined
  value: LiabilityOption | null
  onSelect: (option: LiabilityOption | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('passif')
  const [open, setOpen] = useState(false)

  const groups = [
    { kind: 'equity' as const, heading: t('combobox.groupEquity') },
    { kind: 'intercompany_loan' as const, heading: t('combobox.groupLoans') },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !options}
          className="w-44 justify-between font-normal"
        >
          <span className="truncate">
            {value ? value.label : t('combobox.placeholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={t('combobox.search')} />
          <CommandList>
            <CommandEmpty>{t('combobox.empty')}</CommandEmpty>
            {groups.map((group) => {
              const items = (options ?? []).filter(
                (option) => option.kind === group.kind,
              )
              if (items.length === 0) return null
              return (
                <CommandGroup key={group.kind} heading={group.heading}>
                  {items.map((option) => (
                    <CommandItem
                      key={option.targetId}
                      // Le targetId garantit l'unicité cmdk quand deux cibles
                      // partagent le même libellé ; la recherche matche sur
                      // les libellés.
                      value={`${option.label} ${option.sublabel} ${option.targetId}`}
                      onSelect={() => {
                        onSelect(
                          option.targetId === value?.targetId ? null : option,
                        )
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          'size-4',
                          option.targetId === value?.targetId
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
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
