import { extractJson } from '#shared/legal/compose'
import { aiCardsSystemPrompt, readAiCards, type AiCardsKind, type AiChatMessage } from '#shared/aiCards'

// The AI chat behind the feedback and board pages. It asks the model for cards as JSON
// (shared/aiCards.ts cleans the answer) and files each one through the same function a
// hand-made card uses, so numbering, events and validation are the usual ones.

export type AiCardsResult = { reply: string, created: { id: string, number: number | null, title: string }[], failed: { title: string, message: string }[] }

export async function createCardsFromChat(member: MemberContext, project: ParseObject, kind: AiCardsKind, messages: AiChatMessage[]): Promise<AiCardsResult> {
  await rateLimit(`sb:rl:aicards:${member.agentId}`, LIMITS.aiCardsPerAgent.limit, LIMITS.aiCardsPerAgent.window)
  if (messages.at(-1)?.role !== 'user') throw createError({ statusCode: 400, statusMessage: 'The last message must be the user\'s' })
  const route = await resolveAi(member.workspace)
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })

  const feedback = getFeedbackConfig(project)
  const board = getBoardConfig(project)
  const options = kind === 'feedback' ? { types: feedback.types, tags: feedback.tags } : { tags: board.labels }
  const { text } = await chatCompletion(route, {
    messages: [{ role: 'system', content: aiCardsSystemPrompt(kind, options) }, ...messages],
    temperature: 0.3,
    max_tokens: 6000
  }, { timeoutMs: 120_000 })
  const parsed = extractJson(text)
  if (!parsed) throw createError({ statusCode: 502, statusMessage: 'The AI provider returned something that could not be used. Try again.' })
  const { reply, cards } = readAiCards(parsed, kind, options)

  const created: AiCardsResult['created'] = []
  const failed: AiCardsResult['failed'] = []
  const ctx = { project, config: feedback, actor: { kind: 'agent' as const, agent: member.agent } }
  for (const card of cards) {
    try {
      const row = kind === 'feedback'
        ? await createFeedbackPost(ctx, { title: card.title, body: card.body, type: card.type, tags: card.tags })
        : await createBoardItem(project, member.agent, { title: card.title, description: card.body, labels: card.tags, priority: card.priority })
      created.push({ id: row.id!, number: row.get('number') ?? null, title: card.title })
    } catch (error) {
      failed.push({ title: card.title, message: (error as Error)?.message || 'Could not create this card' })
    }
  }
  return { reply, created, failed }
}
