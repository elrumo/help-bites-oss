// One public file of a brand kit, saved under its own name. Streamed from the
// bucket, so the download works even where the bucket's URL is only reachable
// inside the stack, and `download` links work from any page.

export default defineEventHandler(async (event) => {
  const project = await publicBrandProject(event)
  const row = await getBrandAsset(getRouterParam(event, 'id') || '').catch(() => null)
  if (!row || pointerId(row.get('project')) !== project.id || row.get('public') === false) throw createError({ statusCode: 404, statusMessage: 'File not found' })
  setResponseHeaders(event, {
    'Content-Type': String(row.get('mime') || 'application/octet-stream'),
    'Content-Disposition': `attachment; filename="${brandDownloadName(row)}"`,
    'Content-Length': String(row.get('size') || ''),
    'Cache-Control': 'public, max-age=300',
    // An SVG or PDF opened from here must not run anything.
    'Content-Security-Policy': "default-src 'none'; sandbox"
  })
  return sendStream(event, await readObjectStream(String(row.get('storageKey') || '')) as never)
})
