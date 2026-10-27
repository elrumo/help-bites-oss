// Hosted pages and the delivery API serve a component's HTML as written, so a component never carries anything that runs.
// The old check was one regex over the text, which a browser reads differently: `<svg/onload=…>` (a slash for a space),
// `<img src="x"onerror=…>` (no space after the quote), `href="java&#115;cript:…"` and a tab inside the scheme all ran. This reads
// each tag the way the HTML tokenizer does (names, quoted and unquoted values, `/` and quotes as separators) and judges
// attribute values after the character references are decoded and the characters browsers ignore are removed. One pass.

/** Plain text that is refused wherever it appears, as before: it is never needed in a component. */
const ANYWHERE = /<script|<object|<embed|<base\b|<link\b|\son[a-z]+\s*=|javascript:|vbscript:|data:text\/html|srcdoc\s*=/i
const NEVER = /^(?:java|vb)script:|^data:(?:text\/html|application\/xhtml)/i
const REFERENCE = /&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|(colon|tab|newline|lpar|rpar));?/gi
const NAMED: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')' }
const FORBIDDEN_TAGS = new Set(['script', 'object', 'embed', 'base', 'link'])

/** What the browser makes of an attribute value before it looks at a scheme: references decoded, controls and spaces dropped. */
function normalised(value: string): string {
  return value
    .replace(REFERENCE, (whole, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (named) return NAMED[named.toLowerCase()] ?? whole
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? '', 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    .replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]+/g, '')
}

type Tag = { name: string, attributes: Array<[string, string]> }

/** The tags of `html` with their attributes, as the tokenizer reads them: a tag ends at the first `>` outside quotes. */
function* tagsOf(html: string): Generator<Tag> {
  let i = 0
  while (i < html.length) {
    const open = html.indexOf('<', i)
    if (open < 0) return
    const first = html.charCodeAt(open + 1)
    const letter = (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
    if (!letter) { i = open + 1; continue }
    let p = open + 1
    while (p < html.length && !/[\s/>]/.test(html[p] ?? '')) p++
    const tag: Tag = { name: html.slice(open + 1, p).toLowerCase(), attributes: [] }
    for (;;) {
      while (p < html.length && /[\s/]/.test(html[p] ?? '')) p++
      if (p >= html.length || html[p] === '>') break
      const nameStart = p
      // The first character is part of the name even if it is `=`, as in the specification.
      p++
      while (p < html.length && !/[\s/>=]/.test(html[p] ?? '')) p++
      const name = html.slice(nameStart, p).toLowerCase()
      while (p < html.length && /\s/.test(html[p] ?? '')) p++
      let value = ''
      if (html[p] === '=') {
        p++
        while (p < html.length && /\s/.test(html[p] ?? '')) p++
        const quote = html[p]
        if (quote === '"' || quote === '\'') {
          const end = html.indexOf(quote, p + 1)
          value = html.slice(p + 1, end < 0 ? html.length : end)
          p = end < 0 ? html.length : end + 1
        } else {
          const start = p
          while (p < html.length && !/[\s>]/.test(html[p] ?? '')) p++
          value = html.slice(start, p)
        }
      }
      tag.attributes.push([name, value])
    }
    yield tag
    i = p + 1
  }
}

/** Whether a component's HTML has anything that runs or navigates somewhere dangerous: script, handlers, `javascript:` addresses, frames that bring their own document. */
export function unsafeHtml(html: string): boolean {
  if (ANYWHERE.test(html)) return true
  for (const tag of tagsOf(html)) {
    if (FORBIDDEN_TAGS.has(tag.name)) return true
    for (const [name, value] of tag.attributes) {
      if (name.startsWith('on') || name === 'srcdoc') return true
      if (tag.name === 'meta' && name === 'http-equiv') return true
      if (NEVER.test(normalised(value))) return true
    }
  }
  return false
}
