import { isRole } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Change a teammate\'s role',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['owner', 'admin', 'agent'] } } } } } },
    responses: { 200: { description: '{ agent }' }, 400: { description: 'The workspace would lose its last owner' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  assertSession(ctx)
  const { role } = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  if (!isRole(role)) throw createError({ statusCode: 400, statusMessage: 'role must be owner, admin or agent' })
  const agent = await setMemberRole(ctx, getRouterParam(event, 'id') || '', role)
  await auditAccess(ctx, event, 'member.role', getRouterParam(event, 'id') || '', { role })
  return { agent }
})
