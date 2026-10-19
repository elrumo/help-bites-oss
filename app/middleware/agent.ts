export default defineNuxtRouteMiddleware(async (to) => {
  const { ensureAgent, context, demo } = useAgent()
  const agent = await ensureAgent()
  if (!agent) return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} })
  // Signed in but in no workspace (removed from the last one): start one.
  if (!demo.value && !context.value?.workspace && to.path !== '/workspaces/new') return navigateTo('/workspaces/new')
})
