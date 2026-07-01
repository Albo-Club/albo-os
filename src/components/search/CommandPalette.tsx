import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Handshake,
  Sparkles,
} from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '~/components/ui/dialog'
import { useDebouncedValue } from '~/hooks/useDebouncedValue'
import { useDealTitle, useFormatters } from '~/components/participations/ParticipationsTable'

/**
 * App-wide command palette (⌘K), scoped to the current org. Searches deals,
 * companies and movements at once (`api.search.global`) and groups the results
 * so the user can pick whether they meant a company or a deal. An "Ask the AI"
 * action forwards the raw query to the assistant panel.
 *
 * `open` state is owned by the org layout (mirrors the ⌘J AI panel toggle).
 */
export function CommandPalette({
  orgId,
  orgSlug,
  open,
  onOpenChange,
  onAskAi,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAskAi: (query: string) => void
}) {
  const { t } = useTranslation(['search', 'participations'])
  const navigate = useNavigate()
  const dealTitle = useDealTitle()
  const { fmtEur } = useFormatters()
  const [value, setValue] = useState('')
  const term = useDebouncedValue(value).trim()

  // Reset the query each time the palette closes so it reopens clean.
  useEffect(() => {
    if (!open) setValue('')
  }, [open])

  const results = useConvexQuery(
    api.search.global,
    open && term.length >= 2 ? { orgId, query: term } : 'skip',
  )

  function close() {
    onOpenChange(false)
  }

  const hasResults =
    results &&
    (results.deals.length > 0 ||
      results.companies.length > 0 ||
      results.transactions.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">{t('search:placeholder')}</DialogTitle>
        {/* Server-side filtering: disable cmdk's own matching. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={value}
            onValueChange={setValue}
            placeholder={t('search:placeholder')}
          />
          <CommandList>
            {term.length >= 2 && !hasResults && (
              <CommandEmpty>{t('search:empty')}</CommandEmpty>
            )}

            {results && results.deals.length > 0 && (
              <CommandGroup heading={t('search:groups.deals')}>
                {results.deals.map((d) => (
                  <CommandItem
                    key={d._id}
                    value={`deal-${d._id}`}
                    onSelect={() => {
                      close()
                      void navigate({
                        to: '/app/$orgSlug/deals/$dealId',
                        params: { orgSlug, dealId: d._id },
                      })
                    }}
                  >
                    <Handshake className="size-4 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">
                      {d.targetName ??
                        dealTitle({
                          name: d.name,
                          instrumentKind: d.instrumentKind,
                        })}
                      {d.name && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {d.name}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t(`participations:instrument.${d.instrumentKind}`, {
                        defaultValue: d.instrumentKind,
                      })}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.companies.length > 0 && (
              <CommandGroup heading={t('search:groups.companies')}>
                {results.companies.map((c) => (
                  <CommandItem
                    key={c._id}
                    value={`company-${c._id}`}
                    onSelect={() => {
                      close()
                      void navigate({
                        to: '/app/$orgSlug/participations/$companyId',
                        params: { orgSlug, companyId: c._id },
                      })
                    }}
                  >
                    <Building2 className="size-4 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.sector && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {t(`participations:sectors.${c.sector}`, {
                          defaultValue: c.sector,
                        })}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.transactions.length > 0 && (
              <CommandGroup heading={t('search:groups.transactions')}>
                {results.transactions.map((tx) => (
                  <CommandItem
                    key={tx._id}
                    value={`tx-${tx._id}`}
                    onSelect={() => {
                      close()
                      if (tx.dealId) {
                        void navigate({
                          to: '/app/$orgSlug/deals/$dealId',
                          params: { orgSlug, dealId: tx.dealId },
                        })
                      } else {
                        void navigate({
                          to: '/app/$orgSlug/cash',
                          params: { orgSlug },
                        })
                      }
                    }}
                  >
                    {tx.direction === 'in' ? (
                      <ArrowDownLeft className="size-4 shrink-0 opacity-60" />
                    ) : (
                      <ArrowUpRight className="size-4 shrink-0 opacity-60" />
                    )}
                    <span className="flex-1 truncate">{tx.label}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {fmtEur(tx.amount)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {term.length >= 2 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="ask-ai"
                    onSelect={() => {
                      close()
                      onAskAi(term)
                    }}
                  >
                    <Sparkles className="size-4 shrink-0 opacity-60" />
                    <span className="truncate">
                      {t('search:askAi', { query: term })}
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
