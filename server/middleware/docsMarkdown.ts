import { markdownRequest } from '#shared/docs'

// /docs/<slug>.md is a guide as Markdown and /docs.md the list of them: for the
// pages' Copy buttons, an AI assistant or a curl. A middleware rather than a
// route file because Nitro reads `[slug].md` as a parameter named "slug.md" and
// would answer every /docs/<anything>, the HTML pages included.
export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const wanted = markdownRequest(event.path)
  if (!wanted) return
  // Answering here ends the request before securityHeaders.ts runs.
  setResponseHeaders(event, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  })
  return wanted === 'index' ? docsIndexMarkdown() : publishedDocMarkdown(wanted)
})
