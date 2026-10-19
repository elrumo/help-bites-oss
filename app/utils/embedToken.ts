// A standalone embed (no host frame: demos, tests, app web views) can take its
// identity token from the URL. `#token=` is the better place, since a fragment
// never reaches the server or its logs; `?token=` still works. Either way the
// token leaves the address bar, and so the history entry, once it is read.
export function takeUrlToken(): string {
  const url = new URL(location.href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const token = fragment.get('token') || url.searchParams.get('token') || ''
  if (!fragment.has('token') && !url.searchParams.has('token')) return token
  if (fragment.has('token')) url.hash = ''
  url.searchParams.delete('token')
  // Vue Router's own state rides along, or its scroll and back tracking break.
  history.replaceState(history.state, '', url.href)
  return token
}
