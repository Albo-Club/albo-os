import { ConvexError, v } from 'convex/values'
import { httpAction, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { verifyHmac } from './lib/webhookAuth'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import type { FunctionArgs, GenericMutationCtx } from 'convex/server'

type MutCtx = GenericMutationCtx<DataModel>

const eur = (value: number) => Math.round(value * 100) // euros (float) → cents

/**
 * Powens → n8n → Convex bank-data ingestion.
 *
 * Pipeline: Powens webhooks hit n8n (which validates Powens' BI-Signature),
 * n8n maps the few fields we need and POSTs to the HTTP routes below, signing
 * the raw body with HMAC-SHA256 (`ALBO_INGEST_SECRET`). Convex owns the data:
 * tenant resolution, cents conversion, dedup, and the no-backfill cutoff.
 *
 * Multi-tenant: the "tenant" of an account is the couple
 * `(orgId, ownerCompanyId)` where ownerCompany is a `group_*` entity. n8n
 * resolves which entity owns each account and sends `orgSlug` + `ownerCompany`
 * on the accounts call. Transactions carry no tenant — it is inherited from
 * the already-persisted account via `powensAccountId`.
 */

async function resolveOrg(
  ctx: MutCtx,
  orgSlug: string,
): Promise<Id<'organizations'>> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
    .unique()
  if (!org) throw new ConvexError('org_not_found')
  return org._id
}

async function resolveOwnerCompany(
  ctx: MutCtx,
  orgId: Id<'organizations'>,
  owner: { siren?: string; name?: string },
): Promise<Id<'companies'>> {
  let company: Doc<'companies'> | null = null
  if (owner.siren) {
    const siren = owner.siren
    company = await ctx.db
      .query('companies')
      .withIndex('by_org_siren', (q) =>
        q.eq('orgId', orgId).eq('siren', siren),
      )
      .first()
  }
  if (!company && owner.name) {
    const byOrg = await ctx.db
      .query('companies')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    company = byOrg.find((c) => c.name === owner.name) ?? null
  }
  if (!company) throw new ConvexError('owner_company_not_found')
  if (!company.kind.startsWith('group_')) {
    throw new ConvexError('owner_must_be_group_entity')
  }
  return company._id
}

/**
 * Upsert bank accounts + balances. Keyed on `powensAccountId`. On first
 * insert, stamps `ingestSince = now()` (the no-backfill cutoff); never
 * touches it again afterwards.
 */
