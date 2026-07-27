import { createFileRoute, redirect } from '@tanstack/react-router'

// The org dashboard was retired: the org root now forwards to the
// participations list (same server-side beforeLoad redirect pattern as
// /app/$orgSlug/pointage). Old links/bookmarks to /app/$orgSlug still resolve.
export const Route = createFileRoute('/app/$orgSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/$orgSlug/participations',
      params: { orgSlug: params.orgSlug },
      replace: true,
    })
  },
})
