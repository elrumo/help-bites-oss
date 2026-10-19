export default defineNitroPlugin(() => {
  if (import.meta.prerender || !isAPNsConfigured()) return
  // Pushes are background work: on web replicas every one of them would race to claim every message.
  if (!runsWorkers()) return

  subscribeAllWorkspaceEvents((event) => {
    if (event.type !== 'message.created' || event.message.sender !== 'user') return
    void notifyDevices(event)
  })
})

/** A new end-user message reaches the devices of that workspace's team only, badged with its unread count. */
async function notifyDevices(event: Extract<SupportEvent, { type: 'message.created' }>): Promise<void> {
  // Redis makes one process the fan-out even when Nitro runs more than one.
  const claimed = await useRedis().set(`sb:pushed:${event.message.id}`, '1', 'EX', 24 * 60 * 60, 'NX').catch(() => null)
  if (!claimed) return

  const Parse = useParse()
  const workspaceId = event.workspaceId || await workspaceIdOfProject(event.projectId)
  if (!workspaceId) return
  const members = await new Parse.Query('WorkspaceMember').equalTo('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId)).select('user').limit(1000).find(MASTER)
  const projects = (await workspaceProjectIds(workspaceId)).map(id => Parse.Object.extend('Project').createWithoutData(id))
  const [devices, unreadRows] = await Promise.all([
    new Parse.Query('Device').containedIn('agent', members.map(m => m.get('user'))).select('token', 'env').limit(10_000).find(MASTER),
    new Parse.Query('Conversation').containedIn('project', projects).greaterThan('unreadByAgent', 0).select('unreadByAgent').limit(1_000).find(MASTER)
  ])
  const badge = unreadRows.reduce((sum, row) => sum + Number(row.get('unreadByAgent') || 0), 0)
  const body = event.message.body.replace(/\s+/g, ' ').trim() || 'Sent an image'
  await Promise.all(devices.map(async (row) => {
    const result = await sendAPNs({ token: String(row.get('token') || ''), env: String(row.get('env') || 'sandbox') }, { title: 'New support message', body: body.slice(0, 160), badge, conversationId: event.conversationId })
    if (result === 'unregistered') await row.destroy(MASTER)
  }))
}
