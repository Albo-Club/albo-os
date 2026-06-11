import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Id } from '../../../convex/_generated/dataModel'
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

/** Minimal shape of an enriched deal (return of `api.deals.list`). */
export type DealOption = {
  _id: Id<'deals'>
  /** Custom name — displayed with the instrument when present. */
  name?: string | null
  target: { name: string } | null
  investor: { name: string } | null
  instrumentKind: string
}

/**
 * Searchable deal combobox (Popover + Command). The displayed label is the
 * target company name; the investor + the instrument disambiguate deals of
 * the same company.
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
  const { t } = useTranslation('pointage')
  const [open, setOpen] = useState(false)
  const dealTitle = useDealTitle()

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
                  // The _id guarantees cmdk uniqueness when two deals share
                  // the same company name; search matches on the names, the
                  // custom name and the instrument (like the Participations
                  // table).
                  value={`${deal.target?.name ?? ''} ${dealTitle(deal)} ${deal.investor?.name ?? ''} ${deal._id}`}
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
                      {dealTitle(deal)}
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
