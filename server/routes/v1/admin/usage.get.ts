defineRouteMeta({
  openAPI: {
    tags: ['Workspace'],
    summary: 'Plan and usage',
    description: 'The workspace\'s plan, its limits (null: none) and features, and what it has used: gauges as they stand now, counters for the current month (emailsPerDay: today, UTC).',
    responses: { 200: { description: '`{ plan: { id, name }, unlimited, limits, soft, features, apiPerMinute, emailLogDays, usage }`' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { workspaceWide: true })
  return await usageSnapshot(ctx.workspace)
})
