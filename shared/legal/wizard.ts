import { LEGAL_REGIONS, LEGAL_REGION_LABELS, type LegalAnswers, type LegalDocType, type LegalQuestion } from './types'
import { matches } from './when'

// The wizard is data: the panel renders it, and so can any API client
// (GET /v1/admin/legal/wizard/:type returns `questionsFor`).

export type LegalProcessor = { id: string, name: string, purpose: string, data: string, url: string }

/** Services indie apps commonly use. Picking one adds a line to the privacy policy's "who we share with". */
export const LEGAL_PROCESSORS: LegalProcessor[] = [
  { id: 'stripe', name: 'Stripe', purpose: 'payment processing', data: 'payment and billing details', url: 'https://stripe.com/privacy' },
  { id: 'apple_iap', name: 'Apple (App Store)', purpose: 'in-app purchases and subscriptions', data: 'purchase and subscription status', url: 'https://www.apple.com/legal/privacy/' },
  { id: 'google_play_billing', name: 'Google Play Billing', purpose: 'in-app purchases and subscriptions', data: 'purchase and subscription status', url: 'https://policies.google.com/privacy' },
  { id: 'revenuecat', name: 'RevenueCat', purpose: 'subscription management', data: 'purchase status and an app user ID', url: 'https://www.revenuecat.com/privacy/' },
  { id: 'firebase', name: 'Google Firebase', purpose: 'authentication, analytics, crash reporting or hosting', data: 'account identifiers, usage and device information', url: 'https://firebase.google.com/support/privacy' },
  { id: 'google_analytics', name: 'Google Analytics', purpose: 'usage analytics', data: 'usage and device information', url: 'https://policies.google.com/privacy' },
  { id: 'posthog', name: 'PostHog', purpose: 'product analytics', data: 'usage and device information', url: 'https://posthog.com/privacy' },
  { id: 'mixpanel', name: 'Mixpanel', purpose: 'product analytics', data: 'usage and device information', url: 'https://mixpanel.com/legal/privacy-policy/' },
  { id: 'sentry', name: 'Sentry', purpose: 'crash and error reporting', data: 'crash reports and device information', url: 'https://sentry.io/privacy/' },
  { id: 'admob', name: 'Google AdMob', purpose: 'advertising', data: 'advertising identifiers and device information', url: 'https://policies.google.com/privacy' },
  { id: 'openai', name: 'OpenAI', purpose: 'AI features', data: 'content you submit to AI features', url: 'https://openai.com/policies/privacy-policy' },
  { id: 'anthropic', name: 'Anthropic', purpose: 'AI features', data: 'content you submit to AI features', url: 'https://www.anthropic.com/legal/privacy' }
]

const DATA_OPTIONS = [
  { value: 'account', label: 'Account details (name, email)' },
  { value: 'payments', label: 'Purchases and payments' },
  { value: 'analytics', label: 'Usage analytics' },
  { value: 'crash', label: 'Crash and error reports' },
  { value: 'device', label: 'Device information and identifiers' },
  { value: 'location', label: 'Location' },
  { value: 'user_content', label: 'Content users create or upload' },
  { value: 'support', label: 'Support messages' },
  { value: 'advertising', label: 'Advertising identifiers' }
]

