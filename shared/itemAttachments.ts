// Images and files on feedback posts and board items. The upload routes store the bytes and answer with
// one of these; a post or item keeps the list. The server also checks every url is one of the project's own uploads.

export type ItemAttachment = { url: string, name: string, mime: string, size: number }

export const ITEM_ATTACHMENTS_MAX = 10
export const ITEM_FILE_MAX_BYTES = 25 * 1024 * 1024
/** Screen recordings run long: MP4 and MOV videos take up to 100 MB. */
export const ITEM_VIDEO_MAX_BYTES = 100 * 1024 * 1024

/** Files besides images (PNG, JPEG, GIF, WebP) with a type we vouch for. Any other file can be attached too, but is stored and served as an opaque download (`application/octet-stream`), never as a page. */
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

/** Programs and launchers that run when opened: refused whatever the rest of the filename says (a file's last extension decides). */
export const ITEM_BLOCKED_EXTENSIONS: readonly string[] = ['exe', 'dll', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'lnk', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'ps1', 'msc', 'reg', 'hta', 'jar', 'sh', 'command', 'app', 'apk', 'dmg', 'pkg']

/** The file's lowercase extension, without the dot ('' when there is none). */
export const itemFileExtension = (name: string) => (name.includes('.') ? name.split('.').pop() || '' : '').toLowerCase()

/** The type a file is served as: its known type, else an opaque download. */
export const itemFileMime = (name: string) => (Object.hasOwn(ITEM_FILE_TYPES, itemFileExtension(name)) ? ITEM_FILE_TYPES[itemFileExtension(name)]! : 'application/octet-stream')

/** Whether the first bytes are a Windows, Linux or macOS program, or a `#!` script: refused even under another extension. */
export function looksExecutable(head: Uint8Array): boolean {
  const at = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  return at(0x4D, 0x5A) || at(0x7F, 0x45, 0x4C, 0x46) || at(0x23, 0x21) || at(0xFE, 0xED, 0xFA, 0xCE) || at(0xFE, 0xED, 0xFA, 0xCF) || at(0xCE, 0xFA, 0xED, 0xFE) || at(0xCF, 0xFA, 0xED, 0xFE)
}

/** For a file picker's `accept`: images only, (anything: no `accept`). */
export const ITEM_IMAGE_ACCEPT = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].join(',')

export const isImageMime = (mime: string) => mime.startsWith('image/')
export const isVideoMime = (mime: string) => mime.startsWith('video/')
/** Images and videos open in the viewer; anything else is a download. */
export const isMediaMime = (mime: string) => isImageMime(mime) || isVideoMime(mime)

/** The largest upload for a file of this type (a MIME type or a filename's extension): video, else the file limit. */
export const itemFileMaxBytes = (mimeOrName: string) => (isVideoMime(mimeOrName) || /\.(mp4|mov)$/i.test(mimeOrName) ? ITEM_VIDEO_MAX_BYTES : ITEM_FILE_MAX_BYTES)
export const formatLimit = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

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
