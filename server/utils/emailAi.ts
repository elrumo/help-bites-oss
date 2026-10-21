import { jsonSchema, parsePartialJson, tool, type UIMessageStreamWriter } from 'ai'
import { createError } from 'h3'
import { COMPONENT_FIELD_TYPES, findBlock, type EmailBlock, type EmailBlockType, type EmailComponentField, type EmailDocument, type EmailTheme } from '#shared/email/blocks'
import { addBlock, MAX_DOCUMENT_CHARS, moveBlock, normalizeDocument, removeBlock, replaceBlockWith, setDocument, updateBlock, updateSettings, type BlockParent, type OpResult } from '#shared/email/ops'
import { applyThemeToDocument, THEME_PRESETS } from '#shared/email/theme'
import { lintEmail } from '#shared/email/lint'
import { componentValue, renderBlockTable } from '#shared/email/render'
import { componentBlocks, componentCatalog, componentInstance, expandComponentRefs, refreshComponent, type EmailComponentDef } from '#shared/email/components'
import { conversionGaps } from '#shared/email/convert'
import { EMAIL_AI_TIERS, type EmailAiTier } from '#shared/email/ai'
import type { EmailBrand, TemplateVariable } from '#shared/email/resolve'

// The AI designer behind the email editor. It edits the block document only
// through tools (the same pure ops the editor uses), streaming every new
// document to the browser as it goes. Its prompt is the full block reference
// plus the rules for choosing between a block, a library component, a new
// component and custom HTML; it knows whether it is shaping a master (brand
// placeholders, never hardcoded names) or one project's template, sees the
// deterministic checks from lintEmail, and, when converting HTML, is told
// after each edit what it dropped or added compared with the source.

/**
 * The designer's model for a workspace: its own provider when it has one,
 * else the server's gateway, where Ultra is a plan feature and every turn
 * spends AI credits (refused up front once they are gone).
 */
export async function emailAiModel(workspace: ParseObject, tier: EmailAiTier) {
  const route = await resolveAi(workspace, { model: EMAIL_AI_TIERS[tier].model, ultra: tier === 'ultra' })
  if (!route) throw createError({ statusCode: 501, statusMessage: 'The AI designer needs LITELLM_API_BASE_URL on the server, or the workspace\'s own AI provider' })
  if (tier === 'ultra' && route.source === 'platform') await assertFeature(workspace, 'emailAiUltra')
  await assertAiBudget(route)
  return { model: aiSdkModel(route), route }
}

export type EmailAiState = {
  doc: EmailDocument
  variables: TemplateVariable[]
  changed: boolean
  /** The library this template can use: shared components plus its project's own. */
  components: EmailComponentDef[]
  /** Components saved this turn. */
  saved: number
}

export type SaveComponentInput = { id?: string, name: string, description: string, html: string, fields: EmailComponentField[], shared?: boolean }

export type EmailAiContext = {
  scope: 'master' | 'project'
  brand: EmailBrand | null
  selectedId?: string | null
  /** The HTML being converted, and the rest of the email when only one block is. */
  source?: { html: string, keep?: EmailDocument } | null
  /** Creates (or, with an id, updates) a library component; the route picks its scope. */
  saveComponent?: (input: SaveComponentInput) => Promise<EmailComponentDef>
}

const BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'section', 'columns', 'html', 'component'] as const
const MAX_SAVES_PER_TURN = 5

function summary(b: EmailBlock): string {
  const clip = (s: string, n = 60) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
  switch (b.type) {
    case 'heading': return `h${b.level}${b.fontSize ? ` ${b.fontSize}px` : ''} "${clip(b.text)}"`
    case 'text': return `"${clip(b.html)}"`
    case 'button': return `"${clip(b.label)}" → ${b.href}`
    case 'image': return `${b.src}${b.alt ? ` alt="${clip(b.alt)}"` : ' (no alt)'}`
    case 'spacer': return `${b.height}px`
    case 'html': return `${b.html.length} chars`
    case 'section': return [b.background ? `on ${b.background}${b.gradientTo ? `→${b.gradientTo}` : ''}` : 'no background', b.radius ? `radius ${b.radius}` : ''].filter(Boolean).join(', ')
    case 'component': return `"${b.name}" (${b.componentId || 'not in the library'}) ${b.fields.map(f => `${f.key}="${clip(componentValue(f, b.values), 40)}"`).join(' ')}`
    default: return ''
  }
}

/** An indented map of the email: the model targets blocks by these ids. */
function outline(blocks: EmailBlock[], depth = 0): string[] {
  return blocks.flatMap((b, i) => {
    const line = `${'  '.repeat(depth)}${depth ? '-' : `${i}.`} ${b.id} ${b.type} ${summary(b)}`.trimEnd()
    if (b.type === 'section') return [line, ...outline(b.blocks, depth + 1)]
    if (b.type !== 'columns') return [line]
    return [line, ...b.columns.flatMap((col, c) => [`${'  '.repeat(depth + 1)}column ${c} (0-based):`, ...outline(col, depth + 2)])]
  })
}

