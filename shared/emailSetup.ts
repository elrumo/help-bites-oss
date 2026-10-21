// What a project needs before its email works, for the strip across the top of
// the Email section. Judged on the server (server/utils/emailSetup.ts) from the
// mailer's environment and the project's own settings, then worded by each
// client (`emailSetup.<key>` in i18n/locales/en.json, EmailSetupStrip.swift).

export const EMAIL_SETUP_CHECKS = ['mailer', 'sender', 'webhook', 'postalAddress', 'paused'] as const
export type EmailSetupKey = typeof EMAIL_SETUP_CHECKS[number]

/** `ok`; `todo`: mail cannot go out (or a campaign cannot start) until it is done; `warn`: it works, less well. */
export type EmailSetupState = 'ok' | 'todo' | 'warn'

export type EmailSetupCheck = {
  key: EmailSetupKey
  state: EmailSetupState
  /** Sends everything by hand, in automations or in bulk (mailer, sender), or only campaigns and sequences (postalAddress, paused). */
  scope: 'all' | 'bulk'
  /** The address mail goes out from, or the reason a pause gives. */
  value: string
}

export type EmailSetup = {
  checks: EmailSetupCheck[]
  /** Transactional and template mail can go out. */
  sending: boolean
  /** Campaigns and sequences can start as well. */
  bulk: boolean
}

export type EmailSetupFacts = {
  /** MAILGUN_API_KEY is set on the server. */
  apiKey: boolean
  /** The domain and address mail goes out from: the project's own, else the server's defaults. */
  domain: string
  fromEmail: string
  /** The server has a delivery-webhook signing key, so bounces, opens and complaints reach HelpBites. */
  webhook: boolean
  /** The newsletter settings' postal address, required in every marketing email. */
  postalAddress: string
  /** Why bulk mail is paused for the workspace (the reputation guard), or ''. */
  pausedReason: string
}

export function buildEmailSetup(facts: EmailSetupFacts): EmailSetup {
  const checks: EmailSetupCheck[] = [
    { key: 'mailer', state: facts.apiKey ? 'ok' : 'todo', scope: 'all', value: '' },
    { key: 'sender', state: facts.domain && facts.fromEmail ? 'ok' : 'todo', scope: 'all', value: facts.fromEmail },
    // Mail sends without it; what is lost is the log's delivered, opened and bounced, and the suppressions bounces would add.
    { key: 'webhook', state: facts.webhook ? 'ok' : 'warn', scope: 'all', value: '' },
    { key: 'postalAddress', state: facts.postalAddress.trim() ? 'ok' : 'todo', scope: 'bulk', value: '' },
    { key: 'paused', state: facts.pausedReason ? 'todo' : 'ok', scope: 'bulk', value: facts.pausedReason }
  ]
  const blocked = (scope: 'all' | 'bulk') => checks.some(check => check.state === 'todo' && (scope === 'bulk' || check.scope === 'all'))
  return { checks, sending: !blocked('all'), bulk: !blocked('bulk') }
}
