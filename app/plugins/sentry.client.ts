import * as Sentry from '@sentry/vue'

// An embed can open with its identity token in the URL (#token= or ?token=).
// The address bar is scrubbed on load, but the first navigation may already be noted.
const scrub = (url: unknown) => (typeof url === 'string' ? url.replace(/([?&#])token=[^&#]*/g, '$1token=[scrubbed]') : url)

export default defineNuxtPlugin((nuxtApp) => {
  const dsn = useRuntimeConfig().public.sentryDsn
  if (!dsn) return
  Sentry.init({
    app: nuxtApp.vueApp,
    dsn,
    beforeBreadcrumb(crumb) {
      for (const key of ['from', 'to', 'url']) if (crumb.data && key in crumb.data) crumb.data[key] = scrub(crumb.data[key])
      return crumb
    },
    beforeSend(event) {
      if (event.request?.url) event.request.url = scrub(event.request.url) as string
      return event
    }
  })
})
