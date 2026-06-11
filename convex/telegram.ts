/**
 * Telegram bot bridge to the AI agent. The webhook receives updates from the
 * Telegram Bot API, maps the sender to an app user via `telegramAccounts`
 * (linked through a one-shot code, cf. `createLinkCode`), and replies with
 * `chatAgent.generateText` on the user's current thread. Write-tool
 * approvals are surfaced as inline keyboards (Confirmer / Refuser) and
 * resumed exactly like `chat.respondToToolApproval` — see KNOWN_ISSUES.md
 * « Approbation d'outils ».
 */
import { ConvexError, v } from 'convex/values'
import { createThread, listUIMessages } from '@convex-dev/agent'

import { components, internal } from './_generated/api'
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import { chatAgent } from './agent'
import { buildInstructions } from './lib/instructions'
import { readMembership } from './lib/agentScope'
import { consumeLimit } from './rateLimiters'
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'
import type { DataModel, Doc } from './_generated/dataModel'

type DbCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>

const LINK_CODE_BYTES = 16
const LINK_CODE_TTL_MS = 1000 * 60 * 60 * 24 // 24h
// Telegram caps messages at 4096 chars; keep a margin for safety.
const TELEGRAM_MESSAGE_MAX = 4000

// User-facing bot copy is in French on purpose (server-side strings, same
// rationale as convex/emailTemplates.ts — both users are French speakers).
const COPY = {
  linked: (orgName: string) =>
    `Compte lié à l'organisation ${orgName}. Envoyez un message pour ` +
    'parler à l\'agent. Commandes : /new (nouvelle conversation), ' +
    '/org <slug> (changer d\'organisation).',
  badLinkCode: 'Code invalide ou expiré. Demandez un nouveau lien.',
  alreadyLinked: 'Ce compte Telegram est déjà lié à un autre utilisateur.',
  startHint: 'Utilisez le lien fourni par votre administrateur : /start <code>.',
  newThread: 'Nouvelle conversation démarrée.',
  orgSwitched: (orgName: string) => `Organisation courante : ${orgName}.`,
  orgDenied: 'Organisation inconnue ou accès refusé.',
  rateLimited: 'Trop de messages, réessayez dans un instant.',
  genericError: 'Une erreur est survenue. Réessayez.',
  emptyAnswer: "L'agent n'a pas produit de réponse.",
  approvalPrompt: (toolName: string, input: string) =>
    `⚙️ Action proposée : ${toolName}\n${input}`,
  approvalGone: 'Cette demande de confirmation n\'est plus en attente.',
  approvalConfirmed: '✅ Confirmé',
  approvalDenied: '❌ Refusé',
} as const

// ─── Webhook (HTTP) ─────────────────────────────────────────────────────────

/** Minimal typed extraction of the Telegram update, passed to the worker. */
const vTelegramEvent = v.union(
  v.object({
    kind: v.literal('message'),
    telegramUserId: v.string(),
    chatId: v.string(),
    text: v.string(),
  }),
  v.object({
    kind: v.literal('callback'),
    telegramUserId: v.string(),
    chatId: v.string(),
    messageId: v.number(),
    callbackQueryId: v.string(),
    data: v.string(),
  }),
)

/** Constant-time string comparison (no timingSafeEqual in the V8 runtime). */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const ba = new Uint8Array(da)
  const bb = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}

type TelegramUpdate = {
  message?: {
    text?: string
    from?: { id?: number; is_bot?: boolean }
    chat?: { id?: number }
  }
  callback_query?: {
    id?: string
    data?: string
    from?: { id?: number }
    message?: { message_id?: number; chat?: { id?: number } }
  }
}

/**
 * Verifies the secret token set at setWebhook time, extracts the few fields
 * we use, schedules the worker and ACKs immediately (Telegram retries on
 * non-200, and slow webhooks get throttled).
 */
