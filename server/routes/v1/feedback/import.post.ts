defineRouteMeta({
  openAPI: {
    tags: ['Feedback'], operationId: 'importFeedback', security: [{ ProjectSecret: [] }],
    summary: 'Import or upsert posts (server to server)',
    description: 'Bring a board’s history over from another system, or publish entries from a release script. Up to 100 posts per call. A post with an `externalId` is upserted (re-running converges); its `votes` and `subscriptions` are synced to exactly the given user ids (without `subscriptions`, its author and commenters follow it), `reactions` to exactly the given map, and its `comments` upserted by their own `externalId` — threading (`parentExternalId`, `replyToExternalId`), `pinnedCommentExternalId` and `duplicateOfExternalId` refer to external ids too. Keep the old `number` to keep `#N` links; posts without one get the next free number, and the counter moves past every imported one. Authors are your user ids; with a name, email or username they become end users who can be emailed later (`emailOptOut` carries an opt-out over). `createdAt`, `editedAt` and `completedAt` take ISO strings or Parse `{ iso }` dates. Never sends notifications. Not transactional: failures are reported per index; a duplicate whose target is not imported yet fails after everything else landed, so import targets first or re-run.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['posts'], properties: { posts: { type: 'array', maxItems: 100, items: { type: 'object', required: ['title'], properties: {
      externalId: { type: 'string', example: 'legacy:8Jd2kQ' }, number: { type: 'integer', example: 12 }, title: { type: 'string' }, body: { type: 'string' }, type: { type: 'string' }, platform: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, status: { type: 'string' },
      author: { type: 'object', nullable: true, properties: { externalId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, username: { type: 'string' }, avatarUrl: { type: 'string' }, emailOptOut: { type: 'boolean' } } }, isTeam: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' }, editedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' },
      hidden: { type: 'boolean' }, featured: { type: 'boolean' }, locked: { type: 'boolean' }, showOnChangelog: { type: 'boolean' }, changelogTitle: { type: 'string' }, changelogBody: { type: 'string' }, shippedIn: { type: 'string' }, icon: { type: 'string' }, adminNote: { type: 'string' }, metadata: { type: 'object' },
      pinnedCommentExternalId: { type: 'string' }, duplicateOfExternalId: { type: 'string' },
      reactions: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } }, example: { '+1': ['user_1'], heart: ['user_2'] }, description: 'Reaction key → user ids' },
      votes: { type: 'array', items: { type: 'string' }, description: 'Voter user ids' },
      subscriptions: { type: 'array', items: { type: 'object', properties: { externalId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, username: { type: 'string' }, avatarUrl: { type: 'string' }, emailOptOut: { type: 'boolean' }, muted: { type: 'boolean' }, lastReadAt: { type: 'string', format: 'date-time' } } } },
      comments: { type: 'array', items: { type: 'object', required: ['body'], properties: { externalId: { type: 'string' }, body: { type: 'string' }, author: { type: 'object' }, isTeam: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, editedAt: { type: 'string', format: 'date-time' }, visibility: { type: 'string', enum: ['public', 'internal', 'hidden'] }, parentExternalId: { type: 'string' }, replyToExternalId: { type: 'string' }, reactions: { type: 'object' } } } }
    } } } } } } } },
    responses: { 200: { description: 'Per-post results.', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, id: { type: 'string' }, externalId: { type: 'string' }, created: { type: 'boolean' } } } }, failed: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, message: { type: 'string' } } } } } } } } }, 400: { description: 'No posts, or more than 100.' }, 401: { description: 'Project secret required.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await requireProjectSecret(event)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const posts = Array.isArray(body?.posts) ? body.posts : []
  if (!posts.length || posts.length > 100) throw createError({ statusCode: 400, statusMessage: 'Send between 1 and 100 posts' })

  const config = getFeedbackConfig(project)
  const results: { index: number, id: string, externalId: string, created: boolean }[] = []
  const failed: { index: number, message: string }[] = []
  for (const [index, item] of posts.entries()) {
    try {
      const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const { id, created } = await importFeedbackPost(project, config, raw)
      results.push({ index, id, externalId: typeof raw.externalId === 'string' ? raw.externalId : '', created })
    } catch (error) {
      failed.push({ index, message: (error as Error)?.message || 'Could not import this post' })
    }
  }
  if (results.length) await raiseFeedbackNumberCounter(project)
  return { results, failed }
})
