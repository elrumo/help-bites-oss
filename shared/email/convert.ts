import { findBlock, walkBlocks, type EmailDocument, type ImageBlock } from './blocks'
import { removeBlock } from './ops'
import { fillComponent, renderEmailHtml } from './render'
import { decodeHtmlEntities } from './resolve'
import { replaceBetween, replaceElements, stripTags } from '../htmlScan'

// Checks a conversion against the HTML it came from. When someone pastes an
// email and asks for it as blocks, every visible word and every link should
// survive, and nothing should appear that wasn't there (commented-out copy,
// invented text). The AI designer gets this list after each edit, so it can
// fix what it dropped instead of guessing whether it was faithful.

const HTML_TAG = /<(table|tbody|tr|td|div|section|html|body|p|a|img|span|h[1-6]|center)\b/gi

/** Asking for HTML to be rebuilt as blocks, rather than for an edit. */
export const CONVERT_REQUEST = /\b(convert|conversion|rebuild|recreate|replicate|reproduce|turn (?:it|this|these|that) into|into (?:editable )?(?:blocks|components))\b/i

/** The HTML in a chat message, when it carries some (at least a few tags of it). */
export function sourceHtmlOf(text: string): string | null {
  const value = String(text || '')
  if ((value.match(HTML_TAG) || []).length < 3) return null
  const start = value.indexOf('<')
  const end = value.lastIndexOf('>')
  return end > start ? value.slice(start, end + 1) : null
}

/** What a reader sees: no comments, head, hidden preview text or markup. */
function visible(html: string): string {
  // Each step reads the text once (shared/htmlScan.ts): the HTML can be anything a sender pasted.
  const withoutComments = replaceBetween(String(html || ''), '<!--', '-->', ' ')
  const withoutHead = replaceElements(withoutComments, ['head', 'style', 'script', 'title'], () => ' ')
  return stripTags(replaceElements(withoutHead, ['div', 'span', 'p', 'td'], () => ' ', (_name, attrs) => HIDDEN_BLOCK.test(attrs)), ' ')
}

const HIDDEN_BLOCK = /display\s*:\s*none|max-height\s*:\s*0/i

const TOKEN = /\{\{\{?\s*[\w.-]+\s*\}?\}\}|[\p{L}\p{N}]+(?:[.'’@&-][\p{L}\p{N}]+)*/gu
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circ: '\u0302', uml: '\u0308', tilde: '\u0303', cedil: '\u0327', ring: '\u030A' }
const LETTERS: Record<string, string> = { szlig: 'ß', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø', eth: 'ð', thorn: 'þ' }

/** Entities as text: accented letters too (`&eacute;`); any other unknown one is dropped, not read as a word. */
function decode(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring);/g, (_m, letter: string, accent: string) => `${letter}${ACCENTS[accent]}`.normalize('NFC'))
    .replace(/&([a-zA-Z]+);/g, (_m, name: string) => LETTERS[name] ?? ' ')
}

function words(html: string): string[] {
  return (decode(visible(html)).match(TOKEN) || []).map(w => w.toLowerCase().replace(/\s+/g, ''))
}

function urls(html: string): Set<string> {
  const found = new Set<string>()
  const markup = replaceElements(replaceBetween(String(html || ''), '<!--', '-->', ' '), ['head'], () => ' ')
  for (const match of markup.matchAll(/\b(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const url = decode(match[2] ?? match[3] ?? '').trim()
    if (url && url !== '#') found.add(url)
  }
  return found
}

/** Each source image's size as drawn: a CSS width beats the width attribute; height only when there's no width. */
function imageSizes(html: string): Map<string, { width?: number, height?: number }> {
  const sizes = new Map<string, { width?: number, height?: number }>()
  const markup = replaceBetween(String(html || ''), '<!--', '-->', ' ')
  for (const [tag] of markup.matchAll(/<img(?=[\s/>])[^<>]*>/gi)) {
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|(\\d+))`, 'i'))
    const src = decode(attr('src')?.[2] ?? attr('src')?.[3] ?? '').trim()
    if (!src) continue
    const style = attr('style')?.[2] ?? attr('style')?.[3] ?? ''
    const px = (prop: string) => Number(style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+)px`, 'i'))?.[1] || 0)
    const plain = (name: string) => Number((attr(name)?.[2] ?? attr(name)?.[3] ?? attr(name)?.[4] ?? '').replace(/px$/, '')) || 0
    const width = px('width') || plain('width')
    const height = width ? 0 : px('height') || plain('height')
    sizes.set(src, { ...(width ? { width } : {}), ...(height ? { height } : {}) })
  }
  return sizes
}

