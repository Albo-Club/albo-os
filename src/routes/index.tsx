import { createFileRoute, redirect } from '@tanstack/react-router'

// Albo OS is an internal tool — no marketing landing. `/` forwards to `/app`
// in `beforeLoad` so the redirect happens server-side on the document request
// (HTTP redirect, no hydrated "redirecting" screen, no client hop). The
// `/app` guard then sends signed-out visitors to `/login`.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/app', replace: true })
  },
})
