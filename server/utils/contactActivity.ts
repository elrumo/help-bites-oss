import { ACTIVITY_LIMITS, mergeActivity, type ActivityItem, type ActivityType, type ContactActivity } from '#shared/activity'
import { formatMoney, fromMinor } from '#shared/stripe'
import { identityOf, type ContactIdentity } from './contactJoins'
import { iso, MASTER, useParse, type ParseObject } from './parse'

// One person's history, newest first, merged from the places HelpBites keeps
// it. Each kind is a bounded query of its own (`limit` rows older than
// `before`), so a long-lived contact costs the same as a new one.

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const dateOf = (value: unknown): string => iso(value) || ''
const secondsToIso = (value: unknown) => (Number(value) > 0 ? new Date(Number(value) * 1000).toISOString() : '')

type Kind = (project: ParseObject, who: ContactIdentity, contact: ParseObject, before: Date | null, limit: number) => Promise<ActivityItem[]>

function older(query: { lessThan(key: string, value: Date): unknown }, before: Date | null, key = 'createdAt') {
  if (before) query.lessThan(key, before)
}

const KINDS: Record<ActivityType, Kind> = {
  async joined(_project, _who, contact, before) {
    const at = dateOf(contact.createdAt)
    if (!at || (before && new Date(at) >= before)) return []
    const origin = (contact.get('origin') || {}) as { type?: string }
    return [{ id: `joined:${contact.id}`, type: 'joined', at, title: 'Added as a contact', detail: origin.type ? `Via ${origin.type.replace('_', ' ')}` : '', ref: null }]
  },

  async conversation(project, who, _contact, before, limit) {
    const Parse = useParse()
    const query = new Parse.Query('Conversation').equalTo('project', project).equalTo('endUser', Parse.Object.extend('EndUser').createWithoutData(who.id)).descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).map(row => ({ id: `conversation:${row.id}`, type: 'conversation' as const, at: dateOf(row.createdAt), title: clip(String(row.get('subject') || 'Conversation')), detail: String(row.get('status') || ''), ref: { kind: 'conversation' as const, id: row.id || '' } }))
  },

  async feedback_post(project, who, _contact, before, limit) {
    const Parse = useParse()
    const queries = [
      new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('endUser', Parse.Object.extend('EndUser').createWithoutData(who.id)),
      ...(who.externalId ? [new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('authorExternalId', who.externalId)] : [])
    ]
    const query = Parse.Query.or(...queries).descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).map(row => ({ id: `post:${row.id}`, type: 'feedback_post' as const, at: dateOf(row.createdAt), title: `Posted “${clip(String(row.get('title') || ''), 100)}”`, detail: `#${row.get('number') ?? ''} · ${row.get('status') || ''}`, ref: { kind: 'feedback_post' as const, id: row.id || '' } }))
  },

  async feedback_comment(project, who, _contact, before, limit) {
    if (!who.externalId) return []
    const query = new (useParse()).Query('FeedbackComment').equalTo('project', project).equalTo('authorExternalId', who.externalId).notEqualTo('visibility', 'hidden').include('post').descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).map((row) => {
      const post = row.get('post') as ParseObject | undefined
      return { id: `comment:${row.id}`, type: 'feedback_comment' as const, at: dateOf(row.createdAt), title: `Commented on “${clip(String(post?.get('title') || 'a post'), 80)}”`, detail: clip(String(row.get('body') || '')), ref: post?.id ? { kind: 'feedback_post' as const, id: post.id } : null }
    })
  },

  async vote(project, who, _contact, before, limit) {
    if (!who.externalId) return []
    const query = new (useParse()).Query('FeedbackVote').equalTo('project', project).equalTo('voterId', who.externalId).include('post').descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).filter(row => row.get('post')).map((row) => {
      const post = row.get('post') as ParseObject
      return { id: `vote:${row.id}`, type: 'vote' as const, at: dateOf(row.createdAt), title: `Voted for “${clip(String(post.get('title') || ''), 100)}”`, detail: `#${post.get('number') ?? ''}`, ref: { kind: 'feedback_post' as const, id: post.id || '' } }
    })
  },

  async email(project, who, _contact, before, limit) {
    if (!who.email) return []
    const query = new (useParse()).Query('EmailLog').equalTo('project', project).equalTo('to', who.email).descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).map(row => ({ id: `email:${row.id}`, type: 'email' as const, at: dateOf(row.createdAt), title: clip(String(row.get('subject') || row.get('templateName') || 'Email')), detail: [row.get('source'), row.get('status')].filter(Boolean).join(' · '), ref: { kind: 'email_log' as const, id: row.id || '' } }))
  },

  async sequence(project, who, _contact, before, limit) {
    const Parse = useParse()
    const query = new Parse.Query('SequenceEnrollment').equalTo('project', project).equalTo('contact', Parse.Object.extend('EndUser').createWithoutData(who.id)).include('sequence').descending('createdAt').limit(limit)
    older(query, before)
    return (await query.find(MASTER)).map((row) => {
      const sequence = row.get('sequence') as ParseObject | undefined
      return { id: `sequence:${row.id}`, type: 'sequence' as const, at: dateOf(row.createdAt), title: `Started “${clip(String(sequence?.get('name') || 'a sequence'), 80)}”`, detail: `Step ${Number(row.get('step') || 0) + 1} · ${row.get('status') || ''}`, ref: sequence?.id ? { kind: 'sequence' as const, id: sequence.id } : null }
    })
  },

  async payment(project, who, _contact, before, limit) {
    if (!who.stripeCustomerId && !who.email) return []
    const query = new (useParse()).Query('StripePayment').equalTo('projectId', project.id)
    if (who.stripeCustomerId) query.equalTo('customerId', who.stripeCustomerId)
    else query.equalTo('email', who.email)
    query.descending('paidAtSec').limit(limit)
    if (before) query.lessThan('paidAtSec', Math.floor(before.getTime() / 1000))
    return (await query.find(MASTER)).map((row) => {
      const currency = String(row.get('currency') || '')
      return { id: `payment:${row.id}`, type: 'payment' as const, at: secondsToIso(row.get('paidAtSec')), title: `Paid ${formatMoney(fromMinor(Number(row.get('amount')) || 0, currency), currency)}`, detail: clip(String(row.get('description') || row.get('status') || '')), ref: { kind: 'stripe' as const, id: String(row.get('stripeId') || '') } }
    })
  },

  async subscription(project, who, _contact, before, limit) {
    if (!who.stripeCustomerId && !who.email) return []
    const query = new (useParse()).Query('StripeSubscription').equalTo('projectId', project.id)
    if (who.stripeCustomerId) query.equalTo('customerId', who.stripeCustomerId)
    else query.equalTo('email', who.email)
    query.descending('startedAtSec').limit(limit)
    if (before) query.lessThan('startedAtSec', Math.floor(before.getTime() / 1000))
    return (await query.find(MASTER)).map(row => ({ id: `subscription:${row.id}`, type: 'subscription' as const, at: secondsToIso(row.get('startedAtSec')), title: `Subscribed to ${row.get('plan') || 'a plan'}`, detail: String(row.get('status') || ''), ref: { kind: 'stripe' as const, id: String(row.get('stripeId') || '') } }))
  },

  async onboarding(project, who, _contact, before, limit) {
    const Parse = useParse()
    const query = new Parse.Query('OnboardingCompletion').equalTo('project', project).equalTo('endUser', Parse.Object.extend('EndUser').createWithoutData(who.id)).descending('at').limit(limit)
    older(query, before, 'at')
    return (await query.find(MASTER)).map(row => ({ id: `onboarding:${row.id}`, type: 'onboarding' as const, at: dateOf(row.get('at')), title: `${row.get('outcome') === 'skipped' ? 'Skipped' : 'Finished'} onboarding “${row.get('flow')}”`, detail: '', ref: { kind: 'onboarding_flow' as const, id: String(row.get('flow') || '') } }))
  }
}

export async function contactActivity(project: ParseObject, contact: ParseObject, options: { types?: ActivityType[], before?: string, limit?: number } = {}): Promise<ContactActivity> {
  const limit = Math.min(Math.max(Number(options.limit) || ACTIVITY_LIMITS.default, 1), ACTIVITY_LIMITS.max)
  const before = options.before ? new Date(options.before) : null
  const who = identityOf(contact)
  const kinds = (Object.keys(KINDS) as ActivityType[]).filter(type => !options.types?.length || options.types.includes(type))
  // One kind failing (a table that is down) does not blank the whole feed.
  const lists = await Promise.all(kinds.map(type => KINDS[type](project, who, contact, before && !Number.isNaN(before.getTime()) ? before : null, limit + 1).catch((error) => {
    console.warn(`[activity] ${type} failed:`, (error as Error).message)
    return [] as ActivityItem[]
  })))
  return mergeActivity(lists.map(list => list.filter(item => item.at)), limit)
}
