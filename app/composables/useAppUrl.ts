import { resolveAppUrl } from '#shared/appUrl'

export { resolveAppUrl }

export function useAppUrl() {
  const config = useRuntimeConfig()
  return computed(() => resolveAppUrl(
    String(config.public.appUrl || ''),
    import.meta.client ? window.location.origin : ''
  ))
}
