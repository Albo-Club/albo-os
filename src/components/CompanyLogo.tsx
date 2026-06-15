import { useState } from 'react'
import { Building2 } from 'lucide-react'

import { cn } from '~/lib/utils'

// Publishable logo.dev key (pk_…), safe to expose client-side.
const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined

const sizeClasses = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10',
} as const

const iconClasses = {
  sm: 'size-3',
  md: 'size-4',
  lg: 'size-5',
} as const

type CompanyLogoProps = {
  domain?: string | null
  companyName?: string | null
  size?: keyof typeof sizeClasses
  className?: string
}

/**
 * Company logo via logo.dev's CDN (hotlinked, never stored — see KNOWN_ISSUES).
 * Falls back to a Building2 icon when the domain, token, or remote image is
 * missing.
 */
export function CompanyLogo({
  domain,
  companyName,
  size = 'md',
  className,
}: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false)

  if (!domain || !LOGO_DEV_TOKEN || hasError) {
    return (
      <div
        className={cn(
          'bg-muted flex shrink-0 items-center justify-center rounded-md',
          sizeClasses[size],
          className,
        )}
        title={companyName ?? undefined}
      >
        <Building2 className={cn('text-muted-foreground', iconClasses[size])} />
      </div>
    )
  }

  return (
    <img
      src={`https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=128&format=png`}
      alt={companyName ?? ''}
      className={cn(
        'shrink-0 rounded-md bg-white object-contain',
        sizeClasses[size],
        className,
      )}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  )
}
