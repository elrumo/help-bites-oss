import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { DocumentStatus } from '#shared/knowledge'
import type { UploadedFile } from './s3'

// An uploaded source document. Versions share a lineageId; exactly one row per
// lineage is `isCurrent`. FAQs point back to the specific version row they came
// from (sourceDocument + sourceVersion), so provenance survives re-uploads.

export type KnowledgeDocument = {
  id: string
  modelId: string
  nodeId: string
  filename: string
  originalFilename: string
  mimeType: string
  size: number
  status: DocumentStatus
  checksum: string
  lineageId: string
  version: number
  isCurrent: boolean
  uploadedBy: string
  processedAt: string | null
  processingError: string
  importStats: Record<string, unknown>
  faqCount?: number
  createdAt: string | null
  updatedAt: string | null
}

/** Create a document row (version 1, or the next version of an existing lineage). */
export async function createDocumentRecord(opts: {
  modelId: string
  nodeId?: string
  file: UploadedFile
  stored: { storageKey: string, mime: string, size: number }
  lineageId?: string
  version?: number
  agentId?: string
}): Promise<ParseObject> {
  const Parse = useParse()
  const doc = new (Parse.Object.extend('KnowledgeDocument'))()
  doc.set('knowledgeModel', Parse.Object.extend('KnowledgeModel').createWithoutData(opts.modelId))
  if (opts.nodeId) doc.set('node', Parse.Object.extend('KnowledgeNode').createWithoutData(opts.nodeId))
  doc.set('filename', opts.file.filename)
  doc.set('originalFilename', opts.file.filename)
  doc.set('mimeType', opts.stored.mime)
  doc.set('size', opts.stored.size)
  doc.set('storageKey', opts.stored.storageKey)
  doc.set('checksum', createHash('sha256').update(opts.file.data).digest('hex'))
  doc.set('lineageId', opts.lineageId || randomUUID())
  doc.set('version', opts.version || 1)
  doc.set('isCurrent', true)
  doc.set('status', 'uploaded')
  if (opts.agentId) doc.set('uploadedBy', Parse.Object.extend('_User').createWithoutData(opts.agentId))
  await doc.save(null, MASTER)
  return doc
}

export async function getKnowledgeDocumentById(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('KnowledgeDocument').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }
}

/** Move a document through its status state machine; clears/records the error. */
export async function setDocumentStatus(doc: ParseObject, status: DocumentStatus, extra: { error?: string, stats?: Record<string, unknown> } = {}): Promise<void> {
  doc.set('status', status)
  if (status === 'processed') {
    doc.set('processedAt', new Date())
    doc.set('processingError', '')
  }
  if (status === 'failed' && extra.error) doc.set('processingError', String(extra.error).slice(0, 1000))
  if (extra.stats) doc.set('importStats', extra.stats)
  await doc.save(null, MASTER)
}

export async function countFaqsForDocument(docId: string): Promise<number> {
  const Parse = useParse()
  const doc = Parse.Object.extend('KnowledgeDocument').createWithoutData(docId)
  return new Parse.Query('Faq').equalTo('sourceDocument', doc).count(MASTER)
}

export function serializeKnowledgeDocument(doc: ParseObject): KnowledgeDocument {
  return {
    id: doc.id || '',
    modelId: pointerId(doc.get('knowledgeModel')),
    nodeId: pointerId(doc.get('node')),
    filename: String(doc.get('filename') || ''),
    originalFilename: String(doc.get('originalFilename') || ''),
    mimeType: String(doc.get('mimeType') || ''),
    size: Number(doc.get('size') || 0),
    status: (doc.get('status') as DocumentStatus) || 'uploaded',
    checksum: String(doc.get('checksum') || ''),
    lineageId: String(doc.get('lineageId') || ''),
    version: Number(doc.get('version') || 1),
    isCurrent: doc.get('isCurrent') !== false,
    uploadedBy: pointerId(doc.get('uploadedBy')),
    processedAt: iso(doc.get('processedAt')),
    processingError: String(doc.get('processingError') || ''),
    importStats: (doc.get('importStats') as Record<string, unknown>) || {},
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt)
  }
}
