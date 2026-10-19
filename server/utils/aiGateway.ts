import { createOpenAI } from '@ai-sdk/openai'
import { DEFAULT_LLM_MODEL } from '#shared/knowledge'
import { safeHttpUrl } from '#shared/support'

// Which model endpoint an AI call goes to, and whether it counts against the
// workspace's AI credits. In order:
//   1. the assistant's own endpoint, when it has one: their provider, their bill;
//   2. the workspace's own provider ("bring your own key", Settings → AI);
//   3. the server's LiteLLM gateway (LITELLM_API_BASE_URL), metered in credits.
// The community edition prices every call at 0 credits, so only the cloud
// edition ever runs out. Endpoints an operator typed in go through safeFetch;
// the server's own gateway is trusted.

export type AiSource = 'assistant' | 'workspace' | 'platform'

export type AiRoute = {
  source: AiSource
  endpoint: string
  apiKey: string
  model: string
  /** Counted in AI credits (the platform's gateway only). */
  metered: boolean
  workspaceId: string
}

export type WorkspaceAiSettings = { endpoint: string, model: string, ultraModel: string, hasApiKey: boolean }

const AI_TIMEOUT_MS = 10 * 60 * 1000

export function gatewayEndpoint(): string {
  return String(process.env.LITELLM_API_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function sameEndpoint(a: string, b: string): boolean {
  const clean = (value: string) => value.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/v\d+$/, '')
  return !!a && !!b && clean(a) === clean(b)
}

export function chatCompletionsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(base)) return base
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function baseUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  return /\/v\d+$/.test(base) ? base : `${base}/v1`
}

/** The workspace's own AI provider as stored on Workspace.ai (its key sealed). */
export function readWorkspaceAi(workspace: ParseObject | null | undefined): (WorkspaceAiSettings & { apiKey: string }) | null {
  const raw = workspace?.get('ai') as Record<string, unknown> | undefined
  const endpoint = String(raw?.endpoint || '').trim()
  if (!endpoint) return null
  const apiKey = raw?.apiKey ? readCredential(raw.apiKey) : ''
  return { endpoint, model: String(raw?.model || '').trim(), ultraModel: String(raw?.ultraModel || '').trim(), hasApiKey: !!apiKey, apiKey }
}

export function serializeWorkspaceAi(workspace: ParseObject): WorkspaceAiSettings | null {
  const settings = readWorkspaceAi(workspace)
  return settings ? { endpoint: settings.endpoint, model: settings.model, ultraModel: settings.ultraModel, hasApiKey: settings.hasApiKey } : null
}

/** Apply the AI settings form: `endpoint: ''` turns the workspace's own provider off; `apiKey` is write-only ('' clears it, absent keeps it). */
export function applyWorkspaceAiInput(workspace: ParseObject, input: Record<string, unknown>): void {
  const endpoint = safeHttpUrl(input.endpoint).slice(0, 500)
  if (!endpoint) {
    workspace.unset('ai')
    return
  }
  const previous = (workspace.get('ai') || {}) as Record<string, unknown>
  const next: Record<string, unknown> = {
    endpoint,
    model: String(input.model ?? previous.model ?? '').trim().slice(0, 120),
    ultraModel: String(input.ultraModel ?? previous.ultraModel ?? '').trim().slice(0, 120)
  }
  if (typeof input.apiKey === 'string') {
    if (input.apiKey.trim()) next.apiKey = storeCredential(input.apiKey.trim().slice(0, 400))
  } else if (previous.apiKey && sameEndpoint(String(previous.endpoint || ''), endpoint)) {
    // A key only follows its own endpoint: pointing the settings elsewhere must not carry it along.
    next.apiKey = previous.apiKey
  }
  workspace.set('ai', next)
}

export async function workspaceOfRow(row: ParseObject | null | undefined): Promise<ParseObject | null> {
  const id = pointerId(row?.get('workspace'))
  return id ? await getWorkspace(id) : null
}

/**
 * Where a call goes. `model` is what the caller would ask the platform for
 * (an email designer tier); `ultra` picks the workspace's stronger model.
 * Null when no AI is configured anywhere.
 */
