import { createHash } from 'node:crypto'
import { EMAIL_PREVIEW_RUNTIME } from '#shared/email/previewRuntime'

// A script policy for every page Nuxt renders (the panel's SPA shell, the
// embeds): an injected script would otherwise run next to the operator's token.
// The shell's inline scripts (runtime config, color mode, import map) change
// with the deploy and the environment, so each response hashes its own; JSON
// data blocks never run. The email editor's preview is a srcdoc frame, which
// inherits this policy, so its runtime is allowed by hash as well.
// Only script directives: styles, images and API calls stay as they were. The
// frame-ancestors that securityHeaders or the /embed route rules set is kept.
// Dev goes without: Vite's HMR needs inline scripts and eval.
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const NOT_RUN = /(?:^|\s)(?:src\s*=|type\s*=\s*["']?application\/(?:ld\+)?json)/i

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return
  const preview = sha256(EMAIL_PREVIEW_RUNTIME)

  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (typeof response.body !== 'string' || !String(response.headers?.['content-type'] || '').startsWith('text/html')) return
    const hashes = new Set([preview])
    for (const [, attrs = '', text = ''] of response.body.matchAll(INLINE_SCRIPT)) {
      if (!NOT_RUN.test(attrs)) hashes.add(sha256(text))
    }
    const policy = [String(getResponseHeader(event, 'content-security-policy') || ''), `script-src 'self' ${[...hashes].join(' ')}`, "object-src 'none'", "base-uri 'self'"]
    response.headers = { ...response.headers, 'content-security-policy': policy.filter(Boolean).join('; ') }
  })
})
