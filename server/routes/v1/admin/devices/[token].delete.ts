defineRouteMeta({ openAPI: { tags: ['Agent'], summary: 'Unregister an APNs device' } })

export default defineEventHandler(async (event) => {
  const identity = await requireAgentIdentity(event)
  const { agent } = identity
  assertSession(identity)
  const token = String(getRouterParam(event, 'token') || '').trim().toLowerCase()
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Device token is required' })
  const Parse = useParse()
  const row = await new Parse.Query('Device').equalTo('token', token).equalTo('agent', agent).first(MASTER)
  if (row) await row.destroy(MASTER)
  return { deleted: true }
})
