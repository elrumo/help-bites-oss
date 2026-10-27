// Linear-time pieces for taking HTML apart with plain text tools (the converters that turn pasted or imported HTML into
// email blocks, policy sections, blog excerpts). A lazy `[\s\S]*?` up to a closing tag, or `[^>]*` up to `>`, rescans the
// rest of the text from every opener that has no closer, so a body of 50,000 `<h1>` openers costs the square of its
// length: seconds of a single-threaded server for one request. These never look back and never rescan.

/** An element found by `replaceElements`: its (lower-case) tag name, the attribute text of its opening tag, what is between the tags, and all of it as written. */
export type ScannedElement = { name: string, attrs: string, inner: string, whole: string }

/**
 * `html` with each element named in `names` that opens and closes replaced by `replace(element)`: the same as
 * `html.replace(/<(a|b)\b([^>]*)>([\s\S]*?)<\/\1>/gi, …)`, in linear time (a name is a whole name: `<b>` is not `<br>`). An opening tag ends at the next `>` and holds no
 * `<` (a stray `<` starts a new tag, as a browser reads it); the element ends at the first closing tag of its name after it.
 * An opener with no closer is left alone, as is everything inside a replaced element. `when` picks the elements to replace by
 * their name and attributes: the others are not touched, and the scan goes on inside them (so hidden elements nested in a
 * visible one are still found).
 */
export function replaceElements(html: string, names: readonly string[], replace: (element: ScannedElement) => string, when: (name: string, attrs: string) => boolean = () => true): string {
  const opener = new RegExp(`<(${names.join('|')})(?=[\\s/>])([^<>]*)>`, 'gi')
  const closers = new Map<string, RegExp>()
  // Once a name has no closer after some point, no opener after that point has one either.
  const noCloserFrom = new Map<string, number>()
  let out = ''
  let copied = 0
  for (const match of html.matchAll(opener)) {
    const start = match.index ?? 0
    if (start < copied) continue
    const name = (match[1] ?? '').toLowerCase()
    if (!when(name, match[2] ?? '')) continue
    const innerStart = start + match[0].length
    if (innerStart >= (noCloserFrom.get(name) ?? Infinity)) continue
    let closer = closers.get(name)
    if (!closer) { closer = new RegExp(`</${name}\\s*>`, 'gi'); closers.set(name, closer) }
    closer.lastIndex = innerStart
    const end = closer.exec(html)
    if (!end) { noCloserFrom.set(name, innerStart); continue }
    out += html.slice(copied, start) + replace({ name, attrs: match[2] ?? '', inner: html.slice(innerStart, end.index), whole: html.slice(start, end.index + end[0].length) })
    copied = end.index + end[0].length
  }
  return out + html.slice(copied)
}

/** `text` with each span from `open` to the next `close` (both literal, case-sensitive) replaced: `<!--` … `-->` for comments. An unclosed opener is left as it is. Linear. */
export function replaceBetween(text: string, open: string, close: string, replace: string | ((inner: string) => string) = ''): string {
  let out = ''
  let from = 0
  for (;;) {
    const start = text.indexOf(open, from)
    if (start < 0) break
    const end = text.indexOf(close, start + open.length)
    if (end < 0) break
    out += text.slice(from, start) + (typeof replace === 'string' ? replace : replace(text.slice(start + open.length, end)))
    from = end + close.length
  }
  return out + text.slice(from)
}

/** `text` without anything that looks like a tag: `<`, then no `<` or `>`, then `>`. Linear (`<[^>]+>` rescans to the end from every `<` of a text with no `>`). */
export function stripTags(text: string, replacement = ''): string {
  return text.replace(/<[^<>]+>/g, replacement)
}

/** The first element named `name` that closes, or (with `last`) the one that runs to the last closing tag of its name: its attributes and what is inside. Linear. */
export function findElement(html: string, name: string, options: { last?: boolean } = {}): { attrs: string, inner: string } | null {
  const open = new RegExp(`<${name}(?=[\\s/>])([^<>]*)>`, 'i').exec(html)
  if (!open) return null
  const innerStart = open.index + open[0].length
  const closer = new RegExp(`</${name}\\s*>`, 'gi')
  closer.lastIndex = innerStart
  let end = closer.exec(html)
  if (!end) return null
  if (options.last) for (let next = closer.exec(html); next; next = closer.exec(html)) end = next
  return { attrs: open[1] ?? '', inner: html.slice(innerStart, end.index) }
}
