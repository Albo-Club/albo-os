import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  protectedResourceMetadata,
  protectedResourceOptions,
} from '~/lib/mcp-metadata'

/**
 * RFC 9728 protected resource metadata at the well-known root. Clients that
 * do not insert the resource path try this one first.
 */
export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: ({ request }) => protectedResourceMetadata(request),
      OPTIONS: () => protectedResourceOptions(),
    },
  },
})
