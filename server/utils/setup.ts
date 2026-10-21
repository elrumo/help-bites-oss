import { can } from '#shared/roles'
import { buildSetup, type ProjectSetup, type SetupKey } from '#shared/setup'

/** Devices of the workspace's team that a push can reach; none when the server has no APNs credentials. */
async function teamPushDevices(workspace: ParseObject): Promise<number> {
  if (!isAPNsConfigured()) return 0
  const Parse = useParse()
  const members = await new Parse.Query('WorkspaceMember').equalTo('workspace', workspace).select('user').limit(1000).find(MASTER)
  if (!members.length) return 0
  return new Parse.Query('Device').containedIn('agent', members.map(member => member.get('user'))).count(MASTER)
}

/**
 * A project's setup checklist, from what HelpBites has actually seen: the widget loading, a signed token
 * arriving, mail that can go out, an assistant that can answer, a sync that ran. A role that cannot use
 * Stripe is not shown its row.
 */
export async function projectSetup(ctx: MemberContext, project: ParseObject): Promise<ProjectSetup> {
  const Parse = useParse()
  const p = serializeAdminProject(project)
  const skip: SetupKey[] = can(ctx.role, 'marketing') ? [] : ['stripe']
  const [pushDevices, assistantRows, stripe] = await Promise.all([
    teamPushDevices(ctx.workspace),
    new Parse.Query('SupportAgent').equalTo('project', project).ascending('createdAt').limit(20).find(MASTER),
    skip.includes('stripe') ? null : findStripeAccount(project)
  ])
  const readiness = await Promise.all(assistantRows.map(agent => readAssistant(ctx.workspace, agent)))
  const live = readiness.findIndex(r => r.live)
  return buildSetup({
    hiddenSections: p.hiddenSections,
    skip,
    allowedOrigins: p.allowedOrigins.length,
    widgetSeenAt: p.widgetSeenAt,
    identitySeenAt: p.identitySeenAt,
    allowAnonymousUsers: p.allowAnonymousUsers,
    notifyEmails: p.notifyEmails.length,
    mailerReady: isMailerConfigured({ fromEmail: p.fromEmail, domain: p.mailDomain }),
    pushDevices,
    fromEmail: p.fromEmail,
    // Named after the one that answers, else the first: the row says which assistant to look at.
    assistants: { total: assistantRows.length, live: readiness.filter(r => r.live).length, first: String(assistantRows[live >= 0 ? live : 0]?.get('name') || '') },
    stripe: { connected: Boolean(stripe), synced: Boolean(stripe?.get('lastRunAt')) && stripe?.get('status') !== 'error', error: stripe?.get('status') === 'error' ? String(stripe.get('lastError') || 'Sync failed') : '' },
    repos: projectRepos(project).length,
    errorTracker: { connected: p.errors.connected, name: p.errors.providerName }
  })
}
