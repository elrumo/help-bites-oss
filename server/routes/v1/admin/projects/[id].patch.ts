defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'updateProject', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Update a project',
    description: 'Updates supplied project settings. `actionWebhookSecret` is write-only; a blank value clears it, while omission preserves it. The URL must be http(s). `hiddenSections` replaces the whole list. `board` is partial: only the keys sent change (`roadmap` merges key by key), while `statuses` and `labels` replace their whole lists.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', example: 'Acme' }, allowedOrigins: { type: 'array', items: { type: 'string', format: 'uri' } }, siteUrl: { type: 'string', format: 'uri' }, inboxPath: { type: 'string', example: '/messages' }, fromName: { type: 'string', example: 'Acme Support' }, notifyEmails: { oneOf: [{ type: 'string', example: 'ops@example.com, support@example.com' }, { type: 'array', items: { type: 'string', format: 'email' } }] }, allowAttachments: { type: 'boolean' }, allowAnonymousUsers: { type: 'boolean', description: 'Let people use chat and feedback with only an email address (POST /v1/anonymous/session).' }, hiddenSections: { type: 'array', items: { type: 'string', enum: ['conversations', 'knowledge', 'assistants', 'types', 'feedback', 'board', 'changelog', 'onboarding', 'contacts', 'forms', 'email', 'revenue', 'pages', 'blog', 'legal', 'brand', 'errors', 'flags', 'dev'] }, description: 'Sections left out of the project\'s sidebar and the ⌘K list (replaces the list). Their pages and API keep working. `overview` and `settings` cannot be hidden; unknown names are a 400. See docs/OVERVIEW.md.' }, actionWebhookUrl: { type: 'string', format: 'uri', example: 'https://api.example.com/helpbites/actions' }, actionWebhookSecret: { type: 'string', writeOnly: true, example: 'replace-with-a-secret-of-at-least-16-characters' }, board: { '$ref': '#/components/schemas/BoardConfig' }, blog: { '$ref': '#/components/schemas/BlogConfig' }, flags: { type: 'array', description: 'Replaces every feature flag of the project (see GET /v1/flags).', items: { type: 'object', required: ['key'], properties: { key: { type: 'string', example: 'ai_chat' }, description: { type: 'string' }, state: { type: 'string', enum: ['off', 'admins', 'on'], default: 'off' }, fallback: { type: 'string', enum: ['off', 'admins', 'on'], default: 'off' }, targets: { type: 'array', items: { type: 'string' } }, allow: { type: 'array', items: { type: 'string' }, description: 'User ids or emails treated as admins' } } } } }, example: { actionWebhookUrl: 'https://api.example.com/helpbites/actions', actionWebhookSecret: 'replace-with-a-secret-of-at-least-16-characters' } } } } },
    responses: { 200: { description: 'Updated project. Webhook secrets are never returned.', content: { 'application/json': { schema: { type: 'object', properties: { project: { type: 'object' } } } } } }, 400: { description: 'Invalid URL, webhook secret, flags or board settings.' }, 401: { description: 'Admin session or API key required.' }, 402: { description: 'Setting an event webhook URL, which the plan does not include.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const project = await requireProject(ctx, getRouterParam(event, 'id') || '')
  await applyProjectInput(project, (await readBody(event).catch(() => ({}))) as Record<string, unknown>)
  await project.save(null, MASTER)
  forgetProject(String(project.get('publicKey')))
  return { project: serializeAdminProject(project) }
})
