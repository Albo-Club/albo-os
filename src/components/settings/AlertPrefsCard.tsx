import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

/** Keep aligned with NOTIFICATION_KINDS (convex/lib/notificationPrefs.ts). */
const KINDS = [
  'cashThreshold',
  'overdueEntries',
  'bankConnection',
  'indexFailure',
  'reportIssues',
  'weeklyReports',
] as const

type Kind = (typeof KINDS)[number]

export function AlertPrefsCard({
  orgId,
  members,
  myUserId,
  canManage,
}: {
  orgId: Id<'organizations'> | undefined
  members:
    | Array<{ userId: Id<'users'>; email: string; name: string | null }>
    | undefined
  myUserId: Id<'users'> | undefined
  canManage: boolean
}) {
  const { t } = useTranslation(['settings'])
  const prefs = useConvexQuery(
    api.organizations.listAlertPrefs,
    orgId ? { orgId } : 'skip',
  )
  const setPref = useConvexMutation(api.organizations.setMemberAlertPref)

  const byUser = new Map(prefs?.map((p) => [p.userId, p.prefs]))

  async function handleToggle(
    userId: Id<'users'>,
    kind: Kind,
    enabled: boolean,
  ) {
    if (!orgId) return
    try {
      await setPref({ orgId, userId, kind, enabled })
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      toast.error(
        t(
          code === 'insufficient_role' || code === 'not_found'
            ? `settings:members.errors.${code}`
            : 'settings:members.errors.default',
        ),
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:alerts.title')}</CardTitle>
        <CardDescription>{t('settings:alerts.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!members || !prefs ? (
          <p className="text-muted-foreground text-sm">
            {t('settings:members.loading')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings:alerts.member')}</TableHead>
                  {KINDS.map((kind) => (
                    <TableHead key={kind} className="text-center">
                      {t(`settings:alerts.kinds.${kind}.label`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const mine = byUser.get(m.userId)
                  const editable = canManage || m.userId === myUserId
                  return (
                    <TableRow key={m.userId}>
                      <TableCell className="font-medium">
                        {m.name ?? m.email}
                      </TableCell>
                      {KINDS.map((kind) => (
                        <TableCell key={kind} className="text-center">
                          <Checkbox
                            checked={mine?.[kind] ?? true}
                            disabled={!editable}
                            aria-label={t(
                              `settings:alerts.kinds.${kind}.label`,
                            )}
                            onCheckedChange={(checked) =>
                              handleToggle(m.userId, kind, checked === true)
                            }
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <dl className="text-muted-foreground space-y-2 text-xs">
          {KINDS.map((kind) => (
            <div key={kind}>
              <dt className="text-foreground inline font-medium">
                {t(`settings:alerts.kinds.${kind}.label`)}
                {' — '}
              </dt>
              <dd className="inline">
                {t(`settings:alerts.kinds.${kind}.help`)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
