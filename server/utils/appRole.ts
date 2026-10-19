// One image, several jobs (APP_ROLE). A small install runs everything in one
// process ("all", the default). The hosted edition splits it:
//   web      — the panel, the API, the widget: scale it out freely;
//   worker   — schedulers, the job queue, pushes, background syncs: whatever
//              must happen once, not once per web replica;
//   embedder — the local embedding model (about 1.5 GB), loaded once and
//              served to the others at /v1/internal/embeddings.

export type AppRole = 'all' | 'web' | 'worker' | 'embedder'

const ROLES: AppRole[] = ['all', 'web', 'worker', 'embedder']

export function appRole(env: Record<string, string | undefined> = process.env): AppRole {
  const role = String(env.APP_ROLE || 'all').trim().toLowerCase() as AppRole
  return ROLES.includes(role) ? role : 'all'
}

/** Background work runs here: workers, schedulers, the job runner, pushes. */
export function runsWorkers(env?: Record<string, string | undefined>): boolean {
  const role = appRole(env)
  return role === 'all' || role === 'worker'
}

/** The local embedding model may be loaded here. */
export function servesEmbeddings(env?: Record<string, string | undefined>): boolean {
  const role = appRole(env)
  return role === 'all' || role === 'embedder'
}
