defineRouteMeta({
  openAPI: {
    tags: ['Blog'], operationId: 'writeBlogPostWithAi', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Write a blog post with AI',
    description: 'Reads the project\'s connected GitHub repos (read-only, three at most: `repos` names them, else all), the post as it stands and your `instruction`, and proposes Markdown. `mode`: `write` (a whole post: title, excerpt, meta description, tags and body), `continue` (text to add after `body`), `improve` (`body` rewritten, same meaning) or `meta` (title, excerpt, meta description and tags for the `body`). Nothing is saved: send what you keep as a `POST` or `PATCH` on the post. Uses the workspace\'s AI provider, or the server\'s gateway (metered in AI credits). Six requests a minute per operator.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'mode'], properties: {
      project: { type: 'string' },
      mode: { type: 'string', enum: ['write', 'continue', 'improve', 'meta'] },
      instruction: { type: 'string', maxLength: 2000, description: 'What the post is about, or how to change it' },
      title: { type: 'string', maxLength: 200 },
      body: { type: 'string', description: 'The post\'s Markdown so far; required for `continue`, `improve` and `meta`' },
      repos: { type: 'array', items: { type: 'string' }, description: 'owner/name of linked repos to read; all of them when left out' }
    } }, example: { project: 'abc123', mode: 'write', instruction: 'Announce our new offline mode, for a technical audience.' } } } },
    responses: { 200: { description: '`{ result: { body, title, excerpt, metaDescription, tags, notes, repos: [{ repo, read }] } }`. Fields a mode does not produce are empty.' }, 400: { description: 'Nothing to go on, or an unknown mode.' }, 404: { description: 'Project not found.' }, 429: { description: 'Too many requests.' }, 501: { description: 'No AI provider is configured.' }, 502: { description: 'The AI provider failed or answered with something unusable.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = ((await readBody(event).catch(() => ({}))) || {}) as Record<string, unknown>
  const project = await blogProject(ctx, event, body)
  return { result: await suggestBlogText(ctx, project, body) }
})
