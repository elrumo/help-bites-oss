defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Create a conversation type', operationId: 'createConversationType', security: [{ AgentSession: [] }, { AdminApiKey: [] }], description: 'Keys are unique per project. Status keys and field keys must also be unique; a select field needs options; one status is the default.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'project_123' } }], requestBody: { content: { 'application/json': { schema: { '$ref': '#/components/schemas/ConversationType', example: { key: 'report', name: 'Report', statuses: [{ key: 'open', label: 'Open', category: 'open', isDefault: true }, { key: 'reviewing', label: 'Reviewing', category: 'pending' }, { key: 'actioned', label: 'Actioned', category: 'resolved', isTerminal: true, reopenTo: 'open' }], fields: [{ key: 'reason', label: 'Reason', type: 'select', required: true, options: ['copyright', 'abuse'] }, { key: 'sourceUrl', label: 'Source URL', type: 'url' }], actions: [{ key: 'delete', label: 'Delete icon', destructive: true, statusAfter: 'actioned', requiresNote: true }], assignable: true, userCanReopen: true, defaultPriority: 'normal' } } } } }, responses: { 200: { description: 'Created type.', content: { 'application/json': { schema: { type: 'object', properties: { type: { '$ref': '#/components/schemas/ConversationType' } } } } } }, 400: { description: 'Invalid type definition.' }, 409: { description: 'Type key already exists.' } } } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const Parse = useParse()
  const type = new (Parse.Object.extend('ConversationType'))()
  type.set('project', project)
  applyConversationTypeInput(type, body)
  const duplicate = await new Parse.Query('ConversationType').equalTo('project', project).equalTo('key', type.get('key')).first(MASTER)
  if (duplicate) throw createError({ statusCode: 409, statusMessage: 'A type with that key already exists' })
  await type.save(null, MASTER)
  return { type: serializeConversationType(type) }
})
