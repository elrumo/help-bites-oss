import type { ContactSubscription } from '#shared/contacts'

export const SUBSCRIPTION_STATUS: Record<ContactSubscription, { label: string, color: 'success' | 'warning' | 'neutral' | 'error', icon: string, hint: string }> = {
  subscribed: { label: 'Subscribed', color: 'success', icon: 'i-lucide-mail-check', hint: 'Gets marketing email' },
  pending: { label: 'Pending', color: 'warning', icon: 'i-lucide-mail-question', hint: 'Signed up; has not confirmed yet' },
  unsubscribed: { label: 'Unsubscribed', color: 'error', icon: 'i-lucide-mail-x', hint: 'Asked for no more marketing email' },
  none: { label: 'Not subscribed', color: 'neutral', icon: 'i-lucide-mail', hint: 'Transactional email only' }
}

/** A CSV column name as an attribute key: letters, digits and _, starting with a letter. */
export function attributeKeyFor(column: string): string {
  const key = column.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return (/^[A-Za-z]/.test(key) ? key : `c_${key}`).slice(0, 40)
}
