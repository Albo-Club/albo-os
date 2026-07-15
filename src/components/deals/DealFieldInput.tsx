import { useTranslation } from 'react-i18next'
import { ENUM_FIELD_VALUES } from '../../../convex/lib/instruments'
import type { ChangeEvent } from 'react'

import type { FieldFormat } from '~/lib/parse'
import { FORMAT_UNIT } from '~/components/deals/InstrumentBlock'
import { Input } from '~/components/ui/input'
import { useAmountField } from '~/components/ui/amount-input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '~/components/ui/input-group'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/**
 * One editable instrument field, rendered by its display format
 * (€ / % / date / enum / number / …). Shared by the deal edit dialog
 * (deals.$dealId.tsx) and the create-deal dialog (participations.$companyId.tsx)
 * so both surfaces render the exact same input per field.
 */
export function DealFieldInput({
  field,
  format,
  value,
  onChange,
}: {
  field: string
  format: FieldFormat
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('participations')
  const label = t(`field.${field}`, { defaultValue: field })
  const id = `deal-${field}`
  // Euro fields get live thousand-separator formatting; the hook must run
  // before the enum early-return to respect the rules of hooks.
  const amountProps = useAmountField(value, onChange)

  if (format === 'enum') {
    const options = ENUM_FIELD_VALUES[field] ?? []
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('edit.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {t(`enum.${field}.${opt}`, { defaultValue: opt })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isNumeric =
    format === 'eur' ||
    format === 'pct' ||
    format === 'number' ||
    format === 'decimal' ||
    format === 'year'
  const inputType = format === 'date' ? 'date' : isNumeric ? 'number' : 'text'
  const step =
    format === 'eur' || format === 'pct'
      ? '0.01'
      : format === 'decimal'
        ? 'any'
        : '1'

  const unit = FORMAT_UNIT[format]
  // Euro fields use the formatted amount props; everything else keeps the
  // native numeric/text/date input.
  const controlProps =
    format === 'eur'
      ? amountProps
      : {
          type: inputType,
          min: isNumeric ? '0' : undefined,
          step: isNumeric ? step : undefined,
          value,
          onChange: (e: ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value),
        }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {unit ? (
        <InputGroup>
          <InputGroupInput id={id} {...controlProps} />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{unit}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input id={id} {...controlProps} />
      )}
    </div>
  )
}
