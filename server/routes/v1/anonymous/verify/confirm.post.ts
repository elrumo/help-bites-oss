import { normalizeEmail } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'confirmAnonymousCode',
    summary: 'Confirm an email address with its code (public)',
    description: 'Trades the 6-digit code for a verified session. Every earlier session of that address ends, so replace the stored token with the one returned. A wrong or expired code is `400`; five wrong guesses lock the code (`429`, ask for a new one).',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['pk', 'email', 'code'], properties: { pk: { type: 'string' }, email: { type: 'string', format: 'email' }, code: { type: 'string', example: '123456' } } } } } },
    responses: { 200: { description: '`{ status: "token", token, externalId, verified: true }`' }, 400: { description: 'Wrong or expired code.' }, 403: { description: 'The project does not allow email-only users.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many attempts.' } }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'Send a JSON object' })
  const project = await findProjectByPublicKey(String(body.pk || ''))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const email = normalizeEmail(body.email)
  if (!email) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  const result = await confirmAnonymousCode(event, project, email, String(body.code || ''))
  return { status: 'token', token: result.token, externalId: result.externalId, verified: true }
})
