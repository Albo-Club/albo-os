import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'

import type { FieldFormat } from '~/lib/parse'
import { parseField, rawToInput } from '~/lib/parse'
import { cn } from '~/lib/utils'
import { Input } from '~/components/ui/input'
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
  onCommit,
  onClear,
  renderEditor,
  disabled,
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
  onCommit?: (parsed: number | string) => void | Promise<void>
  onClear?: () => void | Promise<void>
  renderEditor?: (api: { done: () => void }) => ReactNode
  disabled?: boolean
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

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      {editing ? (
        editor
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={begin}
          aria-label={ariaLabel}
          className={cn(
            'focus-visible:ring-ring -mx-1 rounded px-1 text-left text-sm focus-visible:ring-2 focus-visible:outline-none',
            disabled ? 'cursor-default' : 'hover:bg-muted/50 cursor-pointer',
          )}
        >
          {display === '' ? '—' : display}
        </button>
      )}
    </div>
  )
}
