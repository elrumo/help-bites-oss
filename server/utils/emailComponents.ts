import { createError } from 'h3'
import type { EmailComponentField } from '#shared/email/blocks'
import { normalizeComponentInput, type EmailComponentDef } from '#shared/email/components'

// The component library (the rules live in shared/email/components.ts). A row
// without a project is shared by every project and master; a project's own
// components only show in that project's templates. Templates copy what they
// insert, so deleting or editing a row never changes an email already made.

export function serializeEmailComponent(row: ParseObject): EmailComponentDef {
  const fields = row.get('fields')
  return {
    id: row.id || '',
    name: String(row.get('name') || ''),
    description: String(row.get('description') || ''),
    html: String(row.get('html') || ''),
    fields: Array.isArray(fields) ? fields as EmailComponentField[] : [],
    projectId: pointerId(row.get('project')) || null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : undefined
  }
}

export async function getEmailComponent(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('EmailComponent').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Component not found' })
  }
}

/** A workspace's shared components, plus one of its projects' own (null: only the shared ones). */
export async function listEmailComponents(workspace: ParseObject, projectId: string | null): Promise<EmailComponentDef[]> {
  const Parse = useParse()
  const shared = new Parse.Query('EmailComponent').equalTo('workspace', workspace).doesNotExist('project')
  const query = projectId ? Parse.Query.or(shared, new Parse.Query('EmailComponent').equalTo('workspace', workspace).equalTo('project', Parse.Object.extend('Project').createWithoutData(projectId))) : shared
  return (await query.ascending('name').limit(1000).find(MASTER)).map(serializeEmailComponent)
}

/**
 * Validates a create or a partial update and applies it; `project: null`
 * shares a project's component with the rest of its workspace. A new row
 * takes the caller's workspace; a project must be one of it.
 */
export async function applyEmailComponentInput(ctx: MemberContext, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const current = row.id ? serializeEmailComponent(row) : { name: '', description: '', html: '', fields: [] }
  const merged: Record<string, unknown> = { name: current.name, description: current.description, html: current.html, fields: current.fields }
  for (const key of ['name', 'description', 'html', 'fields']) if (key in body) merged[key] = body[key]
  const res = normalizeComponentInput(merged)
  if (!res.ok) throw createError({ statusCode: 400, statusMessage: res.error })
  row.set('name', res.value.name)
  row.set('description', res.value.description)
  row.set('html', res.value.html)
  row.set('fields', res.value.fields)
  if (!row.get('workspace')) row.set('workspace', ctx.workspace)
  if ('project' in body) {
    if (body.project) row.set('project', await requireProject(ctx, String(body.project)))
    else row.unset('project')
  }
}
