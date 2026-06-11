import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

/** Rows rendered per page (local display pagination for tables). */
export const PAGE_SIZE = 50

/**
 * Local display pagination: the data stays complete on the client (upstream
 * search, filters, counters and selections are unchanged), only the render is
 * sliced into pages of PAGE_SIZE rows — it's the number of mounted rows that
 * makes a table janky, not the data. `resetKey` snaps back to the first page
 * (search/sort/tab change); the current page is clamped when the list shrinks
 * (rows removed by reactivity).
 */
export function usePagination(totalRows: number, resetKey: string) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  return { page: Math.min(page, pageCount - 1), pageCount, setPage }
}

/** "Page X of Y" bar + prev/next, hidden when there's only one page. */
export function PaginationFooter({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation('common')
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 py-3">
      <span className="text-muted-foreground text-sm tabular-nums">
        {t('pagination.pageOf', { current: page + 1, total: pageCount })}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        <span className="sr-only">{t('pagination.previous')}</span>
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        <span className="sr-only">{t('pagination.next')}</span>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
