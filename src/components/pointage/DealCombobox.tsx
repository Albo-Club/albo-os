import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Id } from '../../../convex/_generated/dataModel'
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

/** Forme minimale d'un deal enrichi (retour de `api.deals.list`). */
export type DealOption = {
  _id: Id<'deals'>
  target: { name: string } | null
  investor: { name: string } | null
  instrumentKind: string
}

/**
 * Combobox cherchable de deals (Popover + Command). Le label affiché est le
 * nom de la target company ; l'investisseur + l'instrument désambiguïsent les
 * deals d'une même boîte.
 */
export function DealCombobox({
  deals,
  value,
  onSelect,
  disabled,
}: {
  deals: Array<DealOption> | undefined
  value: DealOption | null
  onSelect: (deal: DealOption | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['pointage', 'participations'])
  const [open, setOpen] = useState(false)

  const instrumentLabel = (kind: string) =>
    t(`participations:instrument.${kind}`, { defaultValue: kind })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !deals}
          className="w-44 justify-between font-normal"
        >
          <span className="truncate">
            {value
              ? (value.target?.name ?? '—')
              : t('pointage:combobox.placeholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder={t('pointage:combobox.search')} />
          <CommandList>
            <CommandEmpty>{t('pointage:combobox.empty')}</CommandEmpty>
            <CommandGroup>
              {(deals ?? []).map((deal) => (
                <CommandItem
                  key={deal._id}
                  // L'_id garantit l'unicité cmdk quand deux deals partagent
                  // le même nom de boîte ; la recherche matche sur les noms.
                  value={`${deal.target?.name ?? ''} ${deal.investor?.name ?? ''} ${deal._id}`}
                  onSelect={() => {
                    onSelect(deal._id === value?._id ? null : deal)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'size-4',
                      deal._id === value?._id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{deal.target?.name ?? '—'}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {instrumentLabel(deal.instrumentKind)}
                      {deal.investor ? ` · ${deal.investor.name}` : ''}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
