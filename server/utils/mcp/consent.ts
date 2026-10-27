// Marketing consent is a person's own say-so. A contacts call that comes through the MCP may unsubscribe someone, never
// subscribe them: an assistant steered by text in a customer's message could otherwise be talked into opting a list in.
// Tool schemas only name the fields they mean to expose, but the `contacts` batch holds free-form items, so the route
// strips these fields itself when the call is the MCP's (see clientSource in ../clientSource.ts).

const CONSENT_FIELDS = ['resubscribe', 'unsubscribedTopics'] as const
const MAX_ITEMS = 1000

function strip(item: unknown): void {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return
  const record = item as Record<string, unknown>
  for (const key of CONSENT_FIELDS) delete record[key]
  if ('subscription' in record && record.subscription !== 'unsubscribed') delete record.subscription
}

/** The body of a contacts write with every way of subscribing someone taken out, in place. */
export function withoutSubscribing<T extends Record<string, unknown>>(body: T): T {
  strip(body)
  if (Array.isArray(body.contacts)) for (const item of body.contacts.slice(0, MAX_ITEMS)) strip(item)
  return body
}
