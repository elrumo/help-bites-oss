// The llms.txt convention (llmstxt.org): where an AI assistant starts reading a
// site. The docs index with absolute links, for this deployment's own address.
export default defineEventHandler((event) => {
  setResponseHeaders(event, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
  return docsIndexMarkdown(hubOrigin(event))
})
