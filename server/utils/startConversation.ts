// What an operator's "start a conversation" may tell the customer record. `ensureEndUser` has the semantics of the host
// app's own signed token (the host knows its users), so it overwrites a name and an address that differ. An operator, or
// an assistant acting for one, only knows what they were told: they fill a gap, and never rewrite who a customer is or
// where the team's later replies and mail go.

type Row = { get: (key: string) => unknown } | null | undefined

export function startConversationClaims(existing: Row, payload: Record<string, unknown>, externalId: string): { sub: string, name: string, email: string } {
  const keep = (key: string) => String(existing?.get(key) || '').trim()
  return {
    sub: externalId,
    name: keep('name') || String(payload.name || ''),
    email: keep('email') || String(payload.email || '')
  }
}
