import type { EmailLogStatus } from '~~/server/utils/emailLogs'

// How each send status reads in the panel. Status colours mean state, so
// they always come with an icon and a word, never colour alone.

type BadgeColor = 'neutral' | 'success' | 'warning' | 'error'

export const EMAIL_STATUS: Record<EmailLogStatus, { label: string, icon: string, color: BadgeColor, hint: string }> = {
  scheduled: { label: 'Scheduled', icon: 'i-lucide-clock', color: 'neutral', hint: 'Accepted; Mailgun delivers it at the scheduled time.' },
  sent: { label: 'Sent', icon: 'i-lucide-send', color: 'neutral', hint: 'Accepted by Mailgun. Delivery events need the Mailgun webhook.' },
  delivered: { label: 'Delivered', icon: 'i-lucide-check', color: 'success', hint: 'The receiving server accepted it.' },
  opened: { label: 'Opened', icon: 'i-lucide-mail-open', color: 'success', hint: 'Opened at least once (needs open tracking).' },
  clicked: { label: 'Clicked', icon: 'i-lucide-mouse-pointer-click', color: 'success', hint: 'A link was clicked (needs click tracking).' },
  unsubscribed: { label: 'Unsubscribed', icon: 'i-lucide-bell-off', color: 'warning', hint: 'The recipient unsubscribed; the address is suppressed.' },
  bounced: { label: 'Bounced', icon: 'i-lucide-circle-x', color: 'error', hint: 'Permanently refused; the address is suppressed.' },
  complained: { label: 'Spam report', icon: 'i-lucide-flag', color: 'error', hint: 'Marked as spam; the address is suppressed.' },
  failed: { label: 'Failed', icon: 'i-lucide-circle-alert', color: 'error', hint: 'Mailgun did not accept it.' },
  suppressed: { label: 'Not sent', icon: 'i-lucide-ban', color: 'warning', hint: 'Skipped: the address is on the suppression list.' }
}

export const EMAIL_SOURCE_LABELS: Record<string, string> = {
  api: 'API',
  admin: 'Operator',
  test: 'Test',
  notification: 'Notification',
  feedback: 'Feedback',
  system: 'HelpBites',
  campaign: 'Campaign',
  sequence: 'Sequence'
}

export const EMAIL_SUPPRESSION_REASON_LABELS: Record<string, string> = {
  bounce: 'Bounced',
  complaint: 'Spam report',
  unsubscribe: 'Unsubscribed',
  manual: 'Added by hand'
}

/** 1,284 · 12.9K · 4.2M */
export function compactCount(value: number): string {
  return value < 10_000 ? value.toLocaleString() : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function logTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })
}
