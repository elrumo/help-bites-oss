import { messagePreview } from '#shared/support'
import { meiliConfigured, indexDocuments, deleteDocuments, searchIndex, CONVERSATIONS_INDEX, ENDUSERS_INDEX } from './meili'

// Keeps the app's own entities searchable in Meilisearch. All best-effort, like
// publishEvent: search is an upgrade, never a requirement, so a Meili outage
// degrades to the existing Mongo-regex lookups rather than failing a write.

async function endUserFields(conversation: ParseObject): Promise<{ id: string, name: string, email: string }> {
  const endUser = conversation.get('endUser') as ParseObject | undefined
  if (endUser && typeof endUser.get === 'function' && endUser.get('name') !== undefined) {
    return { id: endUser.id || '', name: String(endUser.get('name') || ''), email: String(endUser.get('email') || '') }
  }
  const id = pointerId(conversation.get('endUser'))
  if (!id) return { id: '', name: '', email: '' }
  try {
    const Parse = useParse()
    const row = await new Parse.Query('EndUser').get(id, MASTER)
    return { id, name: String(row.get('name') || ''), email: String(row.get('email') || '') }
  } catch {
    return { id, name: '', email: '' }
  }
}

/** Upsert a conversation into the search index (detached / best-effort). */
export async function syncConversationForSearch(conversation: ParseObject): Promise<void> {
  if (!meiliConfigured()) return
  try {
    const user = await endUserFields(conversation)
    const projectId = pointerId(conversation.get('project'))
    await indexDocuments(CONVERSATIONS_INDEX, [{
      id: conversation.id,
      workspaceId: await workspaceIdOfProject(projectId),
      projectId,
      endUserId: user.id,
      endUserName: user.name,
      endUserEmail: user.email,
      subject: String(conversation.get('subject') || ''),
      preview: messagePreview(conversation.get('lastMessagePreview') || '', 200),
      status: String(conversation.get('status') || 'open'),
      lastMessageAt: (conversation.get('lastMessageAt') as Date | undefined)?.getTime() || 0
    }])
  } catch (error) {
    console.warn('[search] conversation sync failed:', (error as Error).message)
  }
}

function endUserDocument(endUser: ParseObject, workspaceId: string) {
  return {
    id: endUser.id,
    workspaceId,
    projectId: pointerId(endUser.get('project')),
    name: String(endUser.get('name') || ''),
    email: String(endUser.get('email') || ''),
    externalId: String(endUser.get('externalId') || ''),
    tags: Array.isArray(endUser.get('tags')) ? endUser.get('tags') : []
  }
}

export async function syncEndUserForSearch(endUser: ParseObject): Promise<void> {
  return syncEndUsersForSearch([endUser])
}

/** One index call for many contacts (imports and syncs). */
export async function syncEndUsersForSearch(endUsers: ParseObject[]): Promise<void> {
  if (!meiliConfigured() || !endUsers.length) return
  try {
    const projectIds = [...new Set(endUsers.map(u => pointerId(u.get('project'))))]
    const workspaceOf = new Map(await Promise.all(projectIds.map(async id => [id, await workspaceIdOfProject(id)] as const)))
    await indexDocuments(ENDUSERS_INDEX, endUsers.map(u => endUserDocument(u, workspaceOf.get(pointerId(u.get('project'))) || '')))
  } catch (error) {
    console.warn('[search] end-user sync failed:', (error as Error).message)
  }
}

export async function removeConversationFromSearch(id: string): Promise<void> {
  if (!meiliConfigured() || !id) return
  try { await deleteDocuments(CONVERSATIONS_INDEX, [id]) } catch {}
}

export async function removeEndUserFromSearch(id: string): Promise<void> {
  if (!meiliConfigured() || !id) return
  try { await deleteDocuments(ENDUSERS_INDEX, [id]) } catch {}
}

/** Every search names its workspace (and may narrow to a project): never the whole index. */
export type SearchScope = { workspaceId: string, projectId?: string }

export function searchScopeFilter(scope: SearchScope): string[] {
  if (!scope?.workspaceId) throw new Error('search needs a workspace')
  return [`workspaceId = ${JSON.stringify(scope.workspaceId)}`, ...(scope.projectId ? [`projectId = ${JSON.stringify(scope.projectId)}`] : [])]
}

/** Full-text end-user search; empty array signals "fall back to the caller's own query". */
export async function searchEndUserIds(query: string, scope: SearchScope, limit = 50): Promise<string[]> {
  const filter = searchScopeFilter(scope)
  if (!meiliConfigured() || !query.trim()) return []
  const hits = await searchIndex(ENDUSERS_INDEX, query, { filter, limit })
  return hits.map((h: any) => String(h.id)).filter(Boolean)
}

export async function searchConversationIds(query: string, scope: SearchScope, limit = 50): Promise<string[]> {
  const filter = searchScopeFilter(scope)
  if (!meiliConfigured() || !query.trim()) return []
  const hits = await searchIndex(CONVERSATIONS_INDEX, query, { filter, limit })
  return hits.map((h: any) => String(h.id)).filter(Boolean)
}
