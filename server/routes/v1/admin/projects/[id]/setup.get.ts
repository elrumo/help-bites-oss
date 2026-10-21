defineRouteMeta({
  openAPI: {
    tags: ['Agent'], operationId: 'getProjectSetup', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Project setup checklist',
    description: 'What is wired up in one project, judged from state HelpBites has seen rather than boxes ticked: the chat widget loaded on your site, a signed identity token accepted, someone who gets notified, a sender mail can go out from, an assistant that is live, Stripe synced, a GitHub repo linked, an error tracker connected. Rows for a section the project hides are left out, and an agent is not shown Stripe. Each row has a `state` (`done`, `todo`, `attention`), a `reason` code and a `value` to word it with. See docs/OVERVIEW.md.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: {
        description: 'The checklist.',
        content: { 'application/json': { example: {
          done: 2, total: 3,
          items: [
            { key: 'widget', state: 'done', reason: 'seen', value: '2026-10-21T08:00:00.000Z', section: 'dev', optional: false },
            { key: 'identity', state: 'todo', reason: 'missing', value: '', section: 'dev', optional: false },
            { key: 'sender', state: 'done', reason: 'ready', value: 'hello@mail.acme.app', section: 'email?view=settings', optional: false }
          ]
        } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event)
  return projectSetup(ctx, await requireProject(ctx, getRouterParam(event, 'id') || ''))
})
