defineRouteMeta({
  openAPI: {
    tags: ['Pricing'], operationId: 'stopPricingExperiment', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'End an A/B test',
    description: 'Everyone sees this table again; the run\'s numbers are kept. With `adopt` (a variant\'s key), the variant\'s working copy (template, plans, features, words, look, checkout and translations) becomes this table\'s working copy, to publish when you are ready: the winner goes live under the key your site and app already use.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { adopt: { type: 'string' } } }, example: { adopt: 'pricing-b' } } } },
    responses: { 200: { description: '`{ table }`' }, 400: { description: 'No test is running, or `adopt` is not one of its variants.' }, 404: { description: 'Not found.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const { project, row } = await scopedPricingTable(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  await stopPricingExperiment(project, row, body.adopt)
  return { table: await serializePricingTable(project, row, await projectCatalog(project), event) }
})