function documentForPrompt(doc: EmailDocument): string {
  // A component shows its values; its HTML is kept for it and would only burn tokens.
  const json = JSON.stringify(doc, (_key, value) => (value && typeof value === 'object' && value.type === 'component' ? { ...value, html: undefined, fields: undefined } : value))
  return json.length > 32000
    ? `${json.slice(0, 32000)}…(TRUNCATED: the outline above has every block id. Edit with the targeted tools; set_document would lose the blocks cut off here.)`
    : json
}

function selectionForPrompt(selected: EmailBlock | null, width: number): string {
  if (!selected) return 'No block is selected.'
  const clip = (s: string) => (s.length > 12000 ? `${s.slice(0, 12000)}…(truncated)` : s)
  const lines = [`The user has SELECTED block ${selected.id} (${selected.type}); unless they say otherwise their request is about it:`, clip(JSON.stringify(selected))]
  if (selected.type === 'section' || selected.type === 'columns') lines.push(`Its HTML as rendered, the starting point if it becomes a component:\n${clip(renderBlockTable(selected, width))}`)
  return lines.join('\n')
}

const BLOCK_REFERENCE = [
  '## Built-in blocks',
  'Every block has: id, type, padding (px: a number, or { top, right, bottom, left }) and background (a colour behind it). Fields you leave out take these defaults, padding included: heading, text, button and image get 16 on every side, divider and columns 8, everything else 0. So always write padding, as 0 where there is none.',
  '- section { blocks: [...], background?, gradientTo?, gradientAngle? (degrees; 180 is top to bottom), radius?, shadow? (CSS box-shadow) }: blocks on one shared surface: the email card, a coloured or gradient band, a callout box, a footer panel, or (with no background) a padded group. Sections nest. `background` is the solid colour, the gradient\'s start and what Outlook shows. Padding sits inside the surface. A rounded section clips its children to its corners, so a band at the top of a card needs no radius of its own.',
  '- columns { columns: [[...], [...]] (2 or 3), gap? }: blocks side by side. They stay side by side on phones, so keep the main message single-column and use columns for small things (two badges, an icon beside a line of text). Columns hold plain blocks, not sections or columns.',
  '- heading { text, level 1-3, align, color?, fontSize?, fontFamily?, letterSpacing? }: plain text, no markup. Size defaults to 28 / 22 / 18px by level; line height 1.25, bold. fontFamily is a stack for this heading only (omit to use the email\'s); letterSpacing is in px (-0.02em on a 34px title is -0.68).',
  '- text { html, align, color?, fontSize? }: paragraphs at line height 1.6, 15px by default. Inline HTML only: b, strong, i, em, u, br, span, a href. On <a> and <span>, style="" keeps color, background-color, font-weight, font-style, text-decoration and font-size; nothing else survives. Links without a colour take the text colour. Same-style paragraphs share one block, separated by <br><br>; a change of size or colour is a new block.',
  '- button { label, href, align, backgroundColor, color, radius?, fontSize?, shadow? }: a bulletproof button. radius defaults to 6 (999 is a pill); fontSize to 15, and the padding grows with it. backgroundColor "transparent" makes a bare link on its own line (write it explicitly: the default is blue).',
  '- image { src, alt, href?, align, width?, height? }: width in px, or leave it out for full width. For an image sized only by height (a badge) set height and no width; the width follows the picture. Logos, badges and icons always get a width or a height.',
  '- divider { color?, thickness? }: a hairline.',
  '- spacer { height }: empty space.',
  '- html { html }: raw email HTML, the last resort. In it {{key}} fills in as escaped text; {{{key}}} fills in a value that is HTML on purpose.',
  '- component { componentId, values: { field: value } }: an instance of a library component. Write only componentId and values; HelpBites copies the component\'s HTML and fields in. To change an instance\'s copy or style, update its values (they merge).',
  'Settings: title (the subject line), preheader, backgroundColor (the page), contentBackground (the card), contentWidth (600), fontFamily, textColor (the default text colour), text (an optional hand-written plain-text version; blank means generated), theme (the design tokens: brand, onBrand, background, surface, heading, text, muted, fontFamily, radius).',
  'The card: contentBackground is a plain rectangle behind the top-level blocks. When the card has rounded corners or a shadow, or something sits outside it (a badge above it, a note below it), set contentBackground to the page colour and build the card as a section with its background, radius and shadow; the outside parts go before or after that section at the top level.',
  `Theme presets for set_theme: ${THEME_PRESETS.map(p => p.id).join(', ')}.`
]

