defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'createOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create an onboarding flow',
    description: 'Creates a draft with three starter steps unless you send `steps`. `key` is the name apps ask for the flow by (lowercase letters, digits and dashes); left out, it is made from `name`. A project has at most 50 flows, a flow at most 12 steps.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', name: 'Welcome', key: 'welcome', steps: [{ title: 'Welcome to Acme', body: 'Track every order in one place.', imageUrl: 'https://cdn.acme.test/welcome.png', imageAlt: 'The orders screen', buttonLabel: '' }], style: { accent: '#0ea5e9', radius: 20, font: 'rounded' }, options: { skippable: true, progress: 'dots' } } } } } },
    responses: { 200: { description: 'The new draft.' }, 400: { description: 'Invalid value.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await onboardingProject(ctx, event, body)
  const row = await createOnboardingFlow(project, body)
  return { flow: serializeOnboardingFlow(project, row) }
})
