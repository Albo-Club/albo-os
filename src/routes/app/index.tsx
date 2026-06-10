import { useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useConvexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'
import { getLastOrgSlugCookie } from '~/lib/lastOrg'

export const Route = createFileRoute('/app/')({
  // Fast-path : la dernière org visitée (cookie device-local) est redirigée
  // immédiatement — côté serveur dès la requête document, côté client sans
  // attendre l'auth Convex ni `users.me`. Le layout d'org re-valide la
  // membership et efface le cookie avant de revenir ici si elle a sauté
  // (cf. ~/lib/lastOrg). Sans cookie (premier login, post-bounce), le
  // composant retombe sur la résolution via `users.me` ci-dessous.
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