export async function resolveAi(workspace: ParseObject | null, options: { assistant?: ParseObject | null, model?: string, ultra?: boolean } = {}): Promise<AiRoute | null> {
  const workspaceId = workspace?.id || pointerId(options.assistant?.get('workspace'))
  const gateway = gatewayEndpoint()
  const assistant = options.assistant
  const assistantEndpoint = String(assistant?.get('endpoint') || '').trim()
  const assistantKey = assistant?.get('apiKey') ? readCredential(assistant.get('apiKey')) : ''
  const assistantModel = String(assistant?.get('model') || '').trim()

  if (assistantEndpoint && !sameEndpoint(assistantEndpoint, gateway)) {
    return { source: 'assistant', endpoint: assistantEndpoint, apiKey: assistantKey, model: assistantModel || DEFAULT_LLM_MODEL, metered: false, workspaceId }
  }
  const own = readWorkspaceAi(workspace)
  if (own && await hasFeature(workspace, 'byoLlm')) {
    const model = (options.ultra && own.ultraModel) || assistantModel || own.model || DEFAULT_LLM_MODEL
    return { source: 'workspace', endpoint: own.endpoint, apiKey: own.apiKey, model, metered: false, workspaceId }
  }
  if (!gateway) return null
  // The server's key only ever goes to the server's gateway.
  const apiKey = assistantKey || String(process.env.LITELLM_API_KEY || '').trim()
  const model = options.model || assistantModel || String(process.env.LLM_DEFAULT_MODEL || '').trim() || DEFAULT_LLM_MODEL
  return { source: 'platform', endpoint: gateway, apiKey, model, metered: true, workspaceId }
}

/** Refuse (402) a metered call when the workspace has used this month's credits. */
export async function assertAiBudget(route: AiRoute): Promise<void> {
  if (!route.metered || !route.workspaceId) return
  const plan = await workspacePlan(route.workspaceId)
  const limit = plan.limits.aiCredits
  if (limit === null || plan.soft.aiCredits) return
  const used = await readUsage(route.workspaceId, 'aiCredits')
  if (used >= limit) throw planLimitError(plan, 'aiCredits', limit, used)
}

/** Count a finished call's credits (platform calls only; the edition prices them). */
export async function recordAiUsage(route: AiRoute, usage: { inputTokens?: number, outputTokens?: number, costUsd?: number | null }): Promise<void> {
  if (!route.metered || !route.workspaceId) return
  const credits = edition().aiCredits({ model: route.model, inputTokens: Number(usage.inputTokens || 0), outputTokens: Number(usage.outputTokens || 0), costUsd: usage.costUsd ?? null })
  if (credits > 0) await chargeUsage(route.workspaceId, 'aiCredits', Math.ceil(credits))
}

/** LiteLLM reports what a call cost in a header; other providers do not. */
export function reportedCost(headers: Headers | Record<string, string> | undefined | null): number | null {
  const raw = headers instanceof Headers ? headers.get('x-litellm-response-cost') : headers?.['x-litellm-response-cost']
  const value = Number(raw)
  return raw && Number.isFinite(value) && value >= 0 ? value : null
}

function routeFetch(route: AiRoute, timeoutMs = AI_TIMEOUT_MS): typeof fetch {
  if (route.source === 'platform') return fetch
  return ((input: RequestInfo | URL, init?: RequestInit) => safeFetch(input instanceof Request ? input.url : String(input), { ...init, timeoutMs })) as typeof fetch
}

/** An AI SDK model for the route (the email designer, error notes). */
export function aiSdkModel(route: AiRoute) {
  return createOpenAI({ apiKey: route.apiKey || 'none', baseURL: baseUrl(route.endpoint), fetch: routeFetch(route) }).chat(route.model)
}

export type ChatMessage = { role: string, content: string }

/** One OpenAI-style chat completion, budget-checked and metered. */
export async function chatCompletion(route: AiRoute, body: { messages: ChatMessage[], temperature?: number, max_tokens?: number }, options: { timeoutMs?: number } = {}): Promise<{ text: string, model: string }> {
  await assertAiBudget(route)
  const res = await routeFetch(route, options.timeoutMs)(chatCompletionsUrl(route.endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}) },
    body: JSON.stringify({ model: route.model, ...body })
  })
  if (!res.ok) throw new Error(`LLM endpoint returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const json = await res.json() as { choices?: { message?: { content?: string } }[], usage?: { prompt_tokens?: number, completion_tokens?: number } }
  await recordAiUsage(route, { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens, costUsd: reportedCost(res.headers) })
  const text = String(json?.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error('LLM returned an empty response')
  return { text, model: route.model }
}

type StepLike = { usage?: { inputTokens?: number, outputTokens?: number }, response?: { headers?: Record<string, string> } }

/** Meter an AI SDK run (every step it took, including a stopped turn's). */
export async function recordAiSteps(route: AiRoute, steps: readonly StepLike[] | undefined): Promise<void> {
  if (!route.metered || !steps?.length) return
  const costs = steps.map(step => reportedCost(step.response?.headers))
  const costUsd = costs.every(cost => cost !== null) ? costs.reduce((sum, cost) => sum! + cost!, 0) : null
  const inputTokens = steps.reduce((sum, step) => sum + Number(step.usage?.inputTokens || 0), 0)
  const outputTokens = steps.reduce((sum, step) => sum + Number(step.usage?.outputTokens || 0), 0)
  await recordAiUsage(route, { inputTokens, outputTokens, costUsd }).catch(error => console.warn('[ai] usage not recorded:', (error as Error).message))
}
