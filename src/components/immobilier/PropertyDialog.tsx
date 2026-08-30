import { useState } from 'react'
import { useConvexMutation } from '@convex-dev/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'

import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { useReportError } from '~/components/pointage/TransactionSheet'
import { AmountInput } from '~/components/ui/amount-input'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

type PropertyDoc = Doc<'properties'>
type PropertyAssetType = PropertyDoc['propertyType']
type PropertyUsage = PropertyDoc['usage']
type CostPoste = PropertyDoc['costBasis'][number]['poste']

const TYPES = [
  'appartement',
  'maison',
  'immeuble',
  'local_commercial',
  'terrain',
] as const satisfies ReadonlyArray<PropertyAssetType>

const USAGES = [
  'locatif_nu',
  'locatif_meuble',
  'colocation',
  'saisonnier',
  'commercial',
  'marchand_de_biens',
  'residence_secondaire',
] as const satisfies ReadonlyArray<PropertyUsage>

const POSTES = [
  'acquisition',
  'frais_acquisition',
  'travaux',
] as const satisfies ReadonlyArray<CostPoste>

/** `YYYY-MM-DD` → midnight UTC, per the schema's date convention. */
const dateInputToMs = (value: string) => Date.parse(`${value}T00:00:00.000Z`)
const msToDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Amount typed in euros → cents. Empty is a valid state (a zero line item). */
function parseEuros(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed * 100)
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

/**
 * Dialog to create or correct a property.
 *
 * What is entered here are the property's own terms and, for each cost line
 * item, an amount that only counts when that item is on the `manual` source
 * (SPEC D43). Everything else is derived: rents, charges, yield and latent
 * gain come from the matched flows and the valuations, and there is nowhere
 * to type them — by design.
 *
 * The source switch itself lives on the property sheet, in the « Source »
 * column, because that is where the two readings can be compared.
 */
