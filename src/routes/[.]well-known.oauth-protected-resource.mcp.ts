import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import {
  protectedResourceMetadata,
  protectedResourceOptions,
} from '~/lib/mcp-metadata'

/**
 * RFC 9728 §3 path-inserted form: the resource identifier is
 * `<origin>/mcp`, so its metadata lives at
 * `/.well-known/oauth-protected-resource/mcp`. This is the URL the 401
 * challenge advertises.
 */
export const Route = createFileRoute(
  '/.well-known/oauth-protected-resource/mcp',
)({
  server: {
    handlers: {
      GET: ({ request }) => protectedResourceMetadata(request),
      OPTIONS: () => protectedResourceOptions(),
    },
  },
})
