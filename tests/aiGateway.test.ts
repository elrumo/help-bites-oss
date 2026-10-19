import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { definePlan, UNLIMITED_PLAN, type Plan } from '../shared/entitlements'
import { pointerId } from '../server/utils/parse'
import * as editionModule from '../server/utils/edition'
import * as secrets from '../server/utils/secrets'

const g = globalThis as Record<string, unknown>
Object.assign(g, editionModule, secrets)
g.pointerId = pointerId
let plan: Plan = UNLIMITED_PLAN
let used = 0
const charged: number[] = []
g.workspacePlan = async () => plan
g.hasFeature = async (_ref: unknown, feature: keyof Plan['features']) => plan.features[feature]
g.readUsage = async () => used
g.chargeUsage = async (_ref: unknown, _metric: string, amount: number) => { charged.push(amount) }
g.planLimitError = (p: Plan, metric: string, limit: number, n: number) => Object.assign(new Error('limit'), { statusCode: 402, data: { code: 'plan_limit', metric, limit, used: n, plan: p.id } })
g.getWorkspace = async () => null
const fetched: { url: string, init: RequestInit }[] = []
g.safeFetch = async (url: string, init: RequestInit) => {
  fetched.push({ url, init })
  return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } })
}

const ai = await import('../server/utils/aiGateway')

type Fields = Record<string, unknown>
const row = (id: string, fields: Fields = {}) => {
  const data = { ...fields }
  return { id, get: (key: string) => data[key], set: (key: string, value: unknown) => { data[key] = value }, unset: (key: string) => { delete data[key] }, data }
}

const env = { ...process.env }
beforeEach(() => {
  plan = UNLIMITED_PLAN
  used = 0
  charged.length = 0
  fetched.length = 0
  process.env.LITELLM_API_BASE_URL = 'https://gateway.internal/v1'
  process.env.LITELLM_API_KEY = 'server-key'
  delete process.env.LLM_DEFAULT_MODEL
  process.env.HELPBITES_SECRET = 'x'.repeat(40)
})
afterEach(() => {
  editionModule.resetEdition()
  process.env = { ...env }
})

describe('where an AI call goes', () => {
  test('an assistant with its own endpoint uses it, with its own key, unmetered', async () => {
    const assistant = row('A1', { endpoint: 'https://api.openai.com/v1', apiKey: secrets.storeCredential('sk-assistant'), model: 'gpt-4o', workspace: { id: 'W1' } })
    const route = await ai.resolveAi(null, { assistant: assistant as never })
    expect(route).toMatchObject({ source: 'assistant', endpoint: 'https://api.openai.com/v1', apiKey: 'sk-assistant', model: 'gpt-4o', metered: false, workspaceId: 'W1' })
  })

  test('the server\'s key never goes to an endpoint that is not the server\'s gateway', async () => {
    const assistant = row('A1', { endpoint: 'https://evil.example/v1' })
    expect((await ai.resolveAi(null, { assistant: assistant as never }))!.apiKey).toBe('')
  })

  test('the workspace\'s own provider comes next, when the plan allows it', async () => {
    const workspace = row('W1')
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://openrouter.ai/api/v1', model: 'meta/llama', ultraModel: 'anthropic/big', apiKey: 'or-key' })
    expect(await ai.resolveAi(workspace as never)).toMatchObject({ source: 'workspace', apiKey: 'or-key', model: 'meta/llama', metered: false })
    expect((await ai.resolveAi(workspace as never, { ultra: true }))!.model).toBe('anthropic/big')
    plan = definePlan({ id: 'free', name: 'Free', features: { byoLlm: false } })
    expect((await ai.resolveAi(workspace as never))!.source).toBe('platform')
  })

  test('otherwise the server\'s gateway, metered, with the server\'s key', async () => {
    const route = await ai.resolveAi(row('W1') as never, { model: 'openai/mimo-v2.6-pro' })
    expect(route).toMatchObject({ source: 'platform', endpoint: 'https://gateway.internal/v1', apiKey: 'server-key', model: 'openai/mimo-v2.6-pro', metered: true, workspaceId: 'W1' })
    // An assistant pointed at the gateway itself is the gateway too.
    const assistant = row('A1', { endpoint: 'https://gateway.internal', workspace: { id: 'W1' } })
    expect((await ai.resolveAi(null, { assistant: assistant as never }))!.source).toBe('platform')
  })

  test('nothing configured anywhere: no AI', async () => {
    delete process.env.LITELLM_API_BASE_URL
    expect(await ai.resolveAi(row('W1') as never)).toBeNull()
  })
})

