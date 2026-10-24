import type { ItemAttachment } from '#shared/itemAttachments'
import { attachmentPrefix } from './conversations'

/** The attachments stored on a post or item row, in their stored shape. */
export function itemAttachments(value: unknown): ItemAttachment[] {
  if (!Array.isArray(value)) return []
  return value.filter((a): a is ItemAttachment => Boolean(a) && typeof a.url === 'string').map(a => ({ url: a.url, name: String(a.name || ''), mime: String(a.mime || ''), size: Number(a.size) || 0 }))
}

/** Every attachment must be one of this project's own uploads (the upload routes' keys start with the project id). */
export function assertOwnAttachments(project: ParseObject, attachments: ItemAttachment[] | undefined): void {
  const base = attachmentPrefix(project.id || '')
  if (attachments?.some(a => !a.url.startsWith(base))) throw createError({ statusCode: 400, statusMessage: 'Attachments must be files uploaded to this project' })
}
