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
 * - The company itself: creation, identity (a rename in clear), people, the
 *   Attio and Parallel links, archiving; hand-entered KPIs; the business
 *   plan. Automatic writes on the row stay out (cf. tests/journalGuards).
 * - A forecast rule tied to a deal (created, edited, toggled, moved,
 *   deleted) journals on that deal; one without a deal writes nothing. A
 *   to-do tied to a company journals on it; one without stays silent.
 */
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { diffCompanyPatch, diffDealPatch } from './lib/companyEvents'
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
      { source: 'matching', chain: false },
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
      { source: 'matching', chain: false },
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
      { source: 'matching', chain: false },
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
      { source: 'reports', chain: false },
    )
    const vault = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'vault', chain: false },
    )
    expect(reports.written).toBe(1)
    expect(vault.written).toBe(1)
    const again = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'reports', chain: false },
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
    expect(dry.candidates).toMatchObject({ vault: 1 })
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
      chain: false,
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
        chain: false,
      },
    )
    const second = await t.mutation(
      internal.migrations.backfillCompanyEvents.apply,
      { source: 'deals', chain: false },
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

const baseCompany = {
  _id: 'c' as Doc<'companies'>['_id'],
  _creationTime: 0,
  orgId: 'o' as Doc<'companies'>['orgId'],
  name: 'Acme',
  kind: 'portfolio',
  sector: 'saas',
  people: [{ role: 'founder', name: 'Ada' }],
} as Doc<'companies'>

describe('diffCompanyPatch: one event per save', () => {
  test('a save equal to the row is no event', () => {
    expect(
      diffCompanyPatch(baseCompany, { name: 'Acme', sector: 'saas' }),
    ).toBeNull()
    expect(diffCompanyPatch(baseCompany, { summary: undefined })).toBeNull()
  })

  test('a rename is spelled out, the other fields counted', () => {
    expect(
      diffCompanyPatch(baseCompany, {
        name: 'Acme Corp',
        sector: 'fintech',
        domain: 'acme.io',
      }),
    ).toEqual({
      kind: 'company_updated',
      rename: { from: 'Acme', to: 'Acme Corp' },
      otherCount: 2,
    })
    expect(diffCompanyPatch(baseCompany, { sector: 'fintech' })).toEqual({
      kind: 'company_updated',
      otherCount: 1,
    })
  })

  test('the people list diffs by name; the Attio link wins over the rest', () => {
    expect(
      diffCompanyPatch(baseCompany, {
        people: [
          { role: 'founder', name: 'Ada' },
          { role: 'board', name: 'Grace' },
        ],
      }),
    ).toEqual({ kind: 'people_changed', added: ['Grace'], removed: [] })
    expect(
      diffCompanyPatch(baseCompany, { attioCompanyId: 'rec1', name: 'X' }),
    ).toEqual({ kind: 'attio_linked' })
    expect(
      diffCompanyPatch(
        { ...baseCompany, attioCompanyId: 'rec1' },
        { attioCompanyId: undefined },
      ),
    ).toEqual({ kind: 'attio_unlinked' })
  })
})

describe('companyEvents: the company itself, KPIs and the business plan', () => {
  test('created, renamed, people, links, archived then restored', async () => {
    const { user, org } = await orgSetup('org-company')
    const companyId = await user.as.mutation(api.companies.create, {
      orgId: org.orgId,
      name: 'Acme',
      kind: 'portfolio',
    })
    await user.as.mutation(api.companies.update, {
      id: companyId,
      patch: { name: 'Acme Corp', sector: 'saas' },
    })
    // Saving the same values again is not a gesture.
    await user.as.mutation(api.companies.update, {
      id: companyId,
      patch: { name: 'Acme Corp', sector: 'saas', summary: '' },
    })
    await user.as.mutation(api.companies.update, {
      id: companyId,
      patch: { people: [{ role: 'founder', name: 'Ada' }] },
    })
    await user.as.mutation(api.companies.update, {
      id: companyId,
      patch: { attioCompanyId: 'rec1' },
    })
    await user.as.mutation(api.companies.setVascoLink, {
      id: companyId,
      clientSlug: 'parallel',
      issuerId: 'spv-1',
    })
    // Re-saving the same link is mute; unlinking is a gesture.
    await user.as.mutation(api.companies.setVascoLink, {
      id: companyId,
      clientSlug: 'parallel',
      issuerId: 'spv-1',
    })
    await user.as.mutation(api.companies.setVascoLink, { id: companyId })
    await user.as.mutation(api.companies.archive, { id: companyId })
    await user.as.mutation(api.companies.archive, { id: companyId })
    await user.as.mutation(api.companies.restore, { id: companyId })
    await user.as.mutation(api.companies.restore, { id: companyId })

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId,
    })
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'company_restored' },
      { kind: 'company_archived' },
      { kind: 'vasco_unlinked' },
      { kind: 'vasco_linked' },
      { kind: 'attio_linked' },
      { kind: 'people_changed', added: ['Ada'], removed: [] },
      {
        kind: 'company_updated',
        rename: { from: 'Acme', to: 'Acme Corp' },
        otherCount: 1,
      },
      { kind: 'company_created' },
    ])
    expect(rows.every((r) => r.deal === null)).toBe(true)
    expect(rows[0].actor).toEqual({
      kind: 'user',
      name: expect.any(String),
      viaAgent: false,
    })
  })

  test("a company created or edited through the agent is the user's, viaAgent", async () => {
    const { t, user, org } = await orgSetup('org-company-agent')
    const { _id: companyId } = await t.mutation(
      internal.agentTools.createCompanyInternal,
      { orgId: org.orgId, actorUserId: user.userId, name: 'Beta' },
    )
    await t.mutation(internal.agentTools.updateCompanyInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      companyId,
      name: 'Beta Labs',
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId,
    })
    expect(rows.map((r) => r.event.kind)).toEqual([
      'company_updated',
      'company_created',
    ])
    expect(rows.every((r) => r.actor.kind === 'user' && r.actor.viaAgent)).toBe(
      true,
    )
  })

  test('a KPI added by hand or through the agent, then removed', async () => {
    const { t, user, org, target } = await orgSetup('org-kpi')
    const snapshotId = await user.as.mutation(api.kpis.create, {
      companyId: target,
      metricType: 'ARR',
      periodStart: 1,
      periodEnd: 2,
      value: 500_000,
      unit: 'EUR_cents',
    })
    await t.mutation(internal.kpis.createInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      companyId: target,
      metricType: 'headcount',
      periodStart: 1,
      periodEnd: 2,
      value: 12,
    })
    await user.as.mutation(api.kpis.remove, { snapshotId })
    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.deal === null)
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'kpi_removed', metricType: 'arr', periodEnd: 2 },
      { kind: 'kpi_added', metricType: 'headcount', periodEnd: 2, value: 12 },
      {
        kind: 'kpi_added',
        metricType: 'arr',
        periodEnd: 2,
        value: 500_000,
        unit: 'EUR_cents',
      },
    ])
    expect(
      rows.map((r) => r.actor.kind === 'user' && r.actor.viaAgent),
    ).toEqual([false, true, false])
  })

  test('a capital operation added then removed (ALB-248)', async () => {
    const { user, target } = await orgSetup('org-capital-journal')
    const eventId = await user.as.mutation(api.capitalEvents.create, {
      companyId: target,
      asOf: Date.UTC(2025, 11, 10),
      kind: 'round',
      pricePerShare: 80_00,
      sharesIssued: 2_500,
      totalSharesAfter: 40_000,
    })
    await user.as.mutation(api.capitalEvents.remove, { eventId })
    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.deal === null)
    expect(rows.map((r) => r.event)).toEqual([
      {
        kind: 'capital_event_removed',
        capitalKind: 'round',
        asOf: Date.UTC(2025, 11, 10),
      },
      {
        kind: 'capital_event_added',
        capitalKind: 'round',
        asOf: Date.UTC(2025, 11, 10),
        pricePerShareCents: 80_00,
        totalSharesAfter: 40_000,
      },
    ])
    expect(rows.every((r) => r.actor.kind === 'user')).toBe(true)
  })

  test('the AI score is journaled at every synthesis, changed or not (ALB-252)', async () => {
    const { t, user, org, target } = await orgSetup('org-score')
    const synth = (score: number, label: string) =>
      t.mutation(internal.intelligence.upsertIntelligence, {
        companyId: target,
        orgId: org.orgId,
        status: 'completed',
        analysis: { executive_summary: 's', health_score: { score, label } },
      })
    const report = (reportPeriod: string) =>
      t.run(async (ctx) =>
        ctx.db.insert('companyReports', {
          orgId: org.orgId,
          companyId: target,
          source: 'upload',
          status: 'completed',
          reportPeriod,
        }),
      )
    // A synthesis that yields no score (processing, no_data) writes nothing.
    await t.mutation(internal.intelligence.upsertIntelligence, {
      companyId: target,
      orgId: org.orgId,
      status: 'no_data',
      analysis: null,
    })
    await report('Q3 2025')
    await synth(8, 'En bonne voie')
    await report('Q4 2025')
    await synth(6, 'À surveiller')
    await synth(6, 'À surveiller') // manual rerun, same score: still a line
    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.deal === null)
    expect(rows.map((r) => r.event)).toEqual([
      {
        kind: 'score_updated',
        from: 6,
        to: 6,
        label: 'À surveiller',
        reportLabel: 'Q4 2025',
      },
      {
        kind: 'score_updated',
        from: 8,
        to: 6,
        label: 'À surveiller',
        reportLabel: 'Q4 2025',
      },
      {
        kind: 'score_updated',
        to: 8,
        label: 'En bonne voie',
        reportLabel: 'Q3 2025',
      },
    ])
    expect(rows[0].actor).toEqual({ kind: 'system', source: 'intelligence' })
    // The fiche reads the latest line back as before → after, with the
    // report the previous score came from.
    const intel = await user.as.query(api.intelligence.getByCompany, {
      companyId: target,
    })
    expect(intel?.scoreEvolution).toEqual({
      previousScore: 6,
      previousReportLabel: 'Q4 2025',
    })
  })

  test('a business plan replaced is one event on the deal', async () => {
    const { user, target, dealId } = await orgSetup('org-bp')
    await user.as.mutation(api.projections.replaceVersion, {
      dealId,
      version: 'initial',
      lines: [
        { period: 1, amountCents: 1_000, direction: 'in' },
        { period: 2, amountCents: 1_000, direction: 'in' },
      ],
    })
    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows[0]).toMatchObject({
      deal: { _id: dealId },
      event: { kind: 'projection_replaced', version: 'initial', lineCount: 2 },
    })
  })

  test('the backfill rebuilds companies, hand-entered KPIs and BPs once', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-backfill-co')
    // Newer than the rows the harness creates now, older than nothing.
    const archivedAt = Date.now() + 5_000
    await t.run(async (ctx) => {
      await ctx.db.patch('companies', target, { archivedAt })
      // An imported company and a report-extracted KPI must stay silent.
      await ctx.db.insert('companies', {
        orgId: org.orgId,
        name: 'Imported',
        kind: 'portfolio',
        airtableId: 'recX',
      })
      await ctx.db.insert('kpiSnapshots', {
        orgId: org.orgId,
        companyId: target,
        metricType: 'arr',
        periodStart: 1,
        periodEnd: 2,
        value: 1,
        source: 'report:abc',
        capturedAt: 10,
      })
      await ctx.db.insert('kpiSnapshots', {
        orgId: org.orgId,
        companyId: target,
        metricType: 'mrr',
        periodStart: 1,
        periodEnd: 2,
        value: 2,
        capturedAt: 20,
        capturedBy: user.userId,
      })
      for (const period of [1, 2, 3]) {
        await ctx.db.insert('dealProjections', {
          orgId: org.orgId,
          dealId,
          version: 'revised',
          period,
          amountCents: 100,
          direction: 'in',
        })
      }
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })
    const run = async () => {
      let written = 0
      for (const source of ['companies', 'kpis', 'projections'] as const) {
        const r = await t.mutation(
          internal.migrations.backfillCompanyEvents.apply,
          { source, chain: false },
        )
        written += r.written
      }
      return written
    }
    // Target: created + archived; root entity: created; imported: nothing.
    expect(await run()).toBe(3 + 1 + 1)
    expect(await run()).toBe(0)

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'company_archived' },
      { kind: 'projection_replaced', version: 'revised', lineCount: 3 },
      { kind: 'company_created' },
      { kind: 'kpi_added', metricType: 'mrr', periodEnd: 2, value: 2 },
    ])
    expect(rows[0].at).toBe(archivedAt)
    expect(rows[3].actor.kind).toBe('user')
  })
})

