import { extractJson } from '#shared/legal/compose'
import { AI_BOARD_ITEMS_MAX, aiCardsSystemPrompt, readAiCards, type AiBoardItem, type AiCardsKind, type AiChatMessage, type AiItemSet } from '#shared/aiCards'
import type { ItemAttachment } from '#shared/itemAttachments'
import { assertOwnAttachments } from './itemAttachments'
import type { ClientSource } from './clientSource'

// The AI chat behind the feedback and board pages. It asks the model for cards, and on the board
// for changes to existing items and links between them, as JSON (shared/aiCards.ts cleans the
// answer). Each change goes through the same function a hand-made one does, so numbering, events,
// validation and feedback sync are the usual ones. Cards are made first, so an update or link can
// name a card the same answer creates.

export type AiCardsResult = {
  reply: string
  created: { id: string, number: number | null, title: string }[]
  /** Existing or new items the chat changed or related, with what changed. */
  updated: { id: string, number: number | null, title: string, changes: string[] }[]
  failed: { title: string, message: string }[]
}

/** The board's most recently changed items, as the model is shown them. */
async function boardItemsForChat(project: ParseObject): Promise<AiBoardItem[]> {
  const rows = await new (useParse()).Query('BoardItem').equalTo('project', project).descending('updatedAt').limit(AI_BOARD_ITEMS_MAX).find(MASTER)
  return rows.flatMap((row): AiBoardItem[] => typeof row.get('number') === 'number'
    ? [{ number: row.get('number'), title: String(row.get('title') || '').slice(0, 200), status: String(row.get('status') || ''), priority: String(row.get('priority') || ''), labels: Array.isArray(row.get('labels')) ? (row.get('labels') as unknown[]).map(String) : [] }]
    : [])
}

/** What an update changed, in words for the chat: the value for the short fields, just the name for the long ones. */
function changeLines(set: AiItemSet): string[] {
  return Object.entries(set).map(([key, value]) => {
    if (key === 'title' || key === 'description') return key
    if (key === 'labels') return `labels: ${(value as string[]).join(', ') || 'none'}`
    return `${key}: ${value === '' || value === null ? 'none' : String(value)}`
  })
}

export async function createCardsFromChat(member: MemberContext, project: ParseObject, kind: AiCardsKind, messages: AiChatMessage[], attachments: ItemAttachment[] = [], source: ClientSource = 'api'): Promise<AiCardsResult> {
  await rateLimit(`sb:rl:aicards:${member.agentId}`, LIMITS.aiCardsPerAgent.limit, LIMITS.aiCardsPerAgent.window)
  if (messages.at(-1)?.role !== 'user') throw createError({ statusCode: 400, statusMessage: 'The last message must be the user\'s' })
  // Files the operator attached go onto every card this message creates; a file that is not the project's own is refused before the AI runs.
  assertOwnAttachments(project, attachments)
  const route = await resolveAi(member.workspace)
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })

  const feedback = getFeedbackConfig(project)
  const board = getBoardConfig(project)
  const options = kind === 'feedback'
    ? { types: feedback.types, tags: feedback.tags }
    : { tags: board.labels, statuses: board.statuses, items: await boardItemsForChat(project) }
  const { text } = await chatCompletion(route, {
    messages: [{ role: 'system', content: aiCardsSystemPrompt(kind, options) }, ...messages],
    temperature: 0.3,
    max_tokens: 6000
  }, { timeoutMs: 120_000 })
  const parsed = extractJson(text)
  if (!parsed) throw createError({ statusCode: 502, statusMessage: 'The AI provider returned something that could not be used. Try again.' })
  const { reply, cards, updates, links } = readAiCards(parsed, kind, options)

  const created: AiCardsResult['created'] = []
  const failed: AiCardsResult['failed'] = []
  const updated = new Map<string, AiCardsResult['updated'][number]>()
  const refs = new Map<string, ParseObject>()
  const note = (row: ParseObject, changes: string[]) => {
    const id = row.id || ''
    const entry: AiCardsResult['updated'][number] = updated.get(id) ?? { id, number: row.get('number') ?? null, title: '', changes: [] }
    entry.title = String(row.get('title') || '')
    entry.changes.push(...changes)
    updated.set(id, entry)
  }
  // A card is a feedback post, or a board item the chat files like a hand-made one.
  const ctx = { project, config: feedback, actor: { kind: 'agent' as const, agent: member.agent } }
  for (const card of cards) {
    try {
      const row = kind === 'feedback'
        ? await createFeedbackPost(ctx, { title: card.title, body: card.body, type: card.type, tags: card.tags, attachments })
        : await createBoardItem(project, member.agent, { title: card.title, description: card.body, labels: card.tags, priority: card.priority, attachments }, source)
      if (card.ref) refs.set(card.ref, row)
      created.push({ id: row.id!, number: row.get('number') ?? null, title: card.title })
    } catch (error) {
      failed.push({ title: card.title, message: (error as Error)?.message || 'Could not create this card' })
    }
  }

  // An item named by a card of this answer, or by its number on the board.
  const find = async (ref: string) => refs.get(ref) ?? await findBoardItem(project, ref)
  for (const update of updates) {
    try {
      const row = await find(update.item)
      if (!row) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
      await updateBoardItem(project, member.agent, row, update.set, source)
      note(row, changeLines(update.set))
    } catch (error) {
      failed.push({ title: update.item, message: (error as Error)?.message || 'Could not change this item' })
    }
  }
  for (const link of links) {
    try {
      const from = await find(link.from)
      const to = await find(link.to)
      if (!from || !to) throw createError({ statusCode: 404, statusMessage: 'Item not found' })
      await linkBoardItem(project, member.agent, from, 'item', to.id || '', link.linked, source)
      const verb = link.linked ? 'related to' : 'unrelated from'
      note(from, [`${verb} #${to.get('number')}`])
      note(to, [`${verb} #${from.get('number')}`])
    } catch (error) {
      failed.push({ title: `${link.from} ↔ ${link.to}`, message: (error as Error)?.message || 'Could not link these items' })
    }
  }
  return { reply, created, updated: [...updated.values()], failed }
}
