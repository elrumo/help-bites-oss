defineRouteMeta({
  openAPI: {
    tags: ['Legal'], operationId: 'getPublicLegalDocument', security: [],
    summary: 'Read a published legal document',
    description: 'Public, no sign-in. Returns the title, TL;DR, effective date, version and sections, with the full text as `markdown` and sanitised `html`. `locale` is the document\'s language and `translations` lists its published copies in other languages (`locale`, `title`, `path`). Narrow the body with `?format=md` (text/markdown) or `?format=html` (the sanitised HTML fragment), or end the slug in `.md`, `.html` or `.json` (`/v1/legal/{pk}/privacy.md`). Open to any origin (CORS), so your own page can fetch it and style it. Drafts answer 404. Link end users to `/legal/{pk}/{slug}` for the styled page.',
    parameters: [{ name: 'pk', in: 'path', required: true, schema: { type: 'string' } }, { name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'md', 'html'] } }],
    responses: { 200: { description: 'The document.' }, 404: { description: 'Unknown project or no such published document.' }, 429: { description: 'Too many requests.' } }
  }
})

export default defineEventHandler(async (event) => {
  const project = await publicLegalProject(event)
  // `privacy.md` is `privacy` with ?format=md; no slug contains a dot.
  const [, name = '', ext] = /^(.*?)(?:\.(md|html|json))?$/i.exec(getRouterParam(event, 'slug') || '') || []
  const row = await publicLegalDocument(project, name)
  const doc = toPublicLegalDocument(project, row, await listLegalDocuments(project, true))
  setHeader(event, 'Cache-Control', 'public, max-age=60')
  const format = ext ? ext.toLowerCase() : getQuery(event).format
  if (format === 'md') {
    setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
    return `# ${doc.title}\n\n${doc.tldr ? `> ${doc.tldr}\n\n` : ''}${doc.markdown}\n`
  }
  if (format === 'html') {
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    // A fragment for embedding: the script-free sanitised body, nothing that runs.
    setHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src http: https: data:; style-src 'none'")
    return doc.html
  }
  return { document: doc }
})
