// A project's setup checklist: what is wired up, judged from state HelpBites has
// seen (the widget loading, a signed token arriving, a sync running), never from
// a box someone ticked. The server gathers the facts (server/utils/setup.ts) and
// this turns them into rows, so the panel, the native app and the API agree.
// Rows carry a `reason` code and a `value`; each client words them
// (`setup.<key>.<reason>` in i18n/locales/en.json, SetupScreen.swift natively).
// tests/setup.test.ts and tests/setupNativeParity.test.ts keep the words complete.

export const SETUP_REASONS = {
  widget: ['seen', 'noOrigins', 'waiting'],
  identity: ['seen', 'anonymous', 'missing'],
  notified: ['email', 'push', 'noMailer', 'nobody'],
  sender: ['ready', 'default', 'missing'],
  assistant: ['live', 'notLive', 'none'],
  stripe: ['synced', 'waiting', 'error', 'none'],
  github: ['linked', 'none'],
  errors: ['connected', 'none']
} as const

export type SetupKey = keyof typeof SETUP_REASONS
export const SETUP_KEYS = Object.keys(SETUP_REASONS) as SetupKey[]

/** `attention`: set up, but something is wrong with it now (a sync failing, mail that cannot go out). */
export type SetupState = 'done' | 'todo' | 'attention'

export type SetupItem = {
  key: SetupKey
  state: SetupState
  /** One of SETUP_REASONS[key]. */
  reason: string
  /** What the reason is about, to word it with: a count, an address, an error message, a time. Empty when it has none. */
  value: string
  /** The web section that fixes it, as the project overview links to sections (a path, optionally `?query` or `#anchor`). */
  section: string
  /** Not every project wants it (a project with no payments needs no Stripe), so it never reads as a failure. */
  optional: boolean
}

export type ProjectSetup = { items: SetupItem[], done: number, total: number }

/** The section whose page an item belongs to; hiding that section drops the item. Items with none always show. */
export const SETUP_SECTIONS: Partial<Record<SetupKey, string>> = { sender: 'email', assistant: 'assistants', stripe: 'revenue', errors: 'errors' }

export type SetupFacts = {
  hiddenSections: string[]
  /** Items the member's role may not see or fix are left out. */
  skip?: SetupKey[]
  allowedOrigins: number
  widgetSeenAt: string | null
  identitySeenAt: string | null
  allowAnonymousUsers: boolean
  notifyEmails: number
  /** Whether this server can send mail at all, and from the project's own sender. */
  mailerReady: boolean
  /** Devices of the workspace's team that push notifications reach: 0 when the server has no APNs credentials. */
  pushDevices: number
  /** The project's own from address; '' when the server's default applies. */
  fromEmail: string
  assistants: { total: number, live: number, first: string }
  stripe: { connected: boolean, synced: boolean, error: string }
  repos: number
  errorTracker: { connected: boolean, name: string }
}

export function buildSetup(facts: SetupFacts): ProjectSetup {
  const rows: SetupItem[] = []
  const add = (key: SetupKey, state: SetupState, reason: string, value: string | number, section: string, optional = false) => {
    if (facts.skip?.includes(key)) return
    const hidden = SETUP_SECTIONS[key]
    if (hidden && facts.hiddenSections.includes(hidden)) return
    rows.push({ key, state, reason, value: String(value), section, optional })
  }

  if (!facts.allowedOrigins) add('widget', 'todo', 'noOrigins', '', 'dev')
  else if (!facts.widgetSeenAt) add('widget', 'todo', 'waiting', facts.allowedOrigins, 'dev')
  else add('widget', 'done', 'seen', facts.widgetSeenAt, 'dev')

  // Anonymous sign-in covers an app with no backend to sign tokens, so a missing token is no failure there.
  if (facts.identitySeenAt) add('identity', 'done', 'seen', facts.identitySeenAt, 'dev')
  else add('identity', 'todo', facts.allowAnonymousUsers ? 'anonymous' : 'missing', '', 'dev', facts.allowAnonymousUsers)

  if (facts.notifyEmails && !facts.mailerReady) add('notified', 'attention', 'noMailer', facts.notifyEmails, 'settings')
  else if (facts.notifyEmails) add('notified', 'done', 'email', facts.notifyEmails, 'settings')
  else if (facts.pushDevices) add('notified', 'done', 'push', facts.pushDevices, 'settings')
  else add('notified', 'todo', 'nobody', '', 'settings')

  // Mail can go out from the project's own address, or the server's default one.
  if (facts.mailerReady) add('sender', 'done', facts.fromEmail ? 'ready' : 'default', facts.fromEmail, 'email?view=settings')
  else add('sender', 'todo', 'missing', '', 'email?view=settings')

  if (!facts.assistants.total) add('assistant', 'todo', 'none', '', 'assistants', true)
  else if (facts.assistants.live) add('assistant', 'done', 'live', facts.assistants.first, 'assistants', true)
  else add('assistant', 'attention', 'notLive', facts.assistants.first, 'assistants', true)

  if (!facts.stripe.connected) add('stripe', 'todo', 'none', '', 'revenue', true)
  else if (facts.stripe.error) add('stripe', 'attention', 'error', facts.stripe.error, 'revenue', true)
  else if (!facts.stripe.synced) add('stripe', 'todo', 'waiting', '', 'revenue', true)
  else add('stripe', 'done', 'synced', '', 'revenue', true)

  if (facts.repos) add('github', 'done', 'linked', facts.repos, 'settings#github', true)
  else add('github', 'todo', 'none', '', 'settings#github', true)

  if (facts.errorTracker.connected) add('errors', 'done', 'connected', facts.errorTracker.name, 'errors', true)
  else add('errors', 'todo', 'none', '', 'errors', true)

  return { items: rows, done: rows.filter(item => item.state === 'done').length, total: rows.length }
}
