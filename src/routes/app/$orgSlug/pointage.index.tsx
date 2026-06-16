import { createFileRoute, redirect } from '@tanstack/react-router'

// Pointage merged into the Cash section: its matching queue is now the
// « À pointer » filter of the Transactions ledger. Kept as a redirect so old
// links/bookmarks (/app/$orgSlug/pointage) still resolve.
export const Route = createFileRoute('/app/$orgSlug/pointage/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/$orgSlug/cash',
      params: { orgSlug: params.orgSlug },
      search: { tab: 'transactions' },
    })
  },
})
