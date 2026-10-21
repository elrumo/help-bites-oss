/**
 * Strips what could run from a parsed document before an editor preview frames
 * it next to its runtime (a script there could drive the editor): scripts,
 * frames, embeds, `on…` attributes and `javascript:` URLs. `keep` spares the
 * elements a selector names (the editor's own scripts).
 */
export function defangHtml(doc: Document, options: { keep?: string, frames?: boolean } = {}): Document {
  // DOMParser parses <noscript> with scripting off, the frame with it on; and
  // the frame would bring a <template shadowrootmode> to life unchecked.
  const tags = ['script', 'noscript', 'template', 'object', 'embed', 'base', 'meta[http-equiv="refresh" i]', ...(options.frames ? [] : ['iframe', 'frame'])]
  doc.querySelectorAll(tags.join(', ')).forEach((el) => {
    if (!options.keep || !el.matches(options.keep)) el.remove()
  })
  doc.querySelectorAll('*').forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      // URL parsing drops tabs, newlines and leading controls: `java&#9;script:` runs too.
      if (/^on/i.test(name) || /^javascript:/i.test(value.replace(/[\u0000- ]/g, ''))) el.removeAttribute(name)
    }
  })
  return doc
}
