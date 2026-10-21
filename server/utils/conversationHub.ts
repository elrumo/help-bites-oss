import { createError } from 'h3'
import { DEFAULT_LANGUAGE, normalizeQuestion } from '#shared/knowledge'
import { feedbackStatusDefinition, type FeedbackBoardConfig } from '#shared/feedback'
import {
  CONVERSATION_FEEDBACK_LINKS_MAX,
  PAST_CONVERSATIONS_MAX,
  billingFromAttributes,
  draftInput,
  lastCustomerText,
  mergeFaqHits,
  orderFaqModels,
  type ConversationContextResponse,
  type ConversationFaqInput,
  type DraftResponse,
  type FeedbackLinkInput,
  type FeedbackLinkResponse,
  type HubFaqModel,
  type HubFeedbackPost,
  type SuggestionsResponse
} from '#shared/conversationHub'
import { matchSavedReplies } from '#shared/savedReplies'

// What the conversation panel knows about the customer and what it can do for
// them: the aggregated read (GET …/context), linking or filing a feedback post
// that they follow, saved replies and FAQs to answer with, an AI draft, and
// saving a good answer as an FAQ. Operators only; routes under
// server/routes/v1/admin/conversations/[id]/.

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []
}

// ---- the aggregated read ---------------------------------------------------------

function hubPost(row: ParseObject, config: FeedbackBoardConfig, following: boolean): HubFeedbackPost {
  const status = String(row.get('status') || '')
  const ref = feedbackPostRef(row, config)
  return { id: ref.id, number: ref.number, title: ref.title, status: ref.status, statusLabel: feedbackStatusDefinition(config, status)?.label || status, statusCategory: ref.statusCategory, following }
}

/** The posts (of this project) that `ids` name that the person follows. */
async function followedAmong(project: ParseObject, externalId: string, ids: string[]): Promise<Set<string>> {
  const followed = new Set<string>()
  if (!externalId || !ids.length) return followed
  const Parse = useParse()
  const pointers = ids.map(id => Parse.Object.extend('FeedbackPost').createWithoutData(id))
  const subs = await new Parse.Query('FeedbackSubscription').equalTo('project', project).equalTo('subscriberId', externalId).containedIn('post', pointers).limit(ids.length).find(MASTER)
  // A muted follow is not "following": they asked not to hear about it.
  for (const sub of subs) if (sub.get('muted') !== true) followed.add(pointerId(sub.get('post')))
  return followed
}

/** The conversation's linked posts, in link order; a post deleted since is skipped. */
export async function linkedFeedbackPosts(project: ParseObject, conversation: ParseObject, endUser: ParseObject): Promise<HubFeedbackPost[]> {
  const ids = stringList(conversation.get('feedbackPostIds'))
  if (!ids.length) return []
  const rows = await new (useParse()).Query('FeedbackPost').equalTo('project', project).containedIn('objectId', ids).limit(ids.length).find(MASTER)
  const byId = new Map(rows.map(row => [row.id || '', row]))
  const config = getFeedbackConfig(project)
  const followed = await followedAmong(project, String(endUser.get('externalId') || ''), [...byId.keys()])
  return ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [hubPost(row, config, followed.has(id))] : []
  })
}

/** The workspace's knowledge models that can take an FAQ from this project's conversations, best first. */
export async function faqModelsFor(ctx: MemberContext, project: ParseObject, conversation: ParseObject): Promise<HubFaqModel[]> {
  const Parse = useParse()
  const models = await limitToKeyProjects(ctx, new Parse.Query('KnowledgeModel')).equalTo('workspace', ctx.workspace).ascending('name').limit(500).find(MASTER)
  if (!models.length) return []
  const assistants = await new Parse.Query('SupportAgent').equalTo('project', project).notEqualTo('status', 'disabled').limit(20).find(MASTER)
  // The conversation's own assistant first, then the others in the order they were made.
  const chosen = String(conversation.get('assistantId') || '')
  assistants.sort((a, b) => Number(b.id === chosen) - Number(a.id === chosen))
  const assigned = await Promise.all(assistants.map(async assistant => (await resolveAgentFilter(assistant.id || '')).modelIds))
  return orderFaqModels(models.map(model => ({ id: model.id || '', name: String(model.get('name') || ''), projectId: pointerId(model.get('project')) })), project.id || '', assigned)
}

