import { createError } from 'h3'
import { resolveAgentFaqFilter, faqAllowed, filterIsEmpty, ASSIGNMENT_SCOPES, type AgentFaqFilter, type AssignmentLite, type AssignmentScope, type FaqLite } from '#shared/knowledge'

// Explicit knowledge grants for an agent, at model / path-subtree / individual
// FAQ level, with optional exclusions. The pure include/exclude logic lives in
// shared/knowledge.ts; this module resolves Parse pointers into that shape and
// runs the concrete queries.

export type KnowledgeAssignment = {
  id: string
  agentId: string
  scope: AssignmentScope
  modelId: string
  nodeId: string
  pathCache: string
  faqId: string
  exclude: boolean
  createdAt: string | null
}

export async function listAssignments(agentId: string): Promise<ParseObject[]> {
  const Parse = useParse()
  const agent = Parse.Object.extend('SupportAgent').createWithoutData(agentId)
  return new Parse.Query('AgentKnowledgeAssignment').equalTo('supportAgent', agent).include('node').include('faq').limit(1000).find(MASTER)
}

/** Give an assistant (already the caller's) some of the caller's knowledge: never another workspace's. */
export async function createAssignment(ctx: MemberContext, agentId: string, input: Record<string, unknown>): Promise<ParseObject> {
  const Parse = useParse()
  const scope = String(input.scope || '')
  if (!(ASSIGNMENT_SCOPES as readonly string[]).includes(scope)) throw createError({ statusCode: 400, statusMessage: 'scope must be model, path or faq' })
  const a = new (Parse.Object.extend('AgentKnowledgeAssignment'))()
  a.set('supportAgent', Parse.Object.extend('SupportAgent').createWithoutData(agentId))
  a.set('scope', scope)
  a.set('exclude', Boolean(input.exclude))
  if (scope === 'model') {
    if (!input.modelId) throw createError({ statusCode: 400, statusMessage: 'modelId is required for a model assignment' })
    a.set('knowledgeModel', await scoped.knowledgeModel(ctx, String(input.modelId)))
  } else if (scope === 'path') {
    if (!input.nodeId) throw createError({ statusCode: 400, statusMessage: 'nodeId is required for a path assignment' })
    const node = await scoped.knowledgeNode(ctx, String(input.nodeId))
    a.set('node', node)
    a.set('knowledgeModel', node.get('knowledgeModel'))
  } else {
    if (!input.faqId) throw createError({ statusCode: 400, statusMessage: 'faqId is required for a faq assignment' })
    const faq = await scoped.faq(ctx, String(input.faqId))
    a.set('faq', faq)
    a.set('knowledgeModel', faq.get('knowledgeModel'))
  }
  await a.save(null, MASTER)
  return a
}

export function serializeAssignment(a: ParseObject): KnowledgeAssignment {
  const node = a.get('node')
  return {
    id: a.id || '',
    agentId: pointerId(a.get('supportAgent')),
    scope: (a.get('scope') as AssignmentScope) || 'model',
    modelId: pointerId(a.get('knowledgeModel')),
    nodeId: pointerId(a.get('node')),
    pathCache: node && typeof (node as ParseObject).get === 'function' ? String((node as ParseObject).get('pathCache') || '') : '',
    faqId: pointerId(a.get('faq')),
    exclude: a.get('exclude') === true,
    createdAt: iso(a.createdAt)
  }
}

/** Fold an agent's assignments into the pure filter, plus the models it touches. */
export async function resolveAgentFilter(agentId: string): Promise<{ filter: AgentFaqFilter, modelIds: string[] }> {
  const assignments = await listAssignments(agentId)
  const lite: AssignmentLite[] = []
  const modelIds = new Set<string>()
  for (const a of assignments) {
    const scope = a.get('scope') as AssignmentScope
    const exclude = a.get('exclude') === true
    const modelId = pointerId(a.get('knowledgeModel'))
    if (scope === 'model') {
      lite.push({ scope, modelId, exclude })
    } else if (scope === 'path') {
      const node = a.get('node') as ParseObject | undefined
      const pathCache = node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : ''
      lite.push({ scope, modelId, pathCache, exclude })
    } else {
      lite.push({ scope, faqId: pointerId(a.get('faq')), exclude })
    }
    if (!exclude && modelId) modelIds.add(modelId)
  }
  return { filter: resolveAgentFaqFilter(lite), modelIds: [...modelIds] }
}

function faqLiteFromRow(row: ParseObject): FaqLite {
  const node = row.get('node') as ParseObject | undefined
  return {
    id: row.id || '',
    modelId: pointerId(row.get('knowledgeModel')),
    pathCache: node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : '',
    status: String(row.get('status') || ''),
    language: String(row.get('language') || '')
  }
}

/**
 * Concrete FAQ rows an agent may use (the Parse path — retrieval prefers Meili
 * and uses this as a fallback and for the "inspect access" view). Over-fetches
 * candidates in the touched models, then applies the exact include/exclude
 * rules in memory.
 */
export async function queryAccessibleFaqs(agentId: string, opts: { statuses?: string[], limit?: number } = {}): Promise<ParseObject[]> {
  const { filter, modelIds } = await resolveAgentFilter(agentId)
  if (filterIsEmpty(filter)) return []
  const Parse = useParse()
  const statuses = opts.statuses ?? ['active']
  const limit = opts.limit ?? 50
  // Only models of the assistant's own workspace, whatever an assignment says.
  const assistant = await new Parse.Query('SupportAgent').select('workspace').get(agentId, MASTER).catch(() => null)
  const models = new Parse.Query('KnowledgeModel').equalTo('workspace', assistant?.get('workspace') || null).containedIn('objectId', modelIds)
  const q = new Parse.Query('Faq').include('node').containedIn('status', statuses).matchesQuery('knowledgeModel', models).limit(Math.min(limit * 4, 1000))
  const rows = await q.find(MASTER)
  return rows.filter(r => faqAllowed(faqLiteFromRow(r), filter)).slice(0, limit)
}

/** Which of a workspace's agents can currently use a given FAQ — for the FAQ editor's "Agents" panel. */
export async function agentsWithAccessToFaq(faq: ParseObject, workspace: ParseObject, ctx: { apiKeyProjectIds?: string[] | null } = {}): Promise<string[]> {
  const Parse = useParse()
  const modelId = pointerId(faq.get('knowledgeModel'))
  const lite: FaqLite = faqLiteFromRow(faq)
  const agents = await limitToKeyProjects(ctx, new Parse.Query('SupportAgent')).equalTo('workspace', workspace).limit(1000).find(MASTER)
  const out: string[] = []
  for (const agent of agents) {
    const { filter } = await resolveAgentFilter(agent.id || '')
    if (filter.modelIds.includes(modelId) || filter.faqIds.includes(lite.id) || filter.paths.some(p => p.modelId === modelId)) {
      if (faqAllowed(lite, filter)) out.push(agent.id || '')
    }
  }
  return out
}
