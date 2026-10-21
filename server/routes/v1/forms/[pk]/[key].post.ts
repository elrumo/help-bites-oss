import type { H3Event } from 'h3'
import { leadFieldsOf, leadFormMaxBytes, type LeadFormField, type UploadedLeadFile } from '#shared/leadForms'

defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'submitLeadForm', security: [],
    summary: 'Sign up through a lead form (public)',
    description: 'From the browser or an app: no secret, the project\'s public key. Send each field\'s answer under its `key` (`email` always; `name`; anything else is saved as that contact attribute; a choice takes one of its `options`, or what it showed in the language used). JSON, or a plain HTML form (`application/x-www-form-urlencoded`), which is redirected to the form\'s `redirectUrl` (or HelpBites\' own thank-you page). A form with a `file` field takes `multipart/form-data`: each file as a part named by its field key, everything else as text parts; it needs a `Content-Length` and may weigh no more than its file fields allow plus 1 MB. Files are checked by their contents (`accept`, `maxMB`) and kept privately for the team. A browser\'s own multipart form post (one that accepts `text/html`) is redirected like a plain form. Send `locale` (or `Accept-Language`) for errors, pages and emails in that language. The person becomes (or stays) a contact, tagged with the form\'s tags and counted in its segment. With double opt-in they get a confirmation email and stay `pending` until they click it; then, or right away without it, the form\'s welcome email goes out and they start its sequence. Add an empty `website` field hidden from people: bots fill it in. After the answers check out it is always 202, whether or not the address was known.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], additionalProperties: true, properties: { email: { type: 'string' }, name: { type: 'string' }, locale: { type: 'string', description: 'The language the person used, such as `es`.' }, website: { type: 'string', description: 'Honeypot: leave empty.' } } }, example: { email: 'ada@example.com', name: 'Ada', company: 'Acme', locale: 'en' } }, 'multipart/form-data': { schema: { type: 'object', required: ['email'], additionalProperties: true, properties: { email: { type: 'string' }, locale: { type: 'string' } } } } } },
    responses: { 202: { description: '`{ ok: true, pending }`: `pending` means "check your inbox".' }, 400: { description: 'An answer or a file is missing or invalid; `data.errors` lists each, in the language used.' }, 402: { description: 'The form is closed for now (the workspace is at its plan\'s contact or storage limit).' }, 403: { description: 'A browser form from a site not in the project\'s allowed origins.' }, 404: { description: 'Unknown project, or no such active form.' }, 411: { description: 'A multipart body without a Content-Length.' }, 413: { description: 'The files are larger than the form takes.' }, 429: { description: 'Too many sign-ups from this address (or, as multipart, 20 in ten minutes).' } }
  }
})

/**
 * The body as JSON, a plain form, or multipart (each text part a string, each
 * file part kept by field key). A multipart body must say how long it is and
 * fit the form's file fields, so a large upload is refused before it is read.
 */
async function readSubmission(event: H3Event, fields: LeadFormField[]): Promise<{ body: Record<string, unknown>, files: Record<string, UploadedLeadFile> }> {
  if (!/^multipart\/form-data/i.test(String(getHeader(event, 'content-type') || ''))) {
    const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'Send a JSON object or a form' })
    return { body, files: {} }
  }
  const length = Number(getHeader(event, 'content-length') || 0)
  if (!length || length > leadFormMaxBytes(fields)) {
    // The body is never read, so the connection cannot carry another request.
    setResponseHeader(event, 'Connection', 'close')
    throw createError(length ? { statusCode: 413, statusMessage: 'The files are larger than this form takes' } : { statusCode: 411, statusMessage: 'A multipart body needs a Content-Length' })
  }
  await rateLimit(`sb:rl:formupload:${clientIp(event) || 'ip'}`, LIMITS.leadFormUploadsPerIp.limit, LIMITS.leadFormUploadsPerIp.window).catch((error) => {
    setResponseHeader(event, 'Connection', 'close')
    throw error
  })
  const body: Record<string, unknown> = {}
  const files: Record<string, UploadedLeadFile> = {}
  for (const part of await readMultipartFormData(event) || []) {
    const name = String(part.name || '')
    if (!name || name in body || name in files) continue
    if (part.filename !== undefined) files[name] = { filename: String(part.filename), data: new Uint8Array(part.data) }
    else body[name] = part.data.toString('utf8')
  }
  return { body, files }
}

export default defineEventHandler(async (event) => {
  const { project, row } = await findPublicLeadForm(getRouterParam(event, 'pk') || '', getRouterParam(event, 'key') || '')
  const own = (() => { try { return publicBaseUrl() } catch { return '' } })()
  if (!signupOriginAllowed(String(getHeader(event, 'origin') || ''), (project.get('allowedOrigins') as string[] | undefined) || [], own)) throw createError({ statusCode: 403, statusMessage: 'This site may not sign people up for this project' })
  const type = String(getHeader(event, 'content-type') || '')
  // A browser's own form post (not fetch): plain forms always, multipart when the browser asks for a page.
  const form = type.startsWith('application/x-www-form-urlencoded') || (type.startsWith('multipart/form-data') && String(getHeader(event, 'accept') || '').includes('text/html'))

  let body: Record<string, unknown> = {}
  let pending: boolean
  try {
    const read = await readSubmission(event, leadFieldsOf(row.get('fields')))
    body = read.body
    ;({ pending } = await submitLeadForm(event, project, row, body, read.files))
  } catch (error) {
    // A plain form gets its page back with the reason (and what was typed), like the hosted page.
    const status = (error as { statusCode?: number }).statusCode || 500
    if (!form || ![400, 402, 411, 413].includes(status)) throw error
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseStatus(event, status)
    return leadFormPage(project, row, { error: (error as { statusMessage?: string }).statusMessage || 'Check the form and try again.', values: body, poweredBy: await poweredByFor(project), wanted: wantedLocales(event, body) })
  }
  if (form) {
    const saved = serializeLeadForm(project, row)
    return sendRedirect(event, afterSignupUrl(project, saved, localizedLeadForm(saved, wantedLocales(event, body)).locale), 303)
  }
  setResponseStatus(event, 202)
  return { ok: true, pending }
})
