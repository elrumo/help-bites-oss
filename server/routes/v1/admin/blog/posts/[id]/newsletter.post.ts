defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'sendBlogNewsletter', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Send a post as a newsletter',
    description: 'Emails a published post to the project\'s subscribers as a campaign (it then shows under Campaigns, with test sends, pause, cancel and its numbers). The email is built from the post when sending starts: the logo, title, cover, body, a button to the post and a footer with the unsubscribe link and the postal address, which must be set under Campaigns → Settings. The audience is subscribed contacts with an email: `audience.topic` (default: the blog\'s `newsletterTopic`) leaves out anyone who opted out of it, `audience.segment` narrows it. `send`: `now`, `schedule` (with `scheduledAt`), or omit it for a draft to test first. A post goes out once; a draft campaign is reused, and only a canceled one can be replaced. Needs a plan with campaigns.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
      subject: { type: 'string', description: 'Defaults to the post\'s title' },
      name: { type: 'string', description: 'The campaign\'s name; defaults to "Blog: <title>"' },
      audience: { type: 'object', properties: { topic: { type: 'string' }, segment: { type: 'string' } } },
      send: { type: 'string', enum: ['now', 'schedule', 'draft'] },
      scheduledAt: { type: 'string', format: 'date-time' },
      testMode: { type: 'boolean', description: 'Mailgun accepts and logs every message but delivers none.' }
    } }, example: { send: 'now', audience: { topic: 'blog' } } } } },
    responses: { 200: { description: '`{ campaign, post }`' }, 400: { description: 'The post is not live, or the campaign is missing its postal address or a public address.' }, 402: { description: 'The plan does not include campaigns.' }, 404: { description: 'Post, topic or segment not found.' }, 409: { description: 'The post already went out as a newsletter.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'marketing' })
  const row = await scoped.blogPost(ctx, getRouterParam(event, 'id') || '')
  const project = await requireProject(ctx, pointerId(row.get('project')))
  const campaign = await createBlogNewsletter(project, row, await readBody(event).catch(() => ({})))
  return { campaign: serializeCampaign(campaign), post: serializeBlogPost(project, row) }
})
