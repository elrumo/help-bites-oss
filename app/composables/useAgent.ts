import type { AdminProject } from '~~/server/utils/projects'
import type { WorkspaceSummary } from '~~/server/utils/workspaces'
import type { Role } from '#shared/roles'
import { UNLIMITED_PLAN, type PlanLimitData } from '#shared/entitlements'

// Agent session for the panel: the Parse session token lives in a cookie so a
// reload keeps you signed in; every /v1/admin call carries it as a bearer,
// and names the workspace it acts in with X-Workspace (remembered per browser,
// so two tabs stay in the workspace they were switched to on reload).

export type Agent = { id: string, username: string, email: string, name: string }

/** What /v1/admin/me says about where you are and what you may do. */
export type AgentContext = {
  workspace: WorkspaceSummary | null
  role: Role | null
  workspaces: WorkspaceSummary[]
  edition: 'community' | 'cloud'
  /** Unlimited on every self-hosted install, which hides plans from the panel. */
  plan: { id: string, name: string, unlimited: boolean }
  features: Record<string, boolean>
  /** What the edition adds to /me (the cloud edition: emailVerified, superAdmin, billing). Empty in community. */
  extras: Record<string, any>
}

/** A 402: what the plan ran out of, or doesn't include. PlanLimitModal shows it. */
export type PlanLimit = { message: string } & (PlanLimitData | { code?: undefined })

const WORKSPACE_KEY = 'hb-workspace'
function readWorkspace() {
  try { return localStorage.getItem(WORKSPACE_KEY) || '' } catch { return '' }
}
function writeWorkspace(id: string) {
  try { id ? localStorage.setItem(WORKSPACE_KEY, id) : localStorage.removeItem(WORKSPACE_KEY) } catch {}
}

export class ApiError extends Error {
  status: number
  /** The error's `data` from the server, e.g. `{ code: 'forbidden_role' }`. */
  data: Record<string, any>
  constructor(status: number, message: string, data: Record<string, any> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

// The landing page's demo answers every call from memory (utils/demoApi). The
// flag rides in sessionStorage so a reload stays in the demo, starting over.
const DEMO_KEY = 'hb-demo'
function readDemo() {
  try { return sessionStorage.getItem(DEMO_KEY) === '1' } catch { return false }
}

export function useAgent() {
  const token = useCookie<string | null>('sb_agent', { maxAge: 60 * 60 * 24 * 30, sameSite: 'lax', secure: import.meta.client && location.protocol === 'https:', default: () => null })
  const agent = useState<Agent | null>('agent', () => null)
  const projects = useState<AdminProject[]>('projects', () => [])
  const demo = useState('demo', () => import.meta.client && readDemo())
  const context = useState<AgentContext | null>('agent-context', () => null)
  const workspaceId = useState<string>('workspace-id', () => import.meta.client ? readWorkspace() : '')
  const planLimit = useState<PlanLimit | null>('plan-limit', () => null)

  /** Headers for any /v1/admin call made outside api() (uploads, downloads, streams). */
  function agentHeaders(): Record<string, string> {
    return {
      ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
      ...(workspaceId.value ? { 'X-Workspace': workspaceId.value } : {})
    }
  }

  function setDemo(on: boolean) {
    demo.value = on
    agent.value = null
    projects.value = []
    try { on ? sessionStorage.setItem(DEMO_KEY, '1') : sessionStorage.removeItem(DEMO_KEY) } catch {}
  }

  async function api<T = any>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, query?: Record<string, unknown> } = {}): Promise<T> {
    try {
      if (demo.value) return await (await import('~/utils/demoApi')).demoApi<T>(path, options)
      return await $fetch<T>(`/v1${path}`, {
        method: options.method || 'GET',
        body: options.body as any,
        query: options.query,
        headers: agentHeaders()
      })
    } catch (error: any) {
      const status = error?.statusCode || error?.status || 0
      const message = error?.data?.statusMessage || error?.data?.message || error?.message || 'Request failed'
      const data = error?.data?.data || {}
      if (status === 401) {
        token.value = null
        agent.value = null
        context.value = null
        await navigateTo('/login')
      } else if (status === 403 && error?.data?.data?.code === 'not_member' && workspaceId.value) {
        // Removed from this workspace (or it is gone): land wherever the server says is home.
        workspaceId.value = ''
        writeWorkspace('')
        await reloadNuxtApp({ path: '/inbox' })
      } else if (status === 402) {
        // The caller still gets the error; the modal says what ran out.
        planLimit.value = { message, ...data } as PlanLimit
      }
      throw new ApiError(status, message, data)
    }
  }

  async function login(username: string, password: string) {
    const result = await $fetch<{ sessionToken: string, agent: Agent }>('/v1/admin/login', { method: 'POST', body: { username, password } })
    if (demo.value) setDemo(false)
    token.value = result.sessionToken
    agent.value = result.agent
  }

  async function logout() {
    if (demo.value) {
      setDemo(false)
      return navigateTo('/')
    }
    await api('/admin/logout', { method: 'POST' }).catch(() => {})
    token.value = null
    agent.value = null
    context.value = null
    await navigateTo('/login')
  }

  async function ensureAgent(): Promise<Agent | null> {
    if (!token.value && !demo.value) return null
    // Signing in sets the agent but not the workspace context; /me brings both.
    if (agent.value && context.value) return agent.value
    try {
      const me = await api<{ agent: Agent } & AgentContext>('/admin/me')
      agent.value = me.agent
      context.value = { workspace: me.workspace, role: me.role, workspaces: me.workspaces || [], edition: me.edition || 'community', plan: me.plan || { id: UNLIMITED_PLAN.id, name: UNLIMITED_PLAN.name, unlimited: true }, features: me.features || {}, extras: me.extras || {} }
      // The server falls back to your default when the remembered one is gone.
      if (me.workspace && me.workspace.id !== workspaceId.value) {
        workspaceId.value = me.workspace.id
        if (!demo.value) writeWorkspace(me.workspace.id)
      }
      return me.agent
    } catch {
      return null
    }
  }

  /** Work in another workspace: everything on screen belongs to the old one, so start the panel over. */
  async function switchWorkspace(id: string) {
    if (!id || id === workspaceId.value) return
    workspaceId.value = id
    writeWorkspace(id)
    await api('/admin/me', { method: 'PATCH', body: { defaultWorkspaceId: id } }).catch(() => {})
    await reloadNuxtApp({ path: '/inbox' })
  }

  async function loadProjects(): Promise<AdminProject[]> {
    const { projects: list } = await api<{ projects: AdminProject[] }>('/admin/projects')
    projects.value = list
    return list
  }

  return { token, agent, projects, demo, context, workspaceId, planLimit, setDemo, api, agentHeaders, login, logout, ensureAgent, switchWorkspace, loadProjects }
}