export async function loadConversationContext(ctx: MemberContext, project: ParseObject, conversation: ParseObject, endUser: ParseObject): Promise<ConversationContextResponse> {
  const Parse = useParse()
  const [account, past, feedbackPosts, models] = await Promise.all([
    findStripeAccount(project),
    new Parse.Query('Conversation').equalTo('project', project).equalTo('endUser', endUser).notEqualTo('objectId', conversation.id).descending('lastMessageAt').limit(PAST_CONVERSATIONS_MAX).find(MASTER),
    linkedFeedbackPosts(project, conversation, endUser),
    faqModelsFor(ctx, project, conversation)
  ])
  return {
    contact: {
      id: endUser.id || '',
      name: String(endUser.get('name') || ''),
      email: String(endUser.get('email') || ''),
      externalId: String(endUser.get('externalId') || ''),
      language: String(endUser.get('language') || ''),
      lastSeenAt: iso(endUser.get('lastSeenAt'))
    },
    billing: billingFromAttributes(endUser.get('attributes') as Record<string, unknown> | undefined, String(account?.get('currency') || '')),
    pastConversations: past.map((row) => {
      const c = serializeConversation(row)
      return { id: c.id, subject: c.subject, status: c.status, statusCategory: c.statusCategory, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, createdAt: c.createdAt }
    }),
    feedbackPosts,
    faqModels: { models, defaultModelId: models[0]?.id || '' }
  }
}

// ---- linking a feedback post ---------------------------------------------------

/** Add or take away one id with $addToSet / $pull, so two operators linking at once both land; returns the stored ids. */
async function setLink(conversation: ParseObject, postId: string, linked: boolean): Promise<string[]> {
  if (linked) conversation.addUnique('feedbackPostIds', postId)
  else conversation.remove('feedbackPostIds', postId)
  await conversation.save(null, MASTER)
  return stringList((await new (useParse()).Query('Conversation').select('feedbackPostIds').get(conversation.id || '', MASTER)).get('feedbackPostIds'))
}

/**
 * Link a feedback post to the conversation, unlink it, or file a new post as the
 * customer and link that. The customer follows what is linked (unless the call
 * says `follow: false`), but a contact with no user id cannot follow anything: a
 * link is still made, and filing a new post is refused (409), since a post needs
 * an author with an id. Linking leaves a line on the timeline and emits
 * `conversation.feedback_linked`; unlinking leaves a line only, and does not
 * unfollow, since they may still want to hear about it.
 */
export async function changeFeedbackLink(project: ParseObject, conversation: ParseObject, endUser: ParseObject, agent: ParseObject, input: FeedbackLinkInput): Promise<FeedbackLinkResponse> {
  const externalId = String(endUser.get('externalId') || '')
  const current = stringList(conversation.get('feedbackPostIds'))
  let post: ParseObject | undefined
  let created = false
  let linked = true

  if (input.kind === 'create') {
    if (current.length >= CONVERSATION_FEEDBACK_LINKS_MAX) throw createError({ statusCode: 400, statusMessage: `A conversation links at most ${CONVERSATION_FEEDBACK_LINKS_MAX} posts` })
    post = await createFeedbackPostForContact(project, endUser, { title: input.title, body: input.body, ...(input.type ? { type: input.type } : {}) })
    created = true
  } else {
    linked = input.linked
    post = await findFeedbackPost(project, input.postId)
    if (!post) {
      // Unlinking a post deleted since: drop the stale id as stored.
      if (linked || !current.includes(input.postId)) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
      const ids = await setLink(conversation, input.postId, false)
      return { feedbackPostIds: ids, post: { id: input.postId, number: null, title: '', status: '', statusLabel: '', statusCategory: 'open', following: false }, linked: false, created: false, following: false }
    }
    if (linked && !current.includes(post.id || '') && current.length >= CONVERSATION_FEEDBACK_LINKS_MAX) throw createError({ statusCode: 400, statusMessage: `A conversation links at most ${CONVERSATION_FEEDBACK_LINKS_MAX} posts` })
  }

  const postId = post.id || ''
  const already = current.includes(postId)
  const ids = already === linked ? current : await setLink(conversation, postId, linked)
  if (already !== linked) {
    const ref = feedbackPostRef(post, getFeedbackConfig(project))
    await appendEvent(conversation, { type: linked ? 'feedback.linked' : 'feedback.unlinked', postId, number: ref.number, title: ref.title, created }, agent)
    if (linked) await emitDomainEvent(project, 'conversation.feedback_linked', { conversationId: conversation.id, contactId: endUser.id, postId, created })
  }
  // A new post is followed by its author already; a linked one, when asked and possible.
  if (linked && !created && input.kind === 'link' && input.follow && externalId) await followFeedbackPost(project, post, externalId)

  const following = (await followedAmong(project, externalId, [postId])).has(postId)
  return { feedbackPostIds: ids, post: hubPost(post, getFeedbackConfig(project), following), linked, created, following }
}

// ---- saved replies and FAQs to answer with ---------------------------------------

/** The project's assistants, the conversation's own first: whose knowledge a search may read. */
async function projectAssistants(project: ParseObject, conversation: ParseObject, max: number): Promise<ParseObject[]> {
  const assistants = await new (useParse()).Query('SupportAgent').equalTo('project', project).equalTo('status', 'active').limit(20).find(MASTER)
  const chosen = String(conversation.get('assistantId') || '')
  return assistants.sort((a, b) => Number(b.id === chosen) - Number(a.id === chosen)).slice(0, max)
}