describe('the workspace AI form', () => {
  test('stores the key sealed and never hands it back', () => {
    const workspace = row('W1')
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-secret' })
    expect(JSON.stringify(workspace.data)).not.toContain('sk-secret')
    expect(ai.serializeWorkspaceAi(workspace as never)).toEqual({ endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', ultraModel: '', hasApiKey: true })
  })

  test('a saved key stays when the form leaves it out, but not when the endpoint changes', () => {
    const workspace = row('W1')
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://api.openai.com/v1', apiKey: 'sk-secret' })
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://api.openai.com/v1/', model: 'gpt-4o' })
    expect(ai.readWorkspaceAi(workspace as never)!.apiKey).toBe('sk-secret')
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://other.example/v1' })
    expect(ai.readWorkspaceAi(workspace as never)!.hasApiKey).toBe(false)
  })

  test('an empty endpoint turns it off', () => {
    const workspace = row('W1')
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: 'https://api.openai.com/v1', apiKey: 'k' })
    ai.applyWorkspaceAiInput(workspace as never, { endpoint: '' })
    expect(ai.readWorkspaceAi(workspace as never)).toBeNull()
  })
})

describe('credits', () => {
  const platform = { source: 'platform' as const, endpoint: 'https://gateway.internal/v1', apiKey: '', model: 'm', metered: true, workspaceId: 'W1' }

  test('a metered call is refused once the month\'s credits are used', async () => {
    plan = definePlan({ id: 'free', name: 'Free', limits: { aiCredits: 300 } })
    used = 299
    await ai.assertAiBudget(platform)
    used = 300
    await expect(ai.assertAiBudget(platform)).rejects.toMatchObject({ statusCode: 402, data: { metric: 'aiCredits' } })
    // Your own provider is never refused.
    await ai.assertAiBudget({ ...platform, source: 'workspace', metered: false })
  })

  test('the edition prices each call; the community edition charges nothing', async () => {
    await ai.recordAiUsage(platform, { inputTokens: 1000, outputTokens: 1000 })
    expect(charged).toEqual([])
    editionModule.registerEdition({ id: 'cloud', aiCredits: call => (call.costUsd ?? 0) / 0.001 })
    await ai.recordAiUsage(platform, { costUsd: 0.0123 })
    expect(charged).toEqual([13])
  })

  test('a multi-step run adds up every step, and uses the gateway\'s own cost only when every step reports it', async () => {
    const seen: unknown[] = []
    editionModule.registerEdition({ id: 'cloud', aiCredits: (call) => { seen.push(call); return 1 } })
    await ai.recordAiSteps(platform, [
      { usage: { inputTokens: 100, outputTokens: 10 }, response: { headers: { 'x-litellm-response-cost': '0.002' } } },
      { usage: { inputTokens: 200, outputTokens: 20 }, response: { headers: { 'x-litellm-response-cost': '0.003' } } }
    ])
    await ai.recordAiSteps(platform, [{ usage: { inputTokens: 5, outputTokens: 5 } }, { usage: { inputTokens: 5, outputTokens: 5 }, response: { headers: { 'x-litellm-response-cost': '0.1' } } }])
    expect(seen).toEqual([
      { model: 'm', inputTokens: 300, outputTokens: 30, costUsd: 0.005 },
      { model: 'm', inputTokens: 10, outputTokens: 10, costUsd: null }
    ])
  })

  test('a chat completion to your own provider goes through the outbound guard', async () => {
    const route = { source: 'workspace' as const, endpoint: 'https://api.openai.com', apiKey: 'k', model: 'gpt-4o-mini', metered: false, workspaceId: 'W1' }
    expect(await ai.chatCompletion(route, { messages: [{ role: 'user', content: 'hi' }] })).toEqual({ text: 'OK', model: 'gpt-4o-mini' })
    expect(fetched[0]!.url).toBe('https://api.openai.com/v1/chat/completions')
    expect((fetched[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })
})

describe('stored credentials', () => {
  test('are sealed with a root secret, kept as written without one, and old plain ones still read', () => {
    const sealed = secrets.storeCredential('sk-1')
    expect(sealed).not.toContain('sk-1')
    expect(secrets.readCredential(sealed)).toBe('sk-1')
    expect(secrets.readCredential('sk-legacy-plain')).toBe('sk-legacy-plain')
    delete process.env.HELPBITES_SECRET
    expect(secrets.storeCredential('sk-2')).toBe('sk-2')
  })
})
