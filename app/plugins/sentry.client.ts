import * as Sentry from '@sentry/vue'

export default defineNuxtPlugin((nuxtApp) => {
  const dsn = useRuntimeConfig().public.sentryDsn
  if (dsn) Sentry.init({ app: nuxtApp.vueApp, dsn })
})
