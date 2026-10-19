// A record of what operators and the platform's own staff did to a
// workspace that matters later: suspensions, plan changes, deletions,
// exports. Write-only from the app's point of view; read in the super-admin
// screens. A lost entry never fails the action it describes.

export type AuditEntry = {
  action: string
  actor?: ParseObject | null
  workspace?: ParseObject | string | null
  /** What it was done to, when not the workspace itself (a member, a project). */
  target?: string
  data?: Record<string, unknown>
  ip?: string
}

export async function audit(entry: AuditEntry): Promise<void> {
  const Parse = useParse()
  try {
    const row = new (Parse.Object.extend('AuditLog'))()
    row.set('action', entry.action.slice(0, 80))
    if (entry.actor) {
      row.set('actor', entry.actor)
      row.set('actorEmail', String(entry.actor.get('email') || entry.actor.get('username') || '').slice(0, 200))
    }
    const workspace = typeof entry.workspace === 'string' ? (entry.workspace ? Parse.Object.extend('Workspace').createWithoutData(entry.workspace) : null) : entry.workspace
    if (workspace) row.set('workspace', workspace)
    if (entry.target) row.set('target', entry.target.slice(0, 200))
    if (entry.data) row.set('data', entry.data)
    if (entry.ip) row.set('ip', entry.ip.slice(0, 64))
    await row.save(null, MASTER)
  } catch (error) {
    console.error('[audit] not recorded:', entry.action, (error as Error).message)
  }
}

export function serializeAuditEntry(row: ParseObject) {
  return {
    id: row.id || '',
    action: String(row.get('action') || ''),
    actorEmail: String(row.get('actorEmail') || ''),
    workspaceId: pointerId(row.get('workspace')),
    target: String(row.get('target') || ''),
    data: (row.get('data') || {}) as Record<string, unknown>,
    createdAt: iso(row.createdAt)
  }
}
