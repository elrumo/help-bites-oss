// The conversation panel as a hub for the customer: who they are, what they
// pay, what they asked before, the feedback they follow, and the helpers that
// answer them (saved replies, FAQ suggestions, an AI draft). The API
// (server/utils/conversationHub.ts), the panel and the native app share these
// shapes; the pure rules sit here so tests/conversationHub.test.ts can hold them.

import { FAQ_ANSWER_MAX_LENGTH, FAQ_QUESTION_MAX_LENGTH } from './knowledge'
import { FEEDBACK_BODY_MAX_LENGTH, FEEDBACK_TITLE_MAX_LENGTH } from './feedback'
import { STRIPE_ATTR } from './stripe'
import type { Message, StatusCategory } from './support'

/** Past conversations the panel lists (the open one excluded). */
export const PAST_CONVERSATIONS_MAX = 10
/** Posts one conversation can link; a ticket that needs more is several tickets. */
export const CONVERSATION_FEEDBACK_LINKS_MAX = 20

export type HubContact = { id: string, name: string, email: string, externalId: string, language: string, lastSeenAt: string | null }

/** `mrr` is in major currency units (19.99), as the Stripe sync writes it on the contact. */
export type HubBilling = { plan: string, mrr: number, currency: string, status: string, customerId: string }

export type HubPastConversation = { id: string, subject: string, status: string, statusCategory: StatusCategory, lastMessageAt: string | null, lastMessagePreview: string, createdAt: string }

export type HubFeedbackPost = {
  id: string
  number: number | null
  title: string
  status: string
  /** The board's label for `status`, so a client needs no board config to show it. */
  statusLabel: string
  statusCategory: string
  /** The requester follows the post (and is emailed about it). */
  following: boolean
}

export type HubFaqModel = { id: string, name: string }

export type ConversationContextResponse = {
  contact: HubContact
  /** Null unless the contact has a Stripe customer. */
  billing: HubBilling | null
  pastConversations: HubPastConversation[]
  feedbackPosts: HubFeedbackPost[]
  /** Where "Save as FAQ" can write, best first; `defaultModelId` is '' when the workspace has no knowledge model. */
  faqModels: { models: HubFaqModel[], defaultModelId: string }
}

export type FeedbackLinkResponse = {
  /** The conversation after the change (its `feedbackPostIds` are current). */
  feedbackPostIds: string[]
  post: HubFeedbackPost
  linked: boolean
  created: boolean
  /** False when the contact has no user id, so they cannot follow a post; the link is still made. */
  following: boolean
}

export type SuggestedFaq = { id: string, question: string, answer: string }
export type SuggestionsResponse = { faqs: SuggestedFaq[], savedReplies: { id: string, title: string, body: string, shortcut: string }[] }
export type DraftResponse = { draft: string, model: string, sources: { faqId: string, question: string }[] }

type Attributes = Record<string, unknown> | null | undefined

/**
 * The compact billing card, from the attributes the Stripe sync writes on the
 * contact. `currency` is the project's Stripe account currency (a contact's
 * `stripe_mrr` has none of its own). Null when there is no Stripe customer, so
 * a project without Stripe shows nothing.
 */
export function billingFromAttributes(attributes: Attributes, currency: string): HubBilling | null {
  const customerId = String(attributes?.[STRIPE_ATTR.customer] ?? '').trim()
  if (!customerId) return null
  const mrr = Number(attributes?.[STRIPE_ATTR.mrr])
  return {
    plan: String(attributes?.[STRIPE_ATTR.plan] ?? '').trim(),
    mrr: Number.isFinite(mrr) ? mrr : 0,
    currency: currency.toLowerCase(),
    status: String(attributes?.[STRIPE_ATTR.status] ?? '').trim() || 'none',
    customerId
  }
}

// ---- linking a feedback post ----------------------------------------------------

export type FeedbackLinkInput =
  | { kind: 'link', postId: string, linked: boolean, follow: boolean }
  | { kind: 'create', title: string, body: string, type: string }

