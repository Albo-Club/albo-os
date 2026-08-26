/**
 * Better Auth plugin — `POST /invitation/set-password`.
 *
 * Closes the dead end an invitee hits when a Better Auth row already exists
 * for their address but nobody ever proved ownership of the mailbox: the
 * accept page used to show a "sign in with your password" form for a password
 * that was never set (or was typed during someone else's aborted attempt), and
 * neither a magic link nor a reset could be reached from there.
 *
 * The endpoint lets the invitee set their own password on that unverified row,
 * gated by the invitation token — the same proof of inbox possession that
 * already gates the verification bypass at signup (`user.create.before` in
 * convex/auth.ts). The unproven credential and the sessions standing on the
 * row are dropped first, exactly as Better Auth does when a magic link lands
 * on an unverified user (`revokeUnprovenAccountAccess`).
 *
 * Hard limit: a **verified** account is refused (`account_already_active`). An
 * invitation token must never overwrite the password of a real account — that
 * would be a takeover primitive. Those users sign in, or go through
 * `/forgot-password`.
 *
 * The endpoint only sets credentials; it never opens a session. The caller
 * chains `signIn.email` like the signup path does.
 */
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from 'better-auth/api'
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils'
import * as z from 'zod'
import { internal } from '../_generated/api'
import { emailsMatch } from './invitations'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from '../_generated/dataModel'

export const invitationPassword = (ctx: GenericCtx<DataModel>) => ({
  id: 'invitation-password',
  endpoints: {
    setInvitationPassword: createAuthEndpoint(
      '/invitation/set-password',
      {
        method: 'POST',
        requireHeaders: true,
        use: [formCsrfMiddleware],
        body: z.object({
          token: z.string(),
          email: z.string(),
          password: z.string(),
          name: z.string().optional(),
        }),
      },
      async (endpointCtx) => {
        const { token, email, password, name } = endpointCtx.body
        const mutCtx = requireRunMutationCtx(ctx)

        // The invited address comes from the token, never from the body: the
        // body is only cross-checked so a stale page can't set a password on
        // an address the user isn't looking at.
        const invitedEmail = await mutCtx.runQuery(
          internal.invitations.liveInviteEmail,
          { token },
        )
        if (!invitedEmail || !emailsMatch(invitedEmail, email)) {
          throw new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN' })
        }

        const config = endpointCtx.context.password.config
        if (password.length < config.minPasswordLength) {
          throw new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_SHORT' })
        }
        if (password.length > config.maxPasswordLength) {
          throw new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_LONG' })
        }

        const adapter = endpointCtx.context.internalAdapter
        const found = await adapter.findUserByEmail(invitedEmail)
        const user = found?.user
        // No row: the invitee signs up instead (the accept page never calls
        // this endpoint in that state). Verified row: a real account, off
        // limits — see the header.
        if (!user) throw new APIError('BAD_REQUEST', { code: 'USER_NOT_FOUND' })
        if (user.emailVerified) {
          throw new APIError('BAD_REQUEST', { code: 'ACCOUNT_ALREADY_ACTIVE' })
        }

        for (const account of await adapter.findAccounts(user.id)) {
          if (account.providerId === 'credential') {
            await adapter.deleteAccount(account.id)
          }
        }
        await adapter.deleteUserSessions(user.id)

        await adapter.createAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await endpointCtx.context.password.hash(password),
        })
        // Verifying is what the invitation token buys: following the emailed
        // link proves the mailbox, so the invitee is spared the inbox round
        // trip and `signIn.email` passes on the next call.
        await adapter.updateUser(user.id, {
          emailVerified: true,
          ...(name && !user.name ? { name } : {}),
        })

        return endpointCtx.json({ status: true })
      },
    ),
  },
})
