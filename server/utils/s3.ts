import { randomUUID } from 'node:crypto'
import { Client } from 'minio'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES, type Attachment } from '#shared/support'
import { compressImage, imageVariants, type ImageVariant, type ModernFormat } from './imageCompress'
import { KNOWLEDGE_DOC_MAX_BYTES, KNOWLEDGE_DOC_EXTENSIONS } from '#shared/knowledge'
import { formatLimit, itemFileMaxBytes, ITEM_FILE_TYPES, type ItemAttachment } from '#shared/itemAttachments'

// Attachments go straight to any S3-compatible bucket; Parse never sees them.
// Keys are unguessable and prefixed by project, so the message POST can check
// that an attachment URL belongs to the project it is posted into.
//
// ponytail: public-read bucket. Signed URLs if a project ever needs private
// attachments.

let client: Client | null = null
let bucketReady: Promise<void> | null = null

function useS3(): Client {
  if (client) return client
  const endPoint = process.env.S3_ENDPOINT
  const accessKey = process.env.S3_ACCESS_KEY
  const secretKey = process.env.S3_SECRET_KEY
  if (!endPoint || !accessKey || !secretKey) throw new Error('S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY must be set')
  client = new Client({
    endPoint,
    port: process.env.S3_PORT ? Number(process.env.S3_PORT) : undefined,
    useSSL: process.env.S3_USE_SSL !== 'false',
    accessKey,
    secretKey,
    region: process.env.S3_REGION || 'us-east-1'
  })
  return client
}

function bucket(): string {
  const name = process.env.S3_BUCKET
  if (!name) throw new Error('S3_BUCKET must be set')
  return name
}

