/**
 * The email block model — the single source of truth shared by the client
 * editor (preview + inspector), the server AI chat tools, and the HTML
 * renderer. An EmailDocument is an ordered list of blocks plus document-level
 * settings; the renderer (./render.ts) turns it into email-safe, table-based,
 * inline-styled HTML.
 *
 * Two blocks hold other blocks: `columns` (a list per column) and `section`
 * (one list on a shared surface: a card, a coloured band). Everything else is
 * a leaf. `childLists` is the one place that knows which is which, so every
 * walk, edit and render goes through it. The AI references a block by its
 * stable `id`, wherever it sits.
 */

/**
 * Design tokens the theme designer edits. Applying a theme rewrites the
 * settings and block colors below from these tokens — layout is untouched.
 */
export interface EmailTheme {
  /** accent for buttons and links */
  brand: string
  /** text on top of the brand color (button labels) */
  onBrand: string
  /** outer page background */
  background: string
  /** content card background */
  surface: string
  /** heading color */
  heading: string
  /** body text color */
  text: string
  /** dividers / secondary hairlines */
  muted: string
  /** base font family stack */
  fontFamily: string
  /** button corner radius in px */
  radius: number
}

/** Document-level settings applied to the email wrapper. */
export interface EmailSettings {
  /** outer page background (around the content card) */
  backgroundColor: string
  /** the content card background */
  contentBackground: string
  /** max content width in px (typically 600 for email) */
  contentWidth: number
  /** base font family stack */
  fontFamily: string
  /** default text color */
  textColor: string
  /** the email's <title> / preheader-ish subject used in exports */
  title: string
  /** hidden preheader text shown in inbox previews */
  preheader: string
  /** the plain-text part sent alongside the HTML; generated from the HTML when blank */
  text?: string
  /** the design tokens last applied via the theme designer (if any) */
  theme?: EmailTheme
}

export type Align = 'left' | 'center' | 'right'

export const PADDING_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type PaddingSide = typeof PADDING_SIDES[number]

