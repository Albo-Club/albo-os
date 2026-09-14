/// <reference types="vite/client" />
/**
 * Regression: the company activity journal (`companyEvents`), deal families.
 *
 * - One event per mutation call, folded by priority (conversion > status >
 *   fields); a patch that changes nothing writes nothing.
 * - The status/exit gesture carries its proceeds; the clear fields show
 *   before → after, the rest is only counted.
 * - Pointing a transaction logs the match, and the pending → active
 *   promotion it triggers, under the same hand.
 * - A write confirmed through the agent is the user's, flagged `viaAgent`.
 * - The journal is read by org members only, and leaves with its deal.
 * - The backfill is idempotent.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { diffDealPatch } from './lib/companyEvents'
import {
  createBankAccount,
  createOrg,
  createPortfolioCompany,
  createTransaction,
  createUser,
  expectConvexError,
  setupHarness,
} from './regression.setup'
import type { Doc } from './_generated/dataModel'

async function orgSetup(slug = 'org-events') {
  const t = setupHarness()
  const user = await createUser(t, `${slug}@test.dev`)
  const org = await createOrg(t, slug, [{ userId: user.userId, role: 'owner' }])
  const target = await createPortfolioCompany(t, org.orgId, 'Target')
  const dealId = await user.as.mutation(api.deals.create, {
    orgId: org.orgId,
    investorCompanyId: org.rootCompanyId,
    targetCompanyId: target,
    instrumentKind: 'share',
    committedAmount: 100_000,
  })
  return { t, user, org, target, dealId }
}

const baseDeal = {
  _id: 'd' as Doc<'deals'>['_id'],
  _creationTime: 0,
  orgId: 'o' as Doc<'deals'>['orgId'],
  investorCompanyId: 'i' as Doc<'deals'>['investorCompanyId'],
  targetCompanyId: 'c' as Doc<'deals'>['targetCompanyId'],
  instrumentKind: 'share',
  currency: 'EUR',
  status: 'active',
  committedAmount: 100_000,
} as Doc<'deals'>

describe('diffDealPatch: one event per call', () => {
  test('a patch equal to the row is no event', () => {
    expect(diffDealPatch(baseDeal, { committedAmount: 100_000 })).toBeNull()
    expect(diffDealPatch(baseDeal, { exitProceeds: null })).toBeNull()
  })

  test('the exit gesture is one status event carrying the proceeds', () => {
    expect(
      diffDealPatch(baseDeal, {
        status: 'fully_exited',
        exitedDate: 1,
        exitProceeds: 180_000,
      }),
    ).toEqual({
      kind: 'status_changed',
      from: 'active',
      to: 'fully_exited',
      proceedsCents: 180_000,
    })
  })

  test('a conversion wins over the fields patched with it', () => {
    expect(
      diffDealPatch(baseDeal, {
        instrumentKind: 'safe',
        valuationCap: 1,
        committedAmount: 200_000,
      }),
    ).toEqual({ kind: 'converted', from: 'share', to: 'safe' })
  })

  test('clear fields are spelled out, the others counted', () => {
    expect(
      diffDealPatch(baseDeal, {
        committedAmount: 150_000,
        notes: 'x',
        signedDate: 5,
        manuallyEditedFields: ['notes'],
      }),
    ).toEqual({
      kind: 'fields_changed',
      changes: [{ field: 'committedAmount', from: 100_000, to: 150_000 }],
      otherCount: 2,
    })
  })
})

describe('companyEvents: journal written by the deal mutations', () => {
  test('create, then edit, then no-op edit', async () => {
    const { t, user, target, dealId } = await orgSetup()

    await user.as.mutation(api.deals.update, {
      id: dealId,
      patch: { committedAmount: 150_000, notes: 'hello' },
    })
    await user.as.mutation(api.deals.update, {
      id: dealId,
      patch: { committedAmount: 150_000 },
    })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event.kind)).toEqual(['fields_changed', 'created'])
    expect(rows[0].actor).toEqual({
      kind: 'user',
      name: 'org-events@test.dev',
      viaAgent: false,
    })
    expect(rows[0].event).toEqual({
      kind: 'fields_changed',
      changes: [{ field: 'committedAmount', from: 100_000, to: 150_000 }],
      otherCount: 1,
    })
    expect(rows[0].deal?._id).toBe(dealId)
    void t
  })

  test('pointing logs the match and the pending → active promotion', async () => {
    const { t, user, org, target } = await orgSetup('org-pointing')
    const dealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: target,
      instrumentKind: 'share',
      status: 'pending',
    })
    const account = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 50_000_00,
    })
    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    await user.as.mutation(api.transactions.unmatchTransaction, {
      transactionId: txId,
    })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    const ofDeal = rows.filter((r) => r.deal?._id === dealId)
    expect(ofDeal.map((r) => r.event.kind)).toEqual([
      'transaction_unmatched',
      'status_changed',
      'transaction_matched',
      'created',
    ])
    expect(ofDeal[2].event).toEqual({
      kind: 'transaction_matched',
      amountCents: 50_000_00,
      direction: 'out',
    })
    expect(ofDeal[1].event).toMatchObject({ from: 'pending', to: 'active' })
  })

  test("an agent write is the user's, flagged viaAgent", async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-agent')
    await t.mutation(internal.agentTools.updateDealInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      dealId,
      status: 'written_off',
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows[0].actor).toMatchObject({ kind: 'user', viaAgent: true })
    expect(rows[0].event).toEqual({
      kind: 'status_changed',
      from: 'active',
      to: 'written_off',
    })
  })

  test('a deal document logs its attach AND its removal', async () => {
    const { t, user, target, dealId } = await orgSetup('org-docs')
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      dealId,
      title: 'Pacte signé',
      kind: 'pacte',
      storageId,
    })
    await user.as.mutation(api.documents.remove, { documentId })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.slice(0, 2).map((r) => r.event)).toEqual([
      { kind: 'document_removed', title: 'Pacte signé' },
      { kind: 'document_attached', title: 'Pacte signé' },
    ])
  })

  test('the journal is org-scoped and leaves with its deal', async () => {
    const { t, user, target, dealId } = await orgSetup('org-scope')
    const stranger = await createUser(t, 'stranger@test.dev')
    await expectConvexError(
      stranger.as.query(api.companyEvents.listByCompany, { companyId: target }),
      'not_a_member',
    )

    await user.as.mutation(api.deals.remove, { id: dealId })
    const left = await t.run(async (ctx) =>
      ctx.db
        .query('companyEvents')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect(),
    )
    expect(left).toHaveLength(0)
  })

  test('setting a matched transaction aside logs it leaving the deal', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-aside')
    const account = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 12_000_00,
    })
    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: txId,
      dealId,
    })
    // Reclassified straight to "charge": no explicit unmatch, yet the deal
    // loses the transaction — the journal must say so.
    await user.as.mutation(api.transactions.categorizeAsCharge, {
      transactionId: txId,
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event.kind)).toEqual([
      'transaction_unmatched',
      'transaction_matched',
      'created',
    ])
  })

  test('the backfill replays the pointage log: match, unmatch, re-match, aside', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-replay')
    const account = await createBankAccount(t, org)
    const txId = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 150_000_00,
    })
    const match = () =>
      user.as.mutation(api.transactions.matchTransaction, {
        transactionId: txId,
        dealId,
      })
    await match()
    await user.as.mutation(api.transactions.unmatchTransaction, {
      transactionId: txId,
    })
    await match()
    await user.as.mutation(api.transactions.categorizeAsCharge, {
      transactionId: txId,
    })
    // Pretend the journal did not exist: only the decision log remains.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })

    const result = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'matching' },
    )
    expect(result).toMatchObject({ written: 4, removed: 0, unattributable: 0 })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    // Newest first: aside (unmatched), re-match, unmatch, first match.
    expect(rows.map((r) => r.event.kind)).toEqual([
      'transaction_unmatched',
      'transaction_matched',
      'transaction_unmatched',
      'transaction_matched',
    ])
    expect(rows[0].event).toMatchObject({
      amountCents: 150_000_00,
      direction: 'out',
    })
    // Idempotent: a second run writes nothing.
    const again = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'matching' },
    )
    expect(again.written).toBe(0)
  })

  test('the backfill drops a deleted transaction and counts an orphan unmatch', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-replay-edge')
    const account = await createBankAccount(t, org)
    const gone = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 1_00,
    })
    const orphan = await createTransaction(t, org.orgId, account, {
      direction: 'out',
      amount: 2_00,
    })
    await user.as.mutation(api.transactions.matchTransaction, {
      transactionId: gone,
      dealId,
    })
    const goneDecision = await t.run(async (ctx) => {
      const md = await ctx.db
        .query('matchingDecisions')
        .withIndex('by_transaction', (q) => q.eq('transactionId', gone))
        .first()
      // The transaction disappears (deduplication) after being matched…
      await ctx.db.delete('transactions', gone)
      // …and an unmatch is logged on a transaction the log never saw matched.
      await ctx.db.insert('matchingDecisions', {
        orgId: org.orgId,
        transactionId: orphan,
        decision: 'unmatched',
        source: 'manual',
        decidedBy: user.userId,
        decidedAt: Date.now(),
        txLabel: 'orphan',
        txAmount: 2_00,
        txDate: Date.now(),
        txBankAccountId: account,
      })
      // A row an earlier backfill wrote for the deleted transaction.
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
      await ctx.db.insert('companyEvents', {
        orgId: org.orgId,
        companyId: target,
        dealId,
        at: Date.now(),
        actor: { kind: 'user', userId: user.userId },
        event: { kind: 'transaction_matched', amountCents: 1_00 },
        backfillKey: `md:${md!._id}`,
      })
      return md!._id
    })
    void goneDecision

    const result = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'matching' },
    )
    expect(result).toMatchObject({ written: 0, removed: 1, unattributable: 1 })
    const dry = await t.query(
      internal.migrations.backfillCompanyEvents.dryRun,
      {},
    )
    expect(dry).toMatchObject({ unattributable: 1, already: 0 })
    expect(dry.candidates.matching).toBe(0)
  })

  test('a report filed, re-sent unchanged, corrected, detached and deleted', async () => {
    const { t, user, org, target } = await orgSetup('org-reports')
    const forwarder = await createUser(t, 'forwarder@test.dev')
    await t.run(async (ctx) => {
      await ctx.db.insert('organizationMembers', {
        orgId: org.orgId,
        userId: forwarder.userId,
        role: 'member',
        joinedAt: Date.now(),
      })
    })
    const mail = (id: string, receivedAt: number) =>
      t.run(async (ctx) =>
        ctx.db.insert('inboundEmails', {
          agentmailInboxId: 'inbox-test',
          agentmailMessageId: id,
          fromEmail: 'i.milli@weluma.com',
          toEmails: ['reports@test.dev'],
          ccEmails: [],
          subject: 'Fwd: Reporting Q2',
          receivedAt,
          attachments: [],
          status: 'received',
          senderUserId: forwarder.userId,
        }),
      )
    const first = await mail('msg-q2', Date.now() - 20_000)
    const resend = await mail('msg-q2-bis', Date.now() - 10_000)
    const store = (
      inboundEmailId: typeof first,
      headline: string,
      sameSource?: boolean,
    ) =>
      t.mutation(internal.reportStore.storeForCompany, {
        companyId: target,
        orgId: org.orgId,
        inboundEmailId,
        title: 'Reporting Q2',
        headline,
        keyHighlights: ['point'],
        reportPeriod: 'Q2 2026',
        reportType: 'quarterly',
        metrics: {},
        rawMetrics: [],
        canonical: [],
        sameSource,
      })
    const { reportId } = await store(first, 'v1')
    await store(first, 'v1', true) // same source text: silent
    await store(resend, 'v2') // corrected re-send
    await user.as.mutation(api.reportInbox.detachCompany, { reportId })

    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.deal === null)
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'report_detached', label: 'Q2 2026' },
      { kind: 'report_updated', channel: 'email', label: 'Q2 2026' },
      {
        kind: 'report_received',
        channel: 'email',
        label: 'Q2 2026',
        fromEmail: 'i.milli@weluma.com',
      },
    ])
    // Received / updated are the forwarder's; the detach is the member's.
    expect(rows[2].actor).toMatchObject({ name: 'forwarder@test.dev' })
    expect(rows[0].actor).toMatchObject({ name: 'org-reports@test.dev' })
  })

  test('a Parallel publication is credited to Parallel', async () => {
    const { t, user, org, target } = await orgSetup('org-portal')
    const inboundEmailId = await t.run(async (ctx) =>
      ctx.db.insert('inboundEmails', {
        origin: 'vasco',
        agentmailInboxId: 'vasco',
        agentmailMessageId: 'vasco-1',
        fromEmail: 'noreply@parallel.test',
        toEmails: [],
        ccEmails: [],
        subject: 'Publication T2',
        receivedAt: Date.now() + 1_000,
        attachments: [],
        status: 'received',
      }),
    )
    await t.mutation(internal.reportStore.storeForCompany, {
      companyId: target,
      orgId: org.orgId,
      inboundEmailId,
      title: 'Publication T2',
      headline: 'h',
      keyHighlights: [],
      metrics: {},
      rawMetrics: [],
      canonical: [],
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows[0]).toMatchObject({
      actor: { kind: 'system', source: 'vasco' },
      event: {
        kind: 'report_received',
        channel: 'vasco',
        label: 'Publication T2',
      },
    })
  })

  test('the vault: a company document added, renamed, then removed', async () => {
    const { t, user, target } = await orgSetup('org-vault')
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    )
    const documentId = await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'Statuts.pdf',
      kind: 'legal',
      storageId,
    })
    await user.as.mutation(api.documents.update, {
      documentId,
      title: 'Statuts 2026.pdf',
      kind: 'legal',
    })
    // Saving the same title and kind again is not a gesture.
    await user.as.mutation(api.documents.update, {
      documentId,
      title: 'Statuts 2026.pdf',
      kind: 'legal',
    })
    await user.as.mutation(api.documents.remove, { documentId })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'vault_document_removed', title: 'Statuts 2026.pdf' },
      { kind: 'vault_document_updated', title: 'Statuts 2026.pdf' },
      { kind: 'vault_document_added', title: 'Statuts.pdf' },
      { kind: 'created' },
    ])
  })

  test('the backfill rebuilds received reports and vault files once', async () => {
    const { t, user, org, target } = await orgSetup('org-backfill-company')
    const inboundEmailId = await t.run(async (ctx) =>
      ctx.db.insert('inboundEmails', {
        origin: 'upload',
        agentmailInboxId: 'upload',
        agentmailMessageId: 'up-1',
        fromEmail: user.userId,
        toEmails: [],
        ccEmails: [],
        subject: 'Dépôt',
        receivedAt: Date.now(),
        attachments: [],
        status: 'received',
        senderUserId: user.userId,
      }),
    )
    await t.mutation(internal.reportStore.storeForCompany, {
      companyId: target,
      orgId: org.orgId,
      inboundEmailId,
      title: 'Annuel 2025',
      headline: 'h',
      keyHighlights: [],
      metrics: {},
      rawMetrics: [],
      canonical: [],
    })
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['x'], { type: 'application/pdf' })),
    )
    await user.as.mutation(api.documents.create, {
      companyId: target,
      title: 'Kbis.pdf',
      kind: 'legal',
      storageId,
    })
    // Wipe the live journal: only the rows remain.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })
    const reports = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'reports' },
    )
    const vault = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'vault' },
    )
    expect(reports.written).toBe(1)
    expect(vault.written).toBe(1)
    const again = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'reports' },
    )
    expect(again.written).toBe(0)
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event.kind).sort()).toEqual([
      'report_received',
      'vault_document_added',
    ])
    expect(rows.find((r) => r.event.kind === 'report_received')).toMatchObject({
      actor: { kind: 'user' },
      event: { channel: 'upload', label: 'Annuel 2025' },
    })
    const dry = await t.query(
      internal.migrations.backfillCompanyEvents.dryRun,
      {},
    )
    expect(dry.candidates).toMatchObject({ reports: 1, vault: 1 })
  })

  test('the backfill skips what the Airtable import copied in bulk', async () => {
    const { t, user, org, target } = await orgSetup('org-backfill-import')
    await t.run(async (ctx) => {
      await ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'active',
        airtableId: 'recIMPORTED',
      })
      await ctx.db.insert('deals', {
        orgId: org.orgId,
        investorCompanyId: org.rootCompanyId,
        targetCompanyId: target,
        instrumentKind: 'share',
        currency: 'EUR',
        status: 'pending',
        attioDealId: 'attio-1',
      })
      // Drop the live events so only the backfill speaks.
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })
    await t.mutation(internal.migrations.backfillCompanyEvents.apply, {
      source: 'deals',
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    // The manual deal (unknown author) and the Attio one; never the import.
    expect(rows.map((r) => r.actor)).toEqual(
      expect.arrayContaining([
        { kind: 'unknown' },
        { kind: 'system', source: 'attio' },
      ]),
    )
    expect(rows).toHaveLength(2)
  })

  test('the backfill reconstructs a creation once, never twice', async () => {
    const { t, user, target, dealId } = await orgSetup('org-backfill')
    // Simulate a deal that predates the journal: drop its live event.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('companyEvents')
        .withIndex('by_deal', (q) => q.eq('dealId', dealId))
        .collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })

    const first = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      {
        source: 'deals',
      },
    )
    const second = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'deals' },
    )
    expect(first.written).toBe(1)
    expect(second.written).toBe(0)

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor: { kind: 'unknown' },
      event: { kind: 'created' },
    })
  })
})
