/**
 * Which sub-sections of Investissements an org shows (SPEC D37, revised).
 *
 * The platform itself is NOT modular any more: À faire, Investissements,
 * Trésorerie and Passif are always in the sidebar, empty or not. An entry
 * that is missing tells nothing; an empty page says what it is waiting for,
 * and that is what a newcomer needs. Only Investissements has sub-sections,
 * because that is the one place where orgs genuinely differ — an SCI holds a
 * building and no participation, a holding is the other way round.
 *
 * « Une sous-section s'affiche si elle contient quelque chose, ou si elle a
 * été cochée à la main. » Nothing is cached: what each one holds is probed on
 * every read, so it appears the moment its first row exists.
 *
 * Two rules keep the switch from trapping anyone, and they are what makes it
 * REVERSIBLE — the defect of the first version, which could only ever add:
 * a sub-section holding rows cannot be hidden (the content wins), and the
 * last visible one cannot be hidden either (the section would have no page
 * left). The second doubles as the default: an org that has never chosen
 * anything shows Entreprises, with nothing to write at creation.
 *
 * Pure (no Convex import): the slugs and the rules are shared by the server
 * query and the front, and tested in node:test.
 */

/** Sub-sections of Investissements, in display order. */
export const ALL_MODULES = ['entreprises', 'placements', 'immobilier'] as const

export type ModuleKey = (typeof ALL_MODULES)[number]

/** The one shown when an org has never chosen — see the header. */
export const FALLBACK_MODULE: ModuleKey = 'entreprises'

export function isModuleKey(value: string): value is ModuleKey {
  return (ALL_MODULES as ReadonlyArray<string>).includes(value)
}

export type ModuleState = {
  key: ModuleKey
  /** The sub-section holds at least one row. */
  hasContent: boolean
  /** Ticked by hand, whether or not it holds anything. */
  enabled: boolean
}

/** Ticked, or holding something. That is the whole rule. */
export function isVisible(state: ModuleState): boolean {
  return state.hasContent || state.enabled
}

function stateOf(
  states: ReadonlyArray<ModuleState>,
  key: ModuleKey,
): ModuleState | undefined {
  return states.find((row) => row.key === key)
}

/**
 * The sub-sections on screen, in declaration order. Never empty: an org that
 * holds nothing and has ticked nothing still gets `FALLBACK_MODULE`, so
 * Investissements always has a page to open.
 */
export function visibleModules(
  states: ReadonlyArray<ModuleState>,
): Array<ModuleKey> {
  const visible = ALL_MODULES.filter((key) => {
    const state = stateOf(states, key)
    // Unknown state = the query is still in flight: show it rather than
    // flicker it away.
    return state ? isVisible(state) : true
  })
  return visible.length > 0 ? visible : [FALLBACK_MODULE]
}

/**
 * Why a visible sub-section cannot be hidden, or null when it can be.
 *
 * `content` — it holds rows, and hiding it would take them with it.
 * `last` — it is the only one left, and Investissements needs a page.
 */
export function hideBlockedBy(
  states: ReadonlyArray<ModuleState>,
  key: ModuleKey,
): 'content' | 'last' | null {
  if (stateOf(states, key)?.hasContent) return 'content'
  const visible = visibleModules(states)
  if (visible.length <= 1 && visible.includes(key)) return 'last'
  return null
}