const CHOOSING = [
  '## Choosing how to build each part',
  'Go through these in order for every part of the email, and stop at the first that fits:',
  '1. A library component (listed below) whose description matches the part: the team saved it to be reused, so use it, with this email\'s values (copy, links, and style values where they differ), instead of rebuilding it.',
  '2. A built-in block. Use one whenever it can express the part, even when a detail differs (a letter-spacing, a font the reader won\'t have anyway); mention the difference. Blocks stay editable in the inspector, follow the project brand and render reliably in every client.',
  '3. A new library component (save_component), when no block can express a self-contained part and it is the kind of thing other emails will want too: a brand header or footer, a badge, a product or receipt row, a social links row, a testimonial card, app store badges. Write ONE self-contained element (a <table>, never bare <tr> rows) in email-safe HTML: tables and inline styles, no classes or <style>. Put a {{@field}} wherever an email will want its own value: copy, links and images as content fields; colours, sizes and radii as style fields. The defaults are the original values, so the component looks right as inserted. Describe in one sentence when to use it. Then use it: replaceBlockId, or a component block in set_document or add_block.',
  '4. An html block, for one-off markup nothing above can express.',
  'Never put a whole email, or a part blocks can express, into one html block or component.'
]

const CONVERTING = [
  '## Converting HTML',
  'When the user pastes HTML, or asks to turn a custom HTML block into blocks, rebuild it from blocks so it looks the same and every part is editable:',
  '1. Read all of it first. Leave out <!-- comments --> and everything inside them, MSO conditionals and 1x1 tracking images. Everything visible survives exactly: every word (spelling and capitals kept), every link with its full URL (query string included), every {{variable}}.',
  '2. Settings: the outermost background → backgroundColor; the card\'s max width → contentWidth; the font stack most text uses → fontFamily; the most common body text colour → textColor. Take title and preheader from the <title> and the hidden preview text, or write them. Set theme from the source too: brand = the main call-to-action colour, onBrand = its label colour, background = the page, surface = the card, heading and text colours, muted = the hairline colour, radius = the main button\'s radius, fontFamily.',
  '3. The card: with rounded corners or a shadow, or content outside it, set contentBackground to the page colour and make the card a section (its background, radius and shadow, padding 0). Otherwise contentBackground is the card colour.',
  '4. Map each part, top to bottom:',
  '   - a cell with its own background or gradient (a hero, a band, a callout) → section; linear-gradient(183deg, #A 10%, #B 100%) → background "#A", gradientTo "#B", gradientAngle 183',
  '   - a padded group of rows without a background of its own → a section with no background, carrying that padding',
  '   - big bold text in its own cell → heading with its fontSize, color, align, and its own fontFamily and letterSpacing when they differ from the body (level 1 for the main title)',
  '   - paragraphs → text: keep <br>, and keep each link\'s colour, weight and text-decoration in its style=""',
  '   - a link drawn as a box (background, padding, radius) → button with its colours, radius, fontSize and shadow; a plain link alone on its line → button with backgroundColor "transparent" and its text colour',
  '   - <img> → image: width from its style, else its width attribute; only a height → height; href from a wrapping <a>; its alt. An image in the middle of a paragraph ends that text block; the rest continues in a new one.',
  '   - a 1px border-top cell → divider (colour, thickness); an empty cell with a height → spacer, or padding on a neighbour',
  '   - cells side by side → columns',
  '5. Spacing: a cell\'s padding becomes its block\'s padding, a row\'s padding-top its top padding. Keep each alignment.',
  '6. Build it top to bottom as described under How you work: set_document with the settings and the opening part, then add_block for each following part, in order (to convert a single custom HTML block, replace_block that block instead). Then set_variables for every {{placeholder}}, then check_email. After a conversion only fix checks that keep the design as it is (subject, preheader, alt text); report contrast or other design problems instead of changing the original\'s colours. Never set_theme a converted design unless the user asks.',
  '7. The tool results list what the email is missing or has added compared with the source ("Missing text", "Missing link or image", "Text not in the source"). While you are still adding parts, "Missing" is what is left to add. Once every part is in, fix every remaining item with update_blocks, add_block or replace_block, and check again, before you answer.',
  '8. Answer with a short summary of how the parts map to blocks and anything that could not match exactly. If a part looks reusable across emails (a brand header, a footer), offer to save it as a library component; don\'t save it unasked.',
  'Example. This HTML:',
  '<td style="background:#0f172a;padding:24px 32px;border-radius:12px"><h1 style="color:#fff;font-size:30px;margin:0">Hi {{name}}</h1><p style="color:#cbd5e1;font-size:16px;margin:12px 0 0">Your <a href="https://acme.test/plan" style="color:#38bdf8;font-weight:600;text-decoration:none">trial</a> ends soon.</p><a href="{{url}}" style="display:inline-block;margin-top:16px;background:#22c55e;color:#04120a;padding:12px 20px;border-radius:8px">Upgrade</a></td>',
  'becomes this block:',
  '{"type":"section","background":"#0f172a","radius":12,"padding":{"top":24,"right":32,"bottom":24,"left":32},"blocks":[{"type":"heading","text":"Hi {{name}}","level":1,"fontSize":30,"color":"#ffffff","align":"left","padding":0},{"type":"text","html":"Your <a href=\\"https://acme.test/plan\\" style=\\"color:#38bdf8;font-weight:600;text-decoration:none\\">trial</a> ends soon.","fontSize":16,"color":"#cbd5e1","align":"left","padding":{"top":12,"right":0,"bottom":0,"left":0}},{"type":"button","label":"Upgrade","href":"{{url}}","backgroundColor":"#22c55e","color":"#04120a","radius":8,"align":"left","padding":{"top":16,"right":0,"bottom":0,"left":0}}]}'
]

