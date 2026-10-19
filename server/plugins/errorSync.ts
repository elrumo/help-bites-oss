export default defineNitroPlugin(() => {
  // The build prerenders `/` with Nitro plugins running; a Redis subscriber
  // there would throw without REDIS_URL and keep the build process alive.
  if (import.meta.prerender) return
  if (!runsWorkers()) return

  subscribeAllWorkspaceEvents((event) => {
    if (event.type !== 'conversation.updated' || event.conversation.type !== 'error' || !isErrorProvider(event.conversation.subjectRef?.type)) return
    void sync(event.projectId, event.conversation)
  })
})

async function sync(projectId: string, conversation: { id: string, status: string, subjectRef: { type: string, id: string } | null }): Promise<void> {
  if (!conversation.subjectRef?.id || !isErrorProvider(conversation.subjectRef.type)) return
  try {
    const key = `sb:errsync:${conversation.id}:${conversation.status}`
    if (await useRedis().set(key, '1', 'EX', 60, 'NX') !== 'OK') return
    await setErrorIssueStatus(await loadProjectUnscoped(projectId), conversation.subjectRef.type, conversation.subjectRef.id, conversation.status)
  } catch (error) {
    console.warn('[error-sync]', (error as Error).message)
  }
}