async function ensureBucket(): Promise<void> {
  bucketReady ||= (async () => {
    const s3 = useS3()
    const name = bucket()
    if (!(await s3.bucketExists(name))) await s3.makeBucket(name)
    if (process.env.S3_SET_PUBLIC_POLICY !== 'false') {
      const policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${name}/*`] }] }
      await s3.setBucketPolicy(name, JSON.stringify(policy)).catch(err => console.warn('[s3] could not set public policy:', err.message))
    }
  })().catch((error) => {
    bucketReady = null
    throw error
  })
  return bucketReady
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/png': b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
  'image/jpeg': b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/gif': b => b.length > 6 && b.subarray(0, 6).toString('ascii').startsWith('GIF8'),
  'image/webp': b => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** Sniff the real type; the declared one is only a hint. */
export function detectImageMime(data: Buffer): string {
  for (const mime of ATTACHMENT_MIME_TYPES) if (MAGIC[mime]!(data)) return mime
  return ''
}

/**
 * Store an image. Its bytes count against the workspace's storage: the project's, or `workspaceId` for an upload that has no project.
 * With `compress`, it is first re-encoded smaller; with `formats`, it is stored as a set for a <picture> (modern formats, then a
 * fallback every client reads; `url` is the fallback). See imageCompress.ts. The 8 MB limit is on what was sent.
 */
export async function storeAttachment(data: Buffer, projectId: string, ownerId: string, workspaceId = '', options: { compress?: boolean, formats?: readonly ModernFormat[] } = {}): Promise<Attachment> {
  if (data.length > ATTACHMENT_MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 8 MB' })
  let mime = detectImageMime(data)
  if (!mime) throw createError({ statusCode: 415, statusMessage: 'Only PNG, JPEG, GIF and WebP images are accepted' })
  const sent = data.length
  const asked = Boolean(options.compress || options.formats?.length)
  const set = options.formats?.length ? await imageVariants(data, mime, options.formats) : null
  let compressed = false
  if (!set && asked) ({ data, mime, compressed } = await compressImage(data, mime))
  const files: ImageVariant[] = set ?? [{ format: 'png', mime, data }]

  const workspace = workspaceId || await workspaceIdOfProject(projectId)
  const total = files.reduce((sum, file) => sum + file.data.length, 0)
  await reserveUsage(workspace, 'storageBytes', total)
  const name = `${projectId}/${ownerId}/${randomUUID()}`
  const keys: string[] = []
  try {
    await ensureBucket()
    for (const file of files) {
      const key = `${name}.${EXT[file.mime]}`
      await useS3().putObject(bucket(), key, file.data, file.data.length, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=31536000, immutable' })
      keys.push(key)
    }
  } catch (error) {
    await Promise.all(keys.map(deleteDocumentObject))
    await chargeUsage(workspace, 'storageBytes', -total)
    throw error
  }
  const base = String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')
  const urlOf = (file: ImageVariant) => `${base}/${name}.${EXT[file.mime]}`
  const fallback = files[files.length - 1]!
  const result: Attachment = { url: urlOf(fallback), mime: fallback.mime, size: fallback.data.length }
  if (asked) Object.assign(result, { compressed: set ? true : compressed, originalSize: sent })
  if (set) {
    result.variants = set.map(file => ({ format: file.format, mime: file.mime, url: urlOf(file), size: file.data.length }))
    result.picture = pictureHtml(result.variants, '')
  }
  return result
}

/**
 * Store an image or file for a feedback post or board item. Images go through storeAttachment; a file is
 * kept only if its extension is on the list (shared/itemAttachments.ts) and is served as the type that
 * list says, as a download, whatever the upload claimed to be. Counts against the workspace's storage.
 */
export async function storeItemFile(file: { filename: string, data: Buffer }, projectId: string, ownerId: string): Promise<ItemAttachment> {
  const name = normalizeFilename(file.filename)
  if (detectImageMime(file.data)) {
    const stored = await storeAttachment(file.data, projectId, ownerId)
    return { url: stored.url, name, mime: stored.mime, size: stored.size }
  }
  const ext = (name.split('.').pop() || '').toLowerCase()
  const mime = ITEM_FILE_TYPES[ext]
  if (!mime) throw createError({ statusCode: 415, statusMessage: `Only images and ${Object.keys(ITEM_FILE_TYPES).join(', ')} files are accepted` })
  if (file.data.length > itemFileMaxBytes(mime)) throw createError({ statusCode: 413, statusMessage: `File is larger than ${formatLimit(itemFileMaxBytes(mime))}` })
  const workspace = await workspaceIdOfProject(projectId)
  await reserveUsage(workspace, 'storageBytes', file.data.length)
  const key = `${projectId}/${ownerId}/${randomUUID()}.${ext}`
  try {
    await ensureBucket()
    await useS3().putObject(bucket(), key, file.data, file.data.length, { 'Content-Type': mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=31536000, immutable' })
  } catch (error) {
    await chargeUsage(workspace, 'storageBytes', -file.data.length)
    throw error
  }
  return { url: `${String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')}/${key}`, name, mime, size: file.data.length }
}

/** A <picture> of stored variants (modern first, the fallback last as the <img>), for a post's HTML or a page. */
export function pictureHtml(variants: { mime: string, url: string }[], alt: string): string {
  const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const fallback = variants[variants.length - 1]
  if (!fallback) return ''
  const sources = variants.slice(0, -1).map(v => `<source type="${esc(v.mime)}" srcset="${esc(v.url)}">`).join('')
  return `<picture>${sources}<img src="${esc(fallback.url)}" alt="${esc(alt)}" loading="lazy"></picture>`
}

/** Store a public file under `key` (a brand kit's logo, PDF or favicon), counting its bytes against the workspace's storage. Returns its public URL. */
export async function storePublicFile(key: string, data: Buffer, mime: string, workspaceId: string): Promise<string> {
  await reserveUsage(workspaceId, 'storageBytes', data.length)
  try {
    await ensureBucket()
    await useS3().putObject(bucket(), key, data, data.length, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' })
  } catch (error) {
    await chargeUsage(workspaceId, 'storageBytes', -data.length)
    throw error
  }
  return `${String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')}/${key}`
}

/** Store a file that is only handed out through an authenticated route (a lead form upload), counting its bytes. Its key is never shown to anyone. */
export async function storeHiddenFile(key: string, data: Buffer, mime: string, workspaceId: string): Promise<void> {
  await reserveUsage(workspaceId, 'storageBytes', data.length)
  try {
    await ensureBucket()
    await useS3().putObject(bucket(), key, data, data.length, { 'Content-Type': mime, 'Content-Disposition': 'attachment', 'Cache-Control': 'private, no-store' })
  } catch (error) {
    await chargeUsage(workspaceId, 'storageBytes', -data.length)
    throw error
  }
}

export async function readUploadedImage(event: Parameters<typeof readMultipartFormData>[0]): Promise<Buffer> {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Send the image as multipart field "file"' })
  return Buffer.from(file.data)
}

// --- Knowledge source documents ---
// Stored under a `knowledge/<modelId>/<uuid>.<ext>` key and referenced only by
// that key (never a public URL), so downloads go through an authenticated admin
// route. ponytail: the bucket is public-read; a private bucket/prefix is the
// upgrade if the key ever needs to be a hard secret.

export type UploadedFile = { filename: string, mime: string, data: Buffer }

/** Read a multipart `file` field as an uploaded document (any type). */
export async function readUploadedFile(event: Parameters<typeof readMultipartFormData>[0]): Promise<UploadedFile> {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'Send the document as multipart field "file"' })
  return { filename: String(file.filename || 'document'), mime: String(file.type || ''), data: Buffer.from(file.data) }
}

function normalizeFilename(name: string): string {
  const base = String(name || 'document').split(/[\\/]/).pop() || 'document'
  return base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'document'
}

function docExtension(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  return (KNOWLEDGE_DOC_EXTENSIONS as readonly string[]).includes(ext) ? ext : ''
}

/** Validate and store a knowledge document; returns the storage key + metadata. */
export async function storeDocument(file: UploadedFile, modelId: string): Promise<{ storageKey: string, ext: string, mime: string, size: number }> {
  if (file.data.length > KNOWLEDGE_DOC_MAX_BYTES) throw createError({ statusCode: 413, statusMessage: `Document is larger than ${Math.round(KNOWLEDGE_DOC_MAX_BYTES / 1024 / 1024)} MB` })
  const ext = docExtension(normalizeFilename(file.filename))
  if (!ext) throw createError({ statusCode: 415, statusMessage: `Only ${KNOWLEDGE_DOC_EXTENSIONS.join(', ')} documents are accepted` })
  // Reject binary content masquerading as text (NUL byte in the first KB).
  if (file.data.subarray(0, 1024).includes(0)) throw createError({ statusCode: 415, statusMessage: 'Document does not look like text' })

  const model = await new (useParse()).Query('KnowledgeModel').select('workspace').get(modelId, MASTER).catch(() => null)
  const workspaceId = pointerId(model?.get('workspace'))
  await reserveUsage(workspaceId, 'storageBytes', file.data.length)
  const mime = ext === 'txt' ? 'text/plain' : 'text/markdown'
  const storageKey = `knowledge/${modelId}/${randomUUID()}.${ext}`
  try {
    await ensureBucket()
    await useS3().putObject(bucket(), storageKey, file.data, file.data.length, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'private, max-age=31536000, immutable' })
  } catch (error) {
    await chargeUsage(workspaceId, 'storageBytes', -file.data.length)
    throw error
  }
  return { storageKey, ext, mime, size: file.data.length }
}

/** Fetch a stored document's bytes (for the authenticated download route). */
export async function getDocumentBuffer(storageKey: string): Promise<Buffer> {
  const stream = await useS3().getObject(bucket(), storageKey)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export async function deleteDocumentObject(storageKey: string): Promise<void> {
  if (!storageKey) return
  await useS3().removeObject(bucket(), storageKey).catch(() => {})
}

// --- Workspace exports and deletion ---

export function s3Configured(): boolean {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET)
}

/** Upload a file from disk that is only ever handed out through a signed app link (a workspace export). */
export async function storePrivateFile(key: string, filePath: string, headers: Record<string, string>): Promise<void> {
  await ensureBucket()
  await useS3().fPutObject(bucket(), key, filePath, { ...headers, 'Cache-Control': 'private, no-store' })
}

/** Whether the bucket answers (the health check). */
export async function s3BucketReachable(): Promise<boolean> {
  return await useS3().bucketExists(bucket())
}

/** One stored object as a stream, for the app to hand out itself (S3 is often only reachable inside the stack). */
export async function readObjectStream(key: string): Promise<NodeJS.ReadableStream> {
  return await useS3().getObject(bucket(), key)
}

/**
 * Remove every object under a prefix (`<projectId>/`, `knowledge/<modelId>/`,
 * `exports/<workspaceId>/`), or only those written before `olderThan`.
 * Returns how many went.
 */
export async function removeObjectsUnder(prefix: string, olderThan?: Date): Promise<number> {
  // An empty or odd prefix could match the whole bucket.
  if (!/^[\w-]+\/(?:[\w-]+\/)?$/.test(prefix)) throw new Error(`Refusing to remove objects under "${prefix}"`)
  const keys: string[] = []
  for await (const item of listStoredObjects(prefix)) {
    if (!olderThan || (item.lastModified && item.lastModified < olderThan)) keys.push(item.name)
  }
  for (let i = 0; i < keys.length; i += 1000) await useS3().removeObjects(bucket(), keys.slice(i, i + 1000))
  return keys.length
}

/** Every object under a prefix: its key, size and when it was written. */
export async function* listStoredObjects(prefix: string): AsyncGenerator<{ name: string, size: number, lastModified?: Date }> {
  for await (const item of useS3().listObjectsV2(bucket(), prefix, true)) {
    if (item.name) yield { name: item.name, size: Number(item.size) || 0, lastModified: item.lastModified }
  }
}

/** A stored object's headers worth keeping, or null when it is not there. */
export async function statStoredObject(key: string): Promise<{ size: number, headers: Record<string, string> } | null> {
  const stat = await useS3().statObject(bucket(), key).catch(() => null)
  if (!stat) return null
  const meta = (stat.metaData || {}) as Record<string, unknown>
  const headers: Record<string, string> = {}
  for (const [header, name] of [['Content-Type', 'content-type'], ['Content-Disposition', 'content-disposition'], ['Cache-Control', 'cache-control']] as const) {
    if (typeof meta[name] === 'string' && meta[name]) headers[header] = meta[name] as string
  }
  return { size: stat.size, headers }
}

/** The public address of a key in this instance's bucket ('' without S3_PUBLIC_URL). */
export const publicBase = () => String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')

/** Store a file an import carried, counting its bytes against the workspace's storage. The caller removes it again if the import fails. */
export async function storeImportedFile(key: string, data: Buffer, headers: Record<string, string>, workspaceId: string): Promise<void> {
  await reserveUsage(workspaceId, 'storageBytes', data.length)
  try {
    await ensureBucket()
    await useS3().putObject(bucket(), key, data, data.length, headers)
  } catch (error) {
    await chargeUsage(workspaceId, 'storageBytes', -data.length)
    throw error
  }
}

/** Remove the objects an import stored (the keys it kept), and give their bytes back. */
export async function removeImportedFiles(files: { key: string, bytes: number }[], workspaceId: string): Promise<void> {
  for (const file of files) {
    await deleteDocumentObject(file.key)
    await chargeUsage(workspaceId, 'storageBytes', -file.bytes).catch(() => {})
  }
}