/** The body of POST …/feedback-posts: `{ postId, linked?, follow? }` or `{ create: { title, body?, type? } }`. */
export function readFeedbackLinkInput(payload: unknown): { input?: FeedbackLinkInput, errors: string[] } {
  const raw = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>
  const hasCreate = raw.create !== undefined && raw.create !== null
  const postId = typeof raw.postId === 'string' ? raw.postId.trim().replace(/^#/, '') : ''
  if (hasCreate && postId) return { errors: ['Send either postId or create, not both'] }
  if (hasCreate) {
    const create = (raw.create && typeof raw.create === 'object' && !Array.isArray(raw.create) ? raw.create : {}) as Record<string, unknown>
    const title = typeof create.title === 'string' ? create.title.trim() : ''
    const body = typeof create.body === 'string' ? create.body.trim() : ''
    if (!title) return { errors: ['A title is required'] }
    if (title.length > FEEDBACK_TITLE_MAX_LENGTH) return { errors: [`The title is longer than ${FEEDBACK_TITLE_MAX_LENGTH} characters`] }
    if (body.length > FEEDBACK_BODY_MAX_LENGTH) return { errors: [`The text is longer than ${FEEDBACK_BODY_MAX_LENGTH} characters`] }
    return { input: { kind: 'create', title, body, type: typeof create.type === 'string' ? create.type.trim() : '' }, errors: [] }
  }
  if (!postId) return { errors: ['Pass postId (a post id or #number) or create: { title }'] }
  return { input: { kind: 'link', postId, linked: raw.linked !== false, follow: raw.follow !== false }, errors: [] }
}

// ---- saving an answer as an FAQ -------------------------------------------------

export type ConversationFaqInput = { modelId: string, question: string, answer: string }

export function readConversationFaqInput(payload: unknown): { input?: ConversationFaqInput, errors: string[] } {
  const raw = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>
  const question = typeof raw.question === 'string' ? raw.question.trim() : ''
  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : ''
  const errors: string[] = []
  if (!question) errors.push('question is required')
  else if (question.length > FAQ_QUESTION_MAX_LENGTH) errors.push(`The question is longer than ${FAQ_QUESTION_MAX_LENGTH} characters`)
  if (!answer) errors.push('answer is required')
  else if (answer.length > FAQ_ANSWER_MAX_LENGTH) errors.push(`The answer is longer than ${FAQ_ANSWER_MAX_LENGTH} characters`)
  if (errors.length) return { errors }
  return { input: { modelId: typeof raw.modelId === 'string' ? raw.modelId.trim() : '', question, answer }, errors }
}

type ModelLike = { id: string, name: string, projectId: string }

/**
 * The knowledge models "Save as FAQ" offers, best first: those the conversation's
 * assistant reads, then the project's other assistants', then the rest of the
 * project's own, then workspace-wide ones. A model pinned to another project is
 * never offered. `assistantModelIds` is one list per assistant, the conversation's
 * own first.
 */
export function orderFaqModels(models: readonly ModelLike[], projectId: string, assistantModelIds: readonly (readonly string[])[]): HubFaqModel[] {
  const usable = new Map(models.filter(model => !model.projectId || model.projectId === projectId).map(model => [model.id, model]))
  const out: ModelLike[] = []
  const take = (model: ModelLike | undefined) => { if (model && !out.includes(model)) out.push(model) }
  for (const ids of assistantModelIds) for (const id of ids) take(usable.get(id))
  for (const model of usable.values()) if (model.projectId === projectId) take(model)
  for (const model of usable.values()) take(model)
  return out.map(model => ({ id: model.id, name: model.name }))
}

// ---- suggestions and the AI draft -------------------------------------------------

type HitLike = { faqId: string, question: string, answer: string, score: number }

/** FAQs found through several assistants once each, the best-scored first. */
export function mergeFaqHits(lists: readonly (readonly HitLike[])[], limit: number): SuggestedFaq[] {
  const best = new Map<string, HitLike>()
  for (const hit of lists.flat()) {
    const seen = best.get(hit.faqId)
    if (!seen || hit.score > seen.score) best.set(hit.faqId, hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(hit => ({ id: hit.faqId, question: hit.question, answer: hit.answer }))
}

type TranscriptMessage = Pick<Message, 'sender' | 'body' | 'visibility' | 'kind'>

const isPublicText = (message: TranscriptMessage) => message.kind !== 'event' && message.visibility !== 'internal' && Boolean(String(message.body || '').trim())

/** The customer's latest public words: what an empty search falls back to. */
export function lastCustomerText(messages: readonly TranscriptMessage[], max = 300): string {
  const last = [...messages].reverse().find(message => message.sender === 'user' && isPublicText(message))
  return last ? last.body.trim().slice(0, max) : ''
}

/**
 * What the AI draft answers: the customer's latest public message, with the
 * public messages before it as the transcript. Internal notes and events are
 * never included, since a draft can quote what it was shown. Null when the
 * customer has said nothing yet.
 */
export function draftInput(messages: readonly TranscriptMessage[], transcriptMax = 8): { query: string, transcript: { sender: string, body: string }[] } | null {
  const visible = messages.filter(isPublicText)
  let at = -1
  for (let i = visible.length - 1; i >= 0; i--) if (visible[i]!.sender === 'user') { at = i; break }
  if (at < 0) return null
  return {
    query: visible[at]!.body.trim(),
    transcript: visible.slice(Math.max(0, at - transcriptMax), at).map(message => ({ sender: message.sender, body: message.body }))
  }
}

/**
 * What "Save as FAQ" starts from when opened on a reply: that reply as the answer,
 * and the customer's closest earlier public message as the question (both are
 * editable before saving). Messages must be oldest first.
 */
export function faqPrefill(messages: readonly (TranscriptMessage & { id: string })[], messageId: string): { question: string, answer: string } {
  const at = messages.findIndex(message => message.id === messageId)
  if (at < 0) return { question: '', answer: '' }
  return { question: lastCustomerText(messages.slice(0, at), FAQ_QUESTION_MAX_LENGTH), answer: String(messages[at]!.body || '').trim() }
}
