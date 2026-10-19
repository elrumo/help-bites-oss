defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Agent logout', responses: { 200: { description: '{ ok }' } } } })

export default defineEventHandler(async (event) => {
  const { sessionToken } = await requireAgentIdentity(event)
  if (!sessionToken.startsWith('r:')) return { ok: true }
  await fetch(`${process.env.PARSE_URL}/logout`, { method: 'POST', headers: { 'X-Parse-Application-Id': process.env.PARSE_ID || '', 'X-Parse-Session-Token': sessionToken } }).catch(() => {})
  forgetSession(sessionToken)
  return { ok: true }
})
