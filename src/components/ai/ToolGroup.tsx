/**
 * The tool calls of an assistant message, as ONE collapsible block
 * ("3 sources consultées") instead of one bordered card per call.
 *
 * Collapsed, the header says what is going on (spinner while a tool runs,
 * check once all are done, clock while one awaits approval). Expanded, one
 * row per tool with its human label (`chat:tool.labels.*`, falling back to
 * the tool name split into words), its state and, for a list result, the
 * number of items. Each row expands in turn to the parameters and the raw
 * JSON, unchanged from the previous per-call card. The block opens by
 * itself when a tool needs attention (approval, error, refusal), so the
 * Confirm / Reject buttons never hide behind a click.
 *
 * Rich renderers (`toolRenderers.tsx`) still show below the block, one per
 * completed tool that has one.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  XCircleIcon,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ToolPart } from '~/components/ai-elements/tool'
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
} from '~/components/ai-elements/confirmation'
import { ToolInput, ToolOutput } from '~/components/ai-elements/tool'
import { getToolRenderer } from '~/components/ai/toolRenderers'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'

/** `tool-listDeals` → `listDeals`; `dynamic-tool` → its `toolName`. */
export function toolName(part: ToolPart): string {
  return part.type === 'dynamic-tool'
    ? part.toolName
    : part.type.slice('tool-'.length)
}

/** `listDeals` → "List deals": the fallback for a tool with no label yet. */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Human label of a tool (`chat:tool.labels.<name>`), never the raw name. */
export function toolLabel(t: TFunction, name: string): string {
  return t(`chat:tool.labels.${name}`, { defaultValue: humanize(name) })
}

export function isRunning(part: ToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

function needsAttention(part: ToolPart): boolean {
  return (
    part.state === 'approval-requested' ||
    part.state === 'output-error' ||
    part.state === 'output-denied'
  )
}

/**
 * Number of items in a list result: a bare array, or an object whose single
 * array field carries the rows (`{ rows, totals }`). Anything else: none.
 */
function resultCount(output: unknown): number | null {
  if (Array.isArray(output)) return output.length
  if (typeof output !== 'object' || output === null) return null
  const arrays = Object.values(output).filter(Array.isArray)
  return arrays.length === 1 ? arrays[0].length : null
}

function StateIcon({ part }: { part: ToolPart }) {
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return <Spinner className="size-3.5 text-muted-foreground" />
    case 'approval-requested':
      return <ClockIcon className="size-3.5 text-yellow-600" />
    case 'output-error':
      return <XCircleIcon className="size-3.5 text-destructive" />
    case 'output-denied':
      return <XCircleIcon className="size-3.5 text-orange-600" />
    default:
      return <CheckIcon className="size-3.5 text-green-600" />
  }
}

function ToolRow({
  part,
  onRespondApproval,
  respondingApprovalId,
}: {
  part: ToolPart
  onRespondApproval: (approvalId: string, approved: boolean) => void
  respondingApprovalId: string | null
}) {
  const { t } = useTranslation(['chat'])
  const approvalId = part.approval?.id
  const responding =
    approvalId !== undefined && approvalId === respondingApprovalId
  const count =
    part.state === 'output-available' ? resultCount(part.output) : null

  return (
    <Collapsible className="group/row">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm">
        <StateIcon part={part} />
        <span className="truncate">{toolLabel(t, toolName(part))}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
          {count !== null && (
            <span className="text-xs tabular-nums">
              {t('chat:tool.items', { count })}
            </span>
          )}
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/row:rotate-180" />
        </span>
      </CollapsibleTrigger>
      {/* Outside the collapsible content: the Confirm / Reject buttons and
          the recorded decision stay visible without opening the row. */}
      <Confirmation
        approval={part.approval}
        state={part.state}
        className="px-3 pb-2"
      >
        <ConfirmationRequest className="text-muted-foreground">
          {t('chat:approval.pending')}
        </ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction
            disabled={responding}
            onClick={() => approvalId && onRespondApproval(approvalId, true)}
          >
            {t('chat:approval.approve')}
          </ConfirmationAction>
          <ConfirmationAction
            variant="outline"
            disabled={responding}
            onClick={() => approvalId && onRespondApproval(approvalId, false)}
          >
            {t('chat:approval.deny')}
          </ConfirmationAction>
        </ConfirmationActions>
        <ConfirmationAccepted className="text-muted-foreground">
          {t('chat:approval.accepted')}
        </ConfirmationAccepted>
        <ConfirmationRejected className="text-muted-foreground">
          {t('chat:approval.denied')}
        </ConfirmationRejected>
      </Confirmation>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        {part.input !== undefined && (
          <ToolInput input={part.input} label={t('chat:tool.parameters')} />
        )}
        <ToolOutput
          output={part.output}
          errorText={part.errorText}
          label={t('chat:tool.result')}
          errorLabel={t('chat:tool.error')}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ToolGroup({
  parts,
  onRespondApproval,
  respondingApprovalId,
}: {
  /** Consecutive tool parts of one assistant message. */
  parts: Array<ToolPart>
  onRespondApproval: (approvalId: string, approved: boolean) => void
  respondingApprovalId: string | null
}) {
  const { t } = useTranslation(['chat'])
  const running = parts.some(isRunning)
  const attention = parts.some(needsAttention)
  const [open, setOpen] = useState(attention)
  // A tool that needs the user opens the block; they may close it after.
  useEffect(() => {
    if (attention) setOpen(true)
  }, [attention])

  const title = running
    ? t('chat:sources.inProgress')
    : parts.some((p) => p.state === 'approval-requested')
      ? t('chat:sources.approval')
      : t('chat:sources.done', { count: parts.length })

  return (
    <>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="group/tools not-prose w-full rounded-md border"
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground">
          {running ? (
            <Spinner className="size-3.5" />
          ) : attention ? (
            <ClockIcon className="size-3.5 text-yellow-600" />
          ) : (
            <CheckIcon className="size-3.5 text-green-600" />
          )}
          <span className="truncate">{title}</span>
          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 transition-transform group-data-[state=open]/tools:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            'divide-y border-t',
            'data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=open]:animate-in',
          )}
        >
          {parts.map((part) => (
            <ToolRow
              key={part.toolCallId}
              part={part}
              onRespondApproval={onRespondApproval}
              respondingApprovalId={respondingApprovalId}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
      {parts.map((part) => {
        // The renderer is defensive itself (null on unexpected shape); the
        // `output-available` state guarantees `output` is present.
        const Renderer = getToolRenderer(toolName(part))
        return Renderer && part.state === 'output-available' ? (
          <Renderer key={part.toolCallId} output={part.output} />
        ) : null
      })}
    </>
  )
}
