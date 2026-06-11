import { useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import { getLastOrgSlugCookie } from '~/lib/lastOrg'

export const Route = createFileRoute('/app/')({
  // Fast-path: the last visited org (device-local cookie) is redirected
  // immediately — server-side on the document request, client-side without
  // waiting for Convex auth nor `users.me`. The org layout re-validates
  // membership and clears the cookie before bouncing back here if it lapsed
  // (see ~/lib/lastOrg). Without a cookie (first login, post-bounce), the
  // component falls back to resolving via `users.me` below.
  beforeLoad: () => {
    const slug = getLastOrgSlugCookie()
    if (slug) {
      throw redirect({
        to: '/app/$orgSlug',
        params: { orgSlug: slug },
        replace: true,
      })
    }
  },
  component: AppIndex,
})

function AppIndex() {
  const navigate = useNavigate()
  const me = useConvexQuery(api.users.me)

  useEffect(() => {
    if (me?.kind !== 'ready') return
    const { orgs, user } = me
    const lastOrgSlug = user.lastOrgSlug
    if (orgs.length === 0) {
      navigate({ to: '/app/onboarding' })
      return
    }
    const target =
      (lastOrgSlug && orgs.find((o) => o.slug === lastOrgSlug)?.slug) ??
      orgs[0].slug
    navigate({ to: '/app/$orgSlug', params: { orgSlug: target } })
  }, [me, navigate])

  return null
}
