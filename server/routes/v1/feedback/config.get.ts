defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'getFeedbackConfig', security: [{}, { EndUserToken: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Board configuration',
    description: 'Statuses (with their categories and colours), post types, platforms and board options — everything a custom UI needs to render filters and forms — plus the project’s name and theme, the viewer, and where the roadmap comes from. `?pk=` or a token, like the list.',
    parameters: [{ name: 'pk', in: 'query', schema: { type: 'string' } }, { name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id (operators only)' }],
    responses: { 200: { description: 'Board configuration.', content: { 'application/json': { schema: { type: 'object', properties: { config: { '$ref': '#/components/schemas/FeedbackBoardConfig' }, project: { type: 'object', properties: { name: { type: 'string' }, publicKey: { type: 'string' }, theme: { type: 'object' }, brandLogoUrl: { type: 'string' }, poweredBy: { type: 'object', nullable: true, properties: { url: { type: 'string', format: 'uri' } }, description: 'The "Powered by HelpBites" link to show, or null when the plan removes the branding.' } } }, viewer: { '$ref': '#/components/schemas/FeedbackViewer' }, roadmapSource: { type: 'string', enum: ['board', 'posts'], description: '`board` when the project board drives the roadmap (read it from GET /v1/feedback/roadmap); `posts` when the roadmap lists posts (`GET /v1/feedback?view=roadmap`)' } } } } } }, 404: { description: 'Unknown project, or the board is not enabled.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await resolveFeedbackContext(event)
  const project = serializePublicProject(ctx.project)
  // A project board, when on, is what the Roadmap view shows; otherwise it lists posts.
  const roadmapSource = getBoardConfig(ctx.project).enabled ? 'board' : 'posts'
  return { config: ctx.config, roadmapSource, project: { name: project.name, publicKey: project.publicKey, theme: project.theme, brandLogoUrl: project.brandLogoUrl, allowedOrigins: project.allowedOrigins, poweredBy: await poweredByFor(ctx.project) }, viewer: feedbackViewer(ctx.actor) }
})