describe('companyEvents: forecast rules on their deal, to-dos on their company', () => {
  const ruleArgs = {
    label: 'Coupon',
    amountCents: 500_000,
    direction: 'in' as const,
    frequency: 'quarterly' as const,
    anchorDay: 15,
    startDate: Date.UTC(2026, 0, 15),
  }

  test('a rule created, edited, toggled, moved to another deal, deleted', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-rules')
    const other = await createPortfolioCompany(t, org.orgId, 'Other')
    const otherDealId = await user.as.mutation(api.deals.create, {
      orgId: org.orgId,
      investorCompanyId: org.rootCompanyId,
      targetCompanyId: other,
      instrumentKind: 'share',
      committedAmount: 50_000,
    })
    const ruleId = await user.as.mutation(api.forecasts.createRule, {
      orgId: org.orgId,
      dealId,
      ...ruleArgs,
    })
    await user.as.mutation(api.forecasts.updateRule, {
      ruleId,
      patch: { amountCents: 600_000 },
    })
    // Same values again: not a gesture.
    await user.as.mutation(api.forecasts.updateRule, {
      ruleId,
      patch: { amountCents: 600_000 },
    })
    await user.as.mutation(api.forecasts.updateRule, {
      ruleId,
      patch: { active: false },
    })
    await user.as.mutation(api.forecasts.updateRule, {
      ruleId,
      patch: { dealId: otherDealId },
    })
    await user.as.mutation(api.forecasts.deleteRule, { ruleId })
    // A rule with no deal has no sheet: nothing is written anywhere.
    await user.as.mutation(api.forecasts.createRule, {
      orgId: org.orgId,
      ...ruleArgs,
      label: 'Loyer',
    })

    const onTarget = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.event.kind !== 'created')
    expect(onTarget.map((r) => r.event)).toEqual([
      { kind: 'rule_unlinked', label: 'Coupon' },
      { kind: 'rule_toggled', label: 'Coupon', active: false },
      { kind: 'rule_updated', label: 'Coupon' },
      {
        kind: 'rule_created',
        label: 'Coupon',
        amountCents: 500_000,
        frequency: 'quarterly',
      },
    ])
    const onOther = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: other,
      })
    ).filter((r) => r.event.kind !== 'created')
    expect(onOther.map((r) => r.event)).toEqual([
      { kind: 'rule_deleted', label: 'Coupon' },
      { kind: 'rule_linked', label: 'Coupon' },
    ])
    expect(onOther[0].deal?._id).toBe(otherDealId)
  })

  test("a rule written through the agent is the user's, viaAgent", async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-rules-agent')
    const { _id: ruleId } = await t.mutation(
      internal.agentToolsForecasts.createRuleInternal,
      { orgId: org.orgId, actorUserId: user.userId, dealId, ...ruleArgs },
    )
    await t.mutation(internal.agentToolsForecasts.updateRuleInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      ruleId,
      label: 'Coupon 2',
    })
    await t.mutation(internal.agentToolsForecasts.deleteRuleInternal, {
      orgId: org.orgId,
      actorUserId: user.userId,
      ruleId,
    })
    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.event.kind !== 'created')
    expect(rows.map((r) => r.event.kind)).toEqual([
      'rule_deleted',
      'rule_updated',
      'rule_created',
    ])
    expect(rows.every((r) => r.actor.kind === 'user' && r.actor.viaAgent)).toBe(
      true,
    )
  })

  test('a to-do tied to a company: created, moved, done, removed', async () => {
    const { user, org, target } = await orgSetup('org-todos')
    const taskId = await user.as.mutation(api.todo.createTask, {
      orgId: org.orgId,
      title: 'Relancer le founder',
      companyId: target,
    })
    await user.as.mutation(api.todo.setTaskStatus, {
      taskId,
      status: 'in_progress',
    })
    // Same status again: not a gesture.
    await user.as.mutation(api.todo.setTaskStatus, {
      taskId,
      status: 'in_progress',
    })
    await user.as.mutation(api.todo.setTaskStatus, { taskId, status: 'done' })
    await user.as.mutation(api.todo.removeTask, { taskId })
    // Without a company: nowhere to show, nothing written.
    const loose = await user.as.mutation(api.todo.createTask, {
      orgId: org.orgId,
      title: 'Appeler la banque',
    })
    await user.as.mutation(api.todo.setTaskStatus, {
      taskId: loose,
      status: 'done',
    })

    const rows = (
      await user.as.query(api.companyEvents.listByCompany, {
        companyId: target,
      })
    ).filter((r) => r.deal === null)
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'todo_removed', title: 'Relancer le founder' },
      { kind: 'todo_status', title: 'Relancer le founder', status: 'done' },
      {
        kind: 'todo_status',
        title: 'Relancer le founder',
        status: 'in_progress',
      },
      { kind: 'todo_created', title: 'Relancer le founder' },
    ])
  })

  test('the backfill rebuilds deal rules and company to-dos once', async () => {
    const { t, user, org, target, dealId } = await orgSetup('org-backfill-rt')
    const doneAt = Date.now() + 5_000
    await t.run(async (ctx) => {
      await ctx.db.insert('forecastRules', {
        orgId: org.orgId,
        dealId,
        interval: 1,
        active: true,
        sourceType: 'manual',
        ...ruleArgs,
      })
      // No deal: no sheet, skipped.
      await ctx.db.insert('forecastRules', {
        orgId: org.orgId,
        interval: 1,
        active: true,
        sourceType: 'manual',
        ...ruleArgs,
        label: 'Loyer',
      })
      await ctx.db.insert('todos', {
        orgId: org.orgId,
        title: 'Relancer',
        status: 'done',
        createdBy: user.userId,
        createdAt: 10,
        doneAt,
        companyId: target,
      })
      // No company: skipped.
      await ctx.db.insert('todos', {
        orgId: org.orgId,
        title: 'Banque',
        status: 'open',
        createdBy: user.userId,
        createdAt: 10,
      })
      const rows = await ctx.db.query('companyEvents').collect()
      for (const r of rows) await ctx.db.delete('companyEvents', r._id)
    })
    const run = async () => {
      let written = 0
      for (const source of ['rules', 'todos'] as const) {
        const r = await t.mutation(
          internal.migrations.backfillCompanyEvents.apply,
          { source, chain: false },
        )
        written += r.written
      }
      return written
    }
    expect(await run()).toBe(3)
    expect(await run()).toBe(0)

    const rows = await user.as.query(api.companyEvents.listByCompany, {
      companyId: target,
    })
    expect(rows.map((r) => r.event)).toEqual([
      { kind: 'todo_status', title: 'Relancer', status: 'done' },
      {
        kind: 'rule_created',
        label: 'Coupon',
        amountCents: 500_000,
        frequency: 'quarterly',
      },
      { kind: 'todo_created', title: 'Relancer' },
    ])
    expect(rows[2].actor.kind).toBe('user')
  })
})
