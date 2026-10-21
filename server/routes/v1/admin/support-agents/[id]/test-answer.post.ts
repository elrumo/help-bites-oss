import { decideAgentReply, routeAgentMessage } from '#shared/knowledge'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'testAssistantAnswer', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Test what an assistant would do with a message',
    description: 'Runs the decision the support runtime makes for a customer\'s message, without touching any conversation: the routing rules first, then the knowledge the assistant may read and its confidence bar. `decision.outcome` is `answer`, `handoff` (the team gets it) or `silent`; `decision.reason` says why (`rule`, `default`, `noKnowledge`, `lowConfidence`, `confident`), with the matching rule\'s position in `decision.ruleIndex`. When it would answer and the assistant has an AI provider, `answer` holds the reply it would send; that call counts against AI credits like a real one. `live` says whether the assistant answers customers by itself right now (active, auto-reply on, provider and knowledge in place). See docs/KNOWLEDGE.md.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string', example: 'How do I delete my account?' }, conversationType: { type: 'string', example: 'support', description: 'The ticket type to pretend the message arrived as; rules can depend on it.' } } } } } },
    responses: {
      200: {
        description: 'The decision, and what it was based on.',
        content: { 'application/json': { example: {
          decision: { outcome: 'answer', reason: 'confident', ruleIndex: null, best: 0.82, minConfidence: 0.5 },
          rule: null, live: true, model: 'openai/mimo-v2.6-flash',
          answer: 'Open Settings → Account and choose Delete account.',
          knowledge: [{ faqId: 'faq_1', question: 'How do I delete my account?', pathCache: 'Account', score: 0.82 }]
        } } }
      },
      400: { description: 'Missing query.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const agent = await scoped.supportAgent(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const query = String(body.query || '').trim().slice(0, 4000)
  if (!query) throw createError({ statusCode: 400, statusMessage: 'query is required' })
  const message = { conversationType: String(body.conversationType || 'support').trim().slice(0, 60), text: query }

  const rules = readAgentRules(agent)
  const settings = { rules, defaultAction: readDefaultAction(agent), minConfidence: readMinConfidence(agent), fallbackBehavior: agent.get('fallbackBehavior') === 'silent' ? 'silent' as const : 'human' as const }
  // A message the rules hand to the team never reaches the knowledge, so there is nothing to look up.
  const routed = routeAgentMessage(settings.rules, message, settings.defaultAction)
  const knowledge = routed.action === 'human' ? [] : await retrieveKnowledge(agent.id || '', query, { limit: 6 })
  const decision = decideAgentReply(settings, message, knowledge.map(k => k.score || 0))

  const [readiness, ai] = await Promise.all([readAssistant(ctx.workspace, agent), resolveAi(ctx.workspace, { assistant: agent })])
  let answer: string | null = null
  let model = ai?.model || ''
  if (decision.outcome === 'answer' && ai) {
    const generated = await generateAnswer({ agent, query, knowledge })
    answer = generated.text
    model = generated.model
  }
  return {
    decision,
    rule: decision.ruleIndex === null ? null : rules[decision.ruleIndex] || null,
    live: readiness.live,
    model,
    answer,
    knowledge: knowledge.map(k => ({ faqId: k.faqId, question: k.question, pathCache: k.pathCache, score: k.score }))
  }
})
