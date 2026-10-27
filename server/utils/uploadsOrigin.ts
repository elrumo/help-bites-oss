/** The origin uploaded files are served from (S3_PUBLIC_URL), or '' when unset or not an address. The panel loads images from it and from nowhere else. */
export function uploadsOrigin(env: Record<string, string | undefined> = process.env): string {
  try {
    const url = new URL(String(env.S3_PUBLIC_URL || '').trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch { return '' }
}
