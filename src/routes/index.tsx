import { createFileRoute } from '@tanstack/react-router'

import { Button } from '~/components/ui/button'
import { Logo } from '~/components/Logo'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: 'albo — MVP starter' },
      {
        name: 'description',
        content: 'B2B MVP starter — TanStack Start + Convex.',
      },
    ],
  }),
})

function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-8">
      <Logo className="h-10" />
      <h1 className="text-4xl font-bold tracking-tight">Hello</h1>
      <p className="text-muted-foreground max-w-md text-center text-sm">
        Foundation layer is up. Next phase wires auth, multi-tenant orgs, and
        the AI chat sidebar.
      </p>
      <Button>Click me</Button>
    </main>
  )
}
