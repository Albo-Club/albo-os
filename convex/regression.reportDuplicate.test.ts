/// <reference types="vite/client" />
/**
 * Regression: a document forwarded twice files ONCE, whatever period each
 * reading gave it (convex/reportStore.ts:findTwin + storeForCompany).
 *
 * Storage keys a report on (company, period) and the period is read by the
 * model. Two forwards of the same WARO update, three minutes apart, were read
 * "S1 2026" and "no period at all" (09/2026): two keys, two rows, two
 * announcements — on each of the two orgs holding the participation. The
 * detector looks for the twin in the company's neighbourhood instead, on what
 * the document says, and hands it to storage as the row to update.
 */
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import { createOrg, createPortfolioCompany, createUser, setupHarness } from './regression.setup'
import type { Harness } from './regression.setup'
import type { Id } from './_generated/dataModel'

const UPDATE = `Chers investisseurs, voici les nouvelles de l'été.
L'ARR dépasse désormais 840 k€, en hausse de 30 % sur l'atterrissage de fin
d'année dernière, et nous visons entre 950 k€ et 1 M€ à fin 2026. La marge
d'EBITDA ressort à -25 % au deuxième trimestre et la gross margin reste stable
autour de 70 %. La demande est portée par l'échéance de l'affichage
environnemental du 1er octobre 2026. Le pipe créé en France ralentit, à 675 k€
contre 1 M€ sur la même période en 2025, mais le taux de conversion est passé
de 15 % à 25 % grâce au travail mené sur la qualification. Nous démarrons des
tests sur le marché britannique au quatrième trimestre, avec deux enseignes
pilotes déjà engagées. Côté équipe, deux recrutements produit sont finalisés et
le poste de responsable customer success est ouvert. La trésorerie couvre
quatorze mois d'activité au rythme actuel, sans nouvelle levée.
Merci de votre soutien, Paul`

const forwardedBy = (who: string) => `---------- Forwarded message ---------
De : Paul Cappuccio <paul.cappuccio@waro.io>
Date: ven. 11 sept. 2026 à 11:07
Subject: WARO - Summer update
To: ${who}

${UPDATE}`

async function createInboundEmail(
  t: Harness,
  subject: string,
  receivedAt: number,
  extractedText: string,
): Promise<Id<'inboundEmails'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('inboundEmails', {
      agentmailInboxId: 'inbox-test',
      agentmailMessageId: `msg-${receivedAt}`,
      fromEmail: 'benjamin@test.dev',
      toEmails: ['reports@test.dev'],
      ccEmails: [],
      subject,
      receivedAt,
      extractedText,
      attachments: [],
      status: 'received',
    })
  })
}

const BASE = Date.UTC(2026, 8, 11, 10, 45)

