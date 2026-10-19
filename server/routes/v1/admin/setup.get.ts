defineRouteMeta({
  openAPI: { tags: ['Agent'], summary: 'First-run check', description: 'True until the first agent account exists (community edition; the hosted edition has open sign-up instead). Unauthenticated. `needsToken` says the server wants its SETUP_TOKEN with the first account.', responses: { 200: { description: '{ needsSetup, needsToken, signup }' } } }
})

export default defineEventHandler(async () => {
  const { signup } = edition().policy
  const needsSetup = signup === 'setup' && (await countAgents()) === 0
  return { needsSetup, needsToken: needsSetup && Boolean(process.env.SETUP_TOKEN), signup }
})
