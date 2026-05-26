import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/all/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/all/participations' })
  },
})
