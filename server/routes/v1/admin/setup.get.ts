defineRouteMeta({
  openAPI: { tags: ['Agent'], summary: 'First-run check', description: 'True until the first agent account exists (community edition; the hosted edition has open sign-up instead). Unauthenticated.', responses: { 200: { description: '{ needsSetup, signup }' } } }
})

export default defineEventHandler(async () => {
  const { signup } = edition().policy
  return { needsSetup: signup === 'setup' && (await countAgents()) === 0, signup }
})
