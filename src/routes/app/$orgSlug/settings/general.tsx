import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../../../convex/_generated/api'
import {
  DEFAULT_SILENCE_MONTHS,
  MAX_SILENCE_MONTHS,
  MIN_SILENCE_MONTHS,
} from '../../../../../convex/lib/reportFreshness'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ImageUpload } from '~/components/ImageUpload'
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
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

export const Route = createFileRoute('/app/$orgSlug/settings/general')({
  component: GeneralSettings,
})

function GeneralSettings() {
  const { t } = useTranslation(['settings', 'validation', 'common'])
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t('validation:name.required'))
          .max(80, t('validation:name.tooLong')),
        reportSilenceMonths: z
          .number()
          .int()
          .min(MIN_SILENCE_MONTHS, t('validation:reportSilenceMonths.range'))
          .max(MAX_SILENCE_MONTHS, t('validation:reportSilenceMonths.range')),
      }),
    [t],
  )
  const { orgSlug } = Route.useParams()
  const me = useConvexQuery(api.users.me)
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const update = useConvexMutation(api.organizations.updateGeneral)
  const setOrgLogo = useConvexMutation(api.files.setOrgLogo)
  const removeOrgLogo = useConvexMutation(api.files.removeOrgLogo)
  const [saving, setSaving] = useState(false)

  const role =
    me?.kind === 'ready'
      ? me.orgs.find((o) => o.slug === orgSlug)?.role
      : undefined
  const canManage = role === 'admin' || role === 'owner'

  const form = useForm({
    defaultValues: {
      name: '',
      reportSilenceMonths: DEFAULT_SILENCE_MONTHS,
    },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (!org) return
      setSaving(true)
      try {
        await update({
          orgId: org._id,
          name: value.name,
          reportSilenceMonths: value.reportSilenceMonths,
        })
        toast.success(t('settings:general.updated'))
      } catch (err) {
        const code = err instanceof ConvexError ? (err.data as string) : ''
        toast.error(
          code === 'insufficient_role'
            ? t('settings:general.errors.insufficient_role')
            : code === 'invalid_name'
              ? t('settings:general.errors.invalid_name')
              : t('settings:general.errors.default'),
        )
      } finally {
        setSaving(false)
      }
    },
  })

  useEffect(() => {
    if (org) {
      form.reset({
        name: org.name,
        reportSilenceMonths: org.reportSilenceMonths ?? DEFAULT_SILENCE_MONTHS,
      })
    }
  }, [org, form])

  if (!org) {
    return (
      <p className="text-muted-foreground text-sm">
        {t('settings:general.loading')}
      </p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:general.title')}</CardTitle>
        <CardDescription>{t('settings:general.description')}</CardDescription>
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
                    <FieldLabel htmlFor={field.name}>
                      {t('settings:general.name')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!canManage}
                      aria-invalid={invalid || undefined}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>

            <form.Field name="reportSilenceMonths">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      {t('settings:general.reportSilence')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="number"
                      min={MIN_SILENCE_MONTHS}
                      max={MAX_SILENCE_MONTHS}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.valueAsNumber)
                      }
                      disabled={!canManage}
                      aria-invalid={invalid || undefined}
                    />
                    <FieldDescription>
                      {t('settings:general.reportSilenceHint')}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>

            <Field>
              <FieldLabel htmlFor="slug">
                {t('settings:general.slug')}
              </FieldLabel>
              <Input id="slug" value={org.slug} disabled />
              <FieldDescription>
                {t('settings:general.slugHint')}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>{t('settings:general.logo')}</FieldLabel>
              <ImageUpload
                currentUrl={org.logoUrl ?? null}
                onPicked={async (storageId) => {
                  await setOrgLogo({ orgId: org._id, storageId })
                }}
                onRemove={async () => {
                  await removeOrgLogo({ orgId: org._id })
                }}
                disabled={!canManage}
              />
              <FieldDescription>
                {t('settings:general.logoHint')}
              </FieldDescription>
            </Field>

            {canManage && (
              <Button type="submit" disabled={saving}>
                {saving
                  ? t('settings:general.saving')
                  : t('settings:general.save')}
              </Button>
            )}
          </FieldGroup>
        </CardContent>
      </form>
    </Card>
  )
}
