/**
 * Pure operations over an EmailDocument. These are the *only* mutations the AI
 * tools (server/utils/emailAi.ts) and the client editor perform, so behaviour
 * stays identical on both sides. Every op returns a new document (immutably)
 * and never throws on a missing id — it reports via the returned `ok`/`message`
 * so the AI gets useful tool feedback.
 */
import {
  childLists,
  coerceNumberLike,
  DEFAULT_SETTINGS,
  defaultBlock,
  findBlock,
  locateBlock,
  normalizePadding,
  type EmailBlock,
  type EmailBlockType,
  type EmailDocument,
  walkBlocks
} from './blocks'
import { componentValues, normalizeComponentFields } from './components'

export interface OpResult {
  ok: boolean
  message: string
  doc: EmailDocument
}

/** Where a block goes: inside a section, or one column of a columns block. */
export type BlockParent = { id: string, column?: number }

const NUMERIC_BLOCK_FIELDS = new Set(['level', 'fontSize', 'radius', 'width', 'thickness', 'height', 'gap', 'gradientAngle', 'letterSpacing'])
const NUMERIC_SETTINGS_FIELDS = new Set(['contentWidth'])
/** Containers nest at most this deep; anything deeper is dropped. */
const MAX_DEPTH = 6
/** The most a stored document may weigh (its JSON, in characters). */
export const MAX_DOCUMENT_CHARS = 512 * 1024

function clone(doc: EmailDocument): EmailDocument {
  try {
    return structuredClone(doc)
  } catch {
    return JSON.parse(JSON.stringify(doc)) as EmailDocument
  }
}

let _counter = 0
/** Stable-ish block id. Time-free (works in workflow scripts/SSR) + a counter. */
export function newBlockId(): string {
  _counter = (_counter + 1) % 1_000_000
  return `blk_${_counter.toString(36)}${Math.round(performance.now()).toString(36)}`
}

/** Put an updated block (matched by `block.id`) back in place anywhere in the tree. */
function putBlock(blocks: EmailBlock[], updated: EmailBlock): boolean {
  const at = locateBlock(blocks, updated.id)
  if (at) at.list[at.index] = updated
  return !!at
}

/** Remove a block by id anywhere in the tree. */
function removeBlockById(blocks: EmailBlock[], id: string): boolean {
  const at = locateBlock(blocks, id)
  if (at) at.list.splice(at.index, 1)
  return !!at
}

// Parse (Mongo) refuses keys with '.' or a leading '$' at any depth; drop any the AI invents.
function safeKeys(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([k]) => !k.includes('.') && !k.startsWith('$')).map(([k, v]) => [k, safeValue(v)]))
}

function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue)
  return value && typeof value === 'object' ? safeKeys(value as Record<string, unknown>) : value
}

/** What normalizing left out, so a tool can say so instead of losing it silently. */
type Normalizing = { seen: Set<string>, dropped: string[] }

function droppedNote(dropped: string[]): string {
  return dropped.length ? ` Dropped ${dropped.length} block(s): ${[...new Set(dropped)].join(', ')}.` : ''
}

const BLOCK_TYPES = new Set(['heading', 'text', 'button', 'image', 'divider', 'spacer', 'columns', 'html', 'section', 'component'])

/**
 * Make an untrusted block (the AI's, an import's) safe to render: known type,
 * a unique id, every field its type needs, numbers as numbers. Unknown blocks
 * are dropped rather than crashing the renderer.
 */
