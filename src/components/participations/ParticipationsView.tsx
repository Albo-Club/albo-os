import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ParticipationsTable } from './ParticipationsTable'
import type { RefObject } from 'react'

import type { DealRow } from './ParticipationsTable'
import { cn } from '~/lib/utils'

/**
 * Stacks two participation tables: the active deals on top (unchanged) and a
 * collapsed-by-default section for settled deals (fully_exited / written_off)
 * below, with a MOIC column + win/lost badge. The split on `status` is the
 * only partitioning rule — `partially_exited` stays with the active deals.
 *
 * Both tables share the single `deals` round-trip fetched by the route; the
 * export stays wired on the full, unsplit set (active + settled) so its scope
 * is unchanged.
 */
export function ParticipationsView({
  deals,
  showOrg = false,
  orgSlug,
  exportRef,
}: {
  deals: Array<DealRow> | undefined
  showOrg?: boolean
  orgSlug?: string
  exportRef?: RefObject<(() => void) | null>
}) {
  const { t } = useTranslation('participations')
  const [open, setOpen] = useState(false)

  const { active, settled } = useMemo(() => {
    if (!deals) return { active: undefined, settled: undefined }
    const activeDeals: Array<DealRow> = []
    const settledDeals: Array<DealRow> = []
    for (const d of deals) {
      if (d.status === 'fully_exited' || d.status === 'written_off') {
        settledDeals.push(d)
      } else {
        activeDeals.push(d)
      }
    }
    return { active: activeDeals, settled: settledDeals }
  }, [deals])

  return (
    <div className="space-y-6">
      <ParticipationsTable
        deals={active}
        showOrg={showOrg}
        orgSlug={orgSlug}
        exportRef={exportRef}
        // Keep the export on the full deal set, not just the active subset.
        exportDeals={deals}
      />

      {settled && settled.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
            {t('settled.sectionTitle', { count: settled.length })}
          </button>
          {open && (
            <ParticipationsTable
              deals={settled}
              showOrg={showOrg}
              orgSlug={orgSlug}
              settled
            />
          )}
        </section>
      )}
    </div>
  )
}