export interface PaddingSides {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export type PaddingValue = number | PaddingSides

interface BaseBlock {
  id: string
  type: string
  /** outer padding in px, applied to all sides or per side */
  padding?: PaddingValue
  /** per-block background override */
  background?: string
}

function readNumberish(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (!value || typeof value !== 'object') return null

  const record = value as {
    value?: unknown
    target?: { value?: unknown }
    currentTarget?: { value?: unknown }
  }

  if ('value' in record) return readNumberish(record.value)
  if (record.target && 'value' in record.target) return readNumberish(record.target.value)
  if (record.currentTarget && 'value' in record.currentTarget) return readNumberish(record.currentTarget.value)
  return null
}

export function coerceNumberLike(value: unknown, fallback = 0): number {
  return readNumberish(value) ?? fallback
}

export function isPaddingSides(value: unknown): value is PaddingSides {
  return !!value && typeof value === 'object' && !Array.isArray(value) && PADDING_SIDES.some(side => side in value)
}

export function getPaddingSides(padding: unknown): Required<PaddingSides> {
  if (isPaddingSides(padding)) {
    return {
      top: coerceNumberLike(padding.top, 0),
      right: coerceNumberLike(padding.right, 0),
      bottom: coerceNumberLike(padding.bottom, 0),
      left: coerceNumberLike(padding.left, 0)
    }
  }

  const uniform = coerceNumberLike(padding, 0)
  return { top: uniform, right: uniform, bottom: uniform, left: uniform }
}

export function normalizePadding(padding: unknown): PaddingValue | undefined {
  if (padding == null || padding === '') return undefined
  if (isPaddingSides(padding)) return getPaddingSides(padding)
  return coerceNumberLike(padding, 0)
}

export function isUniformPadding(padding: unknown): boolean {
  const { top, right, bottom, left } = getPaddingSides(padding)
  return top === right && top === bottom && top === left
}

export function getUniformPaddingValue(padding: unknown): number | null {
  if (!isUniformPadding(padding)) return null
  return getPaddingSides(padding).top
}

export function paddingCssValue(padding: unknown): string {
  const { top, right, bottom, left } = getPaddingSides(padding)
  return `${top}px ${right}px ${bottom}px ${left}px`
}

export function paddingHorizontal(padding: unknown): number {
  const { left, right } = getPaddingSides(padding)
  return left + right
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading'
  text: string
  level: 1 | 2 | 3
  align: Align
  color?: string
  /** px; omit for the level's size (28 / 22 / 18) */
  fontSize?: number
  /** a font stack for this heading; omit for the email's */
  fontFamily?: string
  /** tracking in px (negative tightens a large title) */
  letterSpacing?: number
}

export interface TextBlock extends BaseBlock {
  type: 'text'
  /** inline HTML allowed (b, i, a, br) — sanitized at render time */
  html: string
  align: Align
  color?: string
  fontSize?: number
}

export interface ButtonBlock extends BaseBlock {
  type: 'button'
  label: string
  href: string
  align: Align
  backgroundColor: string
  color: string
  radius?: number
  /** label size in px (default 15); the padding scales with it */
  fontSize?: number
  /** CSS box-shadow */
  shadow?: string
}

export interface ImageBlock extends BaseBlock {
  type: 'image'
  src: string
  alt: string
  href?: string
  align: Align
  /** width in px; omit/0 for full content width */
  width?: number
  /** height in px, for an image sized by height (a badge); the width follows. Ignored when `width` is set. */
  height?: number
}

export interface DividerBlock extends BaseBlock {
  type: 'divider'
  color?: string
  thickness?: number
}

export interface SpacerBlock extends BaseBlock {
  type: 'spacer'
  height: number
}

export interface ColumnsBlock extends BaseBlock {
  type: 'columns'
  /** 2 or 3 columns, each an independent list of blocks */
  columns: EmailBlock[][]
  /** gap between columns in px */
  gap?: number
}

/**
 * Escape hatch: raw email HTML the AI (or user) provides verbatim. The renderer
 * emits it inside a table cell unchanged — the AI is instructed to keep it
 * email-safe (tables + inline styles). Use sparingly; structured blocks are
 * preferred for everything the typed blocks can express.
 */
export interface HtmlBlock extends BaseBlock {
  type: 'html'
  html: string
}

/**
 * Blocks on one shared surface: the email card, a coloured or gradient band,
 * a callout, or just a padded group. `background` is the solid colour, the
 * gradient's start and what Outlook shows; `padding` sits inside it.
 */
export interface SectionBlock extends BaseBlock {
  type: 'section'
  blocks: EmailBlock[]
  /** gradient end colour; the gradient runs from `background` to it */
  gradientTo?: string
  /** gradient direction in degrees (CSS: 180 is top to bottom) */
  gradientAngle?: number
  /** corner radius in px; children are clipped to it */
  radius?: number
  /** CSS box-shadow */
  shadow?: string
}

export const COMPONENT_FIELD_TYPES = ['text', 'richtext', 'url', 'image', 'color', 'number'] as const
export type EmailComponentFieldType = typeof COMPONENT_FIELD_TYPES[number]

/**
 * One editable part of a library component, written `{{@key}}` in its HTML.
 * Content fields are copy, links and images; style fields are colours and
 * sizes. Keys are plain identifiers, so `values` objects store safely.
 */
export interface EmailComponentField {
  key: string
  label: string
  type: EmailComponentFieldType
  group: 'content' | 'style'
  default: string
}

/**
 * An instance of a library component: a copy of its HTML and fields from when
 * it was inserted, plus this email's values (a missing value is the field's
 * default). Self-contained, so it renders and sends without the library.
 */
export interface ComponentBlock extends BaseBlock {
  type: 'component'
  componentId: string
  name: string
  html: string
  fields: EmailComponentField[]
  values: Record<string, string>
}

export type EmailBlock
  = | HeadingBlock
    | TextBlock
    | ButtonBlock
    | ImageBlock
    | DividerBlock
    | SpacerBlock
    | ColumnsBlock
    | HtmlBlock
    | SectionBlock
    | ComponentBlock

export type EmailBlockType = EmailBlock['type']

export interface EmailDocument {
  settings: EmailSettings
  blocks: EmailBlock[]
}

export const DEFAULT_SETTINGS: EmailSettings = {
  backgroundColor: '#f4f4f5',
  contentBackground: '#ffffff',
  contentWidth: 600,
  fontFamily: '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif',
  textColor: '#18181b',
  title: 'Untitled email',
  preheader: ''
}

/** A blank starter document with a friendly placeholder block. */
export function emptyDocument(): EmailDocument {
  return {
    settings: { ...DEFAULT_SETTINGS },
    blocks: [
      {
        id: 'blk_welcome',
        type: 'heading',
        text: 'Your headline here',
        level: 1,
        align: 'center',
        padding: 24
      } as HeadingBlock,
      {
        id: 'blk_intro',
        type: 'text',
        html: 'Start by describing the email you want in the chat — or click a block to edit it directly.',
        align: 'center',
        padding: 16
      } as TextBlock
    ]
  }
}

/** Defaults for a freshly-inserted block of each type (id filled by caller). */
export function defaultBlock(type: EmailBlockType, id: string): EmailBlock {
  switch (type) {
    case 'heading':
      return { id, type, text: 'Heading', level: 2, align: 'left', padding: 16 }
    case 'text':
      return { id, type, html: 'Some text.', align: 'left', padding: 16 }
    case 'button':
      return { id, type, label: 'Click me', href: 'https://example.com', align: 'center', backgroundColor: '#2563eb', color: '#ffffff', radius: 6, padding: 16 }
    case 'image':
      return { id, type, src: 'https://via.placeholder.com/600x200', alt: '', align: 'center', padding: 16 }
    case 'divider':
      return { id, type, color: '#e4e4e7', thickness: 1, padding: 8 }
    case 'spacer':
      return { id, type, height: 24 }
    case 'columns':
      return { id, type, columns: [[], []], gap: 16, padding: 8 }
    case 'html':
      return { id, type, html: '<!-- custom html -->' }
    // A bare group: normalizeBlock fills these defaults under whatever the AI
    // leaves out, so a default colour or padding would land on every section.
    case 'section':
      return { id, type, blocks: [] }
    case 'component':
      return { id, type, componentId: '', name: 'Component', html: '', fields: [], values: {} }
  }
}

/** The block lists a block holds: one per column, the section's own, or none. */
export function childLists(b: EmailBlock): EmailBlock[][] {
  if (b.type === 'columns') return b.columns
  if (b.type === 'section') return [b.blocks]
  return []
}

/** Walk every block, nested ones included, in reading order. */
export function walkBlocks(blocks: EmailBlock[], fn: (b: EmailBlock) => void): void {
  for (const b of blocks) {
    fn(b)
    for (const list of childLists(b)) walkBlocks(list, fn)
  }
}

/** Find a block by id anywhere in the document. */
export function findBlock(blocks: EmailBlock[], id: string): EmailBlock | null {
  return locateBlock(blocks, id)?.block ?? null
}

export type BlockLocation = {
  block: EmailBlock
  /** the list holding it (the document's, a column's or a section's) */
  list: EmailBlock[]
  index: number
  /** the columns or section block holding it; null at the top level */
  parent: EmailBlock | null
  /** which of the parent's lists (always 0 for a section) */
  column: number
}

/** Where a block sits. The `list` is the live array, so callers may splice it. */
export function locateBlock(blocks: EmailBlock[], id: string, parent: EmailBlock | null = null, column = 0): BlockLocation | null {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.id === id) return { block, list: blocks, index, parent, column }
    const lists = childLists(block)
    for (let c = 0; c < lists.length; c++) {
      const found = locateBlock(lists[c]!, id, block, c)
      if (found) return found
    }
  }
  return null
}
