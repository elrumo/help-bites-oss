defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'generateLegalTldr', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Write the TL;DR summary with AI',
    description: 'Writes a short plain-language summary shown at the top of the public page and marks it `ai`. A summary written by a person is never replaced unless `force: true` (409 otherwise). Edit or write your own with PATCH `tldr`. Needs an AI provider (501 otherwise).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { force: false } } } } },
    responses: { 200: { description: 'The document with its new summary.' }, 409: { description: 'A person wrote the current summary.' }, 501: { description: 'No AI provider configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLegalDocument(ctx, event)
  const body = (await readBody(event).catch(() => ({}))) || {}
  await generateTldr(ctx, row, body.force === true)
  return { document: serializeLegalDocument(project, row) }
})
