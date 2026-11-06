import { createError } from 'h3'
import { CMS_LIMITS } from '#shared/cms/content'
import type { UploadedFile } from './s3'
import { safeFetch } from './outbound'

/**
 * A Pages file sent as JSON (the MCP tool upload_cms_asset, scripts): the bytes as
 * `contentBase64`, or a public `url` downloaded once through safeFetch (http(s) only,
 * no private or metadata addresses, no redirects, capped at the asset limit).
 * `fields` are the multipart route's text fields: project, name, alt, compress, formats.
 */
export async function readJsonCmsUpload(input: Record<string, unknown>): Promise<{ fields: Record<string, string>, file: UploadedFile }> {
  const fields = Object.fromEntries(['project', 'name', 'alt', 'compress', 'formats'].filter(k => input[k] != null).map(k => [k, String(input[k])]))
  const encoded = typeof input.contentBase64 === 'string' ? input.contentBase64 : ''
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!encoded === !url) throw createError({ statusCode: 400, statusMessage: 'Send the file as contentBase64 or as url (one of them)' })
  const tooBig = `A file is at most ${CMS_LIMITS.assetBytes / 1024 / 1024} MB`
  let filename = typeof input.filename === 'string' ? input.filename.trim() : ''
  let data: Buffer
  if (encoded) {
    if (encoded.length > Math.ceil(CMS_LIMITS.assetBytes * 4 / 3) + 4) throw createError({ statusCode: 413, statusMessage: tooBig })
    data = Buffer.from(encoded, 'base64')
    if (!data.length || data.toString('base64') !== encoded) throw createError({ statusCode: 400, statusMessage: 'contentBase64 must be valid base64' })
  } else {
    const response = await safeFetch(url, { timeoutMs: 30_000, maxBytes: CMS_LIMITS.assetBytes })
    if (!response.ok) throw createError({ statusCode: 502, statusMessage: `${new URL(url).host} answered ${response.status}` })
    data = Buffer.from(await response.arrayBuffer().catch(() => { throw createError({ statusCode: 413, statusMessage: tooBig }) }))
    filename ||= new URL(url).pathname.split('/').pop() || ''
  }
  return { fields, file: { filename: filename || 'file', mime: '', data } }
}
