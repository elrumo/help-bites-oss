import { STRIPE_ATTR } from '#shared/stripe'
import { collectAll } from './batches'
import { contactQuery } from './contacts'
import { MASTER, pointerId, useParse, type ParseObject } from './parse'

// How a person's records join back to them. HelpBites keeps these in several
// shapes, because each feature grew its own: a conversation points at the
// EndUser row; a feedback post or vote names its author by the app's user id
// (`externalId`); email logs and Stripe rows name an address or a Stripe
// customer. Everything that needs "this person's X" (the activity feed, the
// conversation panel, segments, revenue rows) goes through here instead of
// repeating the join.

export type ContactIdentity = {
  id: string
  projectId: string
  /** The app's own user id; '' for someone known only by address. */
  externalId: string
  /** Lowercased; '' when unknown. */
  email: string
  stripeCustomerId: string
}

export function identityOf(contact: ParseObject): ContactIdentity {
  const attributes = (contact.get('attributes') || {}) as Record<string, unknown>
  return {
    id: contact.id || '',
    projectId: pointerId(contact.get('project')),
    externalId: String(contact.get('externalId') || ''),
    email: String(contact.get('email') || '').toLowerCase(),
    stripeCustomerId: String(attributes[STRIPE_ATTR.customer] || '')
  }
}

/**
 * The contact ids for Stripe customers: by the customer id the sync wrote on
 * the contact, else by address. Keys of the result are `customerId` and the
 * lowercased `email`, so a row looks itself up either way.
 */
export async function contactIdsForBilling(project: ParseObject, rows: { customerId?: string, email?: string }[]): Promise<{ byCustomer: Map<string, string>, byEmail: Map<string, string> }> {
  const customers = [...new Set(rows.map(r => r.customerId || '').filter(Boolean))]
  const emails = [...new Set(rows.map(r => (r.email || '').toLowerCase()).filter(Boolean))]
  const byCustomer = new Map<string, string>()
  const byEmail = new Map<string, string>()
  if (customers.length) {
    const found = await contactQuery(project, { [`attributes.${STRIPE_ATTR.customer}`]: { $in: customers } }).select('attributes').limit(1000).find(MASTER)
    for (const c of found) byCustomer.set(String((c.get('attributes') as Record<string, unknown>)[STRIPE_ATTR.customer]), c.id || '')
  }
  const unmatched = emails.filter(e => !rows.some(r => r.customerId && byCustomer.has(r.customerId) && (r.email || '').toLowerCase() === e))
  if (unmatched.length) {
    const found = await contactQuery(project).containedIn('email', unmatched).select('email').limit(1000).find(MASTER)
    for (const c of found) byEmail.set(String(c.get('email') || '').toLowerCase(), c.id || '')
  }
  return { byCustomer, byEmail }
}

/** A billing row's contact id, from lookups made by `contactIdsForBilling`; '' when nobody matches. */
export function billingContactId(joins: Awaited<ReturnType<typeof contactIdsForBilling>>, row: { customerId?: string, email?: string }): string {
  return (row.customerId && joins.byCustomer.get(row.customerId)) || joins.byEmail.get((row.email || '').toLowerCase()) || ''
}

/** Feedback posts a person wrote. They are joined by the app's user id, or by the EndUser pointer for posts filed on someone's behalf. */
export async function postsBy(project: ParseObject, who: ContactIdentity, limit = 20): Promise<ParseObject[]> {
  const Parse = useParse()
  const byPointer = new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('endUser', Parse.Object.extend('EndUser').createWithoutData(who.id))
  const queries = [byPointer, ...(who.externalId ? [new Parse.Query('FeedbackPost').equalTo('project', project).equalTo('authorExternalId', who.externalId)] : [])]
  return Parse.Query.or(...queries).descending('createdAt').limit(limit).find(MASTER)
}

/** Every feedback post a person follows or wrote or voted on, by post id, for "what are they waiting for". */
export async function postIdsFollowedBy(project: ParseObject, who: ContactIdentity): Promise<string[]> {
  if (!who.externalId) return []
  const rows = await collectAll(() => new (useParse()).Query('FeedbackSubscription').equalTo('project', project).equalTo('subscriberId', who.externalId).notEqualTo('muted', true), { max: 5000, keys: ['post'] })
  return rows.map(r => pointerId(r.get('post'))).filter(Boolean)
}
