// An existing legal document (pasted or uploaded) → the sections HelpBites
// stores. Pure: no Parse, so it unit-tests without a database. Markdown, HTML
// and plain text go in; headings split it into sections.

export const LEGAL_IMPORT_FORMATS = ['markdown', 'html', 'text'] as const
export type LegalImportFormat = (typeof LEGAL_IMPORT_FORMATS)[number]

export type ImportedSection = { heading: string, body: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]!.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** HTML → Markdown for the tags a policy uses (headings, paragraphs, lists, links, emphasis). Everything else is dropped to its text. */
export function htmlToMarkdown(html: string): string {
  const md = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${plain(inner)}\n\n`)
    // Only links that are safe to keep; anything else (javascript:, data:) becomes its text.
    .replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const url = decode(href).trim()
      return /^(https?:\/\/|mailto:|\/|#)/i.test(url) ? `[${plain(inner)}](${url.replace(/\)/g, '%29')})` : plain(inner)
    })
    .replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '**$3**')
    .replace(/<(em|i)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '*$3*')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|section|article|table|tr|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return decode(md).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const looksLikeHtml = (text: string) => /<(h[1-6]|p|div|ul|ol|li|br|section|article)[\s>/]/i.test(text)

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const NUMBERED = /^\d+(\.\d+)*[.)]?\s+\S.{0,100}$/
const ALL_CAPS = /^[A-Z][A-Z0-9 &,'’/-]{3,80}$/

/** Plain text has no markers: a short unpunctuated line after a blank line that is numbered ("2. Sharing") or ALL CAPS is a heading. */
function plainHeading(line: string, prevBlank: boolean): boolean {
  const text = line.trim()
  return prevBlank && text.length <= 100 && !/[.,;:!?]$/.test(text) && (NUMBERED.test(text) || ALL_CAPS.test(text))
}

type Block = { level: number, heading: string, lines: string[] }

/** Cuts a body longer than `max` at paragraph breaks so every section fits. */
function chunk(section: ImportedSection, max: number): ImportedSection[] {
  if (section.body.length <= max) return [section]
  const parts: string[] = []
  let current = ''
  for (const paragraph of section.body.split(/\n{2,}/)) {
    for (let rest = paragraph; rest; rest = rest.slice(max)) {
      const piece = rest.slice(0, max)
      if (current && current.length + piece.length + 2 > max) { parts.push(current); current = '' }
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) parts.push(current)
  return parts.map((body, i) => ({ heading: i === 0 ? section.heading : `${section.heading} (continued)`, body }))
}

/**
 * Splits text into a title and sections. A lone top-level `#` heading is the
 * title; sections break at the highest remaining heading level (deeper headings
 * stay inside their section); text before the first one is an "Introduction".
 * `max` is the longest section body allowed.
 */
export function parseImported(input: string, opts: { format?: LegalImportFormat, max: number }): { title: string, sections: ImportedSection[] } {
  const format = opts.format ?? (looksLikeHtml(input) ? 'html' : 'markdown')
  const lines = (format === 'html' ? htmlToMarkdown(input) : input).replace(/\r\n?/g, '\n').split('\n')
  const hasMarkdownHeadings = format !== 'text' && lines.some(l => MD_HEADING.test(l))

  const blocks: Block[] = [{ level: 0, heading: '', lines: [] }]
  lines.forEach((line, i) => {
    const md = hasMarkdownHeadings ? MD_HEADING.exec(line) : null
    if (md) blocks.push({ level: md[1]!.length, heading: md[2]!.trim(), lines: [] })
    else if (!hasMarkdownHeadings && plainHeading(line, i === 0 || !lines[i - 1]!.trim())) blocks.push({ level: 2, heading: line.trim().replace(/^\d+(\.\d+)*[.)]?\s+/, ''), lines: [] })
    else blocks[blocks.length - 1]!.lines.push(line)
  })

  let title = ''
  const headings = blocks.filter(b => b.level > 0)
  if (headings.length && headings[0]!.level === 1 && headings.filter(b => b.level === 1).length === 1) {
    title = headings[0]!.heading
    headings[0]!.level = 0
  }
  const split = Math.min(...blocks.filter(b => b.level > 0).map(b => b.level), 6)

  const sections: ImportedSection[] = []
  const intro: string[] = []
  let current: ImportedSection | null = null
  for (const block of blocks) {
    const text = block.lines.join('\n').trim()
    if (block.level === 0) {
      if (current) current.body += `\n\n${text}`
      else intro.push(text)
    } else if (block.level === split) {
      if (current) sections.push(current)
      current = { heading: block.heading.slice(0, 200), body: text }
    } else if (current) {
      current.body += `\n\n${'#'.repeat(block.level)} ${block.heading}\n\n${text}`
    } else {
      intro.push(`${'#'.repeat(block.level)} ${block.heading}\n\n${text}`)
    }
  }
  if (current) sections.push(current)
  const introText = intro.join('\n\n').trim()
  if (introText) sections.unshift({ heading: 'Introduction', body: introText })

  return { title: title.slice(0, 200), sections: sections.map(s => ({ heading: s.heading, body: s.body.trim() })).filter(s => s.body).flatMap(s => chunk(s, opts.max)) }
}
