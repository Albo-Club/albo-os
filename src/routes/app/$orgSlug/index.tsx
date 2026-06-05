import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/$orgSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/$orgSlug/participations',
      params: { orgSlug: params.orgSlug },
    })
  },
})
