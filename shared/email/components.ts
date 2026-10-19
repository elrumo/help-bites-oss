import { childLists, COMPONENT_FIELD_TYPES, type ComponentBlock, type EmailBlock, type EmailComponentField, type EmailComponentFieldType, type HtmlBlock } from './blocks'
import { fillComponent, SLOT_RE } from './render'
import { STRIPPED_TAGS } from './lint'

// The component library: custom HTML saved once and reused, with `{{@key}}`
// fields for what each email changes (copy, links and images as content;
// colours and sizes as style). Inserting one copies its HTML and fields into
// a `component` block, so an email never depends on the library afterwards;
// editing the library changes new insertions, and "update from library"
// brings an existing one up to date.

export type EmailComponentDef = {
  id: string
  name: string
  /** When to use it: the AI designer reads this. */
  description: string
  html: string
  fields: EmailComponentField[]
  /** null: shared by every project and master */
  projectId: string | null
  updatedAt?: string
}

export type EmailComponentInput = Pick<EmailComponentDef, 'name' | 'description' | 'html' | 'fields'>

export const COMPONENT_LIMITS = { name: 80, description: 500, html: 100_000, fields: 40, label: 80, value: 2000 }
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

/** The field keys an HTML uses, in order of first appearance. */
export function slotKeys(html: string): string[] {
  const keys = new Set<string>()
  for (const match of String(html ?? '').matchAll(SLOT_RE)) if (KEY_RE.test(match[1]!)) keys.add(match[1]!)
  return [...keys]
}

