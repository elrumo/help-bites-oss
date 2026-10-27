// A tool's answer goes into an assistant's context, and from there into transcripts, logs and whatever the customer text
// it is reading can talk it into repeating. So an answer never carries a secret the tool did not exist to hand over:
// the routes behind the tools serve the panel too, and a few of their records hold tokens (a template's share token, a
// tracker's webhook URL with its token in it). Those are cut here, at the last step, whatever route they came from.

/** Keys whose value is a credential, wherever they sit in an answer. */
const SECRET_KEYS = new Set([
  'shareToken', 'webhookToken', 'sessionToken', 'accessToken', 'refreshToken', 'botToken',
  'apiKey', 'clientSecret', 'secret', 'password', 'dsn'
])

/** A query parameter that carries a credential in a URL or a line of text. */
const SECRET_QUERY = /([?&](?:token|key|secret|signature|sig|api_?key|access_token)=)[^&\s"'<>]+/gi

export const REDACTED = '[left out]'

/** The value with credential keys removed and credentials in URLs blanked, without changing what it was made of. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 40) return value
  if (typeof value === 'string') return value.replace(SECRET_QUERY, `$1${REDACTED}`)
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key) && (typeof item === 'string' || typeof item === 'number')) out[key] = REDACTED
      else out[key] = redactSecrets(item, depth + 1)
    }
    return out
  }
  return value
}