export const LEGAL_QUESTIONS: LegalQuestion[] = [
  { id: 'app_name', label: 'App or product name', kind: 'text', required: true, docTypes: 'all', placeholder: 'Acme Notes' },
  { id: 'entity_name', label: 'Legal name of the company or person operating it', kind: 'text', required: true, docTypes: 'all' },
  { id: 'entity_address', label: 'Postal address', help: 'Needed in the EU, UK and Brazil. Leave it out only if you have none.', kind: 'text', docTypes: 'all' },
  { id: 'contact_email', label: 'Contact email for privacy and legal questions', kind: 'text', required: true, docTypes: 'all' },
  { id: 'website_url', label: 'Website', kind: 'text', docTypes: 'all', placeholder: 'https://example.com' },
  { id: 'dpo_contact', label: 'Data protection officer contact', help: 'Only if you have appointed one.', kind: 'text', docTypes: ['privacy'], showIf: { regions: ['eu', 'uk', 'br'] } },
  { id: 'platforms', label: 'Where does it run?', kind: 'multi', docTypes: 'all', options: [
    { value: 'ios', label: 'iOS' }, { value: 'android', label: 'Android' }, { value: 'web', label: 'Web' }, { value: 'desktop', label: 'Desktop' }
  ] },
  { id: 'regions', label: 'Where are your users?', help: 'Pick every region you have users in or market to. It decides which laws the text addresses.', kind: 'multi', docTypes: 'all',
    options: LEGAL_REGIONS.map(value => ({ value, label: LEGAL_REGION_LABELS[value] })) },
  { id: 'data_collected', label: 'What do you collect?', kind: 'multi', docTypes: ['privacy', 'cookies'], options: DATA_OPTIONS },
  { id: 'processors', label: 'Which services do you use?', help: 'Third parties that receive your users\' data.', kind: 'multi', docTypes: ['privacy'],
    options: [...LEGAL_PROCESSORS.map(p => ({ value: p.id, label: p.name })), { value: 'other', label: 'Others (describe below)' }] },
  { id: 'processors_other', label: 'Other services', help: 'Name each one and what it does.', kind: 'longtext', docTypes: ['privacy'], showIf: { has: { processors: ['other'] } } },
  { id: 'sells_or_shares_data', label: 'Do you sell personal data or share it for advertising?', kind: 'boolean', docTypes: ['privacy'], showIf: { regions: ['us-ca', 'us-other'] } },
  { id: 'ai_features', label: 'Does it send user content to a third-party AI service?', kind: 'boolean', docTypes: ['privacy'] },
  { id: 'children', label: 'Who is it for?', kind: 'select', docTypes: ['privacy'], options: [
    { value: 'none', label: 'Adults and general audiences; not aimed at children' },
    { value: 'teens', label: 'Includes teenagers (13+)' },
    { value: 'kids', label: 'Aimed at children under 13' }
  ] },
  { id: 'retention', label: 'How long do you keep data?', kind: 'text', docTypes: ['privacy'], placeholder: 'Until you delete your account, then removed within 30 days' },
  { id: 'cookie_types', label: 'Which cookies and similar storage do you use?', kind: 'multi', docTypes: ['cookies'], options: [
    { value: 'essential', label: 'Essential (sign-in, security)' },
    { value: 'preferences', label: 'Preferences (language, theme)' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'advertising', label: 'Advertising' }
  ] },
  { id: 'subscriptions', label: 'Do you charge subscriptions?', kind: 'boolean', docTypes: ['terms', 'refund'] },
  { id: 'min_age', label: 'Minimum age to use it', kind: 'select', docTypes: ['terms'], options: [
    { value: '13', label: '13' }, { value: '16', label: '16' }, { value: '18', label: '18' }
  ] },
  { id: 'governing_law', label: 'Governing law', help: 'The country or state whose law governs the terms.', kind: 'text', required: true, docTypes: ['terms'], placeholder: 'England and Wales' },
  { id: 'refund_via', label: 'How do customers pay?', kind: 'select', docTypes: ['refund'], options: [
    { value: 'store', label: 'Through the App Store or Google Play' },
    { value: 'direct', label: 'Directly to us' }
  ] },
  { id: 'refund_window_days', label: 'Refund window in days', help: 'For direct purchases.', kind: 'text', docTypes: ['refund'], showIf: { is: { refund_via: 'direct' } }, placeholder: '14' }
]

/** The questions a document asks, in order. */
export function questionsFor(type: LegalDocType): LegalQuestion[] {
  return LEGAL_QUESTIONS.filter(q => q.docTypes === 'all' || q.docTypes.includes(type))
}

const TEXT_MAX = 2000

/**
 * Cleans an answer set against the questions a document asks: drops unknown
 * keys and values that are not options, trims text, and reports what a visible
 * required question still lacks. Never throws; the caller decides.
 */
export function validateAnswers(type: LegalDocType, input: unknown): { answers: LegalAnswers, errors: string[] } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const answers: LegalAnswers = {}
  for (const q of questionsFor(type)) {
    const value = raw[q.id]
    if (q.kind === 'boolean') {
      if (typeof value === 'boolean') answers[q.id] = value
    } else if (q.kind === 'multi') {
      const allowed = new Set((q.options || []).map(o => o.value))
      if (Array.isArray(value)) answers[q.id] = [...new Set(value.map(String).filter(v => allowed.has(v)))]
    } else if (q.kind === 'select') {
      if (typeof value === 'string' && (q.options || []).some(o => o.value === value)) answers[q.id] = value
    } else if (typeof value === 'string' && value.trim()) {
      answers[q.id] = value.trim().slice(0, TEXT_MAX)
    }
  }
  const errors: string[] = []
  for (const q of questionsFor(type)) {
    if (q.required && matches(q.showIf, answers) && answers[q.id] === undefined) errors.push(`${q.label} is required`)
  }
  return { answers, errors }
}
