defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Delete this workspace',
    description: 'Closes the workspace at once (its widget, API, feedback board and changelog stop answering) and deletes everything in it in the background: projects, conversations, contacts, knowledge, emails, files and search data. Accounts stay. `confirm` must be the workspace\'s name, exactly. Owners only; it can\'t be undone.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', description: 'The workspace\'s name' } } } } } },
    responses: { 200: { description: '`{ deleting: true }`' }, 400: { description: '`confirm` is not the workspace\'s name.' }, 403: { description: 'Not the owner.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'workspace.delete' })
  assertSession(ctx)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (!confirmsDeletion(ctx.workspace, body?.confirm)) throw createError({ statusCode: 400, statusMessage: 'Type the workspace\'s name exactly to delete it' })
  await deleteWorkspace(ctx, clientIp(event))
  return { deleting: true }
})
