defineRouteMeta({
  openAPI: {
    tags: ['End user'], operationId: 'eraseAnonymousSelf', security: [{ EndUserToken: [] }],
    summary: 'Delete my data (email-only session)',
    description: 'Erases everything the caller left in this project: conversations and messages, feedback posts, comments, votes, and the record itself. Only for an `eu_…` session; users that a host signs in erase through the host\'s DELETE /v1/end-users/{externalId}.',
    responses: { 200: { description: '`{ erased: { … counts } }`' }, 401: { description: 'Invalid session.' }, 403: { description: 'Not an email-only session.' } }
  }
})

export default defineEventHandler(async (event) => {
  const { project, claims, endUser } = await requireEndUser(event)
  if (!claims.anon) throw createError({ statusCode: 403, statusMessage: 'Only an email-only session can erase itself' })
  if (!endUser) return { erased: {} }
  return { erased: await eraseEndUserData(project, endUser) }
})
