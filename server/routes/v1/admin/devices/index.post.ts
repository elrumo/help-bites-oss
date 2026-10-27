defineRouteMeta({
  openAPI: {
    tags: ['Agent'], summary: 'Register an APNs device',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['token', 'platform', 'env'] } } } }
  }
})

export default defineEventHandler(async (event) => {
  // A device belongs to the operator's account, not to a workspace.
  const identity = await requireAgentIdentity(event)
  const { agent } = identity
  // Push notifications (with message previews) go to the devices registered here.
  assertSession(identity)
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const token = String(body.token || '').trim().toLowerCase()
  const platform = String(body.platform || '')
  const env = String(body.env || '')
  if (!/^[a-f0-9]{64,200}$/.test(token)) throw createError({ statusCode: 400, statusMessage: 'Invalid APNs token' })
  if (!['ios', 'ipados', 'macos'].includes(platform) || !['sandbox', 'production'].includes(env)) throw createError({ statusCode: 400, statusMessage: 'Invalid device platform or environment' })

  const Parse = useParse()
  const row = await new Parse.Query('Device').equalTo('token', token).first(MASTER) || new (Parse.Object.extend('Device'))()
  row.set('token', token)
  row.set('agent', agent)
  row.set('platform', platform)
  row.set('env', env)
  await row.save(null, MASTER)
  return { registered: true }
})
