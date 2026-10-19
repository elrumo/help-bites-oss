// What /v1/meta says about this deployment: the edition, where its source code
// is (the AGPL's offer of source) and whether anyone may sign up. Fetched once.

export type DeploymentMeta = { edition: 'community' | 'cloud', gitSha: string, sourceCodeUrl: string, signup: 'setup' | 'open' }

const FALLBACK: DeploymentMeta = { edition: 'community', gitSha: '', sourceCodeUrl: '/source', signup: 'setup' }
let loading: Promise<void> | null = null

export function useMeta() {
  const meta = useState<DeploymentMeta | null>('deployment-meta', () => null)
  if (import.meta.client && !meta.value && !loading) {
    loading = $fetch<DeploymentMeta>('/v1/meta').then((m) => { meta.value = m }).catch(() => { loading = null })
  }
  return computed(() => meta.value || FALLBACK)
}
