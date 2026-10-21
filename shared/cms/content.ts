import { BRAND_RADII, BRAND_THEMES, type BrandRadius, type BrandTheme } from '../brand'
import { CMS_ICONS } from './icons'

/**
 * The content model behind Pages (the landing page builder) and the headless
 * CMS, shared by the editor, the AI tools, the API and the renderer.
 *
 * A component is a schema (its fields) plus an optional HTML/CSS template the
 * hosted pages render; one without a template is data only, for a dev's own
 * app. `root` components are entry types (a page, a blog post), `nestable`
 * ones go inside a `blocks` field. An entry's content is a tree of blocks in
 * Storyblok's shape: `{ _uid, component, ...values }`, where a `blocks` field
 * holds more blocks.
 */

export const CMS_FIELD_TYPES = ['text', 'textarea', 'markdown', 'number', 'boolean', 'color', 'url', 'date', 'select', 'icon', 'asset', 'blocks'] as const
export type CmsFieldType = typeof CMS_FIELD_TYPES[number]

export type CmsField = {
  key: string
  label: string
  type: CmsFieldType
  /** Text types: a string; number: a number; boolean: true or false. Assets and blocks have none. */
  default?: string | number | boolean
  required?: boolean
  /** `select`: the choices. `icon`: the icons offered (shared/cms/icons.ts); empty offers all. */
  options?: string[]
  /** `blocks`: the component keys allowed in it; empty allows every nestable component. */
  allow?: string[]
  description?: string
}

export type CmsComponentDef = {
  id: string
  key: string
  name: string
  description: string
  /** An entry type: entries are made of it (a page, a post). */
  root: boolean
  /** Goes inside another component's `blocks` field. */
  nestable: boolean
  fields: CmsField[]
  html: string
  css: string
  /** Ships with HelpBites (shared/cms/library.ts): read-only, duplicate it to change it. */
  builtin?: boolean
  /** Built-ins only: the values (and child blocks) a new one starts with. */
  example?: Record<string, unknown>
  updatedAt?: string
}

export type CmsAssetRef = { id: string, url: string, alt: string, mime: string, width?: number, height?: number }

export const CMS_ANIM_EFFECTS = ['fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'zoom-in', 'zoom-out', 'blur', 'parallax'] as const
export const CMS_ANIM_TRIGGERS = ['in-view', 'load', 'scroll'] as const
export const CMS_ANIM_EASINGS = ['ease-out', 'ease-in-out', 'linear', 'spring'] as const
export type CmsAnimation = {
  effect: typeof CMS_ANIM_EFFECTS[number]
  /** in-view: plays when it scrolls into view; load: on page load; scroll: follows the scroll position (scrubbed). */
  trigger: typeof CMS_ANIM_TRIGGERS[number]
  /** Milliseconds. */
  duration: number
  delay: number
  easing: typeof CMS_ANIM_EASINGS[number]
  /** Milliseconds between the block's children (its nested blocks, or elements marked `data-hb-item`); 0 animates the block itself. */
  stagger: number
  /** in-view: play the first time only. */
  once: boolean
  /** How far it travels, in px (slides and parallax). */
  distance: number
}
export const DEFAULT_ANIMATION: CmsAnimation = { effect: 'fade-up', trigger: 'in-view', duration: 600, delay: 0, easing: 'ease-out', stagger: 0, once: true, distance: 32 }

export type CmsBlock = { _uid: string, component: string, _anim?: CmsAnimation, [key: string]: unknown }

export const CMS_WIDTHS = ['narrow', 'normal', 'wide'] as const
export type CmsStyle = {
  /** '' wears the project's accent. */
  accent: string
  mode: BrandTheme
  radius: BrandRadius
  /** Google Fonts family names; '' is the system font. */
  headingFont: string
  bodyFont: string
  width: typeof CMS_WIDTHS[number]
}
export const DEFAULT_STYLE: CmsStyle = { accent: '', mode: 'light', radius: 'soft', headingFont: '', bodyFont: '', width: 'normal' }

export const CMS_LIMITS = {
  components: 200,
  fields: 40,
  name: 80,
  description: 500,
  html: 100_000,
  css: 100_000,
  options: 50,
  entries: 1000,
  slug: 200,
  /** JSON size of one entry's content. */
  contentBytes: 512_000,
  depth: 8,
  blocksPerList: 100,
  text: 20_000,
  assets: 2000,
  assetBytes: 20 * 1024 * 1024,
  assetName: 120,
  alt: 300
}

export const COMPONENT_KEY = /^[a-z][a-z0-9_-]{0,39}$/
export const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
/** Lowercase words and dashes, `/` between folders: `home`, `pricing`, `blog/hello-world`. `home` is the site's root. */
export const CMS_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/
const UID = /^[A-Za-z0-9_-]{6,40}$/
const FONT = /^[A-Za-z0-9 ]{1,40}$/
const HEX = /^#[0-9a-f]{6}$/i
export const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]+\)|[a-z]+|var\(--[\w-]+\))$/i

