import { useEffect, useState } from 'react'

/**
 * Valeur debouncée : ne se met à jour qu'après `delayMs` ms sans changement.
 * Sert aux barres de recherche (éviter une query/un filtre par frappe).
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeout)
  }, [value, delayMs])

  return debounced
}
