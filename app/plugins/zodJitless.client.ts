// zod (inside the AI SDK) probes for eval with `Function('')` before it picks
// a faster object parser. The script CSP (server/plugins/scriptCsp.ts) refuses
// eval, so the probe only logs a violation and zod falls back anyway: skip it.
// zod shares this one config object and reads it on its first parse, so this
// works whether or not zod has loaded yet.
export default defineNuxtPlugin(() => {
  const scope = globalThis as { __zod_globalConfig?: { jitless?: boolean } }
  const config = (scope.__zod_globalConfig ||= {})
  config.jitless = true
})
