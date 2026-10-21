// The domain-event bus is in-process: every process that emits an event also
// has to know which sequences wait for it.
export default defineNitroPlugin(() => {
  registerAutomations()
})
