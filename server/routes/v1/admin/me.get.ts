import { isUnlimited } from '#shared/entitlements'

defineRouteMeta({
  openAPI: {
    tags: ['Agent'],
    summary: 'Who am I',
    description: 'The signed-in agent, the workspace this request acts in (`X-Workspace`, else their default) with their role there, every workspace they belong to, and that workspace\'s plan. `plan.unlimited` means no limits and every feature, as on a self-hosted install; `features` lists what the plan includes.',
    responses: { 200: { description: '`{ agent, workspace, role, workspaces, edition, plan: { id, name, unlimited }, features, links, extras }`; `workspace` is null when they belong to none; `extras` is whatever the edition adds (empty in community).' }, 401: { description: 'Not an agent' } }
  }
})

export default defineEventHandler(async (event) => {
  const identity = await requireAgentIdentity(event)
  // A stale or foreign X-Workspace falls back to the default here, so the
  // panel can recover its footing instead of failing every call.
  const member = await resolveMember(identity, String(getHeader(event, 'x-workspace') || '')) || await resolveMember(identity, '')
  const memberships = await membershipsOf(identity.agentId)
  const workspaces = (await Promise.all(memberships.map(async m => ({ m, row: await getWorkspace(m.workspaceId) }))))
    .flatMap(({ m, row }) => row ? [serializeWorkspace(row, m.role)] : [])
  const { id, policy } = edition()
  const plan = await workspacePlan(member?.workspace)
  return {
    agent: serializeAgent(identity.agent),
    workspace: member ? serializeWorkspace(member.workspace, member.role) : null,
    role: member?.role || null,
    workspaces,
    edition: id,
    plan: { id: plan.id, name: plan.name, unlimited: isUnlimited(plan) },
    features: { ...plan.features, teammatePasswords: policy.teammatePasswords },
    links: { sourceCode: sourceCodeUrl() },
    extras: await edition().meExtras?.(identity, member) || {}
  }
})
