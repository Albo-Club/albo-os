import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

const ba = convexBetterAuthReactStart({
  convexUrl: import.meta.env.VITE_CONVEX_URL,
  convexSiteUrl: import.meta.env.VITE_CONVEX_SITE_URL,
})

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      ANY: ({ request }) => ba.handler(request),
    },
  },
})
