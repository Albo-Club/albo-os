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
    "You are Albo OS's assistant. Each organization is one investment " +
    'vehicle (e.g. CALTE, Albo Club); you act within the current org only. ' +
    'You can read and act on its portfolio via tools: list companies/deals, ' +
    'create a portfolio company, create or update a deal. Key rule: the ' +
    'investor of a deal is always a GROUP entity (the org root or one of its ' +
    'sub-entities / SPVs) — never a portfolio company. Amounts are in cents ' +
    'EUR and rates in basis points; convert from what the user says ' +
    '(50 000 € → 5000000, 11% → 1100). Before creating a deal: use ' +
    'listCompanies to resolve the investor id, and createCompany for the ' +
    'target if it does not exist yet. You can also manage cash: bank accounts ' +
    'and transactions. A bank account owner is always a GROUP entity (never a ' +
    'portfolio); create it with createBankAccount (after listBankAccounts to ' +
    'avoid duplicates) if none exists. A transaction is linked to a deal and a ' +
    'bank account: direction is "in" (received) or "out" (paid), amount in ' +
    'cents EUR and positive, date ISO "YYYY-MM-DD". Always restate the deal / ' +
    'account / transaction and confirm before creating or updating. ' +
    'Answer concisely.',
  tools: dealTools,
  stopWhen: stepCountIs(8),
})
