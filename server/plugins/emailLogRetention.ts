// Prune the email log: entries older than EMAIL_LOG_RETENTION_DAYS (default
// 180; 0 keeps everything) go, a few thousand at a time, every six hours.
// Where the edition puts workspaces on plans, a plan may keep less
// (emailLogDays), and each workspace is pruned to its own plan's window.

const EVERY_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Workspaces whose plan keeps the log for less than the server does. */
async function prunePerWorkspace(serverDays: number): Promise<number> {
  const Parse = useParse()
  let deleted = 0
  let after = ''
  for (;;) {
    const query = new Parse.Query('Workspace').ascending('objectId').limit(200)
    if (after) query.greaterThan('objectId', after)
    const page = await query.find(MASTER)
    for (const workspace of page) {
      const days = (await workspacePlan(workspace)).emailLogDays
      if (!days || (serverDays && days >= serverDays)) continue
      const projects = (await workspaceProjectIds(workspace.id || '')).map(id => Parse.Object.extend('Project').createWithoutData(id))
      deleted += await purgeEmailLogs({ scope: { workspace, projects }, before: new Date(Date.now() - days * DAY_MS), max: 20_000 })
    }
    if (page.length < 200) return deleted
    after = page.at(-1)!.id || ''
  }
}

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL) return
  if (!runsWorkers()) return

  async function prune() {
    const days = emailLogRetentionDays()
    const perWorkspace = !!edition().planFor
    if (!days && !perWorkspace) return
    // Redis makes one process do it even when Nitro runs more than one.
    const claimed = await useRedis().set('sb:emaillog:prune', '1', 'EX', 60 * 60, 'NX').catch(() => null)
    if (!claimed) return
    try {
      // The server's window applies to everything (system mail included); a plan can only shorten it.
      let deleted = days ? await purgeEmailLogs({ before: new Date(Date.now() - days * DAY_MS), max: 50_000 }) : 0
      if (perWorkspace) deleted += await prunePerWorkspace(days)
      if (deleted) console.log(`[email] pruned ${deleted} log entries`)
    } catch (error) {
      console.error('[email] pruning the log failed:', (error as Error).message)
    }
  }

  setTimeout(prune, 60_000).unref?.()
  setInterval(prune, EVERY_MS).unref?.()
})
