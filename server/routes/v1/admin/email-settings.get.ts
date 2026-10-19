defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'adminEmailSettings', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'How this server sends email',
    description: 'Whether Mailgun is configured, the default sender every project falls back to, the delivery-webhook URL to give Mailgun, and how long the log is kept. Per-project senders are on the project (`fromEmail`, `replyTo`, `mailDomain`).',
    responses: { 200: { description: '`{ configured, provider, domain, fromEmail, apiBaseUrl, webhook: { configured, url }, retentionDays }`' } }
  }
})

export default defineEventHandler(async (event) => {
  await requireMember(event, { workspaceWide: true })
  const defaults = mailgunDefaults()
  const base = (process.env.APP_URL || getRequestURL(event).origin).replace(/\/+$/, '')
  return {
    configured: isMailerConfigured(),
    provider: 'mailgun',
    domain: defaults.domain,
    fromEmail: defaults.fromEmail,
    apiBaseUrl: defaults.baseUrl,
    webhook: { configured: Boolean(process.env.MAILGUN_WEBHOOK_SIGNING_KEY), url: `${base}/v1/webhooks/mailgun` },
    retentionDays: emailLogRetentionDays()
  }
})
