import { Search, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from './ThemeToggle'

import { Button } from '~/components/ui/button'
import { SidebarTrigger } from '~/components/ui/sidebar'
import { UserButton } from '~/components/auth/user-button'

export function AppHeader({
  aiPanelOpen,
  onToggleAiPanel,
  onOpenSearch,
}: {
  aiPanelOpen?: boolean
  onToggleAiPanel?: () => void
  onOpenSearch?: () => void
}) {
  const { t } = useTranslation(['nav'])

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="ml-auto flex items-center gap-1">
        {onOpenSearch && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSearch}
            title={t('nav:appShell.searchShortcut')}
          >
            <Search className="mr-1.5 size-4" />
            {t('nav:appShell.search')}
          </Button>
        )}
        {onToggleAiPanel && (
          <Button
            variant={aiPanelOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleAiPanel}
            aria-pressed={aiPanelOpen}
            title={t('nav:appShell.aiShortcut')}
          >
            <Sparkles className="mr-1.5 size-4" />
            {t('nav:appShell.ai')}
          </Button>
        )}
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
  )
}
