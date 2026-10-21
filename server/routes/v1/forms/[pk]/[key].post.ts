defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'submitLeadForm', security: [],
    summary: 'Sign up through a lead form (public)',
    description: 'From the browser or an app: no secret, the project\'s public key. Send each field\'s answer under its `key` (`email` always; `name`; anything else is saved as that contact attribute). JSON, or a plain HTML form (`application/x-www-form-urlencoded`), which is redirected to the form\'s `redirectUrl` (or HelpBites\' own thank-you page). The person becomes (or stays) a contact, tagged with the form\'s tags and counted in its segment. With double opt-in they get a confirmation email and stay `pending` until they click it; then, or right away without it, the form\'s welcome email goes out and they start its sequence. Add an empty `website` field hidden from people: bots fill it in. After the answers check out it is always 202, whether or not the address was known.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], additionalProperties: true, properties: { email: { type: 'string' }, name: { type: 'string' }, website: { type: 'string', description: 'Honeypot: leave empty.' } } }, example: { email: 'ada@example.com', name: 'Ada', company: 'Acme' } } } },
    responses: { 202: { description: '`{ ok: true, pending }`: `pending` means "check your inbox".' }, 400: { description: 'An answer is missing or invalid; `data.errors` lists each.' }, 402: { description: 'Sign-ups are closed for now (the workspace is at its plan\'s contact limit).' }, 403: { description: 'A browser form from a site not in the project\'s allowed origins.' }, 404: { description: 'Unknown project, or no such active form.' }, 429: { description: 'Too many sign-ups from this address.' } }
  }
})

export default defineEventHandler(async (event) => {
  const form = String(getHeader(event, 'content-type') || '').startsWith('application/x-www-form-urlencoded')
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Send a JSON object or a form' })
  const { project, row } = await findPublicLeadForm(getRouterParam(event, 'pk') || '', getRouterParam(event, 'key') || '')
  const own = (() => { try { return publicBaseUrl() } catch { return '' } })()
  if (!signupOriginAllowed(String(getHeader(event, 'origin') || ''), (project.get('allowedOrigins') as string[] | undefined) || [], own)) throw createError({ statusCode: 403, statusMessage: 'This site may not sign people up for this project' })

  let pending: boolean
  try {
    ({ pending } = await submitLeadForm(event, project, row, body))
  } catch (error) {
    // A plain form gets its page back with the reason (and what was typed), like the hosted page.
    const status = (error as { statusCode?: number }).statusCode || 500
    if (!form || ![400, 402].includes(status)) throw error
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, status)
    return leadFormPage(project, row, { error: (error as { statusMessage?: string }).statusMessage || 'Check the form and try again.', values: body, poweredBy: await poweredByFor(project) })
  }
  if (form) return sendRedirect(event, afterSignupUrl(project, serializeLeadForm(project, row)), 303)
  setResponseStatus(event, 202)
  return { ok: true, pending }
})