export function PropertyDialog({
  orgId,
  property,
  onClose,
}: {
  orgId: Id<'organizations'>
  property?: PropertyDoc
  onClose: () => void
}) {
  const { t } = useTranslation(['immobilier', 'common'])
  const reportError = useReportError('immobilier')
  const createProperty = useConvexMutation(api.properties.create)
  const updateProperty = useConvexMutation(api.properties.update)

  const [name, setName] = useState(property?.name ?? '')
  const [address, setAddress] = useState(property?.address ?? '')
  const [propertyType, setPropertyType] = useState<PropertyAssetType>(
    property?.propertyType ?? 'appartement',
  )
  const [usage, setUsage] = useState<PropertyUsage>(
    property?.usage ?? 'locatif_nu',
  )
  const [surface, setSurface] = useState(
    property?.surfaceSqm != null ? String(property.surfaceSqm) : '',
  )
  const [acquiredDate, setAcquiredDate] = useState(
    property?.acquiredDate != null ? msToDateInput(property.acquiredDate) : '',
  )
  const [status, setStatus] = useState<PropertyDoc['status']>(
    property?.status ?? 'held',
  )
  const [saleDate, setSaleDate] = useState(
    property?.saleDate != null ? msToDateInput(property.saleDate) : '',
  )
  const [salePrice, setSalePrice] = useState(
    property?.salePriceCents != null
      ? String(property.salePriceCents / 100)
      : '',
  )
  // The entered amounts, per line item. A line item already on `flows` keeps
  // its stored amount here: switching back must not mean re-typing it.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const poste of POSTES) {
      const entry = property?.costBasis.find((row) => row.poste === poste)
      initial[poste] =
        entry?.manualAmountCents != null
          ? String(entry.manualAmountCents / 100)
          : ''
    }
    return initial
  })
  const [notes, setNotes] = useState(property?.notes ?? '')
  const [pending, setPending] = useState(false)

  const valid =
    name.trim() !== '' &&
    (status !== 'sold' || (saleDate !== '' && salePrice.trim() !== ''))

  async function handleSave() {
    if (!valid) return
    setPending(true)
    try {
      const parsedSurface = Number.parseFloat(surface.replace(',', '.'))
      const costBasis = POSTES.map((poste) => {
        const existing = property?.costBasis.find((row) => row.poste === poste)
        return {
          poste,
          // The dialog never changes a source — that is the sheet's switch.
          // A new property starts every line item on `manual`: nothing is
          // matched to it yet, so `flows` would read zero.
          source: existing?.source ?? ('manual' as const),
          manualAmountCents: parseEuros(amounts[poste] ?? ''),
        }
      })
      const fields = {
        name: name.trim(),
        address: address.trim(),
        propertyType,
        usage,
        surfaceSqm: Number.isFinite(parsedSurface) ? parsedSurface : undefined,
        acquiredDate:
          acquiredDate !== '' ? dateInputToMs(acquiredDate) : undefined,
        costBasis,
        notes: notes.trim() || undefined,
      }
      if (property) {
        await updateProperty({
          propertyId: property._id,
          status,
          saleDate: status === 'sold' ? dateInputToMs(saleDate) : undefined,
          salePriceCents:
            status === 'sold' ? parseEuros(salePrice) : undefined,
          ...fields,
        })
        toast.success(t('immobilier:create.editSuccess'))
      } else {
        await createProperty({ orgId, ...fields })
        toast.success(t('immobilier:create.success'))
      }
      onClose()
    } catch (err) {
      reportError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* A tall form needs its own height cap: shadcn's dialog has none, and
          the footer actions would fall off the viewport (CLAUDE.md). */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(
              property ? 'immobilier:create.editTitle' : 'immobilier:create.title',
            )}
          </DialogTitle>
          <DialogDescription>
            {t('immobilier:create.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('immobilier:fields.name')} htmlFor="p-name">
            <Input
              id="p-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('immobilier:fields.namePlaceholder')}
            />
          </Field>
          <Field label={t('immobilier:fields.address')} htmlFor="p-address">
            <Input
              id="p-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t('immobilier:fields.addressPlaceholder')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('immobilier:fields.propertyType')} htmlFor="p-type">
              <Select
                value={propertyType}
                onValueChange={(value) =>
                  setPropertyType(value as PropertyAssetType)
                }
              >
                <SelectTrigger id="p-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`immobilier:type.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('immobilier:fields.usage')} htmlFor="p-usage">
              <Select
                value={usage}
                onValueChange={(value) => setUsage(value as PropertyUsage)}
              >
                <SelectTrigger id="p-usage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USAGES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`immobilier:usage.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* A surface is a plain number, not money — the native numeric
                input is the right one here (CLAUDE.md). */}
            <Field label={t('immobilier:fields.surface')} htmlFor="p-surface">
              <Input
                id="p-surface"
                type="number"
                min={0}
                value={surface}
                onChange={(event) => setSurface(event.target.value)}
              />
            </Field>
            <Field
              label={t('immobilier:fields.acquiredDate')}
              htmlFor="p-acquired"
            >
              <Input
                id="p-acquired"
                type="date"
                value={acquiredDate}
                onChange={(event) => setAcquiredDate(event.target.value)}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">
                {t('immobilier:fields.costBasis')}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('immobilier:fields.costBasisHint')}
              </p>
            </div>
            {POSTES.map((poste) => (
              <Field
                key={poste}
                label={t(`immobilier:poste.${poste}`)}
                htmlFor={`p-cost-${poste}`}
              >
                <AmountInput
                  id={`p-cost-${poste}`}
                  value={amounts[poste] ?? ''}
                  onChange={(value) =>
                    setAmounts((prev) => ({ ...prev, [poste]: value }))
                  }
                />
              </Field>
            ))}
          </div>

          {property ? (
            <>
              <Field label={t('immobilier:fields.status')} htmlFor="p-status">
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as PropertyDoc['status'])
                  }
                >
                  <SelectTrigger id="p-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="held">
                      {t('immobilier:status.held')}
                    </SelectItem>
                    <SelectItem value="sold">
                      {t('immobilier:status.sold')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {status === 'sold' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t('immobilier:fields.saleDate')}
                    htmlFor="p-sale-date"
                  >
                    <Input
                      id="p-sale-date"
                      type="date"
                      value={saleDate}
                      onChange={(event) => setSaleDate(event.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('immobilier:fields.salePrice')}
                    htmlFor="p-sale-price"
                  >
                    <AmountInput
                      id="p-sale-price"
                      value={salePrice}
                      onChange={setSalePrice}
                    />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}

          <Field label={t('immobilier:fields.notes')} htmlFor="p-notes">
            <Input
              id="p-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!valid || pending}>
            {t('immobilier:create.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
