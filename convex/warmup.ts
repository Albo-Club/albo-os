/**
 * Keep the Vercel SSR function warm. The app is internal (2 users), so
 * traffic alone never keeps an instance alive — most visits used to pay a
 * 1-3s cold start on the document request. A GET on SITE_URL every few
 * minutes keeps one instance hot. Triggered by the cron in `crons.ts`.
 */
import { internalAction } from './_generated/server'

export const pingSite = internalAction({
  args: {},
  handler: async () => {
    const siteUrl = process.env.SITE_URL
    // Same localhost guard as convex/auth.ts: never ping a dev deployment.
    if (!siteUrl || /(?:^|\/\/)(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(siteUrl)) {
      return
    }
    try {
      await fetch(siteUrl, { redirect: 'manual' })
    } catch {
      // A failed ping is harmless — the next interval retries. Swallow to
      // keep the cron log clean of transient network noise.
    }
  },
})
