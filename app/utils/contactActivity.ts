import type { ActivityRef, ActivityType } from '#shared/activity'

// How a person's activity (GET /v1/contacts/:id/activity) reads in the panel:
// an icon per kind, a relative time, and where an item leads. The native app
// mirrors this in Features/Contacts/ContactActivity.swift.

export const ACTIVITY_ICONS: Record<ActivityType, string> = {
  joined: 'i-lucide-user-plus',
  conversation: 'i-lucide-message-circle',
  feedback_post: 'i-lucide-lightbulb',
  feedback_comment: 'i-lucide-message-square-text',
  vote: 'i-lucide-thumbs-up',
  email: 'i-lucide-mail',
  sequence: 'i-lucide-list-ordered',
  payment: 'i-lucide-credit-card',
  subscription: 'i-lucide-repeat',
  onboarding: 'i-lucide-rocket'
}

/** The kinds the Billing section already shows in more detail (live from Stripe). */
export const BILLING_ACTIVITY: ActivityType[] = ['payment', 'subscription']

/** Where an item opens in the panel, or null when it leads nowhere. */
export function activityLink(projectId: string, ref: ActivityRef | null): string | null {
  if (!ref) return null
  switch (ref.kind) {
    case 'conversation': return `/inbox?project=${projectId}&c=${ref.id}`
    case 'feedback_post': return `/projects/${projectId}/feedback`
    case 'email_log': return `/projects/${projectId}/email?view=log`
    case 'sequence': return `/projects/${projectId}/campaigns?view=sequences`
    case 'onboarding_flow': return `/projects/${projectId}/onboarding`
    case 'stripe': return `/projects/${projectId}/revenue`
  }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]]

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"; `now` and `locale` are for tests. */
export function relativeTime(iso: string, now = Date.now(), locale?: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((then - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}
