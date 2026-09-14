import { useEffect, useMemo, useState } from 'react'
import { useConvexMutation, useConvexQuery } from '@convex-dev/react-query'
import { useAction } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { AlertTriangle, Check, Upload } from 'lucide-react'

import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { StatementDraft } from '../../../convex/lib/statements'
import { useFormatters } from '~/components/participations/ParticipationsTable'
import { Badge } from '~/components/ui/badge'
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
import { LoadingLine } from '~/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/** The only reader shipped so far — the statement layouts differ per bank. */
const SOURCE = 'natixis_wm' as const

/** Sentinels of the per-account destination Select. */
const CREATE = '__create__'
const IGNORE = '__ignore__'

/** Sentinel of the support Select: create the bank as a company inline. */
const NEW_SUPPORT = '__new__'

/** ms epoch → "AAAA-MM-JJ" for a date input (statement dates are UTC). */
function toDateInput(ms: number | undefined): string {
  if (ms == null) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * « Importer un relevé » — the door that fills the securities placements of a
 * bank no connection covers (convex/statements.ts).
 *
 * Two steps on purpose, because a model reading a table can be wrong and a
 * wrong valuation written in silence is invisible: the PDF is read first and
 * nothing is stored, the screen shows account by account what was understood
 * — with the sum of the lines checked against the total the statement itself
 * prints — and only then does the human write it.
 */
export function ImportStatementDialog({
  orgId,
  onClose,
}: {
  orgId: Id<'organizations'>
  onClose: () => void
}) {
  const { t } = useTranslation(['placements', 'common'])
  const { fmtEurCents } = useFormatters()
  const generateUploadUrl = useConvexMutation(api.files.generateUploadUrl)
  const parseStatement = useAction(api.statements.parse)
  const applyStatement = useConvexMutation(api.statements.apply)
  const createCompany = useConvexMutation(api.companies.create)
  const companies = useConvexQuery(api.companies.list, { orgId })
  const placements = useConvexQuery(api.statements.listPlacementTargets, {
    orgId,
  })

  const [file, setFile] = useState<File | null>(null)
  const [reading, setReading] = useState(false)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState<StatementDraft | null>(null)
  const [storageId, setStorageId] = useState<Id<'_storage'> | null>(null)
  const [statementDate, setStatementDate] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [supportId, setSupportId] = useState<string>(NEW_SUPPORT)
  // accountNumber → dealId | CREATE | IGNORE
  const [targets, setTargets] = useState<Record<string, string>>({})

  const groupEntities = useMemo(
    () => (companies ?? []).filter((c) => c.kind.startsWith('group_')),
    [companies],
  )
  const supports = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.kind.startsWith('group_'))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  )
  const bankName = draft?.bankName ?? ''

  // Preselect the holder when the org has a single group entity — never guess
  // when several exist (same rule as CreatePlacementDialog).
  useEffect(() => {
    if (groupEntities.length === 1 && ownerId === '') {
      setOwnerId(groupEntities[0]._id)
    }
  }, [groupEntities, ownerId])

  // Preselect the support when a company already carries the bank's name.
  useEffect(() => {
    if (!bankName || supportId !== NEW_SUPPORT) return
    const match = supports.find(
      (c) => c.name.trim().toLowerCase() === bankName.trim().toLowerCase(),
    )
    if (match) setSupportId(match._id)
  }, [bankName, supports, supportId])

  async function handleRead() {
    if (!file) return
    setReading(true)
    try {
      const url = await generateUploadUrl({})
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      })
      if (!res.ok) throw new Error(`upload_failed:${res.status}`)
      const { storageId: uploaded } = (await res.json()) as {
        storageId: Id<'_storage'>
      }
      setStorageId(uploaded)
      const parsed = await parseStatement({
        orgId,
        storageId: uploaded,
        source: SOURCE,
      })
      setDraft(parsed)
      setStatementDate(toDateInput(parsed.statementDate))
      // A securities account already carried by a placement links back to it;
      // everything else defaults to what it looks like.
      const preset: Record<string, string> = {}
      for (const account of parsed.accounts) {
        const linked = (placements ?? []).find(
          (p) => p.accountNumber === account.accountNumber,
        )
        preset[account.accountNumber] = linked
          ? linked._id
          : account.isSecurities
            ? CREATE
            : IGNORE
      }
      setTargets(preset)
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = ['statement_unreadable', 'statement_unparsed']
      toast.error(
        t(
          known.includes(code)
            ? `placements:import.errors.${code}`
            : 'placements:import.errors.read',
        ),
      )
    } finally {
      setReading(false)
    }
  }

  const parsedDate = statementDate
    ? Date.UTC(
        Number(statementDate.slice(0, 4)),
        Number(statementDate.slice(5, 7)) - 1,
        Number(statementDate.slice(8, 10)),
      )
    : null
  const kept = (draft?.accounts ?? []).filter(
    (a) => targets[a.accountNumber] !== IGNORE,
  )
  const needsSupport = kept.some((a) => targets[a.accountNumber] === CREATE)
  const canWrite =
    draft != null &&
    storageId != null &&
    parsedDate != null &&
    Number.isFinite(parsedDate) &&
    ownerId !== '' &&
    kept.length > 0 &&
    !writing

  async function handleApply() {
    if (!draft || !storageId || parsedDate == null) return
    setWriting(true)
    try {
      // The support only exists to be a created placement's target — when no
      // account asks for one, none is resolved and none is created.
      const supportCompanyId = !needsSupport
        ? undefined
        : supportId === NEW_SUPPORT
          ? await createCompany({
              orgId,
              name: bankName || t('placements:import.defaultSupport'),
              kind: 'portfolio',
            })
          : (supportId as Id<'companies'>)

      const result = await applyStatement({
        orgId,
        storageId,
        source: SOURCE,
        statementDate: parsedDate,
        bankName: bankName || t('placements:import.defaultSupport'),
        ownerCompanyId: ownerId as Id<'companies'>,
        supportCompanyId,
        accounts: kept.map((account) => {
          const target = targets[account.accountNumber]
          return {
            accountNumber: account.accountNumber,
            label: account.label,
            valuation: account.totalValuation ?? account.positionsTotal,
            dealId: target === CREATE ? undefined : (target as Id<'deals'>),
            positions: account.positions,
          }
        }),
      })
      toast.success(
        t('placements:import.imported', {
          accounts: result.accountsCount,
          positions: result.positionsCount,
        }),
      )
      onClose()
    } catch (err) {
      const code = err instanceof ConvexError ? (err.data as string) : ''
      const known = [
        'owner_must_be_group_entity',
        'owner_wrong_org',
        'support_wrong_org',
        'support_required',
      ]
      toast.error(
        t(
          known.includes(code)
            ? `placements:import.errors.${code}`
            : 'placements:import.errors.apply',
        ),
      )
    } finally {
      setWriting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('placements:import.title')}</DialogTitle>
          <DialogDescription>
            {t('placements:import.description')}
          </DialogDescription>
        </DialogHeader>

        {draft == null ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="statement-file">
                {t('placements:import.fileLabel')}
              </Label>
              <Input
                id="statement-file"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-muted-foreground text-xs">
                {t('placements:import.fileHint')}
              </p>
            </div>
            {reading && (
              <LoadingLine>{t('placements:import.reading')}</LoadingLine>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="statement-date">
                  {t('placements:import.dateLabel')}
                </Label>
                <Input
                  id="statement-date"
                  type="date"
                  value={statementDate}
                  onChange={(e) => setStatementDate(e.target.value)}
                />
                {statementDate === '' && (
                  <p className="text-destructive text-xs">
                    {t('placements:import.dateMissing')}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('placements:import.ownerLabel')}</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t('placements:import.ownerPlaceholder')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {groupEntities.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {needsSupport && (
              <div className="space-y-2">
                <Label>{t('placements:import.supportLabel')}</Label>
                <Select value={supportId} onValueChange={setSupportId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_SUPPORT}>
                      {t('placements:import.supportNew', {
                        name: bankName || t('placements:import.defaultSupport'),
                      })}
                    </SelectItem>
                    {supports.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-sm font-medium">
                {t('placements:import.accountsTitle')}
              </p>
              {draft.accounts.map((account) => (
                <div
                  key={account.accountNumber}
                  className="[&>*]:min-w-0 space-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {account.label}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {account.accountNumber}
                        {account.nature ? ` · ${account.nature}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums">
                        {fmtEurCents(
                          account.totalValuation ?? account.positionsTotal,
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('placements:import.positionsCount', {
                          count: account.positions.length,
                        })}
                      </p>
                    </div>
                  </div>

                  {account.coherent ? (
                    <p className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Check className="size-3 shrink-0" />
                      {t('placements:import.coherent')}
                    </p>
                  ) : (
                    <p className="text-destructive flex items-start gap-1 text-xs">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {t('placements:import.incoherent', {
                          gap: fmtEurCents(account.gap ?? 0),
                        })}
                      </span>
                    </p>
                  )}

                  <Select
                    value={targets[account.accountNumber] ?? IGNORE}
                    onValueChange={(value) =>
                      setTargets((prev) => ({
                        ...prev,
                        [account.accountNumber]: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CREATE}>
                        {t('placements:import.targetCreate')}
                      </SelectItem>
                      {(placements ?? []).map((p) => (
                        <SelectItem key={p._id} value={p._id}>
                          {t('placements:import.targetLink', { name: p.name })}
                        </SelectItem>
                      ))}
                      <SelectItem value={IGNORE}>
                        {t('placements:import.targetIgnore')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!account.isSecurities &&
                    targets[account.accountNumber] === IGNORE && (
                      <p className="text-muted-foreground text-xs">
                        {t('placements:import.currentAccountHint')}
                      </p>
                    )}
                </div>
              ))}
            </div>

            <Badge variant="secondary" className="max-w-full">
              <span className="truncate">
                {t('placements:import.total', {
                  amount: fmtEurCents(
                    kept.reduce(
                      (sum, a) => sum + (a.totalValuation ?? a.positionsTotal),
                      0,
                    ),
                  ),
                })}
              </span>
            </Badge>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={reading || writing}
          >
            {t('common:actions.cancel')}
          </Button>
          {draft == null ? (
            <Button
              onClick={() => void handleRead()}
              disabled={!file || reading}
            >
              <Upload className="size-4" />
              {reading
                ? t('placements:import.reading')
                : t('placements:import.read')}
            </Button>
          ) : (
            <Button onClick={() => void handleApply()} disabled={!canWrite}>
              {writing
                ? t('placements:import.writing')
                : t('placements:import.submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
