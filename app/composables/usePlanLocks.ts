import type { Feature } from '#shared/entitlements'

// Which features the workspace's plan leaves out, so the panel can say so
// before anyone fills in a form and meets the 402. An unlimited plan (every
// self-hosted install) locks nothing, and neither does a plan not loaded yet.
export function usePlanLocks() {
  const { context } = useAgent()
  function locked(feature: Feature | null | undefined): boolean {
    const plan = context.value
    return !!feature && !!plan && !plan.plan.unlimited && plan.features[feature] === false
  }
  return { locked }
}
