import { normalizeErrorAlerts } from '#shared/errorAlerts'
import { clampText } from '#shared/support'

defineRouteMeta({ openAPI: { tags: ['Error tracking'], summary: 'Save the error alert rules', operationId: 'setErrorAlerts', security: [{ AgentSession: [] }, { AdminApiKey: [] }] } })

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'projects.manage' })
  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const project = await requireProject(ctx, clampText(body.project, 40))
  const { config, errors } = normalizeErrorAlerts(body)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  project.set('errorAlerts', config)
  await project.save(null, MASTER)
  return config
})
