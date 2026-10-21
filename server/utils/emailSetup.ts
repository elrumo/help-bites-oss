import { buildEmailSetup, type EmailSetup } from '#shared/emailSetup'
import { normalizeMarketingConfig } from '#shared/marketing'

/** Whether a project's email can go out, and what is missing: the strip across the Email section. */
export async function projectEmailSetup(project: ParseObject): Promise<EmailSetup> {
  const defaults = mailgunDefaults()
  return buildEmailSetup({
    apiKey: Boolean(process.env.MAILGUN_API_KEY),
    // A project's own sender wins; blank falls back to the server's, as sendMail does.
    domain: String(project.get('mailDomain') || '') || defaults.domain,
    fromEmail: String(project.get('fromEmail') || '') || defaults.fromEmail,
    webhook: Boolean(process.env.MAILGUN_WEBHOOK_SIGNING_KEY),
    postalAddress: normalizeMarketingConfig(project.get('marketing')).postalAddress,
    pausedReason: (await emailSendingPaused(pointerId(project.get('workspace')))) || ''
  })
}