/** `buttonLabel` / `button_label` → "Button label". */
export function fieldLabel(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function defaultGroup(type: EmailComponentFieldType): 'content' | 'style' {
  return type === 'color' || type === 'number' ? 'style' : 'content'
}

/** What a slot is, from where it sits: an href is a link, a src an image, after `color:` a colour, before `px` a number. */
export function guessFieldType(html: string, key: string): EmailComponentFieldType {
  const source = String(html ?? '')
  const at = source.search(new RegExp(`\\{\\{\\s*@${key}\\s*\\}\\}`))
  if (at === -1) return 'text'
  const before = source.slice(Math.max(0, at - 48), at)
  const after = source.slice(source.indexOf('}}', at) + 2, source.indexOf('}}', at) + 6)
  if (/\b(href|action)\s*=\s*["']?$/i.test(before)) return 'url'
  if (/\bsrc\s*=\s*["']?$/i.test(before)) return 'image'
  if (/(color|background|bgcolor|fill|stroke)\s*[:=]\s*["']?$/i.test(before)) return 'color'
  if (/^(px|em|rem|%|deg)/i.test(after)) return 'number'
  return 'text'
}

/**
 * One field per `{{@key}}` in the HTML, in order. Declared fields keep their
 * label, type, group and default; a slot nobody declared becomes a text field,
 * and a declared field the HTML no longer uses is dropped.
 */
export function normalizeComponentFields(html: string, raw: unknown): EmailComponentField[] {
  const declared = new Map<string, EmailComponentField>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const f = (item || {}) as Record<string, unknown>
    const key = String(f.key ?? '').trim()
    if (!KEY_RE.test(key) || declared.has(key)) continue
    const type = (COMPONENT_FIELD_TYPES as readonly string[]).includes(String(f.type)) ? f.type as EmailComponentFieldType : guessFieldType(html, key)
    declared.set(key, {
      key,
      label: String(f.label ?? '').trim().slice(0, COMPONENT_LIMITS.label) || fieldLabel(key),
      type,
      group: f.group === 'style' || f.group === 'content' ? f.group : defaultGroup(type),
      default: String(f.default ?? f.defaultValue ?? '').slice(0, COMPONENT_LIMITS.value)
    })
  }
  return slotKeys(html).slice(0, COMPONENT_LIMITS.fields).map((key) => {
    const known = declared.get(key)
    if (known) return known
    const type = guessFieldType(html, key)
    return { key, label: fieldLabel(key), type, group: defaultGroup(type), default: '' }
  })
}

/** This instance's values: declared keys only, as strings. */
export function componentValues(fields: EmailComponentField[], raw: unknown): Record<string, string> {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const out: Record<string, string> = {}
  for (const f of fields) {
    if (Object.hasOwn(input, f.key) && input[f.key] != null) out[f.key] = String(input[f.key]).slice(0, COMPONENT_LIMITS.value)
  }
  return out
}

/** Validates a component from the API, the dialog or the AI. */
export function normalizeComponentInput(input: unknown): { ok: true, value: EmailComponentInput } | { ok: false, error: string } {
  const raw = (input || {}) as Record<string, unknown>
  const name = String(raw.name ?? '').trim()
  const description = String(raw.description ?? '').trim()
  const html = String(raw.html ?? '').trim()
  if (!name) return { ok: false, error: 'A component needs a name' }
  if (name.length > COMPONENT_LIMITS.name) return { ok: false, error: `The name is longer than ${COMPONENT_LIMITS.name} characters` }
  if (description.length > COMPONENT_LIMITS.description) return { ok: false, error: `The description is longer than ${COMPONENT_LIMITS.description} characters` }
  if (!html) return { ok: false, error: 'A component needs HTML' }
  if (html.length > COMPONENT_LIMITS.html) return { ok: false, error: 'The HTML is larger than 100 KB' }
  if (STRIPPED_TAGS.test(html)) return { ok: false, error: 'The HTML uses tags mail clients strip (script, form, iframe, video)' }
  return { ok: true, value: { name, description, html, fields: normalizeComponentFields(html, raw.fields) } }
}

/** A new instance of a library component (the caller adds the id). */
export function componentInstance(def: Pick<EmailComponentDef, 'id' | 'name' | 'html' | 'fields'>, values: unknown = {}): Omit<ComponentBlock, 'id'> {
  const fields: EmailComponentField[] = JSON.parse(JSON.stringify(def.fields || []))
  return { type: 'component', componentId: def.id, name: def.name, html: def.html, fields, values: componentValues(fields, values) }
}

/** The library has a different version than the one this instance copied. */
export function componentOutdated(block: ComponentBlock, def: EmailComponentDef | undefined): boolean {
  return !!def && (def.html !== block.html || def.name !== block.name || JSON.stringify(def.fields) !== JSON.stringify(block.fields))
}

/** The library's current version, keeping this instance's values for fields that still exist. */
export function refreshComponent(block: ComponentBlock, def: EmailComponentDef): Partial<ComponentBlock> {
  const next = componentInstance(def, block.values)
  return { name: next.name, html: next.html, fields: next.fields, values: next.values }
}

/** The instance as plain custom HTML, values filled in; `{{variables}}` stay. */
export function detachComponent(block: ComponentBlock): HtmlBlock {
  return {
    id: block.id,
    type: 'html',
    html: fillComponent(block.html, block.fields, block.values),
    ...(block.padding !== undefined ? { padding: block.padding } : {}),
    ...(block.background ? { background: block.background } : {})
  }
}

/**
 * The AI writes `{ type: 'component', componentId, values }`; fill in the
 * library's HTML and fields. Blocks that already carry their HTML (instances
 * already in the email) stay as they are. References to components the
 * library doesn't have are dropped and reported.
 */
export function expandComponentRefs(blocks: unknown, library: EmailComponentDef[]): { blocks: unknown[], unknown: string[] } {
  const unknown: string[] = []
  const byId = new Map(library.map(def => [def.id, def]))
  const expand = (list: unknown): unknown[] => (Array.isArray(list) ? list : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [raw]
    const block = { ...(raw as Record<string, unknown>) }
    if (block.type === 'component' && !String(block.html ?? '').trim()) {
      const def = byId.get(String(block.componentId ?? ''))
      if (!def) {
        unknown.push(String(block.componentId ?? '(none)'))
        return []
      }
      Object.assign(block, componentInstance(def, block.values))
    }
    if (Array.isArray(block.columns)) block.columns = block.columns.map(col => expand(col))
    if (Array.isArray(block.blocks)) block.blocks = expand(block.blocks)
    return [block]
  })
  return { blocks: expand(blocks), unknown }
}

/** Every component instance in a block tree. */
export function componentBlocks(blocks: EmailBlock[]): ComponentBlock[] {
  return blocks.flatMap(b => [...(b.type === 'component' ? [b] : []), ...childLists(b).flatMap(componentBlocks)])
}

/** The library as the AI designer reads it: newest first, capped. */
export function componentCatalog(defs: EmailComponentDef[], limit = 60): string {
  if (!defs.length) return '(none yet)'
  const sorted = [...defs].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const lines = sorted.slice(0, limit).map((def) => {
    const fields = def.fields.map(f => `${f.key} (${f.type}, ${f.group}${f.default ? `, default "${f.default.slice(0, 60)}"` : ''})`).join('; ')
    return `- ${def.id} "${def.name}"${def.projectId ? ' (this project)' : ' (shared)'}: ${def.description || 'no description'}\n  fields: ${fields || 'none'}`
  })
  if (sorted.length > limit) lines.push(`(${sorted.length - limit} more not shown)`)
  return lines.join('\n')
}