export const telegramWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) throw new ConvexError('missing_telegram_webhook_secret')
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (!header || !(await constantTimeEqual(header, secret))) {
    return new Response('Invalid secret token', { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const message = update.message
  const callback = update.callback_query
  if (
    message?.text !== undefined &&
    message.from?.id !== undefined &&
    message.chat?.id !== undefined &&
    !message.from.is_bot
  ) {
    await ctx.scheduler.runAfter(0, internal.telegram.processUpdate, {
      event: {
        kind: 'message' as const,
        telegramUserId: String(message.from.id),
        chatId: String(message.chat.id),
        text: message.text,
      },
    })
  } else if (
    callback?.id !== undefined &&
    callback.data !== undefined &&
    callback.from?.id !== undefined &&
    callback.message?.chat?.id !== undefined &&
    callback.message.message_id !== undefined
  ) {
    await ctx.scheduler.runAfter(0, internal.telegram.processUpdate, {
      event: {
        kind: 'callback' as const,
        telegramUserId: String(callback.from.id),
        chatId: String(callback.message.chat.id),
        messageId: callback.message.message_id,
        callbackQueryId: callback.id,
        data: callback.data,
      },
    })
  }
  // Other update kinds (edits, joins, …) are ignored on purpose.
  return Response.json({ status: 'received' })
})

// ─── Telegram API helper ────────────────────────────────────────────────────

/**
 * Calls the Telegram Bot API. Send failures are logged, not thrown: a failed
 * reply must not crash the worker (the agent turn is already persisted and
 * visible in the in-app panel).
 */
async function tgCall(
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new ConvexError('missing_telegram_bot_token')
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error('telegram_api_error', method, res.status, await res.text())
  }
}

function chunkText(text: string): Array<string> {
  const chunks: Array<string> = []
  for (let i = 0; i < text.length; i += TELEGRAM_MESSAGE_MAX) {
    chunks.push(text.slice(i, i + TELEGRAM_MESSAGE_MAX))
  }
  return chunks
}

// ─── Pending approval lookup ────────────────────────────────────────────────

/** Minimal tool-part shape (mirrors the detection in AiPanel.tsx). */
type ToolLikePart = {
  type: string
  state?: string
  approval?: { id: string }
  input?: unknown
  toolName?: string
}

type PendingApproval = { approvalId: string; toolName: string; input: unknown }

/**
 * Scans the latest thread messages for a tool part stopped on
 * `approval-requested` (same detection as the in-app panel). The thread has
 * at most one pending approval: a new generation auto-denies stale ones.
 */
async function findPendingApproval(
  ctx: Parameters<typeof listUIMessages>[0],
  threadId: string,
): Promise<PendingApproval | null> {
  const { page } = await listUIMessages(ctx, components.agent, {
    threadId,
    // First page is ordered newest-first; a pending approval is always in
    // the generation that just ran.
    paginationOpts: { numItems: 10, cursor: null },
  })
  for (const message of page) {
    for (const part of message.parts) {
      const toolPart = part as ToolLikePart
      if (
        (toolPart.type === 'dynamic-tool' ||
          toolPart.type.startsWith('tool-')) &&
        toolPart.state === 'approval-requested' &&
        toolPart.approval?.id
      ) {
        const toolName =
          toolPart.type === 'dynamic-tool'
            ? (toolPart.toolName ?? 'tool')
            : toolPart.type.slice('tool-'.length)
        return {
          approvalId: toolPart.approval.id,
          toolName,
          input: toolPart.input,
        }
      }
    }
  }
  return null
}

// ─── Worker (action) ────────────────────────────────────────────────────────

function isRateLimited(err: unknown): boolean {
  return (
    err instanceof ConvexError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    (err.data as { code?: string }).code === 'rate_limited'
  )
}

const APPROVAL_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '✅ Confirmer', callback_data: 'approve' },
      { text: '❌ Refuser', callback_data: 'deny' },
    ],
  ],
}

/**
 * Runs one agent turn and replies on Telegram. If the generation stopped on
 * a write-tool approval, the reply carries the Confirmer/Refuser keyboard.
 */
