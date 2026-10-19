defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'sendEmail', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send an email',
    description: 'Sends one message per recipient: one of the project\'s templates (by send key or id), your own HTML (in the body or uploaded as a file), a block document, or a plain-text message in the project\'s layout. Every recipient gets a log entry (`GET /v1/email-logs`). Server to server: authenticate with the project secret (`sk_…`). Operators and admin keys can send for any project by passing `project`.\n\nJSON, or `multipart/form-data` with an `html` file, `attachment` files and the other fields as form fields (or one `payload` JSON field).',
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['to'],
            properties: {
              template: { type: 'string', description: 'A send key (e.g. `welcome`) or template id of this project. One of `template`, `html`, `document` or `message`.' },
              html: { type: 'string', description: 'Your own HTML: a full document or a fragment. `{{key}}` fills in escaped, `{{{key}}}` raw. With multipart, upload it as a file field named `html`.' },
              document: { type: 'object', description: 'A block document `{ settings, blocks }`, as the editor exports it.' },
              message: { type: 'object', description: 'Plain text in the project\'s message layout.', properties: { subject: { type: 'string' }, body: { type: 'string' }, ctaUrl: { type: 'string' }, ctaLabel: { type: 'string' } } },
              to: { type: 'array', maxItems: 50, items: { type: 'object', required: ['email'], properties: { email: { type: 'string', description: '`ada@example.com` or `Ada Lovelace <ada@example.com>`' }, name: { type: 'string' }, variables: { type: 'object', description: 'This recipient\'s own values; they win over the call\'s `variables`.' } } }, description: 'Up to 50 recipients, each getting their own message. Items are `{ email, name?, variables? }` or plain addresses (`ada@example.com`, `Ada Lovelace <ada@example.com>`); a single address may be a string.' },
              cc: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Copied on every message.' },
              bcc: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Blind-copied on every message.' },
              variables: { type: 'object', description: 'Values for the `{{placeholders}}`. `{{recipient.email}}` and `{{recipient.name}}` fill in per message, `{{project.*}}` from the project.' },
              subject: { type: 'string', description: 'Overrides the template\'s subject; required for `html` without a `<title>`. Placeholders fill in.' },
              text: { type: 'string', description: 'The plain-text part. Generated from the HTML when omitted.' },
              from: { type: 'string', description: 'Sender name, or `Name <address>` (or an object `{ name, email }`). A different address must be on the project\'s sending domain.' },
              replyTo: { type: 'string' },
              headers: { type: 'object', description: 'Extra headers such as `List-Unsubscribe`. Values may use placeholders, filled per recipient.' },
              tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
              metadata: { type: 'object', description: 'Up to 10 of your own keys, values up to 200 characters. Stored on the log and echoed by delivery webhooks.' },
              attachments: { type: 'array', maxItems: 10, items: { type: 'object', required: ['filename', 'content'], properties: { filename: { type: 'string' }, content: { type: 'string', description: 'base64' }, contentType: { type: 'string' }, inline: { type: 'boolean', description: 'Referenced from the HTML as `cid:<filename>`.' } } }, description: 'Up to 10 files, 10 MB in all. With multipart, upload them as `attachment` file fields.' },
              sendAt: { type: 'string', format: 'date-time', description: 'Deliver later, up to 72 hours ahead.' },
              tracking: { type: 'object', properties: { opens: { type: 'boolean' }, clicks: { type: 'boolean' } }, description: 'Override the Mailgun domain\'s open and click tracking.' },
              testMode: { type: 'boolean', description: 'Mailgun accepts and logs the message but does not deliver it.' },
              ignoreSuppressions: { type: 'boolean', description: 'Send even to addresses on the project\'s suppression list (for a password reset after an unsubscribe).' },
              idempotencyKey: { type: 'string', description: 'Or the `Idempotency-Key` header. A retry with the same key within 24 hours returns the first response instead of sending again.' },
              project: { type: 'string', description: 'Operators and admin keys only: the project to send for.' }
            }
          },
          example: { template: 'welcome', to: 'ada@example.com', variables: { firstName: 'Ada' } } },
        'multipart/form-data': { schema: { type: 'object', properties: { html: { type: 'string', format: 'binary' }, attachment: { type: 'string', format: 'binary' }, to: { type: 'string' }, subject: { type: 'string' }, payload: { type: 'string', description: 'The JSON body as one field.' } } } }
      }
    },
    responses: {
      200: { description: '`{ id, sent, failed, suppressed, results: [{ to, status, logId, messageId, error? }] }`. `status` is sent, scheduled, failed or suppressed. A replay of an idempotent request carries `Idempotent-Replayed: true`.' },
      400: { description: 'Invalid request: no or bad recipients, more than one kind of content, a bad header, or no subject.' },
      401: { description: 'Project secret, admin key or session required.' },
      402: { description: 'The workspace\'s emails for this month or today would run out; nothing was sent.' },
      404: { description: 'No template with that key in this project.' },
      409: { description: 'A request with this idempotency key is still being processed.' },
      413: { description: 'The HTML or the attachments are too large.' },
      502: { description: 'The mail provider refused every recipient (each is still in the log).' },
      503: { description: 'Email sending is not configured on this server.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const { body, files } = await readEmailSendBody(event)
  const project = await callerProject(event, caller, body.project)
  await rateLimit(`sb:rl:emailsend:${project.id}`, LIMITS.emailSendsPerProject.limit, LIMITS.emailSendsPerProject.window)
  const request = parseEmailSendRequest(body, files, event)

  const claim = await claimIdempotencyKey(project.id || '', request.idempotencyKey)
  if (claim.replay) {
    setResponseHeader(event, 'Idempotent-Replayed', 'true')
    return claim.replay
  }
  try {
    const sender = projectEmailSender(project, { fromName: request.from.name, fromEmail: request.from.email, replyTo: request.replyTo })
    if (!isMailerConfigured(sender)) throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured on this server' })
    const content = await resolveEmailContent(project, request.content)
    const batchId = newEmailBatchId()
    const results = await deliverEmails(buildOutgoingEmails(project, caller.actor, request, content, sender, { batchId, source: caller.source, event, poweredBy: await poweredByFor(project) }))
    const summary = summarizeDeliveries(batchId, results)
    if (summary.failed.length && !summary.sent && !summary.suppressed.length) {
      throw createError({ statusCode: 502, statusMessage: 'The mail provider refused every recipient', data: summary })
    }
    await claim.store(summary)
    return summary
  } catch (error) {
    // Nothing was accepted: a retry with the same key should really try again.
    await claim.release()
    throw error
  }
})
