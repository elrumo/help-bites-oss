import { readChangelogSubscribeInput } from '#shared/changelog'

defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'subscribeToChangelog', security: [{}, { EndUserToken: [] }],
    summary: 'Get emailed about the changelog',
    description: 'Two callers. **Signed in** (an identity token with an email claim): the account’s email is the address, whatever the body says; they are subscribed at once (`instant` or `weekly`), or unsubscribed with `off`. Answers `{ state, frequency }`. **Anonymous** (`?pk=` and an `email`): double opt-in. The address gets a confirm link (the `changelog-confirm` template) and nothing is active until it is clicked; the answer is always `{ ok: true }` whether or not the address is already subscribed, and a repeat inside a day sends no second mail. Instant mails go once a burst of publishes goes quiet; weekly ones on Monday. 404 unless the project has `changelog.notify` on. An anonymous **browser form** (`application/x-www-form-urlencoded`, what the Pages block "Changelog sign-up" posts, with an optional empty `website` honeypot field) is answered with a small HTML page instead of JSON.',
    parameters: [{ name: 'pk', in: 'query', schema: { type: 'string' }, description: 'Project public key (anonymous callers)' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['frequency'], properties: { frequency: { type: 'string', enum: ['instant', 'weekly', 'off'], description: '`off` is for a signed-in user only; an anonymous address unsubscribes with the link in its mails' }, email: { type: 'string', description: 'Anonymous callers only' } } } } } },
    responses: { 200: { description: 'Signed in: `{ state: "active" | "unsubscribed", frequency }`. Anonymous: `{ ok: true }`.' }, 400: { description: 'Invalid frequency or address, or the account has no email.' }, 404: { description: 'Unknown project, or no notifications.' }, 429: { description: 'Too many requests.' }, 503: { description: 'Notifications are not configured on this server.' } }
  }
})

export default defineEventHandler(async (event) => {
  const form = String(getHeader(event, 'content-type') || '').startsWith('application/x-www-form-urlencoded')
  const body = await readBody(event).catch(() => ({}))
  const { frequency, email, errors } = readChangelogSubscribeInput(body)
  // A form gets a page back (the visitor is on a page of ours, not a script), a script gets JSON.
  const answer = async (status: number, title: string, message: string, project?: ParseObject | null) => {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, status)
    return messagePage(project ? pageBrand(project, await poweredByFor(project)) : { name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }, title, message)
  }
  if (errors.length) {
    if (form) return await answer(400, 'Check the address', 'Enter a valid email address and try again.')
    throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  }
  setHeader(event, 'Cache-Control', 'no-store')

  const token = optionalBearer(event)
  if (token.startsWith('sk_') || token.startsWith('r:') || token.startsWith('ak_')) throw createError({ statusCode: 401, statusMessage: 'A reader subscribes: send their identity token, or ?pk= and an email' })
  if (token) {
    const { project, claims } = await verifyEndUserToken(event, token)
    requireChangelogNotify(project)
    return await subscribeSignedIn(project, claims, frequency)
  }

  await rateLimit(`sb:rl:clsub:${clientIp(event) || 'ip'}`, 10, 3600)
  const pk = String(getQuery(event).pk || getHeader(event, 'x-project-key') || '').trim()
  const project = pk ? await findProjectByPublicKey(pk) : null
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  requireChangelogNotify(project)
  if (frequency === 'off') throw createError({ statusCode: 400, statusMessage: 'Use the unsubscribe link in any email to stop them' })
  const sent = () => answer(200, 'Check your inbox', 'We sent you a link to confirm. Once you click it, you will get an email when something new ships.', project)
  // A bot filled the field a person cannot see: look done, do nothing.
  if (form && typeof (body as Record<string, unknown>).website === 'string' && (body as Record<string, unknown>).website) return await sent()
  try {
    await subscribeAnonymous(project, email, frequency)
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode || 500
    if (!form || (status >= 500 && status !== 503)) throw error
    return await answer(status, 'Could not sign you up', (error as { statusMessage?: string }).statusMessage || 'Try again in a little while.', project)
  }
  return form ? await sent() : { ok: true }
})
