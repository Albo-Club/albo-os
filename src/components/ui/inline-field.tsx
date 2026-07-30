import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'

import type { FieldFormat } from '~/lib/parse'
import { parseField, rawToInput } from '~/lib/parse'
import { cn } from '~/lib/utils'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { useAmountField } from '~/components/ui/amount-input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '~/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/**
 * One labelled fiche field, editable inline: the value reads as plain text
 * until clicked, then swaps to a format-appropriate control (€/%/number/date
 * input, or an enum Select). Enter or blur commits, Escape cancels — the same
 * interaction as the royalty CA cell (`EditableCa`, RoyaltiesPanel), lifted to a
 * shared, format-driven control laid out like `FieldRow` / `IdentityField`.
 *
 * Parsing/serialisation is delegated to `parseField` / `rawToInput` (lib/parse),
 * the single source shared with the edit dialog. Writing is the caller's job:
 * `onCommit(parsed)` receives a valid, changed value; `onClear` (optional) fires
 * when the field is emptied and the caller supports clearing (company text
 * fields clear on '' ; deal columns can't be cleared over the mutation, so they
 * omit it and an emptied cell is a no-op).
 *
 * For a bespoke editor (e.g. the creatable sector combobox) pass `renderEditor`:
 * it fully owns the commit and calls `done()` to leave edit mode.
 *
 * `layout` picks the resting shape: `stacked` (default, label above the value),
 * `row` (label left, value right, hairline below) — what the fiche side panels
 * use to keep long labels on one line in a narrow column — or `block` (no label
 * at all, the value spans the full width), for a free-text paragraph whose
 * label is already carried by the enclosing `IdentitySection`. Editing behaves
 * identically in all three.
 *
 * `format: 'multiline'` opens a textarea instead of an input: Enter inserts a
 * newline, blur commits, Escape cancels. Pair it with `layout="block"` and a
 * `placeholder` — deal notes, company summary.
 */
export function InlineField({
  label,
  format,
  rawValue,
  display,
  unit,
  enumOptions,
  renderEnumLabel,
  selectPlaceholder,
  ariaLabel,
  placeholder,
  onCommit,
  onClear,
  renderEditor,
  disabled,
  layout = 'stacked',
}: {
  label: string
  format: FieldFormat
  rawValue: unknown
  display: string
  unit?: string
  enumOptions?: ReadonlyArray<string>
  renderEnumLabel?: (opt: string) => string
  selectPlaceholder?: string
  ariaLabel?: string
  /** Muted prompt shown in place of the em dash when the field is empty, and
   * as the textarea placeholder while editing a multiline field. */
  placeholder?: string
  onCommit?: (parsed: number | string) => void | Promise<void>
  onClear?: () => void | Promise<void>
  renderEditor?: (api: { done: () => void }) => ReactNode
  disabled?: boolean
  layout?: 'stacked' | 'row' | 'block'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Euro fields get live thousand-separator formatting; the hook must run
  // unconditionally (rules of hooks) even when the field isn't a euro one — the
  // props are only spread for `format === 'eur'`.
  const amountProps = useAmountField(draft, setDraft)

  const hadValue = rawValue != null && rawValue !== ''

  function begin() {
    if (disabled) return
    setDraft(rawToInput(format, rawValue))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    // Emptied: clear when the caller supports it, otherwise leave unchanged
    // (deal columns can't be cleared through the mutation).
    if (trimmed === '') {
      if (onClear && hadValue) void onClear()
      return
    }
    const parsed = parseField(format, draft)
    // null = unparseable (e.g. letters in a € field): keep the current value.
    if (parsed == null) return
    if (parsed !== rawValue) void onCommit?.(parsed)
  }

  let editor: ReactNode = null
  if (editing) {
    if (renderEditor) {
      editor = renderEditor({ done: () => setEditing(false) })
    } else if (format === 'enum') {
      editor = (
        <Select
          open
          defaultValue={typeof rawValue === 'string' ? rawValue : undefined}
          onValueChange={(v) => {
            setEditing(false)
            if (v !== rawValue) void onCommit?.(v)
          }}
          onOpenChange={(o) => !o && setEditing(false)}
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue placeholder={selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {(enumOptions ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {renderEnumLabel ? renderEnumLabel(opt) : opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    } else if (format === 'multiline') {
      // Enter belongs to the text here, so only blur commits (Escape cancels).
      editor = (
        <Textarea
          autoFocus
          rows={4}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="text-[13px]"
        />
      )
    } else {
      const isNumeric =
        format === 'eur' ||
        format === 'pct' ||
        format === 'number' ||
        format === 'decimal' ||
        format === 'year'
      const inputType =
        format === 'date' ? 'date' : isNumeric ? 'number' : 'text'
      const step =
        format === 'eur' || format === 'pct'
          ? '0.01'
          : format === 'decimal'
            ? 'any'
            : '1'
      const handlers = {
        autoFocus: true,
        onBlur: commit,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
        },
      }
      // Euro fields use the formatted amount props; everything else keeps the
      // native numeric/text/date input (mirror of the dialog's DealFieldInput).
      const controlProps =
        format === 'eur'
          ? { ...amountProps, ...handlers }
          : {
              type: inputType,
              min: isNumeric ? '0' : undefined,
              step: isNumeric ? step : undefined,
              value: draft,
              onChange: (e: ChangeEvent<HTMLInputElement>) =>
                setDraft(e.target.value),
              ...handlers,
            }
      editor = unit ? (
        <InputGroup className="h-8">
          <InputGroupInput {...controlProps} />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{unit}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input className="h-8" {...controlProps} />
      )
    }
  }

  const empty = display === ''
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      onClick={begin}
      aria-label={ariaLabel}
      className={cn(
        'focus-visible:ring-ring -mx-1 rounded px-1 focus-visible:ring-2 focus-visible:outline-none',
        layout === 'block'
          ? 'w-full text-left text-[13px] leading-relaxed whitespace-pre-wrap'
          : cn(
              'text-sm font-medium',
              layout === 'row' ? 'min-w-0 text-right' : 'text-left',
            ),
        empty && placeholder && 'text-muted-foreground italic',
        disabled ? 'cursor-default' : 'hover:bg-muted/50 cursor-pointer',
      )}
    >
      {empty ? (placeholder ?? '—') : display}
    </button>
  )

  // The section header already carries the label — the value takes the width.
  if (layout === 'block') {
    return editing ? <>{editor}</> : trigger
  }

  if (layout === 'row') {
    return (
      <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0">
        <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
        {editing ? <div className="min-w-0 flex-1">{editor}</div> : trigger}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </span>
      {editing ? editor : trigger}
    </div>
  )
}
