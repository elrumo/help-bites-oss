function isLoopback(url: string) {
  try {
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

// The connect/API snippets tell a website where to point at this deployment.
// The panel, widget.js and the API are all one origin, so the origin the
// operator is actually viewing is the real, reachable endpoint. A public
// APP_URL is an intentional override (e.g. a tunnel while you build the embed)
// and wins; an unset or loopback APP_URL carries no deployment info, so we fall
// back to the browsed origin rather than showing a stale localhost.
// ponytail: loopback list is the heuristic ceiling; extend it if a deploy uses
// another local host alias.
export function resolveAppUrl(configured: string, origin: string) {
  const clean = String(configured || '').replace(/\/+$/, '')
  if (clean && !isLoopback(clean)) return clean
  return origin || clean
}