function normalizeBlock(raw: unknown, ctx: Normalizing, depth = 0): EmailBlock | null {
  const input = raw as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || !BLOCK_TYPES.has(String(input.type))) {
    ctx.dropped.push(input && typeof input === 'object' ? `unknown type "${String(input.type ?? '')}"` : 'not a block')
    return null
  }
  const type = input.type as EmailBlockType
  const { seen } = ctx
  const id = typeof input.id === 'string' && input.id && !seen.has(input.id) ? input.id : newBlockId()
  seen.add(id)
  const block = { ...defaultBlock(type, id), ...safeKeys(input), id, type } as Record<string, unknown>
  for (const field of NUMERIC_BLOCK_FIELDS) {
    if (field in block && block[field] !== undefined) block[field] = coerceNumberLike(block[field], 0)
  }
  if ('padding' in block) block.padding = normalizePadding(block.padding)
  if (type === 'heading') block.level = Math.min(3, Math.max(1, Math.round(Number(block.level) || 2)))
  const children = (list: unknown) => {
    const items = Array.isArray(list) ? list : []
    if (depth >= MAX_DEPTH && items.length) ctx.dropped.push(`nested deeper than ${MAX_DEPTH} levels`)
    return depth >= MAX_DEPTH ? [] : items.map(child => normalizeBlock(child, ctx, depth + 1)).filter(Boolean)
  }
  if (type === 'columns') {
    const cols = Array.isArray(input.columns) && input.columns.length ? input.columns.slice(0, 4) : [[], []]
    block.columns = cols.map(children)
  }
  if (type === 'section') block.blocks = children(input.blocks)
  for (const field of ['text', 'html', 'label', 'href', 'src', 'alt', 'componentId', 'name']) {
    if (field in block && typeof block[field] !== 'string') block[field] = String(block[field] ?? '')
  }
  if (type === 'component') {
    block.fields = normalizeComponentFields(String(block.html), input.fields)
    block.values = componentValues(block.fields as never, input.values)
  }
  return block as unknown as EmailBlock
}

export function normalizeDocument(raw: unknown, dropped: string[] = []): EmailDocument {
  const input = (raw || {}) as { settings?: unknown, blocks?: unknown }
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings && typeof input.settings === 'object' ? safeKeys(input.settings as Record<string, unknown>) : {}) } as EmailDocument['settings']
  settings.contentWidth = coerceNumberLike(settings.contentWidth, DEFAULT_SETTINGS.contentWidth) || DEFAULT_SETTINGS.contentWidth
  const ctx: Normalizing = { seen: new Set(), dropped }
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).map(b => normalizeBlock(b, ctx)).filter((b): b is EmailBlock => !!b)
  return { settings, blocks }
}

/** Replace the entire document (settings + blocks), normalized so it always renders. */
export function setDocument(doc: EmailDocument, next: EmailDocument): OpResult {
  if (!Array.isArray((next as { blocks?: unknown } | null)?.blocks)) return { ok: false, message: 'The document needs a blocks array; nothing changed.', doc }
  const dropped: string[] = []
  const out = normalizeDocument(clone(next), dropped)
  return { ok: true, message: `Replaced the email with ${out.blocks.length} top-level block(s).${droppedNote(dropped)}`, doc: out }
}

/** Patch document-level settings (subject, colors, width, fonts…). */
export function updateSettings(doc: EmailDocument, patch: Partial<EmailDocument['settings']>): OpResult {
  const next = clone(doc)
  const normalized = { ...patch } as Record<string, unknown>
  for (const field of NUMERIC_SETTINGS_FIELDS) {
    if (field in normalized) {
      const current = next.settings[field as keyof EmailDocument['settings']]
      normalized[field] = coerceNumberLike(normalized[field], typeof current === 'number' ? current : 0)
    }
  }
  next.settings = { ...next.settings, ...normalized }
  return { ok: true, message: 'Updated email settings.', doc: next }
}

/**
 * Shallow-merge a patch into one block (by id). Type is never changed. A
 * component's `values` merge too, so a patch can change one field.
 */
export function updateBlock(doc: EmailDocument, id: string, patch: Record<string, unknown>): OpResult {
  const next = clone(doc)
  const target = findBlock(next.blocks, id)
  if (!target) return { ok: false, message: `No block with id "${id}".`, doc }
  const { id: _id, type: _type, ...safe } = patch as Record<string, unknown>
  if ('padding' in safe) safe.padding = normalizePadding(safe.padding)
  for (const field of NUMERIC_BLOCK_FIELDS) {
    if (field in safe) {
      const current = (target as unknown as Record<string, unknown>)[field]
      safe[field] = coerceNumberLike(safe[field], typeof current === 'number' ? current : 0)
    }
  }
  if (target.type === 'component' && safe.values && typeof safe.values === 'object') {
    safe.values = componentValues(target.fields, { ...target.values, ...(safe.values as Record<string, unknown>) })
  }
  Object.assign(target, safe)
  putBlock(next.blocks, target)
  return { ok: true, message: `Updated ${target.type} block "${id}".`, doc: next }
}