export function emailSystemPrompt(state: EmailAiState, ctx: EmailAiContext): string {
  const { doc, variables } = state
  const selected = ctx.selectedId ? findBlock(doc.blocks, ctx.selectedId) : null
  const issues = lintEmail(doc, { master: ctx.scope === 'master' })
  const brand = ctx.brand

  return [
    'You are the email designer inside HelpBites, a toolkit indie developers use to run support, feedback and email for their apps. You design, edit and convert emails that look right in Gmail, Apple Mail and Outlook, on phones and desktops.',
    '',
    '## How you work',
    'The email is a tree of typed BLOCKS that HelpBites renders to email-safe HTML (tables, inline styles). Change it ONLY with the tools; never paste HTML or JSON into the chat.',
    '- A new email, a redesign, or converting pasted HTML: build it top to bottom in a few calls, so the user watches it take shape in the preview. First set_document with the settings and the opening part (for a carded email: what sits above the card, the card section holding its first band, and anything below the card); then add_block for each following part in reading order, one whole part per call (a section with all its blocks), with parentId to put it inside the card. Short emails can go in one set_document.',
    '- Edits: the targeted tools. update_blocks changes several blocks in one call; add_block and move_block take a parentId to work inside a section or a column; replace_block swaps one block for others in place.',
    '- Restyle without touching copy or layout ("darker", "more playful", "use #16a34a"): set_theme.',
    '- Every new {{placeholder}} gets a realistic sample value through set_variables, so the preview reads like a real email.',
    '- After changing more than one block, call check_email and fix what it reports that is in your control.',
    '- Then answer in one to three short sentences: what changed, and anything the user must do (replace a placeholder image, point a button at a real URL). If the request was ambiguous, state the assumption you made in one clause. Do not ask questions about simple edits; make the sensible choice.',
    '',
    ...CHOOSING,
    '',
    ...BLOCK_REFERENCE,
    '',
    '## Library components',
    componentCatalog(state.components),
    '',
    ...CONVERTING,
    '',
    '## Quality bar',
    '- Subject (settings.title) under 50 characters and specific; a preheader that adds to it rather than repeating it.',
    '- One clear primary action. Button labels are verbs ("Reset password", not "Click here").',
    '- Body text contrast at least 4.5:1, headings 3:1; every image has alt text.',
    '- Short paragraphs, scannable structure, generous spacing; 600px wide.',
    '- Transactional emails (receipts, resets, invitations) stay plain and skip marketing; marketing emails end with a muted footer with the sender address and an unsubscribe line ({{unsubscribeUrl}}).',
    '- Never invent real image URLs: use https://dummyimage.com/… placeholders and say so. Use {{variables}} for links the app fills in (e.g. {{resetUrl}}, {{actionUrl}}).',
    '',
    ctx.scope === 'master'
      ? [
          '## This is a MASTER template',
          'It is designed once and used by many projects, each with its own brand. Never hardcode a product name, logo or website:',
          '- {{project.name}} for the product name, {{project.logoUrl}} as the logo image src, {{project.url}} for links to the product.',
          '- Primary buttons use the theme brand colour; each project swaps that colour for its own accent automatically, on buttons and on components\' colour fields.',
          '- Copy that differs per project (sign-off, address, support email) goes in variables such as {{footer}} or {{supportEmail}}, with neutral sample values.',
          '- Components you save here are shared with every project.',
          '- Converting HTML into a master keeps its copy as written unless the user asks for the brand placeholders.'
        ].join('\n')
      : [
          '## This template belongs to one project',
          `Project: ${brand?.name || 'unnamed'}${brand?.siteUrl ? ` (${brand.siteUrl})` : ''}${brand?.theme?.accent ? `, brand accent ${brand.theme.accent}` : ''}.`,
          '{{project.name}}, {{project.logoUrl}} and {{project.url}} still work and fill in from the project settings.',
          'Components you save here belong to this project unless you pass shared: true (only for parts with nothing project-specific in them).'
        ].join('\n'),
    '',
    '## Current email',
    `Subject: ${doc.settings.title || '(none)'} | Preheader: ${doc.settings.preheader || '(none)'}`,
    'Blocks (index. id type summary; nested blocks are indented under their section or column):',
    outline(doc.blocks).join('\n') || '(empty)',
    `Variables: ${variables.length ? variables.map(v => `{{${v.key}}}${v.defaultValue ? ` = "${v.defaultValue}"` : ''}`).join(', ') : '(none)'}`,
    issues.length ? `Checks currently failing:\n${issues.map(i => `- [${i.level}] ${i.message}${i.blockId ? ` (${i.blockId})` : ''}`).join('\n')}` : 'Checks: all passing.',
    ...(ctx.source ? ['You are converting HTML in this turn: the tools compare the email with it after each edit.'] : []),
    selectionForPrompt(selected, doc.settings.contentWidth),
    `Full document JSON: ${documentForPrompt(doc)}`
  ].join('\n')
}

