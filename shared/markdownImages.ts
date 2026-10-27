// Which images the panel loads on its own when it shows Markdown someone else wrote (FAQ answers, feedback and comments,
// changelog entries). A remote image is a request to a stranger's server the moment the operator opens the item, and its
// address can carry whatever the writer, or an assistant a stranger steered, put there. So only the panel's own origin,
// the uploads storage and small inline images are loaded; any other address is shown as a link the operator may follow.

export type ImageOrigins = {
  /** The panel's own origin (`location.origin`). */
  self: string
  /** The origin of the uploads storage (S3_PUBLIC_URL), '' when unknown. */
  uploads: string
}

export function imageAllowed(src: string | null | undefined, origins: ImageOrigins): boolean {
  const value = String(src || '').trim()
  if (!value) return false
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return true
  // `//host/x` is another origin; `/x` is this one.
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\')
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return [origins.self, origins.uploads].some(origin => Boolean(origin) && url.origin === origin)
}

/** The address a blocked image is offered as a link to: http(s) only. */
export function imageLink(src: string | null | undefined): string {
  try {
    const url = new URL(String(src || '').trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch { return '' }
}
