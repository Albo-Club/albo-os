import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { X } from 'lucide-react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'

const ERROR_CODES = new Set([
  'invalid_email',
  'email_taken',
  'blocked_address',
  'insufficient_role',
  'not_found',
])

/**
 * Secondary addresses each member forwards reports from. One row per member,
 * their declared addresses as removable chips plus an input to add one.
 */
export function SendingAddressesCard({
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
  const aliases = useConvexQuery(
    api.organizations.listMemberAliases,
    orgId ? { orgId } : 'skip',
  )
  const addAlias = useConvexMutation(api.organizations.addMemberAlias)
  const removeAlias = useConvexMutation(api.organizations.removeMemberAlias)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function report(err: unknown) {
    const code = err instanceof ConvexError ? (err.data as string) : ''
    toast.error(
      t(
        ERROR_CODES.has(code)
          ? `settings:sendingAddresses.errors.${code}`
          : 'settings:sendingAddresses.errors.default',
      ),
    )
  }

  async function handleAdd(userId: Id<'users'>) {
    const email = (drafts[userId] ?? '').trim()
    if (!orgId || !email) return
    try {
      await addAlias({ orgId, userId, email })
      setDrafts((d) => ({ ...d, [userId]: '' }))
    } catch (err) {
      report(err)
    }
  }

  async function handleRemove(aliasId: Id<'userEmailAliases'>) {
    if (!orgId) return
    try {
      await removeAlias({ orgId, aliasId })
    } catch (err) {
      report(err)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:sendingAddresses.title')}</CardTitle>
        <CardDescription>
          {t('settings:sendingAddresses.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!members || !aliases ? (
          <p className="text-muted-foreground text-sm">
            {t('settings:members.loading')}
          </p>
        ) : (
          members.map((m) => {
            const mine = aliases.filter((a) => a.userId === m.userId)
            const editable = canManage || m.userId === myUserId
            return (
              <div key={m.userId} className="space-y-2">
                <p className="text-sm font-medium">{m.name ?? m.email}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {mine.length === 0 ? (
                    <span className="text-muted-foreground text-sm">
                      {t('settings:sendingAddresses.none')}
                    </span>
                  ) : (
                    mine.map((a) => (
                      <Badge key={a._id} variant="secondary" className="gap-1">
                        {a.email}
                        {editable ? (
                          <button
                            type="button"
                            aria-label={t('settings:sendingAddresses.remove', {
                              email: a.email,
                            })}
                            onClick={() => handleRemove(a._id)}
                            className="hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        ) : null}
                      </Badge>
                    ))
                  )}
                </div>
                {editable ? (
                  <div className="flex max-w-sm gap-2">
                    <Input
                      type="email"
                      value={drafts[m.userId] ?? ''}
                      placeholder={t('settings:sendingAddresses.placeholder')}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [m.userId]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        void handleAdd(m.userId)
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => handleAdd(m.userId)}
                      disabled={!(drafts[m.userId] ?? '').trim()}
                    >
                      {t('settings:sendingAddresses.add')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
