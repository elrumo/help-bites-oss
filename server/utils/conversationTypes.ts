import { createError } from 'h3'
import {
  CONVERSATION_PRIORITIES,
  STATUS_CATEGORIES,
  clampText,
  type ConversationAction,
  type ConversationField,
  type ConversationPriority,
  type ConversationStatusDefinition,
  type ConversationType
} from '#shared/support'

export const SUPPORT_TYPE: ConversationType = {
  key: 'support', name: 'Support', description: '', icon: '',
  statuses: [
    { key: 'open', label: 'Open', category: 'open', isDefault: true },
    { key: 'done', label: 'Done', category: 'resolved', isTerminal: true, reopenTo: 'open' }
  ],
  fields: [], actions: [], assignable: true, userCanReopen: true, defaultPriority: 'normal'
}

export const ERROR_TYPE: ConversationType = {
  key: 'error', name: 'Error', description: '', icon: 'i-lucide-bug',
  statuses: [
    { key: 'open', label: 'Open', category: 'open', isDefault: true },
    { key: 'resolved', label: 'Resolved', category: 'resolved', isTerminal: true, reopenTo: 'open' },
    { key: 'closed', label: 'Ignored', category: 'closed', isTerminal: true, reopenTo: 'open' }
  ],
  fields: [], actions: [], assignable: true, userCanReopen: true, defaultPriority: 'normal'
}

export function serializeConversationType(row: ParseObject): ConversationType {
  return {
    id: row.id || '', projectId: pointerId(row.get('project')),
    key: String(row.get('key') || ''), name: String(row.get('name') || ''), description: String(row.get('description') || ''), icon: String(row.get('icon') || ''),
    statuses: Array.isArray(row.get('statuses')) ? row.get('statuses') : [],
    fields: Array.isArray(row.get('fields')) ? row.get('fields') : [],
    actions: Array.isArray(row.get('actions')) ? row.get('actions') : [],
    assignable: row.get('assignable') !== false,
    userCanReopen: row.get('userCanReopen') !== false,
    defaultPriority: (CONVERSATION_PRIORITIES as readonly string[]).includes(row.get('defaultPriority')) ? row.get('defaultPriority') : 'normal'
  }
}

/** Types the embed may offer as a request-type choice: every configured type
 *  (plus the implicit support preset), minus any the widget cannot submit — the
 *  embed only collects subject + body, so a type with a required user-facing
 *  field is left out rather than failing the send.
 *  ponytail: no per-type intake form in the embed; render fields here if needed. */
export async function listSelectableTypes(project: ParseObject): Promise<Pick<ConversationType, 'key' | 'name' | 'description' | 'icon'>[]> {
  const rows = await new (useParse()).Query('ConversationType').equalTo('project', project).ascending('name').find(MASTER)
  const types = rows.map(serializeConversationType)
  if (!types.some(type => type.key === 'support')) types.unshift({ ...SUPPORT_TYPE, projectId: project.id || '' })
  return types
    .filter(type => !type.fields.some(field => field.required && field.editableBy !== 'none' && field.editableBy !== 'agent' && !field.private))
    .map(type => ({ key: type.key, name: type.name, description: type.description, icon: type.icon }))
}

export async function getConversationType(project: ParseObject, key: unknown): Promise<ConversationType> {
  const wanted = clampText(key, 40) || 'support'
  const row = await new (useParse()).Query('ConversationType').equalTo('project', project).equalTo('key', wanted).first(MASTER)
  if (row) return serializeConversationType(row)
  if (wanted === 'support') return { ...SUPPORT_TYPE, projectId: project.id || '' }
  if (wanted === 'error') return { ...ERROR_TYPE, projectId: project.id || '' }
  throw createError({ statusCode: 400, statusMessage: `Unknown conversation type: ${wanted}` })
}

export function defaultStatus(type: ConversationType): ConversationStatusDefinition {
  return type.statuses.find(status => status.isDefault) || type.statuses[0] || SUPPORT_TYPE.statuses[0]!
}

export function statusDefinition(type: ConversationType, key: unknown): ConversationStatusDefinition {
  const status = type.statuses.find(item => item.key === key)
  if (!status) throw createError({ statusCode: 400, statusMessage: `Invalid status for ${type.key}` })
  return status
}

export function publicFields(values: Record<string, unknown>, type: ConversationType): Record<string, unknown> {
  const privateKeys = new Set(type.fields.filter(field => field.private).map(field => field.key))
  return Object.fromEntries(Object.entries(values || {}).filter(([key]) => !privateKeys.has(key)))
}

