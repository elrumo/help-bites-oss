import { createError } from 'h3'

/**
 * Send one of the project's own email templates (by send key) to up to 50
 * people, in-process: the same path as `POST /v1/emails/send` with the project
 * secret, minus the HTTP. `body` is that endpoint's body (`template`, `to`,
 * `variables`, `headers`, `idempotencyKey`, `tags`…), so a retry with the same
 * `idempotencyKey` is collapsed for 24 hours exactly as it would be there.
 */
export async function sendChangelogTemplate(project: ParseObject, body: Record<string, unknown>): Promise<{ sent: number, failed: string[], suppressed: string[] }> {
  const request = parseEmailSendRequest(body, [])
  const claim = await claimIdempotencyKey(project.id || '', request.idempotencyKey)
  if (claim.replay) return claim.replay as { sent: number, failed: string[], suppressed: string[] }
  try {
    const sender = projectEmailSender(project, { fromName: request.from.name, fromEmail: request.from.email, replyTo: request.replyTo })
    if (!isMailerConfigured(sender)) throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured on this server' })
    const content = await resolveEmailContent(project, request.content)
    const batchId = newEmailBatchId()
    const results = await deliverEmails(buildOutgoingEmails(project, SYSTEM_EMAIL_ACTOR, request, content, sender, { batchId, source: 'notification', poweredBy: await poweredByFor(project) }))
    const summary = summarizeDeliveries(batchId, results)
    await claim.store(summary)
    return summary
  } catch (error) {
    // Nothing was accepted: a retry with the same key should really try again.
    await claim.release()
    throw error
  }
}
