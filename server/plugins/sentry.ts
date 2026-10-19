import * as Sentry from '@sentry/bun'

export default defineNitroPlugin((nitroApp) => {
  const dsn = useRuntimeConfig().public.sentryDsn
  if (!dsn) return
  Sentry.init({ dsn })
  nitroApp.hooks.hook('error', error => Sentry.captureException(error))
})
