defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'startGuestSession',
    summary: 'Start a guest session (public)',
    description: 'For a visitor who has no account and gave no email address, when the project\'s admin opened guest access (Project settings → Guest access, `guestSurfaces` on the public project config). Send the project\'s public key; the answer is a session token (`eu_…`) to use as the Bearer token on the end-user routes of the opened surfaces (`chat`, `feedback`, `comments`). Keep the token: a new call makes a new guest. A guest has no email (no reply mail), cannot upload files, is limited to the opened surfaces (`403` with `data.code = "guest_not_allowed"` elsewhere), has tighter write limits than other users, and the session expires after 30 days without use. Minting is limited per IP and per project (`429`).',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['pk'], properties: { pk: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ token, externalId, name, surfaces }`' }, 403: { description: 'The project does not allow guests.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many guest sessions from this address or project.' } }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'Send a JSON object' })
  const project = await findProjectByPublicKey(String(body.pk || ''))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  return startGuestSession(event, project)
})
