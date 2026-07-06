/**
 * Cerveau 1 — structured extraction of an investor report.
 *
 * Uses the Vercel AI SDK `generateObject` (Zod-validated output) over the
 * OpenRouter model from convex/agent.ts. Falls back to `generateText` + manual
 * JSON parse if the configured model lacks native structured-output support
 * (the DeepSeek default may not) — mirroring the robustness of Albo's
 * analyze-report step.
 *
 * Metrics are extracted as a {key,value}[] array (structured-output friendly,
 * no open-ended record in the JSON schema) and flattened to an object on store.
 */

import { generateObject, generateText } from 'ai'
import { z } from 'zod/v3'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { getModel } from './agent'
import { EXTRACTION_SYSTEM_PROMPT } from './lib/reportPrompts'
import { coerceMetrics } from './lib/reportMetrics'

const MAX_TEXT = 30_000
const MAX_OCR = 30_000

const analysisSchema = z.object({
  company_name: z.string(),
  report_date: z.string().describe('ISO date YYYY-MM-DD (email date)'),
  report_title: z.string(),
  report_period: z.string().describe('e.g. "January 2026", "Q4 2025"'),
  report_type: z.enum(['monthly', 'bimonthly', 'quarterly', 'semi-annual', 'annual']),
  headline: z.string(),
  key_highlights: z.array(z.string()),
  metrics: z.array(z.object({ key: z.string(), value: z.number() })),
  report_about: z.enum(['company_self', 'fund_portfolio_company']),
  target_company_name: z.string().nullable(),
})

type RawAnalysis = z.infer<typeof analysisSchema>

export interface ReportAnalysis {
  companyName: string
  reportDate: string
  reportTitle: string
  reportPeriod: string
  reportType: 'monthly' | 'bimonthly' | 'quarterly' | 'semi-annual' | 'annual'
  headline: string
  keyHighlights: Array<string>
  metrics: Record<string, number>
  reportAbout: 'company_self' | 'fund_portfolio_company'
  targetCompanyName: string | null
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n[...tronqué]` : s
}

function buildUserPrompt(
  textContent: string,
  ocrContent: string | null,
  companyName: string,
  subject: string,
  fromEmail: string,
  emailDate: string,
): string {
  const ocr = ocrContent ? `--- OCR DU DOCUMENT ---\n${truncate(ocrContent, MAX_OCR)}\n\n` : ''
  return `Analyse ce report d'investissement et produis le JSON structuré.

Company name : ${companyName}
Sender email : ${fromEmail}
Email subject : ${subject}
Email date : ${emailDate}

${ocr}--- CONTENU DU MAIL ---
${truncate(textContent, MAX_TEXT)}`
}

// The schema guarantees every required field; we only flatten metrics
// (key/value pairs → object) and pass the rest through.
function toAnalysis(raw: RawAnalysis): ReportAnalysis {
  const metrics: Record<string, number> = {}
  for (const m of raw.metrics) metrics[m.key] = m.value
  return {
    companyName: raw.company_name,
    reportDate: raw.report_date,
    reportTitle: raw.report_title,
    reportPeriod: raw.report_period,
    reportType: raw.report_type,
    headline: raw.headline,
    keyHighlights: raw.key_highlights,
    metrics,
    reportAbout: raw.report_about,
    targetCompanyName: raw.target_company_name,
  }
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('no JSON found in model response')
  }
}

export const analyze = internalAction({
  args: {
    textContent: v.string(),
    ocrContent: v.optional(v.string()),
    companyName: v.string(),
    subject: v.string(),
    fromEmail: v.string(),
    emailDate: v.string(),
  },
  handler: async (_ctx, args): Promise<ReportAnalysis> => {
    const model = getModel()
    const userPrompt = buildUserPrompt(
      args.textContent,
      args.ocrContent ?? null,
      args.companyName,
      args.subject,
      args.fromEmail,
      args.emailDate,
    )

    try {
      const { object } = await generateObject({
        model,
        schema: analysisSchema,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: userPrompt,
      })
      return toAnalysis(object)
    } catch (err) {
      console.warn(
        '[reportAnalysis] generateObject failed, falling back to generateText:',
        err instanceof Error ? err.message : String(err),
      )
      const { text } = await generateText({
        model,
        system: `${EXTRACTION_SYSTEM_PROMPT}\n\nRéponds UNIQUEMENT avec un JSON valide, sans markdown. Le champ "metrics" doit être un tableau d'objets {"key": string, "value": number}.`,
        prompt: userPrompt,
      })
      // The fallback has no schema to steer the model, so `metrics` often comes
      // back as a dict — coerce it to the {key,value}[] shape before validating.
      const parsed = analysisSchema.safeParse(coerceMetrics(extractJson(text)))
      if (!parsed.success) {
        throw new Error(`[reportAnalysis] could not parse analysis: ${parsed.error.message}`)
      }
      return toAnalysis(parsed.data)
    }
  },
})
