import { createError } from 'h3'
import { SUPPORT_AGENT_STATUSES, AGENT_FALLBACKS, AGENT_RULE_ACTIONS, ASSISTANT_FAQ_LOOKUP, KNOWLEDGE_NAME_MAX_LENGTH, assistantReadiness, normalizeAgentRules, slugifyKnowledge, type AssistantReadiness, type SupportAgentStatus, type AgentFallback, type AgentRule, type AgentRuleAction } from '#shared/knowledge'
import { safeHttpUrl } from '#shared/support'
import { sameEndpoint } from './aiGateway'

// A SupportAgent is an AI support configuration (system prompt, model, provider
// settings, which knowledge it may use). Distinct from the human Team (_User).
// The apiKey is write-only over the wire (serialization reports only hasApiKey)
// and sealed at rest; aiGateway.ts decides where each assistant's calls go.

export type SupportAgent = {
  id: string
  projectId: string
  name: string
  slug: string
  description: string
  status: SupportAgentStatus
  systemPrompt: string
  model: string
  endpoint: string
  hasApiKey: boolean
  temperature: number
  autoReply: boolean
  fallbackBehavior: AgentFallback
  /** Don't send an AI answer unless the top knowledge match scores at least this (0..1). 0 = no gate. */
  minConfidence: number
  /** Ordered routing rules: first match decides auto vs human for a message. */
  rules: AgentRule[]
  /** What to do when no rule matches. */
  defaultAction: AgentRuleAction
  createdBy: string
  createdAt: string | null
  updatedAt: string | null
}

export async function getSupportAgentById(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('SupportAgent').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }
}

export async function applySupportAgentInput(ctx: MemberContext, agent: ParseObject, input: Record<string, unknown>): Promise<void> {
  if (typeof input.name === 'string' && input.name.trim()) {
    agent.set('name', input.name.trim().slice(0, KNOWLEDGE_NAME_MAX_LENGTH))
    if (!agent.get('slug')) agent.set('slug', slugifyKnowledge(input.name))
  }
  if (typeof input.slug === 'string' && input.slug.trim()) agent.set('slug', slugifyKnowledge(input.slug))
  if ('description' in input) agent.set('description', String(input.description ?? '').trim().slice(0, 2000))
  if (typeof input.status === 'string' && (SUPPORT_AGENT_STATUSES as readonly string[]).includes(input.status)) agent.set('status', input.status)
  if ('systemPrompt' in input) agent.set('systemPrompt', String(input.systemPrompt ?? '').slice(0, 8000))
  if ('model' in input) agent.set('model', String(input.model ?? '').trim().slice(0, 120))
  if ('endpoint' in input) {
    const endpoint = safeHttpUrl(input.endpoint).slice(0, 500)
    // A key only follows its own endpoint (as in the workspace AI settings): pointing the assistant elsewhere must not carry the
    // stored key along, or whoever may edit an assistant could have it sent to a server of their own.
    if (typeof input.apiKey !== 'string' && agent.get('apiKey') && !sameEndpoint(String(agent.get('endpoint') || ''), endpoint)) agent.unset('apiKey')
    agent.set('endpoint', endpoint)
  }
  // apiKey is write-only; empty string clears it, absence leaves it untouched.
  if (typeof input.apiKey === 'string') {
    const key = input.apiKey.trim()
    if (key) agent.set('apiKey', storeCredential(key.slice(0, 400)))
    else agent.unset('apiKey')
  }
  if ('temperature' in input) {
    const t = Number(input.temperature)
    if (Number.isFinite(t)) agent.set('temperature', Math.min(Math.max(t, 0), 2))
  }
  if ('autoReply' in input) agent.set('autoReply', Boolean(input.autoReply))
  if (typeof input.fallbackBehavior === 'string' && (AGENT_FALLBACKS as readonly string[]).includes(input.fallbackBehavior)) agent.set('fallbackBehavior', input.fallbackBehavior)
  if ('minConfidence' in input) {
    const c = Number(input.minConfidence)
    if (Number.isFinite(c)) agent.set('minConfidence', Math.min(Math.max(c, 0), 1))
  }
  if (typeof input.defaultAction === 'string' && (AGENT_RULE_ACTIONS as readonly string[]).includes(input.defaultAction)) agent.set('defaultAction', input.defaultAction)
  if ('rules' in input) agent.set('rules', normalizeAgentRules(input.rules))

  if (!agent.get('workspace')) agent.set('workspace', ctx.workspace)
  if ('projectId' in input) {
    // Another project of the same workspace, or none (shared across the workspace).
    const projectId = String(input.projectId || '')
    if (projectId) agent.set('project', await requireProject(ctx, projectId))
    else agent.unset('project')
  }
  // A limited key's assistants belong to its projects; a shared one is the workspace's.
  if (!agent.get('project')) assertWorkspaceWide(ctx)
}

export function readMinConfidence(agent: ParseObject): number {
  const n = Number(agent.get('minConfidence'))
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0
}

export function readAgentRules(agent: ParseObject): AgentRule[] {
  return normalizeAgentRules(agent.get('rules'))
}

export function readDefaultAction(agent: ParseObject): AgentRuleAction {
  return agent.get('defaultAction') === 'human' ? 'human' : 'auto'
}

/** How far an assistant is from answering customers by itself: the checks behind the strip on its page and the setup checklist. */
export async function readAssistant(workspace: ParseObject, agent: ParseObject): Promise<AssistantReadiness> {
  const [route, faqs] = await Promise.all([
    resolveAi(workspace, { assistant: agent }),
    // Rows it may read, up to a lookup's worth: enough to say "some" or "none", and a count worth showing.
    queryAccessibleFaqs(agent.id || '', { limit: ASSISTANT_FAQ_LOOKUP })
  ])
  return assistantReadiness({ status: String(agent.get('status') || 'draft'), autoReply: agent.get('autoReply') === true, llm: Boolean(route), faqs: faqs.length })
}

export function serializeSupportAgent(agent: ParseObject): SupportAgent {
  return {
    id: agent.id || '',
    projectId: pointerId(agent.get('project')),
    name: String(agent.get('name') || ''),
    slug: String(agent.get('slug') || ''),
    description: String(agent.get('description') || ''),
    status: (agent.get('status') as SupportAgentStatus) || 'draft',
    systemPrompt: String(agent.get('systemPrompt') || ''),
    model: String(agent.get('model') || ''),
    endpoint: String(agent.get('endpoint') || ''),
    hasApiKey: Boolean(agent.get('apiKey')),
    temperature: typeof agent.get('temperature') === 'number' ? agent.get('temperature') : 0.2,
    autoReply: agent.get('autoReply') === true,
    fallbackBehavior: (agent.get('fallbackBehavior') as AgentFallback) || 'human',
    minConfidence: readMinConfidence(agent),
    rules: readAgentRules(agent),
    defaultAction: readDefaultAction(agent),
    createdBy: pointerId(agent.get('createdBy')),
    createdAt: iso(agent.createdAt),
    updatedAt: iso(agent.updatedAt)
  }
}
