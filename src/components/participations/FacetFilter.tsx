import { ListFilter } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

/** A multi-select facet option: stored raw value + its localized label. */
export type FacetOption = { value: string; label: string }

/**
 * Dashed-border dropdown holding the checkbox options of one facet
 * (instrument / status / sector). The menu stays open across clicks so
 * several values can be toggled in a row; the trigger shows a count badge
 * once anything is selected. Shared by the grouped participations view and
 * the flat deals list.
 */
export function FacetFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: Array<FacetOption>
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <ListFilter className="size-4" />
          {label}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal tabular-nums"
              >
                {selected.size}
              </Badge>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-auto">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.has(opt.value)}
            // Keep the menu open so multiple values can be toggled at once.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(opt.value)}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
