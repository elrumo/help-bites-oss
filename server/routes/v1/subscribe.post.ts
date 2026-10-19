import { normalizeMarketingConfig } from '#shared/marketing'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'subscribe',
    summary: 'Newsletter sign-up (public)',
    description: 'For your site\'s sign-up form, from the browser: no secret, the project\'s public key (`pk`). JSON, or a plain HTML form (`application/x-www-form-urlencoded`), which is redirected to the project\'s thank-you URL (or HelpBites\' own page). With double opt-in (the default) the person gets a confirmation email and stays `pending` until they click it. `topics` picks which of the project\'s topics they want (default: all); an address already subscribed keeps its topics, and a different choice emails it the link to its preferences page instead. Add an empty `website` field hidden from people: bots fill it in. Always 202: the answer never says whether the address was known.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['pk', 'email'], properties: { pk: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } }, website: { type: 'string', description: 'Honeypot: leave empty.' } } } } } },
    responses: { 202: { description: '`{ ok: true, pending }`' }, 400: { description: 'Not an email address.' }, 402: { description: 'Sign-ups are closed for now (the workspace is at its plan\'s contact limit).' }, 403: { description: 'A browser form from a site not in the project\'s allowed origins.' }, 429: { description: 'Too many sign-ups from this address.' } }
  }
})

export default defineEventHandler(async (event) => {
  const form = String(getHeader(event, 'content-type') || '').startsWith('application/x-www-form-urlencoded')
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'Send a JSON object or a form' })
  const project = await findProjectByPublicKey(String(body.pk || ''))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const own = (() => { try { return publicBaseUrl() } catch { return '' } })()
  if (!signupOriginAllowed(String(getHeader(event, 'origin') || ''), (project.get('allowedOrigins') as string[] | undefined) || [], own)) throw createError({ statusCode: 403, statusMessage: 'This site may not sign people up for this project' })

  let input: ReturnType<typeof readSignup>
  try {
    input = readSignup(body)
  } catch (error) {
    if (!form) throw error
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 400)
    return signupPage(project, { error: 'Enter a valid email address.', poweredBy: await poweredByFor(project) })
  }
  let pending: boolean
  try {
    ({ pending } = await handleSignup(event, project, input))
  } catch (error) {
    // Sign-ups closed by the plan's contact limit: a form gets its page back with the reason, like a bad address.
    if (!form || (error as { statusCode?: number }).statusCode !== 402) throw error
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, 402)
    return signupPage(project, { error: SIGNUPS_CLOSED, poweredBy: await poweredByFor(project) })
  }
  if (form) {
    const next = normalizeMarketingConfig(project.get('marketing')).confirmRedirectUrl
    return sendRedirect(event, next || `/s/${encodeURIComponent(String(project.get('publicKey')))}?sent=1`, 303)
  }
  setResponseStatus(event, 202)
  return { ok: true, pending }
})
