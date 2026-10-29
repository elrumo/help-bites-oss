// Minimal Parse REST helper for the maintenance scripts (no SDK, no Nuxt).
// Bun auto-loads .env from the repo root.

const REQUIRED = ['PARSE_ID', 'PARSE_MASTER_KEY', 'PARSE_URL']

export function env(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function assertEnv() {
  for (const name of REQUIRED) env(name)
}

export function headers() {
  return {
    'X-Parse-Application-Id': env('PARSE_ID'),
    'X-Parse-Master-Key': env('PARSE_MASTER_KEY'),
    'Content-Type': 'application/json'
  }
}

export function url(path) {
  return `${env('PARSE_URL').replace(/\/+$/, '')}${path}`
}

export async function parseFetch(path, init = {}) {
  const response = await fetch(url(path), { ...init, headers: { ...headers(), ...(init.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/** A request as a stranger would make it: the app id and nothing else (plus the client key, when the server asks for one). */
export async function parseFetchAnonymous(path) {
  const clientKey = process.env.PARSE_CLIENT_KEY?.trim()
  const response = await fetch(url(path), { headers: { 'X-Parse-Application-Id': env('PARSE_ID'), ...(clientKey ? { 'X-Parse-Client-Key': clientKey } : {}) } })
  return { ok: response.ok, status: response.status }
}
