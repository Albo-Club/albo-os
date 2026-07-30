import { Loader2 } from 'lucide-react'
import type * as React from 'react'

import { cn } from '~/lib/utils'

/**
 * Indeterminate spinner. Drop inside a Button next to the label during async
 * actions, or use standalone for inline loading affordances.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
    />
  )
}

/**
 * Spinner next to its label, for a screen or a block waiting on its data.
 * Inline so it centres inside a flex parent or a `text-center` table cell
 * without stretching.
 */
export function LoadingLine({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex items-center gap-2 text-sm',
        className,
      )}
    >
      <Spinner className="size-3.5" />
      {children}
    </span>
  )
}
