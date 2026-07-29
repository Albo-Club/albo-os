import { useEffect, useRef, useState } from 'react'

/**
 * Sticky offset for a side panel that should scroll with the page and then
 * freeze once its bottom edge is reached, instead of scrolling out of view.
 *
 * `position: sticky` only pins the edges it is given an offset for, and a
 * `bottom` offset does NOT hold a taller-than-scrollport box in place — it
 * only pulls up a box whose flow position is below the fold, so a tall panel
 * still scrolls away past the top. The trick is a **negative `top`** equal to
 * how much the panel overflows the scrollport: the panel travels up with the
 * page until its bottom lands `gap` px above the scrollport bottom, then
 * sticks there. When the panel fits in the scrollport there is nothing left to
 * reveal, so it pins under the top edge instead.
 *
 * Returns the ref to attach to the panel and the `top` value in px, meant to
 * be passed as an inline style next to a `sticky` class.
 */
export function useStickyBottom(gap = 24) {
  const ref = useRef<HTMLElement>(null)
  const [top, setTop] = useState(gap)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const port = scrollParent(el)
    const measure = () => {
      const portHeight = port ? port.clientHeight : window.innerHeight
      const height = el.offsetHeight
      // Keep a gap top and bottom, hence the 2× when deciding whether the
      // panel actually overflows.
      setTop(
        height > portHeight - 2 * gap ? -(height - portHeight) - gap : gap,
      )
    }

    measure()
    // The panel's height changes as data loads (summary, people), and the
    // scrollport's changes when the window or the AI panel resizes.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (port) observer.observe(port)
    return () => observer.disconnect()
  }, [gap])

  return { ref, top }
}

/** Nearest scrollable ancestor — the app shell scrolls in a div, not the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}
