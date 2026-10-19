import { isRole } from '#shared/roles'

defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Invite someone',
    description: 'Emails an invitation link (when email sending is set up) and returns it either way, valid for 7 days. Inviting the same address again replaces the old link.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['owner', 'admin', 'agent'], default: 'agent' } } } } } },
    responses: { 200: { description: '{ invitation, url, emailed }' }, 402: { description: 'The plan\'s teammate limit is reached (pending invitations count).' }, 403: { description: 'The workspace owner has not confirmed their email address yet (`email_unverified`), where the edition asks for it.' }, 409: { description: 'Already a member' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'team.manage' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const email = String(body.email || '').trim().toLowerCase()
  if (!isProbablyEmail(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  return createInvitation(ctx, { email, role: isRole(body.role) ? body.role : 'agent' })
})
