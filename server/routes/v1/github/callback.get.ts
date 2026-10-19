defineRouteMeta({ openAPI: { tags: ['GitHub'], summary: 'GitHub install callback', description: 'Where GitHub sends the browser after the app is installed (the app\'s Setup URL). The signed `state` and the OAuth `code` are the credentials. Redirects to /projects with `?github=connected` or the reason it failed.', responses: { 302: { description: 'Redirect to the panel' } } } })

export default defineEventHandler(async (event) => {
  await rateLimit(`sb:rl:github:${clientIp(event) || 'ip'}`, 30, 600)
  const query = getQuery(event)
  const done = (result: string) => sendRedirect(event, `/projects?github=${encodeURIComponent(result)}`, 302)
  // An organisation owner still has to approve: nothing is installed yet.
  if (query.setup_action === 'request') return done('An owner of the GitHub organisation has to approve the request first. Connect again once they have.')
  try {
    await completeInstall({ state: String(query.state || ''), code: String(query.code || ''), installationId: String(query.installation_id || '') })
    return done('connected')
  } catch (error) {
    return done((error as { statusMessage?: string }).statusMessage || 'Could not connect GitHub')
  }
})
