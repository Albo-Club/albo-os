import { useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pencil,
} from 'lucide-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from '../../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'

import type { Id } from '../../../../convex/_generated/dataModel'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { CompanyLogo } from '~/components/CompanyLogo'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

export const Route = createFileRoute(
  '/app/$orgSlug/participations/group/$slug',
)({
  component: GroupConso,
  errorComponent: NotFound,
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(
          null,
          'participations',
        )('group.metaTitle'),
      },
    ],
  }),
})

function BackLink({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation('participations')
  return (
    <Link
      to="/app/$orgSlug/participations"
      params={{ orgSlug }}
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      {t('back')}
    </Link>
  )
}

function NotFound() {
  const { t } = useTranslation('participations')
  const { orgSlug } = Route.useParams()
  return (
    <main className="flex-1 space-y-4 p-6">
      <BackLink orgSlug={orgSlug} />
      <p className="text-muted-foreground text-sm">{t('group.notFound')}</p>
    </main>
  )
}

type GroupData = NonNullable<
  FunctionReturnType<typeof api.participations.getGroup>
>

/** A single consolidated KPI tile. */
function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function GroupConso() {
  const { t } = useTranslation('participations')
  const { orgSlug, slug } = Route.useParams()
  const org = useConvexQuery(api.organizations.bySlug, { slug: orgSlug })
  const group = useConvexQuery(
    api.participations.getGroup,
    org ? { orgId: org._id, slug } : 'skip',
  )

  if (!org || !group) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <BackLink orgSlug={orgSlug} />
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </main>
    )
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <BackLink orgSlug={orgSlug} />
      <Header group={group} orgId={org._id} />
      <KpiGrid group={group} orgId={org._id} />
      <EntityList group={group} orgSlug={orgSlug} />
    </main>
  )
}

function Header({
  group,
  orgId,
}: {
  group: GroupData
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation(['participations', 'common'])
  const rename = useConvexMutation(api.participations.setGroupDisplayName)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.displayName)
  const [pending, setPending] = useState(false)

  async function save() {
    setPending(true)
    try {
      await rename({ orgId, slug: group.slug, displayName: name })
      setEditing(false)
    } catch {
      toast.error(t('participations:group.renameError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <CompanyLogo companyName={group.displayName} size="lg" />
      {editing ? (
        <span className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-64"
          />
          <Button size="sm" onClick={save} disabled={pending || !name.trim()}>
            {t('common:actions.save')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setName(group.displayName)
              setEditing(false)
            }}
            disabled={pending}
          >
            {t('common:actions.cancel')}
          </Button>
        </span>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {group.displayName}
          </h1>
          <Badge variant="secondary">{t('participations:badge.group')}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
            {t('participations:group.rename')}
          </Button>
        </>
      )}
      <span className="text-muted-foreground text-sm">
        {t('participations:group.entityCount', { count: group.entityCount })}
      </span>
    </div>
  )
}

function KpiGrid({
  group,
  orgId,
}: {
  group: GroupData
  orgId: Id<'organizations'>
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtMultiple } = useFormatters()
  const setBlocks = useConvexMutation(api.participations.setGroupBlocks)
  const [customizing, setCustomizing] = useState(false)

  const valueOf = (key: string): string => {
    switch (key) {
      case 'expo_totale':
        return fmtEur(group.totals.committed)
      case 'verse':
        return fmtEur(group.totals.paid)
      case 'recu':
        return fmtEur(group.totals.received)
      case 'tvpi':
        return fmtMultiple(group.totals.tvpi)
      default:
        return '—'
    }
  }

  const persist = (blocks: Array<{ key: string; visible: boolean }>) =>
    setBlocks({ orgId, slug: group.slug, blocks }).catch(() =>
      toast.error(t('group.customizeError')),
    )

  const move = (index: number, dir: -1 | 1) => {
    const next = [...group.blocks]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void persist(next)
  }
  const toggle = (index: number) => {
    const next = group.blocks.map((b, i) =>
      i === index ? { ...b, visible: !b.visible } : b,
    )
    void persist(next)
  }

  const visible = group.blocks.filter((b) => b.visible)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('group.kpisTitle')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCustomizing((v) => !v)}
        >
          {t('group.customize')}
        </Button>
      </div>

      {customizing ? (
        <div className="divide-y rounded-lg border">
          {group.blocks.map((b, i) => (
            <div
              key={b.key}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <span className={b.visible ? '' : 'text-muted-foreground'}>
                {t(`block.${b.key}`, { defaultValue: b.key })}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => move(i, 1)}
                  disabled={i === group.blocks.length - 1}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggle(i)}
                >
                  {b.visible ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="text-muted-foreground size-4" />
                  )}
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {visible.map((b) => (
            <KpiTile
              key={b.key}
              label={t(`block.${b.key}`, { defaultValue: b.key })}
              value={valueOf(b.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EntityList({
  group,
  orgSlug,
}: {
  group: GroupData
  orgSlug: string
}) {
  const { t } = useTranslation('participations')
  const { fmtEur, fmtMultiple } = useFormatters()
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t('group.entitiesTitle')}</h2>
      <div className="divide-y rounded-lg border">
        {group.entities.map((e) => (
          <Link
            key={e.companyId}
            to="/app/$orgSlug/participations/$companyId"
            params={{ orgSlug, companyId: e.companyId }}
            className="hover:bg-accent/60 grid grid-cols-2 items-center gap-x-6 gap-y-1 px-4 py-3 text-sm transition-colors sm:grid-cols-6"
          >
            <span className="flex items-center gap-2 font-medium sm:col-span-2">
              <CompanyLogo
                domain={e.domain ?? undefined}
                companyName={e.name}
                size="sm"
              />
              {e.name}
              <ArrowUpRight className="text-muted-foreground size-3.5" />
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t('dealsCount', { count: e.dealsCount })}
            </span>
            <span className="tabular-nums">{fmtEur(e.committed)}</span>
            <span className="tabular-nums">{fmtEur(e.received)}</span>
            <span className="tabular-nums">{fmtMultiple(e.tvpi)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
