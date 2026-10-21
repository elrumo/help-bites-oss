defineRouteMeta({
  openAPI: {
    tags: ['Onboarding'], operationId: 'updateOnboardingFlow', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit an onboarding flow',
    description: 'Only the keys sent change. `steps` is the full list, in order (a step without an `id` is new). `style` and `options` merge key by key. `locale` is the language the flow is written in (default `en`); `translations` is `{ "es": { name, steps: { "<stepId>": { title, body, imageAlt, buttonLabel } } } }`, where a language you send replaces that language and `null` removes it (`POST …/translate` fills it with AI). Edits change the working copy only: apps keep the published version until you publish again. Changing `key` of a published flow moves its public URL, so apps that ask for the old key get a 404.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { name: 'Welcome', steps: [{ id: 'st_1', title: 'Welcome', body: 'Hello.', imageUrl: '', imageAlt: '', buttonLabel: 'Next' }], style: { radius: 12 } } } } } },
    responses: { 200: { description: 'The updated flow.' }, 400: { description: 'Invalid value.' }, 404: { description: 'Not found.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedOnboardingFlow(ctx, event)
  await updateOnboardingFlow(project, row, (await readBody(event).catch(() => ({}))) || {})
  return { flow: serializeOnboardingFlow(project, row) }
})
