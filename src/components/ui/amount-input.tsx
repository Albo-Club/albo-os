import * as React from 'react'

import { Input } from '~/components/ui/input'

/**
 * Thousand-separator formatting for editable amount fields: while typing a
 * money value the input shows `1 000 000` for readability, without changing
 * the value the parent sees.
 *
 * Contract: `value` / `onChange` speak the RAW, unformatted string (digits, an
 * optional decimal separator `.`/`,`, an optional leading `-`) — exactly what
 * the euro parsers in `src/lib/parse.ts` expect. Grouping separators only ever
 * live in the rendered `<input>`, never in what flows back out. The caret is
 * preserved across reformatting so typing mid-number feels native.
 *
 * Grouping uses a plain space, matching the French `Intl.NumberFormat` display
 * formatters (`useFormatters`). We deliberately do NOT group with a locale
 * comma: the decimal separator can be a comma here, so a space is the only
 * unambiguous grouping mark for typed input.
 *
 * Two entry points:
 * - `AmountInput` — drop-in for a plain `<Input>`.
 * - `useAmountField(value, onChange)` — spread the returned props onto any
 *   input-like element (e.g. `<InputGroupInput>` with a € addon).
 */

// fr-FR grouping mark. A regular space keeps copy/paste and typing simple.
const GROUP_SEP = ' '

/** Keep digits, one decimal separator, and an optional leading minus. */
function sanitizeRaw(input: string): string {
  const negative = input.trim().startsWith('-')
  // Drop everything that isn't a digit or a decimal separator.
  let rest = input.replace(/[^\d.,]/g, '')
  // Collapse to a single decimal separator, keeping the first one typed.
  const firstSep = rest.search(/[.,]/)
  if (firstSep !== -1) {
    const head = rest.slice(0, firstSep + 1)
    const tail = rest.slice(firstSep + 1).replace(/[.,]/g, '')
    rest = head + tail
  }
  return (negative && rest !== '' ? '-' : '') + rest
}

/** Insert grouping separators into the integer part; leave the decimals as typed. */
function formatAmount(raw: string): string {
  if (raw === '' || raw === '-') return raw
  const negative = raw.startsWith('-')
  const body = negative ? raw.slice(1) : raw
  const sepIndex = body.search(/[.,]/)
  const intPart = sepIndex === -1 ? body : body.slice(0, sepIndex)
  const decPart = sepIndex === -1 ? '' : body.slice(sepIndex) // includes the separator
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP)
  return (negative ? '-' : '') + groupedInt + decPart
}

/** Count characters that survive into the raw value (everything but grouping). */
function countRawChars(display: string): number {
  let count = 0
  for (const ch of display) if (ch !== GROUP_SEP) count++
  return count
}

/** Caret offset in `display` that sits just after `rawCount` raw characters. */
function caretForRawCount(display: string, rawCount: number): number {
  if (rawCount <= 0) return 0
  let seen = 0
  for (let i = 0; i < display.length; i++) {
    if (display[i] !== GROUP_SEP) seen++
    if (seen === rawCount) return i + 1
  }
  return display.length
}

/**
 * Returns props to spread onto an input-like element to make it a formatted
 * amount field. Owns a ref (for caret restoration) and the change handler.
 */
export function useAmountField(value: string, onChange: (value: string) => void) {
  const ref = React.useRef<HTMLInputElement>(null)
  const caretRef = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    if (caretRef.current != null && ref.current) {
      ref.current.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
    }
  })

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.currentTarget
      const caret = el.selectionStart ?? el.value.length
      const rawBeforeCaret = countRawChars(sanitizeRaw(el.value.slice(0, caret)))
      const nextRaw = sanitizeRaw(el.value)
      caretRef.current = caretForRawCount(formatAmount(nextRaw), rawBeforeCaret)
      onChange(nextRaw)
    },
    [onChange],
  )

  return {
    ref,
    type: 'text' as const,
    inputMode: 'decimal' as const,
    value: formatAmount(value),
    onChange: handleChange,
  }
}

type AmountInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type'
> & {
  value: string
  onChange: (value: string) => void
}

/** Drop-in `<Input>` with live thousand-separator formatting. */
export function AmountInput({ value, onChange, ...props }: AmountInputProps) {
  return <Input {...useAmountField(value, onChange)} {...props} />
}
