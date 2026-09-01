import {
  BookOpen,
  Building2,
  ChartCandlestick,
  Handshake,
  Inbox,
  ListTodo,
  Megaphone,
  Scale,
  Settings,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavLeaf = {
  /** i18n key under the `nav` namespace, e.g. `items.participations`. */
  titleKey: string
  /**
   * Activatable module this entry belongs to (SPEC D37). Absent = always
   * shown: « À faire » aggregates the signals of every other module, and the
   * workspace entries are not modules at all.
   */
  module?: 'investments' | 'cash' | 'passif'
  to: string
  /** Extra path prefixes that keep this item highlighted. */
  alsoActiveOn?: Array<string>
  icon?: LucideIcon
  adminOnly?: boolean
  /** When true, render a `common:demo` badge. */
  demo?: boolean
  /** When true, render as non-clickable with a `nav:comingSoon` badge. */
  soon?: boolean
}

export type NavGroup = {
  /** i18n key under the `nav` namespace, e.g. `groups.platform`. */
  labelKey: string
  items: Array<NavLeaf>
  secondary?: boolean
}

export function getNavGroups(): Array<NavGroup> {
  return [
    {
      labelKey: 'groups.platform',
      items: [
        {
          titleKey: 'items.todo',
          to: '/app/$orgSlug/todo',
          icon: ListTodo,
        },
        {
          titleKey: 'items.investments',
          module: 'investments',
          to: '/app/$orgSlug/participations',
          alsoActiveOn: [
            '/app/$orgSlug/placements',
            '/app/$orgSlug/immobilier',
          ],
          icon: ChartCandlestick,
        },
        {
          titleKey: 'items.cash',
          module: 'cash',
          to: '/app/$orgSlug/cash',
          icon: Wallet,
        },
        {
          titleKey: 'items.passif',
          module: 'passif',
          to: '/app/$orgSlug/passif',
          icon: Scale,
        },
      ],
    },
    {
      labelKey: 'groups.workspace',
      secondary: true,
      items: [
        {
          titleKey: 'items.settings',
          to: '/app/$orgSlug/settings',
          icon: Settings,
        },
        {
          titleKey: 'items.docs',
          to: '/app/$orgSlug/docs',
          icon: BookOpen,
        },
        {
          titleKey: 'items.changelog',
          to: '/app/$orgSlug/changelog',
          icon: Megaphone,
        },
      ],
    },
  ]
}

/** Nav for the cross-org aggregated view (`/app/all`, read-only). */
export function getAllNavGroups(): Array<NavGroup> {
  return [
    {
      labelKey: 'groups.platform',
      items: [
        {
          titleKey: 'items.participations',
          to: '/app/all/participations',
          icon: Building2,
        },
        {
          titleKey: 'items.deals',
          to: '/app/all/deals',
          icon: Handshake,
        },
        {
          titleKey: 'items.reports',
          to: '/app/all/reports',
          icon: Inbox,
        },
      ],
    },
  ]
}
