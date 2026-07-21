import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import * as React from 'react'
import { createServerFn } from '@tanstack/react-start'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import appCss from '~/styles/app.css?url'
import { Toaster } from '~/components/ui/sonner'
import { ThemeProvider } from '~/components/app-shell/ThemeProvider'
import { authClient } from '~/lib/auth-client'
import { getLocale } from '~/lib/locale'
import { getI18n } from '~/lib/i18n'

// SSR session preload: read the Better Auth cookie on the document request
// and derive the Convex JWT server-side, so the client authenticates its
// Convex WebSocket immediately instead of chaining get-session → token
// round trips after hydration (official @convex-dev/better-auth pattern).
const getAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { getToken } = await import('~/lib/auth-server')
  try {
    return { token: (await getToken()) ?? null }
  } catch {
    // Preload is best-effort: fall back to the client-side token flow.
    return { token: null }
  }
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  beforeLoad: async ({ context }) => {
    const locale = getLocale()
    // Only fetch during SSR. The result is dehydrated with the beforeLoad
    // context, so hydration reuses it without re-running this. On later
    // client-side navigations the provider already owns the token
    // lifecycle — calling the server here would add a blocking round trip
    // to every SPA navigation.
    if (typeof window !== 'undefined') {
      return { locale, token: null }
    }
    const { token } = await getAuth()
    if (token) {
      // Authenticate SSR Convex queries too (no-op until routes prefetch).
      context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return { locale, token }
  },
  head: () => {
    const t = getI18n(getLocale()).getFixedT(null, 'common')
    return {
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: t('appTitle'),
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
    }
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function NotFound() {
  const { t } = useTranslation('common')
  return <div>{t('notFound')}</div>
}

function RootComponent() {
  const { convexQueryClient, token } = Route.useRouteContext()
  return (
    // initialToken is only consumed on the very first client mount (the
    // provider ignores later prop changes) — the `token: null` returned by
    // client-side navigations is harmless.
    <ConvexBetterAuthProvider
      client={convexQueryClient.convexClient}
      authClient={authClient}
      initialToken={token}
    >
      <RootDocument>
        <Outlet />
      </RootDocument>
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { locale } = Route.useRouteContext()
  const i18n = getI18n(locale)
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            {children}
            <Toaster richColors closeButton />
          </ThemeProvider>
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  )
}
