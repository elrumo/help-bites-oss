import { matchAgentRules } from '#shared/knowledge'

// Optional AI auto-reply. Invoked from the user-message routes AFTER a user
// message is committed: a cheap check here, then the answer itself runs as
// an `ai.autoReply` job (jobs.ts), so a restart mid-answer does not lose it.
// The generated reply lands through the normal appendMessage path (and its
// SSE event). A no-op unless the conversation's assistant has autoReply on,
// its rules allow an AI answer for this message, and an LLM is configured —
// the product stays human-first by default.

/** The assistant handling this conversation: the one the developer chose
 *  (stored on the conversation at creation), else the project's first active
 *  auto-reply assistant, so conversations opened before assistant selection —
 *  and hosts that don't pass one — still work. */
async function resolveConversationAssistant(conversation: ParseObject, projectId: string): Promise<ParseObject | null> {
  const Parse = useParse()
  const assistantId = String(conversation.get('assistantId') || '')
  if (assistantId) {
    const chosen = await new Parse.Query('SupportAgent').get(assistantId, MASTER).catch(() => null)
    if (chosen && pointerId(chosen.get('project')) === projectId) return chosen
  }
  const project = Parse.Object.extend('Project').createWithoutData(projectId)
  return await new Parse.Query('SupportAgent')
    .equalTo('project', project).equalTo('autoReply', true).equalTo('status', 'active').first(MASTER)
}

/** Queue an answer to the user's message when an assistant would give one. */
export function maybeAutoRespond(conversation: ParseObject, message: ParseObject): void {
  void (async () => {
    const projectId = pointerId(conversation.get('project'))
    if (!projectId || !String(message.get('body') || '').trim()) return
    const agent = await resolveConversationAssistant(conversation, projectId)
    if (agent?.get('autoReply') !== true || agent.get('status') !== 'active') return
    await enqueueJob('ai.autoReply', { conversationId: conversation.id, messageId: message.id }, { workspaceId: await workspaceIdOfProject(projectId) })
  })().catch(error => console.warn('[auto-responder] not queued:', (error as Error).message))
}

const OUT_OF_CREDITS_NOTE = 'The AI assistant did not answer: this workspace has used this month\'s AI credits. A teammate needs to reply. (Add your own AI provider in Settings → AI, or upgrade, to turn auto-replies back on.)'

/** Out of AI credits: say so once in the conversation, and tell the owner at most once a day. */
async function handOffWithoutCredits(conversation: ParseObject, workspaceId: string): Promise<void> {
  const redis = useRedis()
  const month = new Date().toISOString().slice(0, 7)
  if (await redis.set(`sb:ai:nocredit:c:${conversation.id}:${month}`, '1', 'EX', 40 * 24 * 3600, 'NX').catch(() => 'OK') === 'OK') {
    await appendMessage({ conversation, sender: 'agent', senderName: 'HelpBites', visibility: 'internal', input: { body: OUT_OF_CREDITS_NOTE, replyToId: '', clientId: `ai-credits-${conversation.id}-${month}`, attachments: [], context: null } })
  }
  const today = new Date().toISOString().slice(0, 10)
  if (await redis.set(`sb:ai:nocredit:w:${workspaceId}:${today}`, '1', 'EX', 2 * 24 * 3600, 'NX').catch(() => null) !== 'OK') return
  const workspace = await getWorkspace(workspaceId)
  const owner = workspace?.get('owner') as ParseObject | undefined
  const email = owner ? String((await owner.fetch(MASTER).catch(() => owner)).get('email') || '') : ''
  if (!email || !isMailerConfigured()) return
  const space = String(workspace?.get('name') || 'Your workspace')
  const text = `${space} has used this month's AI credits, so AI auto-replies are paused and new questions wait for your team.\n\nThey start again next month, or right away if you add your own AI provider (Settings → AI) or upgrade.`
  await deliverEmails([{
    project: null,
    workspace,
    to: { email, name: '' },
    subject: `${space}: AI auto-replies are paused`,
    html: `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>')}</p>`,
    text,
    sender: projectEmailSender(null, { fromName: 'HelpBites' }),
    log: { source: 'system', kind: 'message', templateName: 'AI credits used up', batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
  }]).catch(() => {})
}

/** The `ai.autoReply` job. Throws to be retried; returns quietly when there is nothing (left) to say. */
export async function runAutoReply(conversationId: string, messageId: string): Promise<void> {
  const Parse = useParse()
  const conversation = await new Parse.Query('Conversation').get(conversationId, MASTER).catch(() => null)
  const asked = await new Parse.Query('Message').get(messageId, MASTER).catch(() => null)
  if (!conversation || !asked || pointerId(asked.get('conversation')) !== conversationId) return
  const projectId = pointerId(conversation.get('project'))
  const query = String(asked.get('body') || '').trim()
  if (!projectId || !query) return

  const agent = await resolveConversationAssistant(conversation, projectId)
  if (!agent) return
  // AI is off by default: only an active assistant with autoReply answers.
  if (agent.get('autoReply') !== true || agent.get('status') !== 'active') return

  // Rules decide whether this message gets an AI answer or waits for a human.
  const action = matchAgentRules(readAgentRules(agent), { conversationType: String(conversation.get('type') || ''), text: query }, readDefaultAction(agent))
  if (action === 'human') return

  // Public messages only: the reply goes to the end user, so an internal
  // note in the model's context could be repeated back to them.
  const { rows: recent } = await listMessages(conversation, undefined, 8, true)
  // Answered by someone already, or the user wrote again (that message has its own job): nothing to add.
  if (recent.at(-1)?.id !== asked.id) return

  const workspaceId = await workspaceIdOfProject(projectId)
  const route = await resolveAi(await getWorkspace(workspaceId), { assistant: agent })
  if (!route) return
  try {
    await assertAiBudget(route)
  } catch {
    await handOffWithoutCredits(conversation, workspaceId)
    return
  }

  const knowledge = await retrieveKnowledge(agent.id || '', query, { limit: 6 })
  // Confidence gate: leave it to a human unless the best match clears the
  // assistant's threshold.
  const minConfidence = readMinConfidence(agent)
  if (minConfidence > 0 && knowledge.reduce((m, k) => Math.max(m, k.score || 0), 0) < minConfidence) return
  if (!knowledge.length && agent.get('fallbackBehavior') === 'silent') return

  const transcript = recent.map(m => ({ sender: String(m.get('sender') || 'user'), body: String(m.get('body') || '') }))
  const { text } = await generateAnswer({ agent, query, knowledge, transcript })

  const projectRow = await loadProjectUnscoped(projectId).catch(() => null)
  const senderName = String(agent.get('name') || '') || String(projectRow?.get('fromName') || '') || 'Support'
  await appendMessage({
    conversation,
    sender: 'agent',
    senderName,
    supportAgent: agent,
    // One answer per question, even when a retry runs after the first attempt got this far.
    input: { body: text, replyToId: '', clientId: `ai-${asked.id}`, attachments: [], context: null }
  })
}
