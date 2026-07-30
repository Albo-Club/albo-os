import { defineConfig } from 'vitest/config'

// Convex regression suite only (convex/regression.*.test.ts). The existing
// unit tests keep their node --test runner (pnpm test:unit) — do not point
// vitest at tests/.
export default defineConfig({
  test: {
    include: ['convex/**/*.test.ts'],
    // convex-test targets the Convex runtime; edge-runtime is the closest
    // match (see convex/_generated/ai/guidelines.md § Testing).
    environment: 'edge-runtime',
    // Both packages rely on import.meta.glob (a Vite-only construct), so they
    // must be transformed by Vite instead of being loaded from node_modules
    // as-is. @convex-dev/better-auth also ships its /test entry as raw TS.
    server: {
      deps: {
        inline: ['convex-test', '@convex-dev/better-auth'],
      },
    },
    env: {
      // convex/auth.ts reads SITE_URL at module load (imported by lib/auth.ts,
      // itself imported by every function under test).
      SITE_URL: 'http://localhost:3000',
    },
  },
})
