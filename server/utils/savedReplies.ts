import { createError } from 'h3'
import type { H3Event } from 'h3'
import { SAVED_REPLIES_PER_PROJECT, readSavedReplyInput, type SavedReply } from '#shared/savedReplies'

// A project's library of canned replies (admin CRUD under /v1/admin/saved-replies).
// The text is stored as typed, placeholders and all; the client fills
// {{firstName}} and {{name}} from the customer when it inserts one.

export async function getSavedReply(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('SavedReply').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Saved reply not found' })
  }
}

export function serializeSavedReply(row: ParseObject): SavedReply {
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    title: String(row.get('title') || ''),
    body: String(row.get('body') || ''),
    shortcut: String(row.get('shortcut') || ''),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

/** The project named by `?project=` or the body, which must be the caller's. */
export async function savedReplyProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) throw createError({ statusCode: 400, statusMessage: 'Pass ?project=<projectId>' })
  return await requireProject(ctx, named)
}

export async function listSavedReplies(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('SavedReply').equalTo('project', project).ascending('title').limit(SAVED_REPLIES_PER_PROJECT).find(MASTER)
}

/** 409 when another reply of the project already answers to the shortcut. */
async function assertShortcutFree(project: ParseObject, shortcut: string, exceptId = ''): Promise<void> {
  if (!shortcut) return
  const taken = await new (useParse()).Query('SavedReply').equalTo('project', project).equalTo('shortcut', shortcut).first(MASTER)
  if (taken && taken.id !== exceptId) throw createError({ statusCode: 409, statusMessage: `The shortcut "${shortcut}" belongs to another saved reply` })
}

export async function createSavedReply(project: ParseObject, agentId: string, payload: unknown): Promise<ParseObject> {
  const { values, errors } = readSavedReplyInput(payload, { create: true })
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  const Parse = useParse()
  if (await new Parse.Query('SavedReply').equalTo('project', project).count(MASTER) >= SAVED_REPLIES_PER_PROJECT) {
    throw createError({ statusCode: 409, statusMessage: `A project has at most ${SAVED_REPLIES_PER_PROJECT} saved replies` })
  }
  await assertShortcutFree(project, values.shortcut || '')
  const row = new (Parse.Object.extend('SavedReply'))() as ParseObject
  row.set('project', project)
  row.set('title', values.title)
  row.set('body', values.body)
  row.set('shortcut', values.shortcut || '')
  if (agentId) row.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  await row.save(null, MASTER)
  return row
}

export async function updateSavedReply(row: ParseObject, payload: unknown): Promise<ParseObject> {
  const { values, errors } = readSavedReplyInput(payload, { create: false })
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
  if (values.shortcut !== undefined) await assertShortcutFree(row.get('project') as ParseObject, values.shortcut, row.id || '')
  for (const [key, value] of Object.entries(values)) row.set(key, value)
  await row.save(null, MASTER)
  return row
}
