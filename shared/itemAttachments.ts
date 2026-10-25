// Images and files on feedback posts and board items. The upload routes store the bytes and answer with
// one of these; a post or item keeps the list. The server also checks every url is one of the project's own uploads.

export type ItemAttachment = { url: string, name: string, mime: string, size: number }

export const ITEM_ATTACHMENTS_MAX = 10
export const ITEM_FILE_MAX_BYTES = 25 * 1024 * 1024

/** Files besides images (PNG, JPEG, GIF, WebP) that can be attached, with the type they are served as. Never HTML, SVG or scripts. */
export const ITEM_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  log: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4',
  mov: 'video/quicktime'
}

/** For a file picker's `accept`: images only, or images and files. */
export const ITEM_IMAGE_ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].join(',')
export const ITEM_ATTACHMENT_ACCEPT = [ITEM_IMAGE_ACCEPT, ...Object.keys(ITEM_FILE_TYPES).map(ext => `.${ext}`)].join(',')

export const isImageMime = (mime: string) => mime.startsWith('image/')

/** The attachments in a request body. Only the four known fields are kept; anything malformed is reported. */
export function readItemAttachments(raw: unknown, errors: string[]): ItemAttachment[] | undefined {
  if (raw === null) return []
  if (!Array.isArray(raw)) { errors.push('attachments must be an array'); return undefined }
  if (raw.length > ITEM_ATTACHMENTS_MAX) { errors.push(`At most ${ITEM_ATTACHMENTS_MAX} attachments`); return undefined }
  const out: ItemAttachment[] = []
  for (const item of raw) {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    if (!/^https?:\/\//i.test(url) || url.length > 2000) { errors.push('Every attachment needs the url its upload returned'); return undefined }
    out.push({
      url,
      name: String(entry.name ?? '').trim().slice(0, 200) || url.split('/').pop() || 'file',
      mime: String(entry.mime ?? '').slice(0, 100),
      size: Math.max(0, Number(entry.size) || 0)
    })
  }
  return out
}
