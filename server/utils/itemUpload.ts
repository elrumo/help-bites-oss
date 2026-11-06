import { createError } from 'h3'
import { formatLimit, ITEM_VIDEO_MAX_BYTES, itemFileMaxBytes } from '#shared/itemAttachments'
import { safeFetch } from './outbound'

/**
 * A planning attachment sent as JSON (the MCP tool, scripts): the bytes as `contentBase64`, or a public `url`
 * downloaded once through safeFetch (http(s) only, no private or metadata addresses, no redirects). A large
 * screenshot or recording rarely fits in a tool call, so `url` is the way to send one. Same size limits either way.
 */
export async function readJsonItemUpload(input: Record<string, unknown>): Promise<{ filename: string, data: Buffer }> {
  let filename = typeof input.filename === 'string' ? input.filename.trim() : ''
  const encoded = typeof input.contentBase64 === 'string' ? input.contentBase64 : ''
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!encoded === !url) throw createError({ statusCode: 400, statusMessage: 'Send the file as contentBase64 (with filename) or as url (one of them)' })
  let data: Buffer
  if (encoded) {
    if (!filename) throw createError({ statusCode: 400, statusMessage: 'Send filename with contentBase64' })
    if (encoded.length > Math.ceil(ITEM_VIDEO_MAX_BYTES * 4 / 3) + 4) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(ITEM_VIDEO_MAX_BYTES)}` })
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw createError({ statusCode: 400, statusMessage: 'contentBase64 must be valid base64' })
    data = Buffer.from(encoded, 'base64')
    if (!data.length || data.toString('base64') !== encoded) throw createError({ statusCode: 400, statusMessage: 'contentBase64 must be valid base64' })
  } else {
    const response = await safeFetch(url, { timeoutMs: 60_000, maxBytes: ITEM_VIDEO_MAX_BYTES })
    if (!response.ok) throw createError({ statusCode: 502, statusMessage: `${new URL(url).host} answered ${response.status}` })
    data = Buffer.from(await response.arrayBuffer().catch(() => { throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(ITEM_VIDEO_MAX_BYTES)}` }) }))
    if (!data.length) throw createError({ statusCode: 400, statusMessage: 'The url returned an empty file' })
    filename ||= decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'file'
  }
  const limit = itemFileMaxBytes(filename)
  if (data.length > limit) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(limit)}` })
  return { filename, data }
}
