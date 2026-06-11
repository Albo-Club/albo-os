import { useEffect, useState } from 'react'

/**
 * Debounced value: only updates after `delayMs` ms without changes.
 * Used by search bars (avoids one query/filter per keystroke).
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeout)
  }, [value, delayMs])

  return debounced
}