const BLOCKS_SCHEMA = { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: [...BLOCK_TYPES] } } } }

/** Component blocks sent without their HTML: this email's own copy (same id) first, then the library. */
function withComponentCopies(blocks: unknown, state: EmailAiState) {
  const own = new Map(componentBlocks(state.doc.blocks).map(b => [b.id, b]))
  const restore = (list: unknown): unknown[] => (Array.isArray(list) ? list : []).map((raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const block = { ...(raw as Record<string, unknown>) }
    const kept = block.type === 'component' && !String(block.html ?? '').trim() ? own.get(String(block.id ?? '')) : undefined
    if (kept && (!block.componentId || block.componentId === kept.componentId)) {
      Object.assign(block, { componentId: kept.componentId, name: kept.name, html: kept.html, fields: kept.fields, values: block.values ?? kept.values })
    }
    if (Array.isArray(block.columns)) block.columns = block.columns.map(col => restore(col))
    if (Array.isArray(block.blocks)) block.blocks = restore(block.blocks)
    return block
  })
  const expanded = expandComponentRefs(restore(blocks), state.components)
  const note = expanded.unknown.length ? ` Left out unknown component id(s) ${expanded.unknown.join(', ')}: use an id from the library list.` : ''
  return { blocks: expanded.blocks, note }
}

// ---- drafts -------------------------------------------------------------------------
// A whole email arrives as one tool call, a few characters at a time, and only
// runs once it is complete. Drafts parse what has arrived so far and stream it
// as a transient `data-draft` document, so the preview fills in block by block
// while the model writes; the real `data-document` replaces it when the call
// runs. Nothing about a draft is saved.

const DRAFTED_TOOLS = new Set(['set_document', 'replace_block', 'add_block'])
const DRAFT_EVERY_MS = 350

/** The email as it would be if the call written so far ended here, or null while there is nothing to show. */
export async function draftDocument(state: EmailAiState, toolName: string, inputText: string): Promise<EmailDocument | null> {
  const parsed = (await parsePartialJson(inputText)).value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const input: Record<string, unknown> = { ...parsed }
  // Some models send objects as JSON strings: read the start of those too.
  for (const key of ['document', 'blocks', 'props']) {
    if (typeof input[key] === 'string') input[key] = (await parsePartialJson(input[key] as string)).value
  }
  if (toolName === 'set_document') {
    const doc = input.document as { settings?: unknown, blocks?: unknown } | undefined
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks) || !doc.blocks.length) return null
    return normalizeDocument({ ...doc, blocks: withComponentCopies(doc.blocks, state).blocks })
  }
  if (toolName === 'replace_block' && typeof input.id === 'string' && Array.isArray(input.blocks)) {
    const res = replaceBlockWith(state.doc, input.id, withComponentCopies(input.blocks, state).blocks)
    return res.ok ? res.doc : null
  }
  if (toolName === 'add_block' && typeof input.type === 'string' && (BLOCK_TYPES as readonly string[]).includes(input.type)) {
    const [props] = withComponentCopies([{ ...(input.props && typeof input.props === 'object' ? input.props : {}), type: input.type }], state).blocks
    if (!props) return null
    const parentId = typeof input.parentId === 'string' ? input.parentId : undefined
    const res = addBlock(state.doc, input.type as EmailBlockType, props as Record<string, unknown>, typeof input.at === 'number' ? input.at : undefined, parentId ? { id: parentId, column: Number(input.column) || 0 } : undefined)
    return res.ok ? res.doc : null
  }
  return null
}

/** streamText's onChunk: drafts for the calls that build many blocks at once, a few times a second. */
export function emailAiDrafts(state: EmailAiState, writer: UIMessageStreamWriter) {
  const calls = new Map<string, { tool: string, text: string, at: number, sent: string }>()
  return async ({ chunk }: { chunk: { type: string, id?: string, toolName?: string, delta?: string } }) => {
    if (chunk.type === 'tool-input-start' && chunk.id && DRAFTED_TOOLS.has(String(chunk.toolName))) {
      calls.set(chunk.id, { tool: String(chunk.toolName), text: '', at: 0, sent: '' })
      return
    }
    const call = chunk.type === 'tool-input-delta' && chunk.id ? calls.get(chunk.id) : undefined
    if (!call) return
    call.text += chunk.delta ?? ''
    const now = Date.now()
    if (now - call.at < DRAFT_EVERY_MS) return
    call.at = now
    const doc = await draftDocument(state, call.tool, call.text).catch(() => null)
    const json = doc ? JSON.stringify(doc) : ''
    if (!doc || json === call.sent) return
    call.sent = json
    writer.write({ type: 'data-draft', data: doc as unknown as Record<string, unknown>, transient: true })
  }
}

