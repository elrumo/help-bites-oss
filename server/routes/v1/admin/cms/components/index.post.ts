defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'createCmsComponent', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a component',
    description: 'A component is a schema and, optionally, an HTML and CSS template for hosted pages (see docs/PAGES.md for the `{{@field}}` syntax). Leave `html` empty for a data-only component your own app renders. `key` is 1 to 40 lowercase letters, digits, `_` and `-`, unique in the project and not a built-in\'s. Field types: text, textarea, markdown, number, boolean, color, url, date, select (with `options`), asset, blocks (with `allow`: the component keys it takes; empty takes any nestable one). Templates are HTML and CSS only: scripts, `on…` handlers and `javascript:` links are refused. A project has at most 200 components.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['project', 'key', 'name'], example: { project: 'p1', key: 'banner', name: 'Banner', nestable: true, fields: [{ key: 'text', type: 'text', label: 'Text', default: 'Hello' }, { key: 'link', type: 'url' }], html: '<a class="banner" href="{{@link}}">{{@text}}</a>', css: '.banner { display: block; padding: 12px; background: var(--hb-accent); color: var(--hb-on-accent); }' } } } } },
    responses: { 200: { description: '`{ component }`' }, 400: { description: 'Invalid component.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const body = (await readBody(event).catch(() => ({}))) || {}
  const project = await cmsProject(ctx, event, body)
  return { component: cmsComponentDef(await saveCmsComponent(project, body)) }
})
