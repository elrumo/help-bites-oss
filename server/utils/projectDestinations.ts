import { createError } from 'h3'

/** Settings that say where a project's mail, notifications, events and pages go. A person changes them in the panel: through a key
 *  (an assistant's included) a single request could send every customer's message, or every reply, to an address of its choosing,
 *  and keep doing it after the key is revoked. */
const DESTINATION_KEYS = ['notifyEmails', 'replyTo', 'fromEmail', 'fromName', 'mailDomain', 'siteUrl', 'inboxPath', 'allowedOrigins', 'emailLogContent', 'actionWebhookUrl', 'actionWebhookSecret', 'eventWebhookUrl', 'eventWebhookSecret'] as const
const NESTED_DESTINATION_KEYS: Record<string, readonly string[]> = {
  changelog: ['commentNotify', 'confirmUrl', 'unsubscribeUrl', 'pageUrl', 'entryUrl'],
  blog: ['commentNotify', 'postUrl'],
  marketing: ['fromEmail', 'mailDomain', 'confirmRedirectUrl'],
  feedback: ['postUrlTemplate'],
  hub: ['links']
}

/** The destination settings a request body tries to change, as `key` or `section.key`. */
export function destinationKeysIn(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const found: string[] = DESTINATION_KEYS.filter(key => key in record)
  for (const [section, keys] of Object.entries(NESTED_DESTINATION_KEYS)) {
    const value = record[section]
    if (value && typeof value === 'object') found.push(...keys.filter(key => key in (value as Record<string, unknown>)).map(key => `${section}.${key}`))
  }
  return found
}

/** 403 for a key that tries to change one of them. */
export function refuseDestinationsToKeys(body: unknown): void {
  const found = destinationKeysIn(body)
  if (found.length) throw createError({ statusCode: 403, statusMessage: `${found.join(', ')} can only be changed signed in to the panel: an API key cannot`, data: { code: 'session_required' } })
}
