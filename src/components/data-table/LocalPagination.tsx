import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

/** Lignes rendues par page (pagination locale d'affichage des tables). */
export const PAGE_SIZE = 50

/**
 * Pagination locale d'affichage : les données restent complètes côté client
 * (recherche, filtres, compteurs et sélections amont inchangés), seul le
 * rendu est découpé en pages de PAGE_SIZE lignes — c'est le nombre de lignes
 * montées qui fait ramer une table, pas la donnée. `resetKey` ramène à la
 * première page (changement de recherche/tri/onglet) ; la page courante est
 * bornée quand la liste rétrécit (lignes retirées par la réactivité).
 */
export function usePagination(totalRows: number, resetKey: string) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  return { page: Math.min(page, pageCount - 1), pageCount, setPage }
}

/** Barre « Page X sur Y » + précédent/suivant, masquée s'il n'y a qu'une page. */
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