async function generateAndReply(
  ctx: Parameters<typeof chatAgent.generateText>[0],
  args: {
    chatId: string
    threadId: string
    promptMessageId: string
    orgName?: string
  },
): Promise<void> {
  await tgCall('sendChatAction', { chat_id: args.chatId, action: 'typing' })
  const result = await chatAgent.generateText(
    ctx,
    { threadId: args.threadId },
    {
      promptMessageId: args.promptMessageId,
      // No `route` context: the user is on Telegram, not in the app.
      system: buildInstructions({ orgName: args.orgName }),
    },
  )
  const pending = await findPendingApproval(ctx, args.threadId)
  if (pending) {
    const input = JSON.stringify(pending.input ?? {}, null, 1)
    const body = [
      result.text.trim(),
      COPY.approvalPrompt(pending.toolName, input),
    ]
      .filter(Boolean)
      .join('\n\n')
    await tgCall('sendMessage', {
      chat_id: args.chatId,
      text: body.slice(0, TELEGRAM_MESSAGE_MAX),
      reply_markup: APPROVAL_KEYBOARD,
    })
    return
  }
  const text = result.text.trim() || COPY.emptyAnswer
  for (const chunk of chunkText(text)) {
    await tgCall('sendMessage', { chat_id: args.chatId, text: chunk })
  }
}

export const processUpdate = internalAction({
  args: { event: vTelegramEvent },
  handler: async (ctx, { event }) => {
    if (event.kind === 'callback') {
      // ACK fast: Telegram shows a spinner on the button until answered.
      await tgCall('answerCallbackQuery', {
        callback_query_id: event.callbackQueryId,
      })
      try {
        const res: {
          threadId: string
          promptMessageId: string
          orgName?: string
          approved: boolean
        } | null = await ctx.runMutation(internal.telegram.respondToApproval, {
          telegramUserId: event.telegramUserId,
          approved: event.data === 'approve',
        })
        // Freeze the decision on the original message (drop the keyboard).
        await tgCall('editMessageReplyMarkup', {
          chat_id: event.chatId,
          message_id: event.messageId,
          reply_markup: { inline_keyboard: [] },
        })
        if (!res) {
          await tgCall('sendMessage', {
            chat_id: event.chatId,
            text: COPY.approvalGone,
          })
          return null
        }
        await tgCall('sendMessage', {
          chat_id: event.chatId,
          text: res.approved ? COPY.approvalConfirmed : COPY.approvalDenied,
        })
        await generateAndReply(ctx, {
          chatId: event.chatId,
          threadId: res.threadId,
          promptMessageId: res.promptMessageId,
          orgName: res.orgName,
        })
      } catch (err) {
        await tgCall('sendMessage', {
          chat_id: event.chatId,
          text: isRateLimited(err) ? COPY.rateLimited : COPY.genericError,
        })
        if (!isRateLimited(err)) throw err
      }
      return null
    }

    const text = event.text.trim()

    if (text.startsWith('/start')) {
      const code = text.slice('/start'.length).trim()
      const reply: string = await ctx.runMutation(
        internal.telegram.linkAccount,
        { code, telegramUserId: event.telegramUserId, chatId: event.chatId },
      )
      await tgCall('sendMessage', { chat_id: event.chatId, text: reply })
      return null
    }

    // Any other interaction requires a linked account; unknown senders are
    // ignored silently (no information leak, no error spam).
    const account: Doc<'telegramAccounts'> | null = await ctx.runQuery(
      internal.telegram.getAccount,
      { telegramUserId: event.telegramUserId },
    )
    if (!account) return null

    if (text === '/new') {
      const reply: string = await ctx.runMutation(
        internal.telegram.resetThread,
        { telegramUserId: event.telegramUserId },
      )
      await tgCall('sendMessage', { chat_id: event.chatId, text: reply })
      return null
    }

    if (text.startsWith('/org')) {
      const slug = text.slice('/org'.length).trim()
      const reply: string = await ctx.runMutation(internal.telegram.switchOrg, {
        telegramUserId: event.telegramUserId,
        slug,
      })
      await tgCall('sendMessage', { chat_id: event.chatId, text: reply })
      return null
    }

    try {
      const prep: {
        threadId: string
        promptMessageId: string
        orgName?: string
      } = await ctx.runMutation(internal.telegram.prepareGeneration, {
        telegramUserId: event.telegramUserId,
        chatId: event.chatId,
        prompt: text,
      })
      await generateAndReply(ctx, {
        chatId: event.chatId,
        threadId: prep.threadId,
        promptMessageId: prep.promptMessageId,
        orgName: prep.orgName,
      })
    } catch (err) {
      await tgCall('sendMessage', {
        chat_id: event.chatId,
        text: isRateLimited(err) ? COPY.rateLimited : COPY.genericError,
      })
      if (!isRateLimited(err)) throw err
    }
    return null
  },
})

