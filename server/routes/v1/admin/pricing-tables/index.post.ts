defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'createPricingTable', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a pricing table',
    description: 'Creates a draft. `template` is `tiers` (cards side by side, the default), `rows` (one compact row per plan), `paywall` (a mobile paywall: selectable price rows and one button), `matrix` (a comparison table) or `spotlight` (one wide plan); the draft starts with example plans and features that fit it unless you send `plans` and `features`. `key` is the name apps ask for the table by; left out, it is made from `name`. A project has at most 50 tables, a table at most 6 plans and 40 feature rows. The fields are those of `PATCH`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project'], example: { project: 'p1', name: 'Pricing', key: 'pricing', template: 'tiers' } } } } },
    responses: { 200: { description: '`{ table }`: the new draft.' }, 400: { description: 'Invalid value.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await pricingProject(ctx, event, body)
  const row = await createPricingTable(project, body)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