export function applyConversationTypeInput(row: ParseObject, input: Record<string, unknown>): void {
  const key = clampText(input.key, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (key) row.set('key', key)
  if (!row.get('key')) throw createError({ statusCode: 400, statusMessage: 'type key is required' })
  const name = clampText(input.name, 80)
  if (name) row.set('name', name)
  if (!row.get('name')) throw createError({ statusCode: 400, statusMessage: 'type name is required' })
  if ('description' in input) row.set('description', clampText(input.description, 300))
  if ('icon' in input) row.set('icon', clampText(input.icon, 80))
  if ('statuses' in input) row.set('statuses', normalizeStatuses(input.statuses))
  if ('fields' in input) row.set('fields', normalizeFields(input.fields))
  if ('actions' in input) row.set('actions', normalizeActions(input.actions))
  if ('assignable' in input) row.set('assignable', Boolean(input.assignable))
  if ('userCanReopen' in input) row.set('userCanReopen', Boolean(input.userCanReopen))
  if ('defaultPriority' in input && (CONVERSATION_PRIORITIES as readonly string[]).includes(String(input.defaultPriority))) row.set('defaultPriority', input.defaultPriority)
  if (!Array.isArray(row.get('statuses')) || !row.get('statuses').length) row.set('statuses', SUPPORT_TYPE.statuses)
  if (!row.get('defaultPriority')) row.set('defaultPriority', 'normal')
}

function uniqueKey(value: unknown): string {
  return clampText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function normalizeStatuses(value: unknown): ConversationStatusDefinition[] {
  if (!Array.isArray(value) || !value.length) throw createError({ statusCode: 400, statusMessage: 'At least one status is required' })
  const seen = new Set<string>()
  const statuses = value.slice(0, 20).map((item, index) => {
    const raw = item as Record<string, unknown>
    const key = uniqueKey(raw?.key)
    if (!key || seen.has(key)) throw createError({ statusCode: 400, statusMessage: 'Status keys must be unique' })
    seen.add(key)
    const category = String(raw?.category || '')
    if (!(STATUS_CATEGORIES as readonly string[]).includes(category)) throw createError({ statusCode: 400, statusMessage: 'Each status needs a valid category' })
    return { key, label: clampText(raw?.label, 80) || key, category: category as ConversationStatusDefinition['category'], ...(raw?.isDefault === true || index === 0 ? { isDefault: true } : {}), ...(raw?.isTerminal === true ? { isTerminal: true } : {}), ...(uniqueKey(raw?.reopenTo) ? { reopenTo: uniqueKey(raw?.reopenTo) } : {}) }
  })
  const defaults = statuses.filter(status => status.isDefault)
  if (defaults.length > 1) throw createError({ statusCode: 400, statusMessage: 'Only one default status is allowed' })
  return statuses
}

function normalizeFields(value: unknown): ConversationField[] {
  if (!Array.isArray(value)) throw createError({ statusCode: 400, statusMessage: 'fields must be an array' })
  const allowed = new Set(['text', 'longtext', 'select', 'url', 'number', 'bool'])
  const seen = new Set<string>()
  return value.slice(0, 50).map((item) => {
    const raw = item as Record<string, unknown>
    const key = uniqueKey(raw?.key)
    const type = String(raw?.type || '')
    if (!key || seen.has(key) || !allowed.has(type)) throw createError({ statusCode: 400, statusMessage: 'Each field needs a unique key and valid type' })
    seen.add(key)
    const options = Array.isArray(raw?.options) ? raw.options.map(option => clampText(option, 100)).filter(Boolean).slice(0, 50) : []
    if (type === 'select' && !options.length) throw createError({ statusCode: 400, statusMessage: 'Select fields need options' })
    const editableBy = raw?.editableBy === 'agent' || raw?.editableBy === 'none' ? raw.editableBy : 'user'
    return { key, label: clampText(raw?.label, 100) || key, type: type as ConversationField['type'], ...(raw?.required === true ? { required: true } : {}), ...(options.length ? { options } : {}), ...(raw?.private === true ? { private: true } : {}), editableBy }
  })
}

function normalizeActions(value: unknown): ConversationAction[] {
  if (!Array.isArray(value)) throw createError({ statusCode: 400, statusMessage: 'actions must be an array' })
  const seen = new Set<string>()
  return value.slice(0, 30).map((item) => {
    const raw = item as Record<string, unknown>
    const key = uniqueKey(raw?.key)
    if (!key || seen.has(key)) throw createError({ statusCode: 400, statusMessage: 'Action keys must be unique' })
    seen.add(key)
    return { key, label: clampText(raw?.label, 100) || key, ...(clampText(raw?.confirm, 300) ? { confirm: clampText(raw?.confirm, 300) } : {}), ...(raw?.destructive === true ? { destructive: true } : {}), ...(uniqueKey(raw?.statusAfter) ? { statusAfter: uniqueKey(raw?.statusAfter) } : {}), ...(raw?.requiresNote === true ? { requiresNote: true } : {}) }
  })
}
