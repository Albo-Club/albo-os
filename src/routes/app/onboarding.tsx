import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
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

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/, '3–40 chars, lowercase letters, digits, dashes'),
})

export const Route = createFileRoute('/app/onboarding')({
  component: OnboardingPage,
  head: () => ({ meta: [{ title: 'Create your organization — albo' }] }),
})

function OnboardingPage() {
  const navigate = useNavigate()
  const create = useConvexMutation(api.organizations.create)
  const [loading, setLoading] = useState(false)

  const form = useForm({
    defaultValues: { name: '', slug: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setLoading(true)
      try {
        const { slug } = await create(value)
        toast.success('Organization created')
        navigate({ to: '/app/$orgSlug', params: { orgSlug: slug } })
      } catch (err) {
        const code = err instanceof ConvexError ? (err.data as string) : ''
        const messages: Record<string, string> = {
          slug_taken: 'That slug is already taken',
          invalid_slug: 'Invalid slug shape',
          invalid_name: 'Invalid name',
        }
        toast.error(messages[code] ?? 'Could not create organization')
      } finally {
        setLoading(false)
      }
    },
  })

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your first organization</CardTitle>
          <CardDescription>
            Your workspace is scoped to an organization. You can create more
            later.
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
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        placeholder="Acme Inc."
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
              <form.Field name="slug">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={field.name}>Slug</FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        placeholder="acme"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) =>
                          field.handleChange(e.target.value.toLowerCase())
                        }
                        aria-invalid={invalid || undefined}
                      />
                      <FieldDescription>
                        Used in URLs: <code>/app/{field.state.value || 'your-slug'}</code>
                      </FieldDescription>
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
              {loading ? 'Creating…' : 'Create organization'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
