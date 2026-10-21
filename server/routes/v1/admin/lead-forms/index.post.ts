defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'createLeadForm', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a lead form',
    description: 'A waitlist or interest form, active at once. `preset` starts it from `email` (one email box and a button on one row, the default), `waitlist` (email and name) or `detailed` (email, name, company, role, a question); anything you send (`fields`, `content`, `style`, `settings`) replaces the preset\'s. `key` is the name sites ask for it by (lowercase letters, digits and dashes); left out, it is made from `name`. A segment of the form\'s leads is made with it, and with the project\'s first form an "All leads" segment. A project has at most 50 forms.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', name: 'Launch waitlist', preset: 'waitlist', settings: { doubleOptIn: true, welcomeTemplate: 'waitlist-welcome', tags: ['waitlist'] } } } } } },
    responses: { 200: { description: '`{ form }`' }, 400: { description: 'Invalid value.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await leadFormProject(ctx, event, body)
  const row = await createLeadForm(project, body)
  return { form: serializeLeadForm(project, row) }
})
