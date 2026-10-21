import type { ContactOrigin, ContactOriginType } from '#shared/contacts'

/** How a contact got here, as the people list and a contact's page show it (labels: contacts.origin.* in the locales). */
export const ORIGIN_ICONS: Record<ContactOriginType, string> = {
  app: 'i-lucide-smartphone',
  lead_form: 'i-lucide-clipboard-list',
  signup: 'i-lucide-mail-plus',
  import: 'i-lucide-file-up',
  sync: 'i-lucide-database',
  stripe: 'i-lucide-credit-card',
  api: 'i-lucide-code-xml',
  panel: 'i-lucide-user-plus',
  feedback: 'i-lucide-lightbulb'
}

/** "Lead form · Waitlist": the kind, and the form or source by name when we know it. */
export function originText(origin: ContactOrigin | null, kind: (type: ContactOriginType) => string, names: Record<string, string>): string {
  if (!origin) return ''
  const name = origin.id ? names[origin.id] : ''
  return name ? `${kind(origin.type)} · ${name}` : kind(origin.type)
}
