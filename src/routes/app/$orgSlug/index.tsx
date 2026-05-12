import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../../convex/_generated/api'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

const inviteSchema = z.object({
  email: z.email('Invalid email'),
  role: z.enum(['member', 'admin']),
})

type MeReady = Extract<
  ReturnType<typeof useConvexQuery<typeof api.users.me>>,
  { kind: 'ready' }
>

export const Route = createFileRoute('/app/$orgSlug/')({
  component: OrgDashboard,
})

function OrgDashboard() {
  const { orgSlug } = Route.useParams()
  const me = useConvexQuery(api.users.me)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const members = useConvexQuery(
    api.organizations.listMembers,
    org ? { orgId: org._id } : 'skip',
  )
  const canInviteHere = me?.kind === 'ready' && canInvite(me, orgSlug)
  const pendingInvites = useConvexQuery(
    api.invitations.listForOrg,
    org && canInviteHere ? { orgId: org._id } : 'skip',
  )
  const createInvite = useConvexMutation(api.invitations.create)
  const revokeInvite = useConvexMutation(api.invitations.revoke)
  const [loading, setLoading] = useState(false)

  const form = useForm({
    defaultValues: { email: '', role: 'member' as 'member' | 'admin' },
    validators: { onChange: inviteSchema, onSubmit: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!org) return
      setLoading(true)
      try {
        await createInvite({ orgId: org._id, ...value })
        toast.success(`Invitation sent to ${value.email}`)
        formApi.reset()
      } catch (err) {
        const code = err instanceof ConvexError ? (err.data as string) : ''
        const messages: Record<string, string> = {
          already_invited: 'There is already a pending invitation for this email',
          invalid_email: 'Invalid email',
          insufficient_role: 'You need to be admin or owner to invite',
          not_a_member: 'You are not a member of this organization',
        }
        toast.error(messages[code] ?? 'Could not send invitation')
      } finally {
        setLoading(false)
      }
    },
  })

  const myRole =
    me?.kind === 'ready'
      ? me.orgs.find((o) => o.slug === orgSlug)?.role
      : undefined

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{org?.name ?? orgSlug}</CardTitle>
          <CardDescription>
            Dashboard placeholder — proper settings UI lands in phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Role: <code>{myRole ?? '—'}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>People with access to this org.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y text-sm">
            {(members ?? []).map((m) => (
              <li key={m._id} className="flex justify-between py-2">
                <span>{m.name ?? m.email}</span>
                <code className="text-muted-foreground">{m.role}</code>
              </li>
            ))}
            {members && members.length === 0 && (
              <li className="text-muted-foreground py-2">No members yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      {canInviteHere && (
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>
              They'll receive an email with a link to accept.
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
            <CardContent>
              <FieldGroup>
                <form.Field name="email">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="email"
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
                <form.Field name="role">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>Role</FieldLabel>
                      <select
                        id={field.name}
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) =>
                          field.handleChange(
                            e.target.value as 'member' | 'admin',
                          )
                        }
                        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </Field>
                  )}
                </form.Field>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Sending…' : 'Send invitation'}
                </Button>
              </FieldGroup>
            </CardContent>
          </form>

          {pendingInvites && pendingInvites.length > 0 && (
            <CardContent className="border-t pt-4">
              <p className="mb-2 text-sm font-medium">Pending invitations</p>
              <ul className="divide-border divide-y text-sm">
                {pendingInvites.map((inv) => (
                  <li
                    key={inv._id}
                    className="flex items-center justify-between py-2"
                  >
                    <span>
                      {inv.email}{' '}
                      <code className="text-muted-foreground">
                        {inv.role}
                      </code>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await revokeInvite({ invitationId: inv._id })
                          toast.success('Invitation revoked')
                        } catch {
                          toast.error('Could not revoke')
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </main>
  )
}

function canInvite(me: MeReady, slug: string): boolean {
  const role = me.orgs.find((o) => o.slug === slug)?.role
  return role === 'admin' || role === 'owner'
}