export const upsertAccount = internalMutation({
  args: {
    orgSlug: v.string(),
    ownerCompany: v.object({
      siren: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    powensUserId: v.optional(v.string()),
    accounts: v.array(
      v.object({
        powensAccountId: v.string(),
        powensConnectionId: v.optional(v.string()),
        bankName: v.string(),
        label: v.string(),
        iban: v.optional(v.string()),
        accountKind: v.optional(v.string()),
        currency: v.optional(v.string()),
        balance: v.optional(v.number()), // euros (float)
        balanceDate: v.optional(v.number()), // ms epoch
      }),
    ),
  },
  handler: async (ctx, args) => {
    const orgId = await resolveOrg(ctx, args.orgSlug)
    const ownerCompanyId = await resolveOwnerCompany(
      ctx,
      orgId,
      args.ownerCompany,
    )
    const now = Date.now()
    const created: Array<Id<'bankAccounts'>> = []
    const updated: Array<Id<'bankAccounts'>> = []

    for (const a of args.accounts) {
      const existing = await ctx.db
        .query('bankAccounts')
        .withIndex('by_powens_account', (q) =>
          q.eq('powensAccountId', a.powensAccountId),
        )
        .first()

      const common = {
        orgId,
        ownerCompanyId,
        bankName: a.bankName.trim(),
        label: a.label.trim(),
        iban: a.iban,
        accountKind: a.accountKind,
        currency: a.currency ?? 'EUR',
        currentBalance: a.balance != null ? eur(a.balance) : undefined,
        balanceAsOf: a.balanceDate,
        powensConnectionId: a.powensConnectionId,
        powensAccountId: a.powensAccountId,
        powensUserId: args.powensUserId,
        lastSyncedAt: now,
      }

      if (existing) {
        await ctx.db.patch("bankAccounts", existing._id, common) // ingestSince left intact
        updated.push(existing._id)
      } else {
        const id = await ctx.db.insert('bankAccounts', {
          ...common,
          ingestSince: now,
        })
        created.push(id)
      }
    }
    return { created, updated }
  },
})

/**
 * Ingest new transactions. Keyed on `powensTxId`:
 *  - already known → patch (corrections, coming→applied), never touches
 *    reconciliation fields;
 *  - new → ingested only if `date >= account.ingestSince` (no backfill);
 *    older-than-cutoff unseen transactions are dropped.
 * The owning account must already exist (n8n sends accounts before tx).
 */
export const ingestTransactions = internalMutation({
  args: {
    transactions: v.array(
      v.object({
        powensTxId: v.string(),
        powensAccountId: v.string(),
        value: v.number(), // euros (float), signed (negative = debit)
        date: v.number(), // ms epoch UTC — operation date
        valueDate: v.optional(v.number()), // ms epoch UTC
        rawLabel: v.string(),
        counterparty: v.optional(v.string()),
        lastUpdate: v.optional(v.number()), // ms epoch
        coming: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { transactions }) => {
    let inserted = 0
    let updated = 0
    let skippedBeforeCutoff = 0
    let skippedUnknownAccount = 0

    for (const t of transactions) {
      const account = await ctx.db
        .query('bankAccounts')
        .withIndex('by_powens_account', (q) =>
          q.eq('powensAccountId', t.powensAccountId),
        )
        .first()
      if (!account) {
        skippedUnknownAccount++
        continue
      }

      const direction = t.value < 0 ? ('out' as const) : ('in' as const)
      const amount = eur(Math.abs(t.value))

      const existing = await ctx.db
        .query('transactions')
        .withIndex('by_powens_id', (q) => q.eq('powensTxId', t.powensTxId))
        .first()

      if (existing) {
        await ctx.db.patch("transactions", existing._id, {
          direction,
          amount,
          transactionDate: t.date,
          valueDate: t.valueDate,
          rawLabel: t.rawLabel.trim(),
          counterparty: t.counterparty,
          powensLastUpdate: t.lastUpdate,
          pending: t.coming,
        })
        updated++
        continue
      }

      if (account.ingestSince != null && t.date < account.ingestSince) {
        skippedBeforeCutoff++
        continue
      }

      await ctx.db.insert('transactions', {
        orgId: account.orgId,
        bankAccountId: account._id,
        direction,
        amount,
        transactionDate: t.date,
        valueDate: t.valueDate,
        rawLabel: t.rawLabel.trim(),
        counterparty: t.counterparty,
        source: 'powens',
        powensTxId: t.powensTxId,
        powensLastUpdate: t.lastUpdate,
        pending: t.coming,
        reconciled: false,
      })
      inserted++
    }
    return { inserted, updated, skippedBeforeCutoff, skippedUnknownAccount }
  },
})

// ─── HTTP routes (registered in convex/http.ts) ────────────────────────────

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Returns the raw body if the HMAC signature is valid, else null. */
async function authedBody(request: Request): Promise<string | null> {
  const body = await request.text()
  const ok = await verifyHmac(
    body,
    request.headers.get('X-Albo-Signature'),
    process.env.ALBO_INGEST_SECRET,
  )
  return ok ? body : null
}

export const accountsWebhook = httpAction(async (ctx, request) => {
  const body = await authedBody(request)
  if (body === null) return new Response('Unauthorized', { status: 401 })
  let payload: FunctionArgs<typeof internal.powens.upsertAccount>
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  try {
    return json(await ctx.runMutation(internal.powens.upsertAccount, payload))
  } catch (e) {
    if (e instanceof ConvexError) return json({ error: e.data }, 422)
    throw e
  }
})

export const transactionsWebhook = httpAction(async (ctx, request) => {
  const body = await authedBody(request)
  if (body === null) return new Response('Unauthorized', { status: 401 })
  let payload: FunctionArgs<typeof internal.powens.ingestTransactions>
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  try {
    return json(
      await ctx.runMutation(internal.powens.ingestTransactions, payload),
    )
  } catch (e) {
    if (e instanceof ConvexError) return json({ error: e.data }, 422)
    throw e
  }
})
