// A cloud build whose ee/ layer did not register would quietly behave like the
// community edition (open setup form, no limits). Check once every plugin has
// run, whatever order the layers' plugins load in, and refuse to serve.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  queueMicrotask(() => {
    if (useRuntimeConfig().public.edition === 'cloud' && edition().id !== 'cloud') {
      console.error('[edition] built as cloud, but the ee/ layer did not register; refusing to start')
      process.exit(1)
    }
  })
})
