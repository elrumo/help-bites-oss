import { describe, expect, test } from 'bun:test'
import {
  CONVERSATION_FEEDBACK_LINKS_MAX,
  billingFromAttributes,
  draftInput,
  faqPrefill,
  lastCustomerText,
  mergeFaqHits,
  orderFaqModels,
  readConversationFaqInput,
  readFeedbackLinkInput
} from '../shared/conversationHub'
import { eventLabel } from '../shared/conversations'
import { FAQ_ORIGINS } from '../shared/knowledge'
import { STRIPE_ATTR, rollupAttributes } from '../shared/stripe'
import type { Conversation, Message } from '../shared/support'
import { serializeConversation, withoutTriage } from '../server/utils/conversations'
import { iso, pointerId } from '../server/utils/parse'

// conversations.ts leans on nitro's auto-imports; the serializer needs these two.
Object.assign(globalThis, { iso, pointerId })

const msg = (id: string, sender: 'user' | 'agent', body: string, extra: Partial<Message> = {}) => ({ id, sender, body, visibility: 'public' as const, kind: 'message' as const, ...extra })

describe('billing card', () => {
  test('reads what the Stripe sync writes on a contact', () => {
    const attributes = rollupAttributes('cus_1', { net: 5000, count: 2, lastAt: 1 }, [{ status: 'active', plan: 'Pro', mrr: 2900 }], 'usd')
    expect(billingFromAttributes(attributes, 'USD')).toEqual({ plan: 'Pro', mrr: 29, currency: 'usd', status: 'active', customerId: 'cus_1' })
  })

  test('nothing without a Stripe customer, so a project without Stripe shows no card', () => {
    expect(billingFromAttributes({ plan: 'pro' }, 'usd')).toBeNull()
    expect(billingFromAttributes(undefined, 'usd')).toBeNull()
    expect(billingFromAttributes({ [STRIPE_ATTR.customer]: '  ' }, 'usd')).toBeNull()
  })

  test('a customer with no subscription still shows, with what is known', () => {
    const attributes = rollupAttributes('cus_2', { net: 0, count: 0, lastAt: null }, [], 'eur')
    expect(billingFromAttributes(attributes, 'eur')).toEqual({ plan: '', mrr: 0, currency: 'eur', status: 'none', customerId: 'cus_2' })
    expect(billingFromAttributes({ [STRIPE_ATTR.customer]: 'cus_3', [STRIPE_ATTR.mrr]: 'lots' }, '')).toMatchObject({ mrr: 0, currency: '', status: 'none' })
  })
})

describe('feedback link input', () => {
  test('links by post id or #number, and follows unless told not to', () => {
    expect(readFeedbackLinkInput({ postId: '#12' }).input).toEqual({ kind: 'link', postId: '12', linked: true, follow: true })
    expect(readFeedbackLinkInput({ postId: 'abc', linked: false, follow: false }).input).toEqual({ kind: 'link', postId: 'abc', linked: false, follow: false })
  })

  test('creates a post from a title, with the text and type optional', () => {
    expect(readFeedbackLinkInput({ create: { title: '  Export CSV  ', body: ' Please ', type: ' feature ' } }).input).toEqual({ kind: 'create', title: 'Export CSV', body: 'Please', type: 'feature' })
    expect(readFeedbackLinkInput({ create: { title: 'Only a title' } }).input).toEqual({ kind: 'create', title: 'Only a title', body: '', type: '' })
  })

  test('refuses a body that names nothing, both, or a bad create', () => {
    expect(readFeedbackLinkInput({}).errors).toHaveLength(1)
    expect(readFeedbackLinkInput(null).errors).toHaveLength(1)
    expect(readFeedbackLinkInput({ postId: 'a', create: { title: 'b' } }).errors).toEqual(['Send either postId or create, not both'])
    expect(readFeedbackLinkInput({ create: {} }).errors).toEqual(['A title is required'])
    expect(readFeedbackLinkInput({ create: { title: 'x'.repeat(201) } }).errors[0]).toContain('title')
    expect(readFeedbackLinkInput({ create: { title: 'ok', body: 'x'.repeat(20001) } }).errors[0]).toContain('text')
  })

  test('a conversation links a bounded number of posts', () => {
    expect(CONVERSATION_FEEDBACK_LINKS_MAX).toBe(20)
  })
})

