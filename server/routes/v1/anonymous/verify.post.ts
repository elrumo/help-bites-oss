import { normalizeEmail } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'sendAnonymousCode',
    summary: 'Email a verification code (public)',
    description: 'Mails a 6-digit code (valid 10 minutes) to an address that has an email-only user in this project. Always `202`: the answer never says whether the address is known, and a few mails per address a day are sent at most. Enter the code with POST /v1/anonymous/verify/confirm.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['pk', 'email'], properties: { pk: { type: 'string' }, email: { type: 'string', format: 'email' } } } } } },
    responses: { 202: { description: '`{ ok: true }`' }, 400: { description: 'Not an email address.' }, 403: { description: 'The project does not allow email-only users.' }, 404: { description: 'Unknown project.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw createError({ statusCode: 400, statusMessage: 'Send a JSON object' })
  const project = await findProjectByPublicKey(String(body.pk || ''))
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const email = normalizeEmail(body.email)
  if (!email) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  await requestAnonymousCode(event, project, email)
  setResponseStatus(event, 202)
  return { ok: true }
})
