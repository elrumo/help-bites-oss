// The hosted sign-up page: link to it, or put it in an iframe.

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  const project = await findProjectByPublicKey(getRouterParam(event, 'publicKey') || '')
  if (!project) {
    setResponseStatus(event, 404)
    return invalidLinkPage()
  }
  return signupPage(project, { sent: getQuery(event).sent === '1', poweredBy: await poweredByFor(project) })
})