// ─── DB functions (internal) ────────────────────────────────────────────────

function scopeKey(orgId: string, userId: string): string {
  return `${orgId}:${userId}`
}

function genLinkCode(): string {
  const bytes = new Uint8Array(LINK_CODE_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function getAccountByTelegramUserId(
  ctx: DbCtx,
  telegramUserId: string,
): Promise<Doc<'telegramAccounts'> | null> {
  return ctx.db
    .query('telegramAccounts')
    .withIndex('by_telegram_user_id', (q) =>
      q.eq('telegramUserId', telegramUserId),
    )
    .unique()
}

export const getAccount = internalQuery({
  args: { telegramUserId: v.string() },
  handler: async (ctx, { telegramUserId }) => {
    return getAccountByTelegramUserId(ctx, telegramUserId)
  },
})

/**
 * CLI runbook (no UI for 2 users — cf. README « Bot Telegram ») :
 *   pnpm exec convex run --prod telegram:createLinkCode \
 *     '{"email":"…","orgSlug":"…"}'
 * Returns the one-shot code; the user sends `/start <code>` to the bot
 * (or opens https://t.me/<bot>?start=<code>). Valid 24h.
 */
export const createLinkCode = internalMutation({
  args: { email: v.string(), orgSlug: v.string() },
  handler: async (ctx, { email, orgSlug }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email.toLowerCase().trim()))
      .unique()
    if (!user) throw new ConvexError('user_not_found')
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError('org_not_found')
    await readMembership(ctx, org._id, user._id)

    const code = genLinkCode()
    const existing = await ctx.db
      .query('telegramAccounts')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique()
    if (existing) {
      await ctx.db.patch('telegramAccounts', existing._id, {
        orgId: org._id,
        linkCode: code,
        linkCodeCreatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('telegramAccounts', {
        userId: user._id,
        orgId: org._id,
        linkCode: code,
        linkCodeCreatedAt: Date.now(),
        createdAt: Date.now(),
      })
    }
    return { code }
  },
})

/** `/start <code>` — binds the Telegram sender to the pending account row. */
export const linkAccount = internalMutation({
  args: {
    code: v.string(),
    telegramUserId: v.string(),
    chatId: v.string(),
  },
  handler: async (ctx, { code, telegramUserId, chatId }): Promise<string> => {
    if (!code) return COPY.startHint
    const account = await ctx.db
      .query('telegramAccounts')
      .withIndex('by_link_code', (q) => q.eq('linkCode', code))
      .unique()
    if (
      !account ||
      !account.linkCodeCreatedAt ||
      Date.now() - account.linkCodeCreatedAt > LINK_CODE_TTL_MS
    ) {
      return COPY.badLinkCode
    }
    // Uniqueness of telegramUserId is enforced here (no unique constraint at
    // the schema level in Convex).
    const conflicting = await getAccountByTelegramUserId(ctx, telegramUserId)
    if (conflicting && conflicting._id !== account._id) {
      return COPY.alreadyLinked
    }
    await ctx.db.patch('telegramAccounts', account._id, {
      telegramUserId,
      chatId,
      threadId: undefined,
      linkCode: undefined,
      linkCodeCreatedAt: undefined,
    })
    const org = await ctx.db.get('organizations', account.orgId)
    return COPY.linked(org?.name ?? account.orgId)
  },
})

/** `/new` — starts a fresh agent thread (lazily created on next message). */
export const resetThread = internalMutation({
  args: { telegramUserId: v.string() },
  handler: async (ctx, { telegramUserId }): Promise<string> => {
    const account = await getAccountByTelegramUserId(ctx, telegramUserId)
    if (!account) throw new ConvexError('telegram_unknown_account')
    await ctx.db.patch('telegramAccounts', account._id, {
      threadId: undefined,
    })
    return COPY.newThread
  },
})

/** `/org <slug>` — switches the current org (membership re-checked). */
export const switchOrg = internalMutation({
  args: { telegramUserId: v.string(), slug: v.string() },
  handler: async (ctx, { telegramUserId, slug }): Promise<string> => {
    const account = await getAccountByTelegramUserId(ctx, telegramUserId)
    if (!account) throw new ConvexError('telegram_unknown_account')
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!org) return COPY.orgDenied
    try {
      await readMembership(ctx, org._id, account.userId)
    } catch {
      return COPY.orgDenied
    }
    await ctx.db.patch('telegramAccounts', account._id, {
      orgId: org._id,
      threadId: undefined,
    })
    return COPY.orgSwitched(org.name)
  },
})

/**
 * Transactional prelude of an agent turn: membership + rate limit + thread
 * (created lazily) + prompt persisted. The generation itself runs in the
 * calling action.
 */
export const prepareGeneration = internalMutation({
  args: {
    telegramUserId: v.string(),
    chatId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { telegramUserId, chatId, prompt }) => {
    const account = await getAccountByTelegramUserId(ctx, telegramUserId)
    if (!account) throw new ConvexError('telegram_unknown_account')
    await readMembership(ctx, account.orgId, account.userId)
    await consumeLimit(ctx, 'chatSend', account.userId)

    let threadId = account.threadId
    if (!threadId) {
      threadId = await createThread(ctx, components.agent, {
        userId: scopeKey(account.orgId, account.userId),
        title: `Telegram — ${prompt.slice(0, 50)}`,
      })
    }
    if (threadId !== account.threadId || chatId !== account.chatId) {
      await ctx.db.patch('telegramAccounts', account._id, { threadId, chatId })
    }

    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    })
    const org = await ctx.db.get('organizations', account.orgId)
    return { threadId, promptMessageId: messageId, orgName: org?.name }
  },
})

