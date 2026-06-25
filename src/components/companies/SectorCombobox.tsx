import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SECTOR_SLUGS } from '~/lib/sectors'
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
 * Creatable sector picker (Popover + Command): pick a predefined sector OR type
 * a free value. A predefined sector is stored as its slug; a free entry is
 * stored verbatim — `companies.sector` stays a free-form string. Selecting the
 * active sector again clears it (toggle, like the pointage combobox). Empty
 * value = no sector.
 */
export function SectorCombobox({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const options = SECTOR_SLUGS.map((slug) => ({
    slug,
    label: t(`participations:sectors.${slug}`),
  }))

  // Resolve the current value to a label: a known slug → its i18n label, a free
  // value → itself, empty → the placeholder.
  const current =
    value === ''
      ? null
      : (options.find((o) => o.slug === value)?.label ?? value)

  const trimmed = search.trim()
  // Offer a "create" row only when the typed text doesn't already match a
  // predefined slug/label (case-insensitive).
  const matchesExisting = options.some(
    (o) =>
      o.slug.toLowerCase() === trimmed.toLowerCase() ||
      o.label.toLowerCase() === trimmed.toLowerCase(),
  )
  const showCreate = trimmed !== '' && !matchesExisting

  function select(next: string) {
    onChange(next)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !current && 'text-muted-foreground')}>
            {current ?? t('participations:edit.sectorPlaceholder')}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={t('participations:edit.sectorSearch')}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t('participations:edit.sectorEmpty')}</CommandEmpty>
            {showCreate && (
              <CommandGroup>
                <CommandItem value={trimmed} onSelect={() => select(trimmed)}>
                  <Check className="size-4 opacity-0" />
                  {t('participations:edit.sectorCreate', { value: trimmed })}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.slug}
                  // Search matches on both the translated label and the slug.
                  value={`${o.label} ${o.slug}`}
                  // Selecting the active sector again clears it.
                  onSelect={() => select(value === o.slug ? '' : o.slug)}
                >
                  <Check
                    className={cn(
                      'size-4',
                      value === o.slug ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
