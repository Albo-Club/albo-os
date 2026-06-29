import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { Agent, stepCountIs } from '@convex-dev/agent'

import { components } from './_generated/api'
import { dealTools } from './agentTools'
import { forecastTools } from './agentToolsForecasts'
import { liabilityTools } from './agentToolsLiabilities'
import { pointageTools } from './agentToolsPointage'
import { projectionTools } from './agentToolsProjections'
import { valuationTools } from './agentToolsValuations'
import { AGENT_MODEL, BASE_INSTRUCTIONS } from './lib/instructions'

/**
 * OpenRouter gateway (OpenAI-compatible). The model id lives in
 * `AGENT_MODEL` (single source, overridable via the OPENROUTER_MODEL env
 * var); the key is read from OPENROUTER_API_KEY in the Convex env. DeepSeek
 * caches the shared system-prompt + tool-schemas prefix automatically
 * server-side (no per-request cache key to inject), so no fetch wrapper is
 * needed — cf. KNOWN_ISSUES.md « Modèle de l'agent (OpenRouter / DeepSeek) ».
 */
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

export function getModel() {
  return openrouter.chat(AGENT_MODEL)
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