/**
 * Confirmer/Refuser button. Same contract as `chat.respondToToolApproval`:
 * record the decision, then the caller MUST resume generation with the
 * returned `promptMessageId` (cf. KNOWN_ISSUES « Approbation d'outils »).
 * Returns null when no approval is pending (stale buttons, or already
 * handled from the in-app panel).
 */
export const respondToApproval = internalMutation({
  args: { telegramUserId: v.string(), approved: v.boolean() },
  handler: async (ctx, { telegramUserId, approved }) => {
    const account = await getAccountByTelegramUserId(ctx, telegramUserId)
    if (!account?.threadId) throw new ConvexError('telegram_unknown_account')
    await readMembership(ctx, account.orgId, account.userId)
    // Resuming triggers an LLM generation: same budget as a message.
    await consumeLimit(ctx, 'chatSend', account.userId)

    // The callback_data is a bare approve/deny: the thread holds at most one
    // pending approval (new generations auto-deny stale ones), resolved here
    // server-side — keeps callback_data clear of the 64-byte Telegram cap.
    const pending = await findPendingApproval(ctx, account.threadId)
    if (!pending) return null

    const { messageId } = approved
      ? await chatAgent.approveToolCall(ctx, {
          threadId: account.threadId,
          approvalId: pending.approvalId,
        })
      : await chatAgent.denyToolCall(ctx, {
          threadId: account.threadId,
          approvalId: pending.approvalId,
        })
    const org = await ctx.db.get('organizations', account.orgId)
    return {
      threadId: account.threadId,
      promptMessageId: messageId,
      orgName: org?.name,
      approved,
    }
  },
})
