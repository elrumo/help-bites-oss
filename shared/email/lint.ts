import type { EmailBlock, EmailDocument } from './blocks'
import { childLists } from './blocks'
import { extractTemplateVariables } from './placeholders'
import { componentValue, fillComponent } from './render'

// Deterministic checks for the things that make an email fail in an inbox:
// missing subject or alt text, unreadable contrast, placeholder links and
// images, markup mail clients strip. The editor shows them; the AI reads them
// and fixes them. `fix` is phrased as an instruction for the AI.

export type EmailIssue = { level: 'error' | 'warning', message: string, fix: string, blockId?: string }

const PLACEHOLDER_URL = /dummyimage\.com|placeholder\.com|placehold\.co|picsum\.photos|example\.(com|org)/i
export const STRIPPED_TAGS = /<\s*(script|form|iframe|object|embed|video)\b/i

function rgb(color: string | undefined): [number, number, number] | null {
  const hex = String(color || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG contrast ratio, or null when either colour is not a plain hex. */
export function contrastRatio(a: string | undefined, b: string | undefined): number | null {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return null
  const lum = (c: [number, number, number]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function label(b: EmailBlock): string {
  if (b.type === 'heading') return `heading “${b.text.slice(0, 30)}”`
  if (b.type === 'text') return `text “${b.html.replace(/<[^>]+>/g, '').slice(0, 30)}”`
  if (b.type === 'button') return `button “${b.label}”`
  if (b.type === 'component') return `component “${b.name}”`
  return `${b.type} block`
}

export function lintEmail(doc: EmailDocument, options: { master?: boolean } = {}): EmailIssue[] {
  const issues: EmailIssue[] = []
  const s = doc.settings
  const title = String(s.title || '').trim()

  if (!title || title === 'Untitled email') issues.push({ level: 'error', message: 'No subject line', fix: 'Write a specific subject line (settings.title) under 50 characters.' })
  else if (title.replace(/\{\{[^}]+\}\}/g, 'xxxxxxxx').length > 70) issues.push({ level: 'warning', message: 'Subject is long and will be cut off in most inboxes', fix: 'Shorten the subject line to under 50 characters.' })
  if (!String(s.preheader || '').trim()) issues.push({ level: 'warning', message: 'No preheader', fix: 'Add a preheader that complements the subject (40–90 characters).' })
  if (!doc.blocks.length) issues.push({ level: 'error', message: 'The email is empty', fix: 'Design the email.' })
  // Custom HTML sizes itself; the width only governs blocks HelpBites lays out.
  const blocksLaidOut = doc.blocks.some(b => b.type !== 'html' && b.type !== 'component')
  if (s.contentWidth > 640 && blocksLaidOut) issues.push({ level: 'warning', message: `Content is ${s.contentWidth}px wide; 600px suits every client`, fix: 'Set settings.contentWidth to 600.' })

  // Contrast is measured against what is really behind a block: its own
  // background, else the nearest section's or columns', else the card's.
  const check = (b: EmailBlock, behind: string) => {
    const blockId = b.id
    const background = b.background || behind
    if (b.type === 'image') {
      if (!String(b.src || '').trim()) issues.push({ level: 'error', blockId, message: 'Image has no source', fix: `Give image ${blockId} a src or remove it.` })
      else if (PLACEHOLDER_URL.test(b.src)) issues.push({ level: 'warning', blockId, message: 'Placeholder image', fix: `Image ${blockId} still uses a placeholder URL; tell the user to replace it with their own image.` })
      if (!String(b.alt || '').trim()) issues.push({ level: 'warning', blockId, message: 'Image has no alt text', fix: `Write descriptive alt text for image ${blockId}.` })
    }
    if (b.type === 'button') {
      if (!String(b.label || '').trim()) issues.push({ level: 'error', blockId, message: 'Button has no label', fix: `Give button ${blockId} a clear action label.` })
      if (!b.href || b.href === '#' || PLACEHOLDER_URL.test(b.href)) issues.push({ level: 'warning', blockId, message: `${label(b)} links nowhere real`, fix: `Point button ${blockId} at a real URL or a {{variable}} such as {{actionUrl}}.` })
      const ratio = contrastRatio(b.color, b.backgroundColor)
      if (ratio !== null && ratio < 3) issues.push({ level: 'warning', blockId, message: `${label(b)} label is hard to read (${ratio.toFixed(1)}:1)`, fix: `Raise the contrast between the label and background of button ${blockId} to at least 4.5:1.` })
    }
    if (b.type === 'heading' || b.type === 'text') {
      const ratio = contrastRatio(b.color || s.textColor, background)
      const min = b.type === 'heading' ? 3 : 4.5
      if (ratio !== null && ratio < min) issues.push({ level: 'warning', blockId, message: `${label(b)} is hard to read (${ratio.toFixed(1)}:1)`, fix: `Raise the contrast of ${blockId} against its background to at least ${min}:1.` })
    }
    if (b.type === 'text' && /href\s*=\s*["']?(#|https?:\/\/(www\.)?example\.)/i.test(b.html)) issues.push({ level: 'warning', blockId, message: `${label(b)} has a placeholder link`, fix: `Replace the placeholder links in ${blockId} with real URLs or {{variables}}.` })
    if (b.type === 'html' && STRIPPED_TAGS.test(b.html)) issues.push({ level: 'error', blockId, message: 'Custom HTML uses tags mail clients strip (script, form, iframe, video)', fix: `Rewrite html block ${blockId} with tables and inline styles only.` })
    if (b.type === 'section' && b.gradientTo && !b.background) issues.push({ level: 'warning', blockId, message: 'Gradient section has no solid colour for Outlook', fix: `Give section ${blockId} a background colour close to its gradient; Outlook shows that instead.` })
    if (b.type === 'component') {
      if (STRIPPED_TAGS.test(fillComponent(b.html, b.fields, b.values))) issues.push({ level: 'error', blockId, message: `${label(b)} uses tags mail clients strip (script, form, iframe, video)`, fix: `Rebuild component ${blockId} with tables and inline styles only.` })
      for (const field of b.fields) {
        const value = componentValue(field, b.values)
        if ((field.type === 'url' || field.type === 'image') && PLACEHOLDER_URL.test(value)) issues.push({ level: 'warning', blockId, message: `${label(b)}: “${field.label}” is a placeholder`, fix: `Set the ${field.key} value of component ${blockId} to a real URL or a {{variable}}.` })
      }
    }
  }
  const visit = (blocks: EmailBlock[], behind: string) => {
    for (const b of blocks) {
      check(b, behind)
      for (const list of childLists(b)) visit(list, b.background || behind)
    }
  }
  visit(doc.blocks, s.contentBackground)

  if (options.master && !extractTemplateVariables(doc).some(k => k.startsWith('project.'))) {
    issues.push({ level: 'warning', message: 'This shared template does not use the project brand', fix: 'Use {{project.name}} for the product name, {{project.logoUrl}} as the logo image src and {{project.url}} for links, {{project.company}} and {{project.address}} in the footer, and {{project.privacyUrl}} / {{project.termsUrl}} for the legal pages, instead of hardcoded values.' })
  }
  return issues
}
