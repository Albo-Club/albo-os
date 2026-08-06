import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Filter state that survives navigation: mirrored in `sessionStorage` under
 * `key`, so leaving a list and coming back restores the search / facets that
 * were active, while closing the tab starts from scratch.
 *
 * The saved values are read in an effect AFTER the first render, never in the
 * initial state: the server renders without storage, so reading it during
 * render would mismatch on hydration (same pattern as `ThemePicker`). The
 * state carries the key it was restored for, which is what keeps the write
 * effect from persisting the defaults over a not-yet-restored entry — and
 * gives each org its own entry when `key` changes.
 *
 * Values must be JSON-serializable: pass arrays, not Sets.
 */
export function usePersistentFilters<T extends Record<string, unknown>>(
  key: string,
  initial: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const initialRef = useRef(initial)
  const [state, setState] = useState<{ key: string | null; value: T }>({
    key: null,
    value: initialRef.current,
  })

  useEffect(() => {
    let stored: Partial<T> | null = null
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) stored = JSON.parse(raw) as Partial<T>
    } catch {
      stored = null
    }
    setState({
      key,
      // Merged over the defaults so a filter added later doesn't come back
      // undefined from an older saved entry.
      value: stored ? { ...initialRef.current, ...stored } : initialRef.current,
    })
  }, [key])

  useEffect(() => {
    if (state.key !== key) return
    try {
      sessionStorage.setItem(key, JSON.stringify(state.value))
    } catch {
      // Storage unavailable (private mode, quota): filters just stop
      // surviving navigation.
    }
  }, [key, state])

  const patch = useCallback(
    (values: Partial<T>) =>
      setState((prev) => ({ ...prev, value: { ...prev.value, ...values } })),
    [],
  )
  const reset = useCallback(
    () => setState((prev) => ({ ...prev, value: initialRef.current })),
    [],
  )

  return [state.value, patch, reset]
}

/** Multi-select facet toggle on the array form of a filter. */
export function toggleValue(
  values: Array<string>,
  value: string,
): Array<string> {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value]
}
