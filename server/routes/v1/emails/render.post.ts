defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'renderEmail', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Preview an email without sending it',
    description: 'Takes the same body as `POST /v1/emails/send` (JSON or multipart) and returns exactly what the first recipient would receive: subject, HTML, plain text, sender and headers. Nothing is sent or logged, and `to` is optional. `?format=html` returns the HTML document itself.',
    parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'html'] } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', description: 'The send body.' }, example: { html: '<p>Hi {{name}}</p>', subject: 'Hello', variables: { name: 'Ada' } } } } },
    responses: {
      200: { description: '`{ subject, html, text, from, replyTo, to, cc, bcc, headers, kind, template, attachments }`, or `text/html` with `format=html`.' },
      400: { description: 'Invalid request (same checks as a send).' },
      404: { description: 'No template with that key in this project.' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const { body, files } = await readEmailSendBody(event)
  const project = await callerProject(event, caller, body.project)
  await rateLimit(`sb:rl:emailrender:${project.id}`, LIMITS.emailRendersPerProject.limit, LIMITS.emailRendersPerProject.window)
  const request = parseEmailSendRequest(body.to ? body : { ...body, to: 'recipient@example.com' }, files)
  const sender = projectEmailSender(project, { fromName: request.from.name, fromEmail: request.from.email, replyTo: request.replyTo })
  const content = await resolveEmailContent(project, request.content)
  const recipient = request.recipients[0]!
  const composed = composeEmail(project, content, request, recipient, sender, await poweredByFor(project))

  if (getQuery(event).format === 'html') {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return composed.html
  }
  return {
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    from: formatMailbox(sender.fromName, sender.fromEmail),
    replyTo: sender.replyTo,
    to: formatMailbox(recipient.name, recipient.email),
    cc: request.cc,
    bcc: request.bcc,
    headers: composed.headers,
    kind: composed.kind,
    template: composed.template ? { id: composed.template.row.id, key: composed.template.key, name: composed.template.name } : null,
    attachments: request.attachments.map(a => ({ filename: a.filename, contentType: a.contentType, size: a.data.byteLength, inline: Boolean(a.inline) }))
  }
})
