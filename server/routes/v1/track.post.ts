import { EVENT_NAME_RE } from '#shared/marketing'
import { readContactInput } from '#shared/contacts'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'trackEvent', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Report something a user did',
    description: 'Server to server. Starts every active sequence whose trigger is this event (`trial_started`, `purchase`, …). `contact` is `{ externalId }` or `{ email }` (with `name`, `attributes` to update them on the way); someone HelpBites does not know yet is added as a contact. Events themselves are not stored: keep state in attributes.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['event', 'contact'], properties: { event: { type: 'string' }, contact: { type: 'object' }, project: { type: 'string' } } }, example: { event: 'trial_started', contact: { externalId: 'u_42', email: 'ada@example.com', attributes: { plan: 'trial' } } } } } },
    responses: { 200: { description: '`{ contact: { id }, enrolled }` — how many sequences it started.' }, 400: { description: 'No event name, or no contact.' }, 402: { description: 'A new contact would pass the plan\'s contact limit.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const name = String(body.event || '').trim()
  if (!EVENT_NAME_RE.test(name)) throw createError({ statusCode: 400, statusMessage: 'event must be a name such as trial_started' })
  const { input, errors } = readContactInput(body.contact)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  // Consent is never set by an event.
  delete input.subscription
  const [result] = await upsertContacts(project, [input], { via: 'api' })
  if (!result || result.status === 'failed') throw createError({ statusCode: 400, statusMessage: result?.error || 'Could not save the contact' })
  const contact = await getProjectContact(project, result.id)
  return { contact: { id: contact.id }, enrolled: await enrollOnEvent(project, contact, name) }
})
