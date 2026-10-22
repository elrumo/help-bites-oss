// Optional page-view stats for HelpBites' own site and panel (Plausible, cookieless): set
// NUXT_PUBLIC_PLAUSIBLE_SRC to the script's address (https://stats.example.com/js/pa-….js). Unset, nothing loads.
// Left out where it would watch someone else's visitors or leak a secret: the embeds (framed on connected sites)
// and the pages whose address carries a token. The script follows route changes itself.
const SKIP = /^\/(embed|invite|oauth)(\/|$)/

export default defineNuxtPlugin(() => {
  const src = useRuntimeConfig().public.plausibleSrc
  if (!src || SKIP.test(location.pathname)) return
  const w = window as any
  w.plausible = w.plausible || function (...args: unknown[]) { (w.plausible.q = w.plausible.q || []).push(args) }
  w.plausible.init = w.plausible.init || function (options?: unknown) { w.plausible.o = options || {} }
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.append(script)
  w.plausible.init()
})