/** Images the conversion drew at another size than the source. */
function imageSizeGaps(sourceHtml: string, doc: EmailDocument): string[] {
  const images: ImageBlock[] = []
  walkBlocks(doc.blocks, b => b.type === 'image' && images.push(b))
  const gaps: string[] = []
  for (const [src, size] of imageSizes(sourceHtml)) {
    const image = images.find(i => i.src === src)
    if (!image) continue
    const drawn = image.width && image.width > 0 ? `${image.width}px wide` : image.height && image.height > 0 ? `${image.height}px tall` : 'full width'
    if (size.width && Math.abs((image.width || 0) - size.width) > 1) gaps.push(`Image size: ${image.id} (${src}) is ${size.width}px wide in the source but ${drawn} here; set width ${size.width}`)
    if (size.height && !(image.width && image.width > 0) && Math.abs((image.height || 0) - size.height) > 1) gaps.push(`Image size: ${image.id} (${src}) is ${size.height}px tall in the source but ${drawn} here; set height ${size.height}`)
  }
  return gaps
}

/** Words of `from`, in order, that `against` doesn't have as many of, joined into phrases. */
function unmatched(from: string[], against: string[]): string[] {
  const left = new Map<string, number>()
  for (const w of against) left.set(w, (left.get(w) || 0) + 1)
  const phrases: string[] = []
  let run: string[] = []
  for (const w of from) {
    const n = left.get(w) || 0
    if (n > 0) {
      left.set(w, n - 1)
      if (run.length) phrases.push(run.join(' '))
      run = []
    } else run.push(w)
  }
  if (run.length) phrases.push(run.join(' '))
  return phrases
}

/**
 * What the converted email lost or gained compared with its source HTML;
 * empty when faithful. `keep` is the rest of the email when only one block
 * was converted: its words were there before and aren't "new".
 */
export function conversionGaps(sourceHtml: string, doc: EmailDocument, keep?: EmailDocument): string[] {
  const html = renderEmailHtml(doc)
  const source = words(sourceHtml)
  const result = words(html)
  const known = keep ? [...source, ...words(renderEmailHtml(keep))] : source
  const resultUrls = urls(html)
  const clip = (p: string) => (p.length > 120 ? `${p.slice(0, 117)}…` : p)
  // Each kind gets its own share, so a pile of lost links can't hide invented copy.
  const capped = (items: string[], max: number) => (items.length > max ? [...items.slice(0, max), `…and ${items.length - max} more like that`] : items)
  return [
    ...capped(unmatched(source, result).map(p => `Missing text: “${clip(p)}”`), 8),
    ...capped([...urls(sourceHtml)].filter(u => !resultUrls.has(u)).map(u => `Missing link or image: ${u}`), 8),
    ...capped(imageSizeGaps(sourceHtml, doc), 6),
    ...capped(unmatched(result, known).map(p => `Text not in the source: “${clip(p)}”`), 6)
  ]
}

/**
 * The HTML a chat turn converts into blocks, if it is a conversion: HTML
 * pasted into the message, or the selected custom HTML block or component
 * (then the rest of the email is kept as it was, so its words aren't "new").
 */
export function conversionSource(doc: EmailDocument, text: string, selectedId?: string | null): { html: string, keep?: EmailDocument } | null {
  if (!CONVERT_REQUEST.test(text)) return null
  const pasted = sourceHtmlOf(text)
  if (pasted) return { html: pasted }
  const selected = selectedId ? findBlock(doc.blocks, selectedId) : null
  if (selected?.type === 'html') return { html: selected.html, keep: removeBlock(doc, selected.id).doc }
  if (selected?.type === 'component') return { html: fillComponent(selected.html, selected.fields, selected.values), keep: removeBlock(doc, selected.id).doc }
  return null
}
