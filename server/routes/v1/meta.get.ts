import { RELEASE_STAGE } from '#shared/version'

defineRouteMeta({
  openAPI: {
    tags: ['Meta'],
    summary: 'About this deployment',
    description: 'Which edition is running, where its source code is, how operators join, and the origin uploaded files are served from. Unauthenticated.',
    responses: { 200: { description: '`{ edition, version, stage, gitSha, sourceCodeUrl, signup, uploadsOrigin }`; `version` is the release ("0.2.0") and `stage` is "beta" while the product is in beta, else null' } }
  }
})

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60')
  const { id, policy } = edition()
  return { edition: id, version: useRuntimeConfig(event).public.version as string, stage: RELEASE_STAGE, gitSha: String(process.env.GIT_SHA || ''), sourceCodeUrl: sourceCodeUrl(), signup: policy.signup, uploadsOrigin: uploadsOrigin() }
})
