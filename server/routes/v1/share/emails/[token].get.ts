defineRouteMeta({ openAPI: { tags: ['Email'], summary: 'Open a shared email template', operationId: 'getSharedEmail', security: [{}], description: 'No auth: the token is the credential. Returns the rendered email, plus the design when the link allows editing.', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '`{ mode, name, subject, html, template? }`' }, 404: { description: 'Link revoked or unknown.' } } } })

export default defineEventHandler(async (event) => {
  const row = await findSharedEmail(event, getRouterParam(event, 'token') || '', 'view')
  const mode = row.get('shareMode') as ShareMode
  const { subject, html } = renderEmailTemplate(row, (row.get('project') as ParseObject) || null)
  return {
    mode,
    name: String(row.get('name') || ''),
    subject,
    html,
    ...(mode === 'edit' ? { template: serializeEmailTemplate(row, { forShare: true }) } : {})
  }
})
