import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from '@tanstack/react-router'
import { useUIMessages } from '@convex-dev/agent/react'
import { usePaginatedQuery } from 'convex/react'
import { useConvexMutation } from '@convex-dev/react-query'
import { ConvexError } from 'convex/values'
import {
  Check,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import { MarkdownMessage } from './MarkdownMessage'
import type { Id } from '../../../convex/_generated/dataModel'
import type { UIMessage } from '@convex-dev/agent/react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/utils'

function errorCode(err: unknown): string {
  const data = err instanceof ConvexError ? err.data : null
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'code' in data) {
    return (data as { code: string }).code
  }
  return ''
}

/** Parties d'un message assistant : texte (markdown) + appels d'outils. */
function MessageParts({ message }: { message: UIMessage }) {
  const { t } = useTranslation(['chat'])
  return (
    <>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return <MarkdownMessage key={i} text={part.text} />
        }
        const toolName =
          part.type === 'dynamic-tool'
            ? part.toolName
            : part.type.startsWith('tool-')
              ? part.type.slice('tool-'.length)
              : null
        if (toolName) {
          return (
            <div
              key={i}
              className="text-muted-foreground my-1 flex items-center gap-1.5 text-xs"
            >
              <Wrench className="size-3 shrink-0" />
              <span className="truncate">
                {t('chat:toolCall', { name: toolName })}
              </span>
            </div>
          )
        }
        return null
      })}
    </>
  )
}

export function AiPanel({
  orgId,
  onClose,
}: {
  orgId: Id<'organizations'>
  /** Fermeture du panneau (collapse desktop / overlay mobile). */
  onClose: () => void
}) {
  const { t, i18n } = useTranslation(['chat', 'common'])
  const location = useLocation()
  const [threadId, setThreadId] = useState<string | null>(null)
  // true = l'utilisateur a demandé un nouveau thread : ne pas ré-adopter le
  // dernier thread existant tant qu'il n'a rien envoyé.
  const [draftNew, setDraftNew] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const createThread = useConvexMutation(api.chat.createNewThread)
  const sendMessage = useConvexMutation(api.chat.sendMessage)
  const renameThread = useConvexMutation(api.chat.renameThread)
  const deleteThread = useConvexMutation(api.chat.deleteThread)
  const stopStream = useConvexMutation(api.chat.stopStream)

  const threads = usePaginatedQuery(
    api.chat.listThreads,
    { orgId },
    { initialNumItems: 20 },
  )

  // Au montage (ou après suppression) : reprendre le thread le plus récent.
  useEffect(() => {
    if (threadId || draftNew) return
    if (threads.status === 'LoadingFirstPage') return
    const latest = threads.results.at(0)
    if (latest) setThreadId(latest._id)
  }, [threadId, draftNew, threads.status, threads.results])

  const messages = useUIMessages(
    api.chat.listMessages,
    threadId ? { orgId, threadId } : 'skip',
    { initialNumItems: 50, stream: true },
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages.results])

  const currentThread = threads.results.find((th) => th._id === threadId)
  const currentTitle = currentThread?.title ?? t('chat:threads.untitled')
  const streaming = messages.results.at(-1)?.status === 'streaming'

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const prompt = input.trim()
    if (!prompt || sending || streaming) return
    setSending(true)
    setInput('')
    try {
      let target = threadId
      if (!target) {
        target = await createThread({ orgId })
        setThreadId(target)
        setDraftNew(false)
      }
      await sendMessage({
        orgId,
        threadId: target,
        prompt,
        context: { route: location.pathname },
      })
    } catch (err) {
      toast.error(
        errorCode(err) === 'rate_limited'
          ? t('chat:errors.rate_limited')
          : t('chat:errors.default'),
      )
      setInput(prompt)
    } finally {
      setSending(false)
    }
  }

  function handleNewThread() {
    setThreadId(null)
    setDraftNew(true)
  }

  function handleSelectThread(id: string) {
    setThreadId(id)
    setDraftNew(false)
  }

  async function handleStop() {
    if (!threadId) return
    try {
      await stopStream({ orgId, threadId })
    } catch {
      toast.error(t('chat:errors.default'))
    }
  }

  async function handleRename() {
    if (!threadId) return
    const title = renameValue.trim()
    if (!title) return
    try {
      await renameThread({ orgId, threadId, title })
      setRenameOpen(false)
    } catch {
      toast.error(t('chat:errors.default'))
    }
  }

  async function handleDelete() {
    if (!threadId) return
    try {
      await deleteThread({ orgId, threadId })
      setDeleteOpen(false)
      setThreadId(null)
      setDraftNew(false)
    } catch {
      toast.error(t('chat:errors.default'))
    }
  }

  async function handleCopy(m: UIMessage) {
    try {
      await navigator.clipboard.writeText(m.text)
      setCopiedKey(m.key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      toast.error(t('chat:errors.default'))
    }
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {threadId ? currentTitle : t('chat:title')}
          </h2>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={handleNewThread}
          aria-label={t('chat:new')}
          title={t('chat:new')}
        >
          <Plus className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t('chat:threads.history')}
              title={t('chat:threads.history')}
            >
              <History className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {threads.results.length === 0 ? (
              <DropdownMenuItem disabled>
                {t('chat:threads.empty')}
              </DropdownMenuItem>
            ) : (
              threads.results.map((th) => (
                <DropdownMenuItem
                  key={th._id}
                  onClick={() => handleSelectThread(th._id)}
                  className={cn(th._id === threadId && 'bg-muted')}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {th.title ?? t('chat:threads.untitled')}
                  </span>
                  <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                    {new Date(th._creationTime).toLocaleDateString(
                      i18n.language,
                    )}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {threadId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t('chat:threads.actions')}
                title={t('chat:threads.actions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setRenameValue(currentThread?.title ?? '')
                  setRenameOpen(true)
                }}
              >
                <Pencil className="size-4" />
                {t('chat:threads.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                {t('common:actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onClose}
          aria-label={t('chat:close')}
          title={t('chat:close')}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {!threadId || messages.results.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm">
            <p>{t('chat:emptyState')}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.results.map((m) => (
              <li
                key={m.key}
                className={cn(
                  'flex',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                {m.role === 'user' ? (
                  <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.text}
                  </div>
                ) : (
                  <div className="group max-w-[92%] text-sm">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <MessageParts message={m} />
                      {!m.text && m.status === 'streaming' && (
                        <span className="text-muted-foreground">…</span>
                      )}
                    </div>
                    {m.status !== 'streaming' && m.text && (
                      <div className="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground size-6"
                          onClick={() => void handleCopy(m)}
                          aria-label={t('chat:copy')}
                          title={t('chat:copy')}
                        >
                          {copiedKey === m.key ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleSend} className="shrink-0 border-t p-3">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat:inputPlaceholder')}
            disabled={sending}
          />
          {streaming ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void handleStop()}
              aria-label={t('chat:stop')}
              title={t('chat:stop')}
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim() || sending}>
              {t('chat:send')}
            </Button>
          )}
        </div>
      </form>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('chat:threads.renameTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => void handleRename()}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('chat:threads.deleteConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t('chat:threads.deleteConfirmBody')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
