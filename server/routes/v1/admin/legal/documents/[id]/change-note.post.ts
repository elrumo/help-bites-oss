defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'suggestLegalChangeNote', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Suggest the note for the next version with AI',
    description: 'Compares the working text with the last published version and writes a one or two sentence note of what changed, to pass as `note` when publishing. Nothing is saved. 409 when nothing differs. Needs an AI provider (501 otherwise).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'The suggested note.', content: { 'application/json': { schema: { type: 'object', example: { note: 'Added Stripe as a payment provider.' } } } } }, 409: { description: 'Nothing differs from the last published version.' }, 501: { description: 'No AI provider configured.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { row } = await scopedLegalDocument(ctx, event)
  return { note: await suggestChangeNote(ctx, row) }
})
