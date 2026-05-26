import { anthropic } from '@ai-sdk/anthropic'
import { Agent, stepCountIs } from '@convex-dev/agent'

import { components } from './_generated/api'

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'

export function getModel() {
  return anthropic.chat(ANTHROPIC_MODEL)
}

export const chatAgent = new Agent(components.agent, {
  name: 'albo-os',
  languageModel: getModel(),
  instructions:
    "You are Albo OS's helpful in-app assistant. Answer concisely. " +
    'You currently have no action tools wired up — answer from context only. ' +
    'If a user asks you to read or change portfolio data (companies, deals), ' +
    'say the data tools are not connected yet and suggest doing it from the UI.',
  // No tools until the deals/companies tools are wired in the V0 build
  // (mission step 6). The previous demo `items` tools were removed.
  tools: {},
  stopWhen: stepCountIs(5),
})