/**
 * Hosted pages share the panel's origin, so a template never carries anything
 * that runs: refused rather than cleaned, so what was saved is what renders.
 * The page's CSP blocks the rest (frames outside YouTube and Vimeo, forms
 * posting elsewhere, outside stylesheets).
 */
export const UNSAFE_HTML = /<script|<object|<embed|<base\b|<link\b|<meta\b[^>]*http-equiv|\son[a-z]+\s*=|javascript:|vbscript:|data:text\/html|srcdoc\s*=/i
export const UNSAFE_CSS = /<\/style|@import|expression\s*\(|javascript:|-moz-binding|behavior\s*:/i

export const uid = (): string => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)

/** `buttonLabel` / `button_label` → "Button label". */
export function fieldLabel(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The `{{@key}}` and `{{#key}}` slots a template uses, in order: what "Detect fields" offers. */
export function templateKeys(html: string): string[] {
  const keys = new Set<string>()
  for (const m of String(html ?? '').matchAll(/\{\{\s*[@#^]([A-Za-z][A-Za-z0-9_]*)/g)) keys.add(m[1]!)
  return [...keys]
}

/** A type for a slot nobody declared, from where it sits: an href is a URL, a src an asset, after `color:` a colour. */
export function guessFieldType(html: string, key: string): CmsFieldType {
  const source = String(html ?? '')
  const at = source.search(new RegExp(`\\{\\{\\s*@${key}\\b`))
  if (at === -1) return 'text'
  const before = source.slice(Math.max(0, at - 48), at)
  if (new RegExp(`\\{\\{\\s*@${key}\\.(alt|width|height|mime|url)`).test(source)) return 'asset'
  if (/\b(href|action)\s*=\s*["']?$/i.test(before)) return 'url'
  if (/\b(src|poster)\s*=\s*["']?$/i.test(before)) return 'asset'
  if (/(color|background|fill|stroke)\s*[:=]\s*["']?$/i.test(before)) return 'color'
  return 'text'
}

// ---- components ------------------------------------------------------------------

const str = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function normalizeField(raw: unknown): CmsField | string {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const key = str(f.key, 40)
  if (!FIELD_KEY.test(key) || key === 'component') return `"${key || '(empty)'}" is not a field key: letters, digits and _, starting with a letter`
  const type = CMS_FIELD_TYPES.includes(f.type as CmsFieldType) ? f.type as CmsFieldType : null
  if (!type) return `Field "${key}": type is one of ${CMS_FIELD_TYPES.join(', ')}`
  const field: CmsField = { key, label: str(f.label, CMS_LIMITS.name) || fieldLabel(key), type }
  if (f.required === true) field.required = true
  const description = str(f.description, 200)
  if (description) field.description = description
  if (type === 'select') {
    const options = (Array.isArray(f.options) ? f.options : []).map(o => str(o, 80)).filter(Boolean)
    if (!options.length) return `Field "${key}": a select needs options`
    field.options = [...new Set(options)].slice(0, CMS_LIMITS.options)
  }
  if (type === 'icon' && Array.isArray(f.options)) {
    const options = f.options.map(o => str(o, 40)).filter(o => Object.hasOwn(CMS_ICONS, o))
    if (options.length) field.options = [...new Set(options)]
  }
  if (type === 'blocks') field.allow = [...new Set((Array.isArray(f.allow) ? f.allow : []).map(k => str(k, 40)).filter(k => COMPONENT_KEY.test(k)))].slice(0, 50)
  if (f.default !== undefined && f.default !== null && f.default !== '' && type !== 'asset' && type !== 'blocks') {
    const value = coerceScalar(field, f.default)
    if (value !== undefined) field.default = value
  }
  return field
}

export type CmsComponentInput = Pick<CmsComponentDef, 'key' | 'name' | 'description' | 'root' | 'nestable' | 'fields' | 'html' | 'css'>

/** Validates a component from the API, the editor or the AI. `reserved`: keys it may not take (the built-ins). */
export function normalizeComponentInput(input: unknown, reserved: Iterable<string> = []): { ok: true, value: CmsComponentInput } | { ok: false, error: string } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const key = str(raw.key, 41).toLowerCase()
  if (!COMPONENT_KEY.test(key)) return { ok: false, error: 'key is 1 to 40 lowercase letters, digits, _ and -, starting with a letter' }
  if (new Set(reserved).has(key)) return { ok: false, error: `"${key}" is a built-in component; pick another key` }
  const name = str(raw.name, CMS_LIMITS.name + 1)
  if (!name) return { ok: false, error: 'A component needs a name' }
  if (name.length > CMS_LIMITS.name) return { ok: false, error: `The name is longer than ${CMS_LIMITS.name} characters` }
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (description.length > CMS_LIMITS.description) return { ok: false, error: `The description is longer than ${CMS_LIMITS.description} characters` }
  const html = typeof raw.html === 'string' ? raw.html.trim() : ''
  const css = typeof raw.css === 'string' ? raw.css.trim() : ''
  if (html.length > CMS_LIMITS.html) return { ok: false, error: 'The HTML is larger than 100 KB' }
  if (css.length > CMS_LIMITS.css) return { ok: false, error: 'The CSS is larger than 100 KB' }
  if (UNSAFE_HTML.test(html)) return { ok: false, error: 'The HTML has something that runs (script, on… handlers, javascript: links, object, embed, base, link or srcdoc). Components are HTML and CSS only' }
  if (UNSAFE_CSS.test(css)) return { ok: false, error: 'The CSS uses @import, expression() or javascript:' }
  if (html && !/^<[a-zA-Z][\w-]*[\s>/]/.test(html)) return { ok: false, error: 'The HTML starts with one element that wraps the component (e.g. <section>)' }
  const fields: CmsField[] = []
  for (const item of Array.isArray(raw.fields) ? raw.fields : []) {
    const field = normalizeField(item)
    if (typeof field === 'string') return { ok: false, error: field }
    if (fields.some(f => f.key === field.key)) return { ok: false, error: `Two fields use the key "${field.key}"` }
    fields.push(field)
  }
  if (fields.length > CMS_LIMITS.fields) return { ok: false, error: `A component has at most ${CMS_LIMITS.fields} fields` }
  const root = raw.root === true
  const nestable = raw.nestable === undefined ? !root : raw.nestable === true
  if (!root && !nestable) return { ok: false, error: 'A component is an entry type (root), a block (nestable), or both' }
  return { ok: true, value: { key, name, description, root, nestable, fields, html, css } }
}

export type CmsLibrary = Map<string, CmsComponentDef>

// ---- values ----------------------------------------------------------------------

function coerceScalar(field: Pick<CmsField, 'type' | 'options'>, value: unknown): string | number | boolean | undefined {
  switch (field.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean': return value === true || value === 'true'
    case 'color': {
      const s = String(value ?? '').trim()
      return SAFE_COLOR.test(s) ? s : undefined
    }
    case 'select': {
      const s = String(value ?? '')
      return field.options?.includes(s) ? s : undefined
    }
    case 'icon': {
      const s = String(value ?? '')
      return Object.hasOwn(CMS_ICONS, s) && (!field.options?.length || field.options.includes(s)) ? s : undefined
    }
    case 'date': {
      const s = String(value ?? '').trim()
      return /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined
    }
    case 'asset':
    case 'blocks': return undefined
    default: return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, CMS_LIMITS.text) : undefined
  }
}

export function normalizeAsset(value: unknown): CmsAssetRef | null {
  const a = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null
  const url = a && typeof a.url === 'string' ? a.url.trim() : ''
  if (!a || !/^https?:\/\//i.test(url) || url.length > 2000) return null
  const ref: CmsAssetRef = { id: str(a.id, 40), url, alt: str(a.alt, CMS_LIMITS.alt), mime: str(a.mime, 80) }
  if (Number.isInteger(a.width) && (a.width as number) > 0) ref.width = a.width as number
  if (Number.isInteger(a.height) && (a.height as number) > 0) ref.height = a.height as number
  return ref
}

export function normalizeAnimation(value: unknown): CmsAnimation | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] => list.includes(v as string) ? v as T[number] : fallback
  const ms = (v: unknown, fallback: number, max: number) => Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v as number))) : fallback
  const effect = pick(CMS_ANIM_EFFECTS, a.effect, DEFAULT_ANIMATION.effect)
  return {
    effect,
    // Parallax only makes sense tied to the scroll.
    trigger: effect === 'parallax' ? 'scroll' : pick(CMS_ANIM_TRIGGERS, a.trigger, DEFAULT_ANIMATION.trigger),
    duration: Math.max(100, ms(a.duration, DEFAULT_ANIMATION.duration, 4000)),
    delay: ms(a.delay, 0, 4000),
    easing: pick(CMS_ANIM_EASINGS, a.easing, DEFAULT_ANIMATION.easing),
    stagger: ms(a.stagger, 0, 1000),
    once: a.once !== false,
    distance: ms(a.distance, DEFAULT_ANIMATION.distance, 400)
  }
}

export function normalizeStyle(value: unknown, base: CmsStyle = DEFAULT_STYLE): CmsStyle {
  const s = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const font = (v: unknown, fallback: string) => v === '' ? '' : typeof v === 'string' && FONT.test(v.trim()) ? v.trim() : fallback
  return {
    accent: s.accent === '' ? '' : typeof s.accent === 'string' && HEX.test(s.accent) ? s.accent.toLowerCase() : base.accent,
    mode: BRAND_THEMES.includes(s.mode as BrandTheme) ? s.mode as BrandTheme : base.mode,
    radius: BRAND_RADII.includes(s.radius as BrandRadius) ? s.radius as BrandRadius : base.radius,
    headingFont: font(s.headingFont, base.headingFont),
    bodyFont: font(s.bodyFont, base.bodyFont),
    width: CMS_WIDTHS.includes(s.width as CmsStyle['width']) ? s.width as CmsStyle['width'] : base.width
  }
}

/** A value of a key no field declares (a field renamed since): kept as plain JSON Parse can store. */
function plain(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string') return value.slice(0, CMS_LIMITS.text)
  if (depth > 6) return null
  if (Array.isArray(value)) return value.slice(0, CMS_LIMITS.blocksPerList).map(v => plain(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (/^[A-Za-z0-9_-]{1,40}$/.test(k)) out[k] = plain(v, depth + 1)
    return out
  }
  return null
}

export type NormalizeResult = { content: CmsBlock, issues: string[] }

/**
 * A content tree fit to store and render: each value fits its field's type,
 * every block has a unique `_uid`, nested blocks are ones their field allows.
 * A block of a component the library doesn't have (deleted since) keeps its
 * data and renders as nothing; values of keys no field declares stay too, so
 * renaming a field never wipes content. What had to change is in `issues`.
 */
export function normalizeContent(raw: unknown, library: CmsLibrary, rootType: string): NormalizeResult {
  const issues: string[] = []
  const seen = new Set<string>()
  const walk = (value: unknown, depth: number, where: string): CmsBlock | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const input = value as Record<string, unknown>
    const component = str(input.component, 41)
    if (!COMPONENT_KEY.test(component)) {
      issues.push(`${where}: a block without a valid component key was dropped`)
      return null
    }
    let id = typeof input._uid === 'string' && UID.test(input._uid) ? input._uid : ''
    if (!id || seen.has(id)) id = uid()
    seen.add(id)
    const block: CmsBlock = { _uid: id, component }
    const anim = normalizeAnimation(input._anim)
    if (anim) block._anim = anim
    const def = library.get(component)
    const fields = new Map((def?.fields || []).map(f => [f.key, f]))
    for (const [key, v] of Object.entries(input)) {
      if (key === '_uid' || key === 'component' || key === '_anim' || v === undefined) continue
      const field = fields.get(key)
      if (!field) {
        if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) block[key] = plain(v)
        continue
      }
      if (field.type === 'blocks') {
        if (depth >= CMS_LIMITS.depth) {
          issues.push(`${def!.name}.${key}: nested deeper than ${CMS_LIMITS.depth} levels; the inner blocks were dropped`)
          block[key] = []
          continue
        }
        const list = Array.isArray(v) ? v : []
        if (list.length > CMS_LIMITS.blocksPerList) issues.push(`${def!.name}.${key}: more than ${CMS_LIMITS.blocksPerList} blocks; the rest were dropped`)
        block[key] = list.slice(0, CMS_LIMITS.blocksPerList).flatMap((child) => {
          const next = walk(child, depth + 1, `${def!.name}.${key}`)
          if (!next) return []
          const childDef = library.get(next.component)
          if (childDef && (!childDef.nestable || (field.allow?.length && !field.allow.includes(next.component)))) {
            issues.push(`${def!.name}.${key} does not take "${childDef.name}"; it was dropped`)
            return []
          }
          return [next]
        })
      } else if (field.type === 'asset') {
        block[key] = normalizeAsset(v)
      } else {
        const scalar = coerceScalar(field, v)
        if (scalar !== undefined) block[key] = scalar
        else if (v !== '' && v !== null) issues.push(`${def!.name}.${key}: "${String(v).slice(0, 40)}" is not a valid ${field.type}`)
      }
    }
    return block
  }
  let content = walk(raw, 0, 'content')
  if (!content || content.component !== rootType) {
    if (content) issues.push(`The content's root is "${content.component}", not "${rootType}"; it was replaced`)
    content = { _uid: uid(), component: rootType }
  }
  return { content, issues }
}

export function contentTooLarge(content: CmsBlock): boolean {
  return JSON.stringify(content).length > CMS_LIMITS.contentBytes
}

/** A new block of a component: its defaults and, for built-ins, their example values and children. */
export function newBlock(def: CmsComponentDef, values: Record<string, unknown> = {}): CmsBlock {
  const block: CmsBlock = { _uid: uid(), component: def.key }
  for (const f of def.fields) {
    if (f.type === 'blocks') block[f.key] = []
    else if (f.default !== undefined) block[f.key] = f.default
  }
  return reuid({ ...block, ...structuredClone(def.example || {}), ...structuredClone(values), _uid: block._uid, component: def.key })
}

/** Fresh `_uid`s through a whole subtree (a duplicate, an example, a template). */
export function reuid<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reuid) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = reuid(v)
  if (typeof out.component === 'string') out._uid = uid()
  return out as T
}

// ---- the tree --------------------------------------------------------------------

export type BlockAt = { block: CmsBlock, parent: CmsBlock | null, field: string, index: number }
export type OpResult = { ok: boolean, message: string, content: CmsBlock }

/** The blocks fields of a block: wherever children can be. */
export function childFields(block: CmsBlock, library: CmsLibrary): string[] {
  const def = library.get(block.component)
  return def ? def.fields.filter(f => f.type === 'blocks').map(f => f.key) : []
}

export function findBlock(root: CmsBlock, id: string, library: CmsLibrary): BlockAt | null {
  if (root._uid === id) return { block: root, parent: null, field: '', index: -1 }
  for (const field of childFields(root, library)) {
    const list = Array.isArray(root[field]) ? root[field] as CmsBlock[] : []
    for (let i = 0; i < list.length; i++) {
      if (list[i]!._uid === id) return { block: list[i]!, parent: root, field, index: i }
      const deeper = findBlock(list[i]!, id, library)
      if (deeper) return deeper
    }
  }
  return null
}

/** Every block in the tree, parents before children. */
export function allBlocks(root: CmsBlock, library: CmsLibrary): CmsBlock[] {
  return [root, ...childFields(root, library).flatMap(f => (Array.isArray(root[f]) ? root[f] as CmsBlock[] : []).flatMap(b => allBlocks(b, library)))]
}

const fail = (content: CmsBlock, message: string): OpResult => ({ ok: false, message, content })

/** Where `child` may go: a blocks field of `parent` that allows it. */
function placeable(parent: CmsBlock, field: string, child: CmsBlock, library: CmsLibrary): string | null {
  const pdef = library.get(parent.component)
  const f = pdef?.fields.find(x => x.key === field)
  if (!pdef || !f || f.type !== 'blocks') return `"${pdef?.name || parent.component}" has no blocks field "${field}"${pdef ? ` (it has: ${childFields(parent, library).join(', ') || 'none'})` : ''}`
  const cdef = library.get(child.component)
  if (!cdef) return `There is no component "${child.component}"`
  if (!cdef.nestable) return `"${cdef.name}" is an entry type and cannot go inside a block`
  if (f.allow?.length && !f.allow.includes(child.component)) return `${pdef.name}.${field} takes only ${f.allow.join(', ')}`
  return null
}

export function addBlock(root: CmsBlock, library: CmsLibrary, parentId: string, field: string, block: CmsBlock, index?: number): OpResult {
  const content = structuredClone(root)
  const at = findBlock(content, parentId, library)
  if (!at) return fail(root, `No block with _uid ${parentId}`)
  const why = placeable(at.block, field, block, library)
  if (why) return fail(root, why)
  const list = Array.isArray(at.block[field]) ? at.block[field] as CmsBlock[] : []
  const i = index === undefined ? list.length : Math.max(0, Math.min(list.length, index))
  list.splice(i, 0, block)
  at.block[field] = list
  return { ok: true, message: `Added ${library.get(block.component)!.name} (${block._uid}) to ${field} at ${i}`, content }
}

export function updateBlock(root: CmsBlock, library: CmsLibrary, id: string, values: Record<string, unknown>): OpResult {
  const content = structuredClone(root)
  const at = findBlock(content, id, library)
  if (!at) return fail(root, `No block with _uid ${id}`)
  for (const [k, v] of Object.entries(values || {})) {
    if (k === '_uid' || k === 'component') continue
    if (v === null && k === '_anim') delete at.block._anim
    else at.block[k] = v
  }
  return { ok: true, message: `Updated ${id}`, content }
}

export function removeBlock(root: CmsBlock, library: CmsLibrary, id: string): OpResult {
  const content = structuredClone(root)
  const at = findBlock(content, id, library)
  if (!at || !at.parent) return fail(root, at ? 'The root cannot be removed' : `No block with _uid ${id}`)
  ;(at.parent[at.field] as CmsBlock[]).splice(at.index, 1)
  return { ok: true, message: `Removed ${id}`, content }
}

export function moveBlock(root: CmsBlock, library: CmsLibrary, id: string, parentId: string, field: string, index: number): OpResult {
  const at = findBlock(root, id, library)
  if (!at || !at.parent) return fail(root, at ? 'The root cannot move' : `No block with _uid ${id}`)
  if (findBlock(at.block, parentId, library)) return fail(root, 'A block cannot move inside itself')
  const removed = removeBlock(root, library, id)
  // Moving down the same list: the slot shifts up once the block is out of it.
  const shift = at.parent._uid === parentId && at.field === field && index > at.index ? 1 : 0
  const added = addBlock(removed.content, library, parentId, field, at.block, index - shift)
  return added.ok ? { ...added, message: `Moved ${id} to ${field} at ${index - shift}` } : fail(root, added.message)
}

export function duplicateBlock(root: CmsBlock, library: CmsLibrary, id: string): OpResult {
  const at = findBlock(root, id, library)
  if (!at || !at.parent) return fail(root, at ? 'The root cannot be duplicated' : `No block with _uid ${id}`)
  return addBlock(root, library, at.parent._uid, at.field, reuid(structuredClone(at.block)), at.index + 1)
}

/** One line per block, indented: the AI reads the page this way. */
export function outline(root: CmsBlock, library: CmsLibrary, depth = 0): string {
  const def = library.get(root.component)
  const title = ['headline', 'title', 'name', 'label', 'text'].map(k => root[k]).find(v => typeof v === 'string' && v) as string | undefined
  const line = `${'  '.repeat(depth)}- ${root.component} ${root._uid}${def ? '' : ' (missing component)'}${title ? `: "${title.slice(0, 60)}"` : ''}${root._anim ? ` [${root._anim.effect}]` : ''}`
  return [line, ...childFields(root, library).flatMap(f => {
    const list = Array.isArray(root[f]) ? root[f] as CmsBlock[] : []
    return list.length ? [`${'  '.repeat(depth + 1)}${f}:`, ...list.map(b => outline(b, library, depth + 2))] : []
  })].join('\n')
}

// ---- project settings ------------------------------------------------------------

/** What the project says and to whom: the wizard and the assistant write it, every AI turn reads it. */
export type CmsBrief = {
  audience: string
  problem: string
  valueProposition: string
  /** The three to five messages every page should land. */
  pillars: string[]
  proof: string
  tone: string
  callToAction: string
}

export type CmsSettings = {
  /** The dev's own site for the editor's "Your site" preview; `{slug}` becomes the entry's slug. */
  previewUrl: string
  brief: CmsBrief
}

export const EMPTY_BRIEF: CmsBrief = { audience: '', problem: '', valueProposition: '', pillars: [], proof: '', tone: '', callToAction: '' }

export function normalizeBrief(value: unknown, base: CmsBrief = EMPTY_BRIEF): CmsBrief {
  const b = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (k: keyof CmsBrief, max = 2000) => typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : base[k] as string
  return {
    audience: text('audience'),
    problem: text('problem'),
    valueProposition: text('valueProposition'),
    pillars: Array.isArray(b.pillars) ? b.pillars.map(p => str(p, 300)).filter(Boolean).slice(0, 6) : base.pillars,
    proof: text('proof'),
    tone: text('tone', 300),
    callToAction: text('callToAction', 300)
  }
}

export function validPreviewUrl(value: unknown): boolean {
  if (value === '') return true
  if (typeof value !== 'string' || value.length > 500) return false
  try {
    return /^https?:$/.test(new URL(value.replace(/\{slug\}/g, 'home')).protocol)
  } catch {
    return false
  }
}

export function normalizeSettings(value: unknown): CmsSettings {
  const s = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return { previewUrl: validPreviewUrl(s.previewUrl) ? String(s.previewUrl || '') : '', brief: normalizeBrief(s.brief) }
}

/** The preview URL for one entry. */
export function previewUrlFor(template: string, slug: string): string {
  return template.replace(/\{slug\}/g, slug === 'home' ? '' : slug)
}
