import { anthropic } from '@ai-sdk/anthropic'
import { Agent, stepCountIs } from '@convex-dev/agent'

import { components } from './_generated/api'
import { dealTools } from './agentTools'
import { forecastTools } from './agentToolsForecasts'
import { liabilityTools } from './agentToolsLiabilities'
import { pointageTools } from './agentToolsPointage'
import { projectionTools } from './agentToolsProjections'
import { valuationTools } from './agentToolsValuations'
import { BASE_INSTRUCTIONS } from './lib/instructions'

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'

export function getModel() {
  return anthropic.chat(ANTHROPIC_MODEL)
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
})
