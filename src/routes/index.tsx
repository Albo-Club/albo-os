import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

// Albo OS is an internal tool — no marketing landing. `/` just forwards to
// `/app`, whose guard sends signed-out visitors to `/login`.
export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation('nav')
  useEffect(() => {
    void navigate({ to: '/app', replace: true })
  }, [navigate])
  return (
    <main className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">{t('redirecting')}</p>
    </main>
  )
}