/** The list a parent holds blocks in, or why it can't. */
function parentList(blocks: EmailBlock[], parent: BlockParent): EmailBlock[] | string {
  const block = findBlock(blocks, parent.id)
  if (!block) return `No block with id "${parent.id}".`
  const lists = childLists(block)
  if (!lists.length) return `Block "${parent.id}" is a ${block.type}; only sections and columns hold blocks.`
  const column = Math.round(Number(parent.column) || 0)
  return lists[column] ?? `Columns block "${parent.id}" has no column ${column + 1}.`
}

/**
 * Insert a new block. `at` is the index in its list (default: the end); the
 * list is the top level, or a section's or a column's when `parent` is given.
 * `props` overrides the type defaults. Returns the new id in the message.
 */
export function addBlock(
  doc: EmailDocument,
  type: EmailBlockType,
  props: Record<string, unknown> = {},
  at?: number,
  parent?: BlockParent
): OpResult & { id: string } {
  const next = clone(doc)
  const list = parent ? parentList(next.blocks, parent) : next.blocks
  if (typeof list === 'string') return { ok: false, id: '', message: list, doc }
  const ctx: Normalizing = { seen: new Set(), dropped: [] }
  walkBlocks(next.blocks, b => ctx.seen.add(b.id))
  const block = normalizeBlock({ ...props, id: newBlockId(), type }, ctx)
  if (!block) return { ok: false, id: '', message: `Unknown block type "${type}".`, doc }
  const id = block.id
  const idx = typeof at === 'number' && at >= 0 && at <= list.length ? at : list.length
  list.splice(idx, 0, block)
  return { ok: true, id, message: `Added ${type} block "${id}" at position ${idx}${parent ? ` in "${parent.id}"` : ''}.${droppedNote(ctx.dropped)}`, doc: next }
}

/**
 * Swap one block for others in the same place (none removes it): a custom
 * HTML block rebuilt as blocks, a block turned into a component.
 */
export function replaceBlockWith(doc: EmailDocument, id: string, blocks: unknown[]): OpResult & { ids: string[] } {
  const next = clone(doc)
  const at = locateBlock(next.blocks, id)
  if (!at) return { ok: false, ids: [], message: `No block with id "${id}".`, doc }
  const ctx: Normalizing = { seen: new Set(), dropped: [] }
  walkBlocks(next.blocks, b => b.id !== id && ctx.seen.add(b.id))
  const added = (Array.isArray(blocks) ? blocks : []).map(b => normalizeBlock(b, ctx)).filter((b): b is EmailBlock => !!b)
  at.list.splice(at.index, 1, ...added)
  const ids = added.map(b => b.id)
  return { ok: true, ids, message: `Replaced block "${id}" with ${ids.length ? ids.map(i => `"${i}"`).join(', ') : 'nothing'}.${droppedNote(ctx.dropped)}`, doc: next }
}

/** Remove a block by id. */
export function removeBlock(doc: EmailDocument, id: string): OpResult {
  const next = clone(doc)
  if (!removeBlockById(next.blocks, id)) return { ok: false, message: `No block with id "${id}".`, doc }
  return { ok: true, message: `Removed block "${id}".`, doc: next }
}

/**
 * Move a block to index `to` of its own list, or of a section's or column's
 * list when `parent` is given.
 */
export function moveBlock(doc: EmailDocument, id: string, to: number, parent?: BlockParent): OpResult {
  const next = clone(doc)
  const from = locateBlock(next.blocks, id)
  if (!from) return { ok: false, message: `No block with id "${id}".`, doc }
  if (parent && (parent.id === id || findBlock(childLists(from.block).flat(), parent.id))) {
    return { ok: false, message: `Block "${id}" can't move inside itself.`, doc }
  }
  from.list.splice(from.index, 1)
  const list = parent ? parentList(next.blocks, parent) : from.list
  if (typeof list === 'string') return { ok: false, message: list, doc }
  const idx = Math.max(0, Math.min(Math.round(Number(to) || 0), list.length))
  list.splice(idx, 0, from.block)
  return { ok: true, message: `Moved block "${id}" to position ${idx}${parent ? ` in "${parent.id}"` : ''}.`, doc: next }
}
