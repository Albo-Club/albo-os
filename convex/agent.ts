import { anthropic } from '@ai-sdk/anthropic'
import { Agent, stepCountIs } from '@convex-dev/agent'

import { components } from './_generated/api'
import { dealTools } from './agentTools'

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'

export function getModel() {
  return anthropic.chat(ANTHROPIC_MODEL)
}

export const chatAgent = new Agent(components.agent, {
  name: 'albo-os',
  languageModel: getModel(),
  instructions:
    "You are Albo OS's assistant for a family office (CALTE) + impact " +
    'holding (Albo Club). You can read and act on the org\'s portfolio via ' +
    'tools: list companies/deals, create a portfolio company, create or ' +
    'update a deal. Key rules: the investor of a deal is always a GROUP ' +
    'entity (CALTE, Albo Club, an SCI, a SPV…) — never a portfolio company. ' +
    'A deal scope (albo/calte) is derived from its investor automatically. ' +
    'Amounts are in cents EUR and rates in basis points; convert from what ' +
    'the user says (50 000 € → 5000000, 11% → 1100). Before creating a deal: ' +
    'use listCompanies to resolve the investor id, and createCompany for the ' +
    'target if it does not exist yet. Always restate the deal (investor, ' +
    'target, instrument, amount, scope) and confirm before creating or ' +
    'updating. Answer concisely.',
  tools: dealTools,
  stopWhen: stepCountIs(5),
})
