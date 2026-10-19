defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'getFeedbackPreferences', security: [{ EndUserToken: [] }],
    summary: 'Your feedback email preference',
    responses: { 200: { description: 'Whether status, comment and mention emails are on.', content: { 'application/json': { schema: { type: 'object', properties: { emails: { type: 'boolean' } } } } } }, 401: { description: 'Sign in first.' } }
  }
})

export default defineEventHandler(async (event) => {
  return await getFeedbackPreferences(await resolveFeedbackContext(event, { requireActor: true }))
})
