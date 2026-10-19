// Checks every project's error alert rules once a minute (see server/utils/errorAlerts.ts).
const TICK_MS = 60_000

export default defineNitroPlugin(() => {
  if (import.meta.prerender || !process.env.PARSE_URL || !runsWorkers()) return

  async function beat() {
    // One instance does the work when Nitro runs more than one.
    if (!(await useRedis().set('sb:erralert:tick', '1', 'EX', 50, 'NX').catch(() => null))) return
    try {
      await eachBatch(() => new (useParse()).Query('Project').exists('errorAlerts'), async (projects) => {
        for (const project of projects) {
          if (!(await workspaceIsActive(pointerId(project.get('workspace'))))) continue
          await runErrorAlerts(project).catch(error => console.warn('[error-alerts]', (error as Error).message))
        }
      })
    } catch (error) {
      console.warn('[error-alerts] tick failed:', (error as Error).message)
    }
  }

  setTimeout(beat, 20_000).unref?.()
  setInterval(beat, TICK_MS).unref?.()
})
