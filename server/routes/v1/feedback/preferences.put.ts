defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'setFeedbackPreferences', security: [{ EndUserToken: [] }],
    summary: 'Turn feedback email on or off',
    description: '`{ "emails": false }` stops every feedback email to this user on this board (status changes, comments, mentions); following still tracks `unread`.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['emails'], properties: { emails: { type: 'boolean' } } } } } },
    responses: { 200: { description: 'The saved preference.', content: { 'application/json': { schema: { type: 'object', properties: { emails: { type: 'boolean' } } } } } }, 401: { description: 'Sign in first.' } }
  }
})

export default defineEventHandler(async (event) => {
  return await setFeedbackPreferences(await resolveFeedbackContext(event, { requireActor: true }), await readBody(event).catch(() => ({})))
})
