import { createMistral } from '@ai-sdk/mistral'
import { Agent, stepCountIs } from '@convex-dev/agent'

import { components } from './_generated/api'
import { dealTools } from './agentTools'
import { forecastTools } from './agentToolsForecasts'
import { liabilityTools } from './agentToolsLiabilities'
import { pointageTools } from './agentToolsPointage'
import { projectionTools } from './agentToolsProjections'
import { valuationTools } from './agentToolsValuations'
import { BASE_INSTRUCTIONS, MISTRAL_MODEL } from './lib/instructions'

/**
 * Mistral bills cached prompt tokens at 10% of the input price when the
 * request carries a `prompt_cache_key`, but @ai-sdk/mistral (3.0.37) has no
 * provider option to send it — so it is injected at the fetch layer. A
 * static key is enough: prefix matching does the real work, and the
 * system-prompt + tool-schemas block is shared across all threads. See
 * KNOWN_ISSUES.md « Mistral prompt caching ».
 */
const mistral = createMistral({
  fetch: async (url, options) => {
    if (typeof options?.body === 'string') {
      try {
        const body = JSON.parse(options.body) as Record<string, unknown>
        body.prompt_cache_key = 'albo-os-chat'
        return fetch(url, { ...options, body: JSON.stringify(body) })
      } catch {
        // Non-JSON body: forward untouched.
      }
    }
    return fetch(url, options)
  },
})

export function getModel() {
  return mistral.chat(MISTRAL_MODEL)
}

export const chatAgent = new Agent(components.agent, {
  name: 'albo-os',
  languageModel: getModel(),
  instructions: BASE_INSTRUCTIONS,
  tools: {
    ...dealTools,
    ...pointageTools,
    ...liabilityTools,
    ...forecastTools,
    ...valuationTools,
    ...projectionTools,
  },
  // Transaction-matching (pointage) flows are multi-step (list → suggest →
  // confirm → match): 12 steps instead of 8.
  stopWhen: stepCountIs(12),
  // One compact log line per LLM call — `cacheReadTokens > 0` on steps ≥ 2
  // is the proof that prompt caching is effective (cf. KNOWN_ISSUES.md).
  usageHandler: (_ctx, { threadId, model, usage }) => {
    console.log(
      JSON.stringify({
        kind: 'llm_usage',
        model,
        threadId,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
      }),
    )
  },
})