describe('save as FAQ', () => {
  test('needs a question and an answer, and the model is optional', () => {
    expect(readConversationFaqInput({ question: ' Q? ', answer: ' A. ' }).input).toEqual({ modelId: '', question: 'Q?', answer: 'A.' })
    expect(readConversationFaqInput({ modelId: ' m1 ', question: 'Q', answer: 'A' }).input?.modelId).toBe('m1')
    expect(readConversationFaqInput({ question: '', answer: '' }).errors).toEqual(['question is required', 'answer is required'])
    expect(readConversationFaqInput({ question: 'q'.repeat(501), answer: 'a' }).errors[0]).toContain('question')
    expect(readConversationFaqInput({ question: 'q', answer: 'a'.repeat(20001) }).errors[0]).toContain('answer')
  })

  test('conversation is an FAQ origin', () => {
    expect(FAQ_ORIGINS).toContain('conversation')
  })

  test('offers the conversation assistant\'s models first, then the project\'s, never another project\'s', () => {
    const models = [
      { id: 'mA', name: 'A shared', projectId: '' },
      { id: 'mB', name: 'B project', projectId: 'p1' },
      { id: 'mC', name: 'C other project', projectId: 'p2' },
      { id: 'mD', name: 'D assigned', projectId: '' },
      { id: 'mE', name: 'E second assistant', projectId: 'p1' }
    ]
    // The conversation's assistant reads D; another assistant reads E and C (which is pinned elsewhere).
    expect(orderFaqModels(models, 'p1', [['mD'], ['mE', 'mC']]).map(m => m.id)).toEqual(['mD', 'mE', 'mB', 'mA'])
    expect(orderFaqModels(models, 'p1', []).map(m => m.id)).toEqual(['mB', 'mE', 'mA', 'mD'])
    expect(orderFaqModels([], 'p1', [['mD']])).toEqual([])
  })

  test('starts from the reply and the customer\'s closest earlier public message', () => {
    const thread = [
      msg('1', 'user', 'How do I export?'),
      msg('2', 'agent', 'Secret', { visibility: 'internal' }),
      msg('3', 'agent', 'Open Settings, then Export.'),
      msg('4', 'user', 'Thanks!'),
      msg('5', 'agent', 'Anytime.')
    ]
    expect(faqPrefill(thread, '3')).toEqual({ question: 'How do I export?', answer: 'Open Settings, then Export.' })
    expect(faqPrefill(thread, '5')).toEqual({ question: 'Thanks!', answer: 'Anytime.' })
    expect(faqPrefill(thread, 'missing')).toEqual({ question: '', answer: '' })
  })
})

describe('suggestions', () => {
  test('an FAQ found through two assistants appears once, best score first', () => {
    const hit = (faqId: string, score: number) => ({ faqId, question: `q${faqId}`, answer: `a${faqId}`, score })
    expect(mergeFaqHits([[hit('1', 0.2), hit('2', 0.9)], [hit('1', 0.8), hit('3', 0.1)]], 8).map(f => f.id)).toEqual(['2', '1', '3'])
    expect(mergeFaqHits([[hit('1', 1), hit('2', 0.5)]], 1)).toEqual([{ id: '1', question: 'q1', answer: 'a1' }])
    expect(mergeFaqHits([], 8)).toEqual([])
  })

  test('the customer\'s latest public words, skipping notes and events', () => {
    const thread = [
      msg('1', 'user', 'First'),
      msg('2', 'user', 'Private', { visibility: 'internal' }),
      msg('3', 'agent', 'Reply'),
      msg('4', 'user', '', { kind: 'event' }),
      msg('5', 'user', '  Latest question  ')
    ]
    expect(lastCustomerText(thread)).toBe('Latest question')
    expect(lastCustomerText(thread.slice(0, 4))).toBe('First')
    expect(lastCustomerText([msg('1', 'agent', 'Only us')])).toBe('')
    expect(lastCustomerText([msg('1', 'user', 'x'.repeat(500))], 300)).toHaveLength(300)
  })
})

describe('the AI draft', () => {
  test('answers the latest customer message with the public messages before it', () => {
    const thread = [
      msg('1', 'user', 'Hi'),
      msg('2', 'agent', 'Hello, how can we help?'),
      msg('3', 'agent', 'Internal: check the logs', { visibility: 'internal' }),
      msg('4', 'user', 'My export is stuck'),
      msg('5', 'agent', 'Event line', { kind: 'event' })
    ]
    expect(draftInput(thread)).toEqual({ query: 'My export is stuck', transcript: [{ sender: 'user', body: 'Hi' }, { sender: 'agent', body: 'Hello, how can we help?' }] })
  })

  test('never shows the model an internal note, and keeps the transcript short', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, i % 2 ? 'agent' : 'user', `text ${i}`))
    const result = draftInput([...many, msg('n', 'agent', 'secret note', { visibility: 'internal' }), msg('last', 'user', 'now')])!
    expect(JSON.stringify(result)).not.toContain('secret note')
    expect(result.transcript).toHaveLength(8)
    expect(result.query).toBe('now')
  })

  test('nothing to answer until the customer has written', () => {
    expect(draftInput([])).toBeNull()
    expect(draftInput([msg('1', 'agent', 'We wrote first')])).toBeNull()
    expect(draftInput([msg('1', 'user', '   ')])).toBeNull()
  })
})

describe('the timeline and what the customer sees', () => {
  test('feedback links read on the timeline', () => {
    const event = (type: string) => ({ kind: 'event', event: { type, number: 12, title: 'Export CSV' } }) as unknown as Message
    expect(eventLabel(event('feedback.linked'))).toBe('Linked to feedback post #12 Export CSV')
    expect(eventLabel(event('feedback.unlinked'))).toBe('Unlinked from feedback post #12 Export CSV')
  })

  test('the linked posts are the team\'s business, not the customer\'s', () => {
    const row = (fields: Record<string, unknown>) => ({ id: 'c1', createdAt: new Date('2026-01-01'), get: (key: string) => fields[key] })
    const conversation = serializeConversation(row({ feedbackPostIds: ['p1', 7, 'p2'] }) as never)
    expect(conversation.feedbackPostIds).toEqual(['p1', 'p2'])
    expect(serializeConversation(row({}) as never).feedbackPostIds).toEqual([])
    expect(Object.keys(withoutTriage(conversation))).not.toContain('feedbackPostIds')
    expect(withoutTriage(conversation as Conversation)).not.toHaveProperty('tags')
  })
})
