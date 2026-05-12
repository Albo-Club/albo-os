import { useEffect } from 'react'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useConvexAuth } from 'convex/react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { api } from '../../../convex/_generated/api'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

function AppLayout() {
  const navigate = useNavigate()
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth()
  const me = useConvexQuery(
    api.users.me,
    isAuthenticated ? {} : 'skip',
  )
  const provisionMe = useConvexMutation(api.users.provisionMe)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [authLoading, isAuthenticated, navigate])

  useEffect(() => {
    if (me?.kind === 'unprovisioned') {
      void provisionMe()
    }
  }, [me?.kind, provisionMe])

  if (authLoading || !isAuthenticated || !me || me.kind !== 'ready') {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </main>
    )
  }

  return <Outlet />
}
