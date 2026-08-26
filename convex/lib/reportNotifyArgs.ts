/**
 * Argument shape of `reportNotify.send`, extracted so the analysis batch that
 * releases the confirmation (`intelligence.runAnalysisBatch`) can carry it
 * through without importing the action module.
 */

import { v } from 'convex/values'

export const recapKindValidator = v.union(
  v.literal('success'),
  v.literal('duplicate'),
  v.literal('failure'),
  v.literal('quarantine'),
)

/** What the pipeline can say about HOW it read the report. Queue handlers only. */
const qualityValidator = v.object({
  matchMethod: v.string(),
  metricsFound: v.array(
    v.object({ metricType: v.string(), value: v.number(), unit: v.string() }),
  ),
  suspicious: v.array(
    v.object({
      metricType: v.string(),
      value: v.number(),
      unit: v.string(),
      previousValue: v.number(),
    }),
  ),
  unrecognized: v.array(v.string()),
  missingUsual: v.array(v.string()),
  // Fiche KPI cible checklist (present when the company defines targets).
  targets: v.optional(
    v.array(
      v.object({
        metricType: v.string(),
        found: v.boolean(),
        value: v.optional(v.number()),
        unit: v.optional(v.string()),
      }),
    ),
  ),
})

export const successPayloadValidator = v.object({
  // Both absent on a one-off document that covers no period.
  reportPeriod: v.optional(v.string()),
  reportType: v.optional(v.string()),
  /** Key highlights of the report just filed — the mail renders the first 3. */
  highlights: v.array(v.string()),
  quality: qualityValidator,
})

export const reportSendArgs = {
  inboundEmailId: v.id('inboundEmails'),
  kind: recapKindValidator,
  reason: v.optional(v.string()),
  success: v.optional(successPayloadValidator),
}