/**
 * Saved replies and FAQs matching `q`. Replies are scanned in memory (a project
 * has at most 200). FAQs come from the knowledge each of the project's assistants
 * may read, through the same search the auto-responder uses (Meilisearch when it
 * is set up, else a keyword scan). With no `q` the FAQs answer the customer's
 * latest message instead, so the picker opens on likely answers.
 */
export async function suggestionsFor(project: ParseObject, conversation: ParseObject, q: string): Promise<SuggestionsResponse> {
  const term = q.trim().slice(0, 200)
  const [replies, assistants, recent] = await Promise.all([
    listSavedReplies(project),
    projectAssistants(project, conversation, 5),
    term ? Promise.resolve(null) : listMessages(conversation, undefined, 20, true)
  ])
  const query = term || (recent ? lastCustomerText(recent.rows.map(serializeMessage)) : '')
  const hits = query
    ? await Promise.all(assistants.map(assistant => retrieveKnowledge(assistant.id || '', query, { limit: 6 }).catch((error) => {
      console.warn('[suggestions] search failed for assistant', assistant.id, (error as Error).message)
      return []
    })))
    : []
  return {
    faqs: mergeFaqHits(hits, 8),
    savedReplies: matchSavedReplies(replies.map(serializeSavedReply), term, 20).map(({ id, title, body, shortcut }) => ({ id, title, body, shortcut }))
  }
}

// ---- the AI draft ---------------------------------------------------------------

/**
 * A reply for the operator to edit, from the same pipeline as the auto-responder:
 * the conversation's assistant, its knowledge, the public transcript. Nothing is
 * stored or sent. 409 when the project has no assistant or no AI is set up; a
 * spent AI budget is the usual 402.
 */
export async function draftReply(workspace: ParseObject, project: ParseObject, conversation: ParseObject): Promise<DraftResponse> {
  const agent = await resolveDraftAssistant(conversation, project.id || '')
  if (!agent) throw createError({ statusCode: 409, statusMessage: 'This project has no assistant yet. Create one under Assistants to get AI drafts.' })
  const route = await resolveAi(workspace, { assistant: agent })
  if (!route) throw createError({ statusCode: 409, statusMessage: 'No AI is set up for this workspace. Add a provider under Settings, AI.' })
  await assertAiBudget(route)

  // Public messages only: a draft may quote what it was shown, and the reply goes to the customer.
  const { rows } = await listMessages(conversation, undefined, 20, true)
  const asked = draftInput(rows.map(serializeMessage))
  if (!asked) throw createError({ statusCode: 409, statusMessage: 'The customer has not written anything to answer yet' })

  const knowledge = await retrieveKnowledge(agent.id || '', asked.query, { limit: 6 })
  try {
    const { text, model } = await generateAnswer({ agent, query: asked.query, knowledge, transcript: asked.transcript })
    return { draft: text, model, sources: knowledge.map(k => ({ faqId: k.faqId, question: k.question })) }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    throw createError({ statusCode: 502, statusMessage: `The AI could not write a draft: ${(error as Error).message}` })
  }
}

// ---- saving an answer as an FAQ ---------------------------------------------------

/**
 * A new active FAQ from a conversation (origin `conversation`, its id kept). The
 * model is the operator's pick, else the first `faqModelsFor` offers; with none
 * in the workspace that is a 409 saying so. Counts against the plan's FAQ gauge.
 */
export async function saveConversationFaq(ctx: MemberContext, project: ParseObject, conversation: ParseObject, input: ConversationFaqInput): Promise<ParseObject> {
  const offered = await faqModelsFor(ctx, project, conversation)
  const modelId = input.modelId || offered[0]?.id || ''
  if (!modelId) throw createError({ statusCode: 409, statusMessage: 'This workspace has no knowledge model yet. Create one under Knowledge first.' })
  // A foreign model is a 404; one pinned to another project is not offered, so it is refused too.
  const model = await scoped.knowledgeModel(ctx, modelId)
  if (!offered.some(item => item.id === model.id)) throw createError({ statusCode: 400, statusMessage: 'That knowledge model belongs to another project' })

  await checkGauge(ctx.workspace, 'faqs')
  const Parse = useParse()
  const faq = new (Parse.Object.extend('Faq'))() as ParseObject
  faq.set('knowledgeModel', model)
  faq.set('origin', 'conversation')
  faq.set('conversationId', conversation.id || '')
  faq.set('status', 'active')
  faq.set('language', DEFAULT_LANGUAGE)
  faq.set('normalizedQuestion', normalizeQuestion(input.question))
  faq.set('needsReindex', true)
  if (ctx.agentId) faq.set('createdBy', Parse.Object.extend('_User').createWithoutData(ctx.agentId))
  applyFaqInput(faq, { question: input.question, answer: input.answer })
  await faq.save(null, MASTER)
  await queueKnowledgeIndex(modelId)
  return faq
}