describe('duplicate document detection', () => {
  test('the same update forwarded twice files once, keeping the period that was read', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Waro')

    // First forward: the model read a period.
    const first = await createInboundEmail(
      t,
      'Tr : WARO - Summer update',
      BASE,
      forwardedBy('Clement Alteresco <clement@alboteam.com>'),
    )
    const a = await t.mutation(internal.reportStore.storeForCompany, {
      companyId,
      orgId: org.orgId,
      inboundEmailId: first,
      title: 'WARO - Summer update 2026',
      headline: "L'ARR dépasse 840 k€.",
      keyHighlights: ['ARR 840 k€'],
      reportPeriod: 'S1 2026',
      periodSortDate: Date.UTC(2026, 0, 1),
      reportType: 'semi-annual' as const,
      metrics: { arr: 84_000_000 },
      rawMetrics: [],
      canonical: [],
    })

    // Second forward, three minutes later: the same document, but this time
    // the model saw no period at all.
    const second = await createInboundEmail(
      t,
      'Fwd: WARO - Summer update',
      BASE + 3 * 60 * 1000,
      forwardedBy('Benjamin Bouquet <benjamin@alboteam.com>'),
    )
    const twin = await t.query(internal.reportStore.findTwin, {
      companyId,
      title: 'WARO - Summer update 2026',
      subject: 'Fwd: WARO - Summer update',
      receivedAt: BASE + 3 * 60 * 1000,
      rawContent: forwardedBy('Benjamin Bouquet <benjamin@alboteam.com>'),
      metrics: { arr: 84_000_000 },
    })
    expect(twin.kind).toBe('duplicate')
    expect(twin.reportId).toBe(a.reportId)
    expect(twin.sameSource).toBe(true)

    const b = await t.mutation(internal.reportStore.storeForCompany, {
      companyId,
      orgId: org.orgId,
      inboundEmailId: second,
      mergeIntoReportId: twin.reportId,
      sameSource: twin.sameSource,
      title: 'WARO - Summer update 2026',
      headline: "Waro dépasse les 840 k€ d'ARR.",
      keyHighlights: ['ARR 840 k€', 'EBITDA -25 %'],
      metrics: { arr: 84_000_000 },
      rawMetrics: [],
      canonical: [],
    })

    expect(b.reportId).toBe(a.reportId)
    expect(b.created).toBe(false)
    // The source did not move: a second reading of one document announces
    // nothing, however differently the model worded it.
    expect(b.changed).toBe(false)

    const rows = await t.run(async (ctx) => ctx.db.query('companyReports').collect())
    expect(rows).toHaveLength(1)
    // The reading that found a period wins over the one that found none.
    expect(rows[0]?.reportPeriod).toBe('S1 2026')
    expect(rows[0]?.reportType).toBe('semi-annual')
  })

  test('a corrected re-send of the same document is still news', async () => {
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const org = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const companyId = await createPortfolioCompany(t, org.orgId, 'Waro')

    const first = await createInboundEmail(t, 'WARO - Summer update', BASE, UPDATE)
    const a = await t.mutation(internal.reportStore.storeForCompany, {
      companyId,
      orgId: org.orgId,
      inboundEmailId: first,
      title: 'WARO - Summer update 2026',
      headline: "L'ARR dépasse 840 k€.",
      keyHighlights: ['ARR 840 k€'],
      reportPeriod: 'S1 2026',
      metrics: { arr: 84_000_000 },
      rawMetrics: [],
      canonical: [],
    })

    const corrected = UPDATE.replace('840 k€', '860 k€')
    const second = await createInboundEmail(
      t,
      'WARO - Summer update (corrigé)',
      BASE + 2 * 60 * 60 * 1000,
      corrected,
    )
    const twin = await t.query(internal.reportStore.findTwin, {
      companyId,
      title: 'WARO - Summer update 2026',
      subject: 'WARO - Summer update (corrigé)',
      receivedAt: BASE + 2 * 60 * 60 * 1000,
      rawContent: corrected,
      metrics: { arr: 86_000_000 },
    })
    expect(twin.kind).toBe('duplicate')
    expect(twin.sameSource).toBe(false)

    const b = await t.mutation(internal.reportStore.storeForCompany, {
      companyId,
      orgId: org.orgId,
      inboundEmailId: second,
      mergeIntoReportId: twin.reportId,
      sameSource: twin.sameSource,
      title: 'WARO - Summer update 2026',
      headline: "L'ARR dépasse 860 k€.",
      keyHighlights: ['ARR 860 k€'],
      reportPeriod: 'S1 2026',
      metrics: { arr: 86_000_000 },
      rawMetrics: [],
      canonical: [],
    })

    expect(b.reportId).toBe(a.reportId)
    expect(b.changed).toBe(true)
  })

  test('a company that does not carry the document yet gets its own copy', async () => {
    // The fan-out case: Waro is held by two orgs. A twin on one of them says
    // nothing about the other, which may have been attached since.
    const t = setupHarness()
    const user = await createUser(t, 'benjamin@test.dev')
    const albo = await createOrg(t, 'albo', [{ userId: user.userId, role: 'owner' }])
    const calte = await createOrg(t, 'calte', [{ userId: user.userId, role: 'owner' }])
    const inAlbo = await createPortfolioCompany(t, albo.orgId, 'Waro')
    const inCalte = await createPortfolioCompany(t, calte.orgId, 'WARO')

    const mail = await createInboundEmail(t, 'WARO - Summer update', BASE, UPDATE)
    await t.mutation(internal.reportStore.storeForCompany, {
      companyId: inAlbo,
      orgId: albo.orgId,
      inboundEmailId: mail,
      title: 'WARO - Summer update 2026',
      headline: "L'ARR dépasse 840 k€.",
      keyHighlights: [],
      reportPeriod: 'S1 2026',
      metrics: {},
      rawMetrics: [],
      canonical: [],
    })

    const twin = await t.query(internal.reportStore.findTwin, {
      companyId: inCalte,
      title: 'WARO - Summer update 2026',
      subject: 'WARO - Summer update',
      receivedAt: BASE,
      rawContent: UPDATE,
      metrics: {},
    })
    expect(twin.kind).toBe('new')
  })
})
