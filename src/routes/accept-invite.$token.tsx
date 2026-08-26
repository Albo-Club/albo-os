import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useConvexAuth } from 'convex/react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useForm } from '@tanstack/react-form'
import { Trans, useTranslation } from 'react-i18next'
import { z } from 'zod'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'

import { api } from '../../convex/_generated/api'
import { authClient } from '~/lib/auth-client'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { classifyAuthError, formatAuthError } from '~/lib/auth-errors'
import { isPasswordPwned } from '~/lib/hibp'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { PasswordInput } from '~/components/auth/password-input'
import { PasswordStrength } from '~/components/auth/password-strength'
import { VerificationSentCard } from '~/components/auth/verification-sent'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

// Better Auth appends ?error=... when a magic-link verify fails — an expired
// link (they live 5 minutes), one already consumed, or one for an address with
// no account — and redirects back to the callbackURL, which for the invite
// flow is this page. Swallowing it left the invitee on the very same form with
// no clue anything had failed.
const searchSchema = z.object({
  error: z.string().optional(),
})

export const Route = createFileRoute('/accept-invite/$token')({
  validateSearch: searchSchema,
  component: AcceptInvitePage,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'auth',
        )('acceptInvite.metaTitle'),
      },
    ],
  }),
})

type Preview = NonNullable<
  ReturnType<typeof useConvexQuery<typeof api.invitations.preview>>
>

function AcceptInvitePage() {
  const { t } = useTranslation('auth')
  const { token } = Route.useParams()
  const { error: linkError } = Route.useSearch()
  const navigate = useNavigate()
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth()
  const preview = useConvexQuery(api.invitations.preview, { token })
  const me = useConvexQuery(api.users.me, isAuthenticated ? {} : 'skip')
  const acceptMutation = useConvexMutation(api.invitations.accept)
  const triedAccept = useRef(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  useEffect(() => {
    if (!preview || preview.kind !== 'ok') return
    if (authLoading || !isAuthenticated) return
    if (me?.kind !== 'ready' && me?.kind !== 'unprovisioned') return
    const myEmail = me.kind === 'ready' ? me.user.email : null
    if (myEmail && myEmail.toLowerCase() !== preview.email.toLowerCase()) return
    if (triedAccept.current) return
    triedAccept.current = true
    ;(async () => {
      try {
        const { orgSlug } = await acceptMutation({ token })
        toast.success(t('acceptInvite.accepted'))
        navigate({ to: '/app/$orgSlug', params: { orgSlug } })
      } catch (err) {
        const code = err instanceof ConvexError ? (err.data as string) : ''
        const known = ['not_found', 'already_accepted', 'expired', 'email_mismatch']
        setAcceptError(
          known.includes(code)
            ? t(`acceptInvite.errors.${code}`)
            : t('acceptInvite.errors.generic'),
        )
        triedAccept.current = false
      }
    })()
  }, [preview, authLoading, isAuthenticated, me, token, navigate, acceptMutation])

  if (!preview)
    return <LoadingCard message={t('acceptInvite.loadingInvitation')} />
  if (preview.kind === 'not_found') {
    return (
      <InfoCard
        title={t('acceptInvite.notFound.title')}
        message={t('acceptInvite.notFound.message')}
      />
    )
  }
  if (preview.kind === 'expired') {
    return (
      <InfoCard
        title={t('acceptInvite.expired.title')}
        message={t('acceptInvite.expired.message')}
      />
    )
  }
  if (preview.kind === 'already_accepted') {
    return (
      <InfoCard
        title={t('acceptInvite.alreadyAccepted.title')}
        message={t('acceptInvite.alreadyAccepted.message')}
      />
    )
  }

  if (authLoading) return <LoadingCard />

  if (isAuthenticated) {
    if (me?.kind !== 'ready' && me?.kind !== 'unprovisioned') {
      return <LoadingCard />
    }
    const myEmail = me.kind === 'ready' ? me.user.email : null
    const isMismatch =
      myEmail && myEmail.toLowerCase() !== preview.email.toLowerCase()
    if (isMismatch) {
      return <SwitchAccountCard preview={preview} currentEmail={myEmail} />
    }
    return (
      <LoadingCard
        message={
          acceptError ?? t('acceptInvite.joining', { orgName: preview.orgName })
        }
        error={!!acceptError}
      />
    )
  }

  // Three states, never two. `claimable` is a Better Auth row nobody ever
  // proved they own (unverified): asking it for a password would ask for one
  // that was never set — the dead end this page used to have. See
  // `invitations.preview`.
  if (preview.accountState === 'active') {
    return <SignInToAccept preview={preview} linkError={linkError} />
  }
  return (
    <CreateAccountCard
      preview={preview}
      token={token}
      claim={preview.accountState === 'claimable'}
      linkError={linkError}
    />
  )
}

/**
 * Surfaces the `?error=` Better Auth hands back when a magic-link verify
 * fails. Without it the redirect lands on an unchanged form and the failure is
 * invisible.
 */
function LinkErrorAlert({ code }: { code?: string }) {
  const { t } = useTranslation('auth')
  if (!code) return null
  const key =
    code === 'INVALID_TOKEN'
      ? 'expired'
      : code === 'new_user_signup_disabled'
        ? 'noAccount'
        : 'generic'
  return (
    <Alert variant="destructive">
      <AlertDescription>{t(`acceptInvite.linkErrors.${key}`)}</AlertDescription>
    </Alert>
  )
}

function LoadingCard({
  message,
  error = false,
}: {
  message?: string
  error?: boolean
}) {
  const { t } = useTranslation(['auth', 'common'])
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {error ? t('auth:acceptInvite.holdOn') : t('auth:acceptInvite.oneMoment')}
          </CardTitle>
          <CardDescription>
            {message ?? t('common:loadingEllipsis')}
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </main>
  )
}

function InfoCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </main>
  )
}

function SwitchAccountCard({
  preview,
  currentEmail,
}: {
  preview: Extract<Preview, { kind: 'ok' }>
  currentEmail: string
}) {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('acceptInvite.wrongAccount.title')}</CardTitle>
          <CardDescription>
            <span className="block break-words">
              <Trans
                t={t}
                i18nKey="acceptInvite.wrongAccount.body"
                values={{ currentEmail, invitedEmail: preview.email }}
              />
            </span>
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-3">
          {/* Consented sign-out: the user explicitly chooses to drop their
              current session. We reload the same /accept-invite/<token> URL so
              the token is preserved and the page re-renders into the sign-in /
              sign-up flow for the invited email. */}
          <Button
            className="w-full"
            disabled={loading}
            onClick={async () => {
              setLoading(true)
              await authClient.signOut()
              window.location.reload()
            }}
          >
            {loading && <Spinner />}
            {t('acceptInvite.wrongAccount.signOut')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={loading}
            onClick={() => navigate({ to: '/app' })}
          >
            {t('acceptInvite.wrongAccount.cancel')}
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

function SignInToAccept({
  preview,
  linkError,
}: {
  preview: Extract<Preview, { kind: 'ok' }>
  linkError?: string
}) {
  const { t } = useTranslation(['auth', 'validation', 'errors'])
  const te = (k: string) => t(`errors:${k}`)
  const signInSchema = useMemo(
    () =>
      z.object({
        password: z.string().min(1, t('validation:password.required')),
      }),
    [t],
  )
  const [loading, setLoading] = useState(false)
  const [magicLoading, setMagicLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [unverified, setUnverified] = useState(false)

  const form = useForm({
    defaultValues: { password: '' },
    validators: { onChange: signInSchema, onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setLoading(true)
      const { error } = await authClient.signIn.email({
        email: preview.email,
        password: value.password,
      })
      setLoading(false)
      if (error) {
        const code = classifyAuthError(error)
        // Same affordance as /login: a verified account can still be sitting
        // on an unverified Better Auth row after a legacy signup, and a toast
        // alone leaves no way out.
        if (code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(true)
          return
        }
        toast.error(formatAuthError(code, 'signin', te))
        return
      }
      // useConvexAuth flips → auto-accept effect fires in parent
    },
  })

  const onResendVerification = async () => {
    setResendLoading(true)
    const { error } = await authClient.sendVerificationEmail({
      email: preview.email,
      callbackURL: window.location.pathname,
    })
    setResendLoading(false)
    if (error) {
      toast.error(formatAuthError(classifyAuthError(error), 'verify', te))
      return
    }
    toast.success(t('auth:signIn.verificationResent'))
  }

  const onMagicLink = async () => {
    setMagicLoading(true)
    const { error } = await authClient.signIn.magicLink({
      email: preview.email,
      callbackURL: window.location.pathname,
    })
    setMagicLoading(false)
    if (error) {
      toast.error(formatAuthError(classifyAuthError(error), 'signin', te))
      return
    }
    toast.success(t('auth:magic.sentInbox'))
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {t('auth:acceptInvite.join', { orgName: preview.orgName })}
          </CardTitle>
          <CardDescription>
            <Trans
              t={t}
              i18nKey="auth:acceptInvite.signInDescription"
              values={{ email: preview.email }}
            />
          </CardDescription>
        </CardHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <CardContent className="flex flex-col gap-6">
            <LinkErrorAlert code={linkError} />
            {unverified && (
              <div className="border-border bg-muted/50 text-foreground rounded-md border p-3 text-sm">
                <p className="mb-2">
                  <Trans
                    t={t}
                    i18nKey="auth:signIn.unverified"
                    values={{ email: preview.email }}
                  />
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onResendVerification}
                  disabled={resendLoading}
                >
                  {resendLoading && <Spinner />}
                  {t('auth:signIn.resendVerification')}
                </Button>
              </div>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">
                  {t('auth:fields.email')}
                </FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={preview.email}
                  readOnly
                  disabled
                />
              </Field>
              <form.Field name="password">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <div className="flex items-center">
                        <FieldLabel htmlFor={field.name}>
                          {t('auth:fields.password')}
                        </FieldLabel>
                        <Link
                          to="/forgot-password"
                          className="text-muted-foreground ml-auto text-sm underline-offset-4 hover:underline"
                        >
                          {t('auth:signIn.forgot')}
                        </Link>
                      </div>
                      <PasswordInput
                        id={field.name}
                        name={field.name}
                        autoComplete="current-password"
                        autoFocus
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={invalid || undefined}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Spinner />}
              {t('auth:acceptInvite.accept')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onMagicLink}
              disabled={magicLoading}
            >
              {magicLoading && <Spinner />}
              {t('auth:signIn.magicLink')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}

/**
 * One form, two doors — both end on a complete account (verified email + a
 * password the invitee chose):
 *  - `claim: false` — no Better Auth row yet: plain signup, the invitation
 *    token rides along so verification is skipped.
 *  - `claim: true` — an unverified row exists: the token lets the invitee set
 *    their own password on it (`/invitation/set-password`), which also
 *    verifies the address. Signing in is then the same chained call.
 */
function CreateAccountCard({
  preview,
  token,
  claim,
  linkError,
}: {
  preview: Extract<Preview, { kind: 'ok' }>
  token: string
  claim: boolean
  linkError?: string
}) {
  const { t } = useTranslation(['auth', 'validation', 'errors'])
  const te = (k: string) => t(`errors:${k}`)
  const signUpSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('validation:name.required')),
        password: z.string().min(12, t('validation:password.min12')),
      }),
    [t],
  )
  const [loading, setLoading] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)

  const form = useForm({
    defaultValues: { name: '', password: '' },
    validators: { onChange: signUpSchema, onSubmit: signUpSchema },
    onSubmit: async ({ value }) => {
      setLoading(true)
      if (claim) {
        // The row exists but nobody ever proved they own the mailbox, so
        // signUp would 409 and signIn has nothing to check against. The
        // endpoint sets the password the invitee just picked and verifies the
        // address; the sign-in below is then the ordinary one.
        const { error } = await authClient.$fetch('/invitation/set-password', {
          method: 'POST',
          body: {
            token,
            email: preview.email,
            password: value.password,
            name: value.name,
          },
        })
        if (error) {
          setLoading(false)
          toast.error(formatAuthError(classifyAuthError(error), 'signup', te))
          return
        }
        const { error: signInError } = await authClient.signIn.email({
          email: preview.email,
          password: value.password,
        })
        setLoading(false)
        if (signInError) {
          toast.error(
            formatAuthError(classifyAuthError(signInError), 'signin', te),
          )
        }
        return
      }
      // Carry the invitation token in the signup body: the user.create.before
      // hook (convex/auth.ts) validates it and marks the invitee emailVerified,
      // so no inbox round-trip is needed. `callbackURL` is a safety net — if the
      // token-gated bypass ever doesn't apply, the verification email still
      // lands back here so the invitation is accepted on return. `inviteToken`
      // is an extra body field (forwarded by the BA client, read server-side,
      // never persisted) — hence the cast past BA's declared signup fields.
      const { error } = await authClient.signUp.email({
        email: preview.email,
        password: value.password,
        name: value.name,
        callbackURL: `/accept-invite/${token}`,
        inviteToken: token,
      } as Parameters<typeof authClient.signUp.email>[0])
      if (error) {
        setLoading(false)
        toast.error(formatAuthError(classifyAuthError(error), 'signup', te))
        return
      }
      // signUp never opens a session while requireEmailVerification is on, so
      // sign in to get one — the invitee is already verified by the hook. The
      // parent's auto-accept effect fires once useConvexAuth flips.
      const { error: signInError } = await authClient.signIn.email({
        email: preview.email,
        password: value.password,
      })
      setLoading(false)
      if (signInError) {
        // Bypass didn't apply (e.g. token consumed mid-flight): fall back to
        // the standard verification screen. The verification email was already
        // sent on signup with the accept-invite callbackURL.
        setVerificationSent(true)
      }
    },
  })

  if (verificationSent) {
    return (
      <VerificationSentCard
        description={
          <Trans
            t={t}
            i18nKey="auth:acceptInvite.verifyDescription"
            values={{ email: preview.email, orgName: preview.orgName }}
          />
        }
      />
    )
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {t('auth:acceptInvite.join', { orgName: preview.orgName })}
          </CardTitle>
          <CardDescription>
            <Trans
              t={t}
              i18nKey={
                claim
                  ? 'auth:acceptInvite.claimDescription'
                  : 'auth:acceptInvite.signUpDescription'
              }
              values={{ email: preview.email }}
            />
          </CardDescription>
        </CardHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <CardContent className="flex flex-col gap-6">
            <LinkErrorAlert code={linkError} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">
                  {t('auth:fields.email')}
                </FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={preview.email}
                  readOnly
                  disabled
                />
              </Field>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={field.name}>
                        {t('auth:fields.yourName')}
                      </FieldLabel>
                      <Input
                        id={field.name}
                        autoComplete="name"
                        autoFocus
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={invalid || undefined}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field
                name="password"
                validators={{
                  onBlurAsync: async ({ value }) => {
                    if (!value || value.length < 12) return undefined
                    const { pwned } = await isPasswordPwned(value)
                    return pwned
                      ? { message: t('validation:password.pwned') }
                      : undefined
                  },
                }}
              >
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  const isValidating = field.state.meta.isValidating
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={field.name}>
                        {t('auth:fields.password')}
                      </FieldLabel>
                      <PasswordInput
                        id={field.name}
                        name={field.name}
                        autoComplete="new-password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={invalid || undefined}
                      />
                      <FieldDescription>
                        {isValidating ? (
                          <span
                            className="flex items-center gap-1.5"
                            aria-live="polite"
                          >
                            <Spinner className="size-3" />
                            {t('auth:password.checking')}
                          </span>
                        ) : (
                          t('auth:password.hint')
                        )}
                      </FieldDescription>
                      <PasswordStrength
                        value={field.state.value}
                        userInputs={[
                          preview.email,
                          form.getFieldValue('name'),
                        ]}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Spinner />}
              {t('auth:acceptInvite.accept')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
