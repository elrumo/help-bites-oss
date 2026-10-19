import { normalizeEmail } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'startAnonymousSession',
    summary: 'Start an email-only session (public)',
    description: 'For an app that has no backend to sign identity tokens, when the project allows email-only users (Project settings). Send the project\'s public key and the person\'s email. A new address gets a session token at once (`200`, use it as the Bearer token on every end-user route; keep it, the person does not need to enter their email again). An address that is already known never gets a token from this call: it gets a 6-digit code by email (`202 { status: "code_sent" }`), and POST /v1/anonymous/verify/confirm trades the code for a token. After a few writes an unverified person gets `403` with `data.code = "email_verification_required"` and must do the same.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['pk', 'email'], properties: { pk: { type: 'string' }, email: { type: 'string', format: 'email' }, name: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ status: "token", token, externalId, verified: false }`' }, 202: { description: '`{ status: "code_sent" }`' }, 400: { description: 'Not an email address.' }, 403: { description: 'The project does not allow email-only users.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many sessions from this address.' } }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'Send a JSON object' })
  const project = await findProjectByPublicKey(String(body.pk || ''))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const email = normalizeEmail(body.email)
  if (!email) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  const result = await startAnonymousSession(event, project, { email, name: String(body.name || '').trim().slice(0, 120) })
  if (result.status === 'code_sent') {
    setResponseStatus(event, 202)
    return { status: 'code_sent' }
  }
  return { status: 'token', token: result.token, externalId: result.externalId, verified: result.verified }
})
