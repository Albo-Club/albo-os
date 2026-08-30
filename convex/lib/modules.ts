/**
 * The activatable modules of an org (SPEC D37).
 *
 * A module is displayed when it **holds something**, or when it has been
 * **turned on by hand**. Nothing else: there is no per-user preference and
 * no display cache — what is visible is derived on every read from the data
 * itself, so a module appears the moment its first row exists and never has
 * to be maintained.
 *
 * The explicit activation is what makes the rule usable at all. Hiding an
 * empty module automatically would hide it exactly when it is needed — to
 * create its FIRST element. So the ⋯ menu can always bring one back.
 *
 * Pure (no Convex import): the slugs and the ordering are shared by the
 * server query and the two front surfaces, and tested in node:test.
 */

/** Sidebar entries that can be hidden. */
export const SIDEBAR_MODULES = ['investments', 'cash', 'passif'] as const

/** Sub-tabs of the Investissements section. */
export const TAB_MODULES = ['entreprises', 'placements', 'immobilier'] as const

export type SidebarModule = (typeof SIDEBAR_MODULES)[number]
export type TabModule = (typeof TAB_MODULES)[number]
export type ModuleKey = SidebarModule | TabModule

export const ALL_MODULES: ReadonlyArray<ModuleKey> = [
  ...SIDEBAR_MODULES,
  ...TAB_MODULES,
]

export function isModuleKey(value: string): value is ModuleKey {
  return (ALL_MODULES as ReadonlyArray<string>).includes(value)
}

/**
 * ⚠️ « À faire » is deliberately NOT in the list, and neither are the
 * workspace entries.
 *
 * The To do tab is where the signals of every other module surface, and it
 * is the one page whose content is created from itself. Hiding it would
 * hide the way to act on the rest — the opposite of what D37 is for.
 */
export type ModuleState = {
  key: ModuleKey
  /** The module holds at least one row. */
  hasContent: boolean
  /** Turned on by hand, whether or not it holds anything. */
  enabled: boolean
}

/** Visible = holds something, OR turned on by hand. That is the whole rule. */
export function isVisible(state: ModuleState): boolean {
  return state.hasContent || state.enabled
}

/** The visible subset, in declaration order. */
export function visibleModules(
  states: ReadonlyArray<ModuleState>,
  among: ReadonlyArray<ModuleKey>,
): Array<ModuleKey> {
  return among.filter((key) => {
    const state = states.find((row) => row.key === key)
    return state ? isVisible(state) : true
  })
}

/**
 * What the ⋯ menu offers: the modules that are hidden, i.e. empty AND not
 * turned on. A module holding something is never offered — it is already
 * there.
 */
export function activatableModules(
  states: ReadonlyArray<ModuleState>,
  among: ReadonlyArray<ModuleKey>,
): Array<ModuleKey> {
  return among.filter((key) => {
    const state = states.find((row) => row.key === key)
    return state ? !isVisible(state) : false
  })
}
