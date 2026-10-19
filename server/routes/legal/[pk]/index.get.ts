// The project's published legal documents, as a page.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const project = await publicLegalProjectOrNull(event)
  if (!project) {
    setResponseStatus(event, 404)
    return invalidLinkPage()
  }
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
  const docs = (await listLegalDocuments(project, true)).map(row => toPublicLegalDocument(project, row))
  return renderLegalIndex(project, docs.map(d => ({ title: d.title, path: d.url, effectiveDate: d.effectiveDate })), await poweredByFor(project))
})
