defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'streamFeedbackEvents', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Live board events (SSE)',
    description: 'Server-sent events for one board: `feedback.post.created`, `feedback.post.updated` (votes, status, edits), `feedback.post.deleted`, `feedback.comment.created`, `feedback.comment.deleted`, and `ping` every few seconds. Posts in events carry no viewer fields (`hasVoted`, `isMine`, …) — merge them over your local copy. A post an admin hides arrives as `feedback.post.deleted` for everyone else. `?pk=` works with `EventSource`; with a token use fetch + a stream reader.',
    parameters: [{ name: 'pk', in: 'query', schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' }],
    responses: { 200: { description: 'An open `text/event-stream`.', content: { 'text/event-stream': { schema: { type: 'string', example: 'event: feedback.post.updated\ndata: {"type":"feedback.post.updated","postId":"p_123","post":{"voteCount":12}}\n' } } } } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event)
  const projectId = ctx.project.id || ''
  const admin = isFeedbackAdmin(ctx.actor)
  return streamFeedbackEvents(event, projectId, e => (e.projectId === projectId ? feedbackEventForViewer(e, admin) : null))
})
