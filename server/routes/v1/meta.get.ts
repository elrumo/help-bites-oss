defineRouteMeta({
  openAPI: {
    tags: ['Meta'],
    summary: 'About this deployment',
    description: 'Which edition is running, where its source code is, and how operators join. Unauthenticated.',
    responses: { 200: { description: '`{ edition, gitSha, sourceCodeUrl, signup }`' } }
  }
})

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
  const { id, policy } = edition()
  return { edition: id, gitSha: String(process.env.GIT_SHA || ''), sourceCodeUrl: sourceCodeUrl(), signup: policy.signup }
})