/** The editing tools. Each mutates `state` and streams the new document to the editor. */
export function emailAiTools(state: EmailAiState, writer: UIMessageStreamWriter, ctx: EmailAiContext) {
  const apply = (res: OpResult): string => {
    if (!res.ok) return res.message
    const doc = normalizeDocument(res.doc)
    if (JSON.stringify(doc).length > MAX_DOCUMENT_CHARS) return 'Not changed: that would make the email larger than 512 KB. Use less custom HTML.'
    state.doc = doc
    state.changed = true
    writer.write({ type: 'data-document', data: state.doc as unknown as Record<string, unknown>, transient: true })
    return res.message
  }

  /** After an edit during a conversion: what the email lost or gained against the source. */
  const gaps = (): string => {
    if (!ctx.source) return ''
    const found = conversionGaps(ctx.source.html, state.doc, ctx.source.keep)
    if (!state.doc.settings.theme) found.push('settings.theme is not set: set it from the source with update_settings (brand = the main call-to-action colour, onBrand, background, surface, heading, text, muted, fontFamily, radius)')
    return found.length
      ? `\nCompared with the HTML being converted, fix each of these:\n${found.map(g => `- ${g}`).join('\n')}`
      : '\nEverything in the HTML being converted is in the email, and nothing else.'
  }

  const withComponents = (blocks: unknown) => withComponentCopies(blocks, state)

  const parent = (parentId?: string, column?: number): BlockParent | undefined => (parentId ? { id: parentId, column } : undefined)

  /** After a call that creates many blocks, their ids, so the next edit can target them. */
  const ids = (said: string): string => {
    if (said.startsWith('No block') || said.startsWith('Not changed') || said.startsWith('The document needs')) return said
    const lines = outline(state.doc.blocks)
    return `${said}\nThe email now (id type summary):\n${lines.slice(0, 60).join('\n')}${lines.length > 60 ? `\n…${lines.length - 60} more` : ''}`
  }

  return withParsedArgs({
    set_document: tool({
      description: 'Replace the whole email: settings plus the tree of blocks (sections and columns hold their children inline). For new emails, redesigns and converting pasted HTML. A library component goes in as { "type": "component", "componentId": "…", "values": { … } }.',
      inputSchema: jsonSchema<{ document: EmailDocument }>({
        type: 'object',
        required: ['document'],
        properties: {
          document: {
            type: 'object',
            required: ['settings', 'blocks'],
            properties: {
              settings: { type: 'object', description: 'title (the subject), preheader, backgroundColor, contentBackground, contentWidth, fontFamily, textColor, theme' },
              blocks: BLOCKS_SCHEMA
            }
          }
        }
      }),
      execute: async ({ document }) => {
        const input = document as unknown as { settings?: unknown, blocks?: unknown } | string | null
        if (typeof input === 'string') {
          try {
            JSON.parse(input)
          } catch (error) {
            return `Not changed: document arrived as text that isn't valid JSON (${(error as Error).message}). Send document as a JSON object; if it is long, check it isn't cut off.`
          }
        }
        if (!input || typeof input !== 'object' || !Array.isArray(input.blocks)) return 'Not changed: document needs { settings, blocks: [...] }.'
        const { blocks, note } = withComponents(input.blocks)
        return ids(apply(setDocument(state.doc, { ...input, blocks } as EmailDocument))) + note + gaps()
      }
    }),
    update_settings: tool({
      description: 'Patch document settings: title (subject), preheader, backgroundColor, contentBackground, contentWidth, fontFamily, textColor, theme.',
      inputSchema: jsonSchema<{ patch: Record<string, unknown> }>({ type: 'object', required: ['patch'], properties: { patch: { type: 'object' } } }),
      execute: async ({ patch }) => apply(updateSettings(state.doc, patch as Partial<EmailDocument['settings']>))
    }),
    update_blocks: tool({
      description: 'Change fields of one or more existing blocks anywhere in the email, by id; send only the fields that change. A component\'s values merge, so send only the values that change. Children can\'t be patched here (use add_block, move_block, remove_block or replace_block), and a block\'s type can\'t change (replace it).',
      inputSchema: jsonSchema<{ updates: { id: string, patch: Record<string, unknown> }[] }>({
        type: 'object',
        required: ['updates'],
        properties: { updates: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'patch'], properties: { id: { type: 'string' }, patch: { type: 'object' } } } } }
      }),
      execute: async ({ updates }) => updates.map((u) => {
        const patch = (u.patch ?? {}) as Record<string, unknown>
        if ('blocks' in patch || 'columns' in patch) return `Block "${u.id}" not changed: children can't be patched; use add_block, move_block, remove_block or replace_block.`
        return apply(updateBlock(state.doc, u.id, patch))
      }).join(' ') + gaps()
    }),
    add_block: tool({
      description: 'Insert one block (a section may bring its children). It goes at the top level, or inside a section with parentId, or into a column of a columns block with parentId and column (0-based). at = index in that list (0 is first; default last). A library component: type "component" with props { componentId, values }. Returns the new id.',
      inputSchema: jsonSchema<{ type: string, props?: Record<string, unknown>, at?: number, parentId?: string, column?: number }>({
        type: 'object',
        required: ['type'],
        properties: { type: { type: 'string', enum: [...BLOCK_TYPES] }, props: { type: 'object' }, at: { type: 'number' }, parentId: { type: 'string' }, column: { type: 'number' } }
      }),
      execute: async ({ type, props, at, parentId, column }) => {
        const { blocks, note } = withComponents([{ ...(props ?? {}), type }])
        if (!blocks.length) return `Nothing added.${note}`
        return apply(addBlock(state.doc, type as EmailBlockType, blocks[0] as Record<string, unknown>, at, parent(parentId, column))) + note + gaps()
      }
    }),
    replace_block: tool({
      description: 'Replace one block, anywhere, with any number of blocks in the same place (none removes it): rebuild a custom HTML block as blocks, or swap a part for a section. The new blocks may be sections with children and library components.',
      inputSchema: jsonSchema<{ id: string, blocks: unknown[] }>({ type: 'object', required: ['id', 'blocks'], properties: { id: { type: 'string' }, blocks: BLOCKS_SCHEMA } }),
      execute: async ({ id, blocks }) => {
        const expanded = withComponents(blocks)
        return ids(apply(replaceBlockWith(state.doc, id, expanded.blocks))) + expanded.note + gaps()
      }
    }),
    remove_block: tool({
      description: 'Remove a block by id, anywhere in the email (its children go with it).',
      inputSchema: jsonSchema<{ id: string }>({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } }),
      execute: async ({ id }) => apply(removeBlock(state.doc, id)) + gaps()
    }),
    move_block: tool({
      description: 'Move a block to index `to` of the list it is in, or into a section (parentId) or a column of a columns block (parentId and column, 0-based).',
      inputSchema: jsonSchema<{ id: string, to: number, parentId?: string, column?: number }>({
        type: 'object',
        required: ['id', 'to'],
        properties: { id: { type: 'string' }, to: { type: 'number' }, parentId: { type: 'string' }, column: { type: 'number' } }
      }),
      execute: async ({ id, to, parentId, column }) => apply(moveBlock(state.doc, id, to, parent(parentId, column)))
    }),
    set_theme: tool({
      description: 'Restyle the whole email from design tokens (colours, font, button radius) without touching copy or layout. A preset and/or tokens; tokens win. Blocks on a section with its own background keep their colours.',
      inputSchema: jsonSchema<{ preset?: string, tokens?: Partial<EmailTheme> }>({
        type: 'object',
        properties: {
          preset: { type: 'string', enum: THEME_PRESETS.map(p => p.id) },
          tokens: { type: 'object', properties: { brand: { type: 'string' }, onBrand: { type: 'string' }, background: { type: 'string' }, surface: { type: 'string' }, heading: { type: 'string' }, text: { type: 'string' }, muted: { type: 'string' }, fontFamily: { type: 'string' }, radius: { type: 'number' } } }
        }
      }),
      execute: async ({ preset, tokens }) => {
        const patch = { ...(THEME_PRESETS.find(p => p.id === preset)?.theme ?? {}), ...(tokens ?? {}) }
        if (!Object.keys(patch).length) return 'No theme given.'
        return apply({ ok: true, message: 'Theme applied.', doc: applyThemeToDocument(state.doc, patch) })
      }
    }),
    set_variables: tool({
      description: 'Give {{placeholders}} a label and a realistic sample value (used in previews and when a send omits it).',
      inputSchema: jsonSchema<{ variables: TemplateVariable[] }>({
        type: 'object',
        required: ['variables'],
        properties: { variables: { type: 'array', items: { type: 'object', required: ['key'], properties: { key: { type: 'string' }, label: { type: 'string' }, defaultValue: { type: 'string' } } } } }
      }),
      execute: async ({ variables }) => {
        const byKey = new Map(state.variables.map(v => [v.key, v]))
        for (const v of variables) if (v?.key) byKey.set(v.key, { ...byKey.get(v.key), ...v })
        state.variables = [...byKey.values()]
        state.changed = true
        writer.write({ type: 'data-variables', data: { variables: state.variables }, transient: true })
        return `Set ${variables.map(v => v.key).join(', ')}.`
      }
    }),
    check_email: tool({
      description: 'Run the deliverability and accessibility checks on the current email (and, while converting, compare it with the source).',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      execute: async () => {
        const issues = lintEmail(state.doc, { master: ctx.scope === 'master' })
        return (issues.length ? issues.map(i => `[${i.level}] ${i.message}${i.blockId ? ` (${i.blockId})` : ''}: ${i.fix}`).join('\n') : 'All checks pass.') + gaps()
      }
    }),
    save_component: tool({
      description: 'Save custom HTML to the component library so this and other emails can reuse it, or update a library component by id (its uses in this email follow; other emails keep their copy). The HTML is ONE self-contained element (a <table>, never bare <tr> rows), email-safe (tables, inline styles), with {{@key}} wherever an email will want its own value; describe every field. replaceBlockId swaps that block for the component at its defaults, so the email looks the same. Returns the component id.',
      inputSchema: jsonSchema<SaveComponentInput & { replaceBlockId?: string }>({
        type: 'object',
        required: ['name', 'description', 'html', 'fields'],
        properties: {
          id: { type: 'string', description: 'Only to update an existing library component' },
          name: { type: 'string' },
          description: { type: 'string', description: 'When to use it, in one sentence' },
          html: { type: 'string', description: 'One element; {{@key}} for each field' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'type', 'group'],
              properties: {
                key: { type: 'string', description: 'letters, digits and _; starts with a letter' },
                label: { type: 'string' },
                type: { type: 'string', enum: [...COMPONENT_FIELD_TYPES] },
                group: { type: 'string', enum: ['content', 'style'] },
                default: { type: 'string', description: 'the original value' }
              }
            }
          },
          shared: { type: 'boolean', description: 'Offer it to every project' },
          replaceBlockId: { type: 'string' }
        }
      }),
      execute: async ({ replaceBlockId, ...input }) => {
        if (!ctx.saveComponent) return 'The component library isn\'t available here.'
        if (input.id && !state.components.some(c => c.id === input.id)) return `No library component "${input.id}" to update; leave id out to save a new one.`
        if (state.saved >= MAX_SAVES_PER_TURN) return `${MAX_SAVES_PER_TURN} components saved this turn already; ask the user before saving more.`
        let def: EmailComponentDef
        try {
          def = await ctx.saveComponent(input)
        } catch (error) {
          return `Not saved: ${(error as { statusMessage?: string }).statusMessage || (error as Error).message}`
        }
        state.saved += 1
        state.components = [def, ...state.components.filter(c => c.id !== def.id)]
        writer.write({ type: 'data-component', data: def as unknown as Record<string, unknown>, transient: true })
        const said = [`Saved component "${def.name}" (${def.id}) with fields: ${def.fields.map(f => `${f.key} (${f.type}, ${f.group})`).join(', ') || 'none'}.`]
        if (input.id) {
          for (const used of componentBlocks(state.doc.blocks).filter(b => b.componentId === def.id && b.id !== replaceBlockId)) {
            said.push(apply(replaceBlockWith(state.doc, used.id, [{ ...used, ...refreshComponent(used, def) }])))
          }
        }
        if (replaceBlockId) {
          const old = findBlock(state.doc.blocks, replaceBlockId)
          // Custom HTML keeps its padding and background outside its markup;
          // anything else (a section) drew them into the HTML just written.
          const frame = old && (old.type === 'html' || old.type === 'component')
            ? { ...(old.padding !== undefined ? { padding: old.padding } : {}), ...(old.background ? { background: old.background } : {}) }
            : {}
          said.push(old
            ? apply(replaceBlockWith(state.doc, old.id, [{ ...componentInstance(def), ...frame }]))
            : `No block "${replaceBlockId}" to replace.`)
        }
        return said.join(' ')
      }
    })
  })
}

/** Some models send object arguments as JSON strings ({"document": "{...}"}); parse them back. */
export function parseStringifiedArgs(input: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...input }
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) continue
    for (const text of [value, closeBrackets(value)]) {
      try {
        out[key] = JSON.parse(text)
        break
      } catch {}
    }
  }
  return out
}

/**
 * A stringified document that only forgot its last closing brackets (a deep
 * tree written by hand), closed. Anything else wrong is left for the parse to
 * reject, so the model hears about it.
 */
export function closeBrackets(text: string): string {
  const open: string[] = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') open.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') {
      if (open.pop() !== ch) return text
    }
  }
  return inString || !open.length ? text : text.replace(/,\s*$/, '') + open.reverse().join('')
}

/** Tools whose execute parses arguments some models send as JSON strings. */
export function withParsedArgs<T extends Record<string, { execute?: (input: any, options: any) => any }>>(tools: T): T {
  for (const t of Object.values(tools)) {
    const execute = t.execute
    if (execute) t.execute = (input, options) => execute(parseStringifiedArgs(input ?? {}), options)
  }
  return tools
}
