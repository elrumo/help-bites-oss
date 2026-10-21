import { walkBlocks, type EmailDocument } from './blocks'
import { componentValue } from './render'

// What of an email is words, and how a translation of those words goes back in.
// A translation is a flat map `key → text` kept next to the design, so editing the
// design never forks it: a block's words are found by the block's id, and anything a
// translation lacks (a block added later) shows in the email's own language.
//
// Keys: `subject`, `preheader`, `text` (the plain-text part), and `<blockId>#<field>`:
// a heading's `text`, a text block's `html`, a button's `label`, an image's `alt`, and a
// component's `values.<fieldKey>` for its text and richtext fields. Custom HTML blocks,
// URLs and colours are never translated.

export type EmailStrings = Record<string, string>

const SETTINGS_KEYS = { subject: 'title', preheader: 'preheader', text: 'text' } as const

/** Every translatable string of a document, by key. Empty ones are left out. */
export function emailTexts(doc: EmailDocument): EmailStrings {
  const out: EmailStrings = {}
  const add = (key: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) out[key] = value
  }
  for (const [key, field] of Object.entries(SETTINGS_KEYS)) add(key, doc.settings[field])
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'heading') add(`${b.id}#text`, b.text)
    else if (b.type === 'text') add(`${b.id}#html`, b.html)
    else if (b.type === 'button') add(`${b.id}#label`, b.label)
    else if (b.type === 'image') add(`${b.id}#alt`, b.alt)
    else if (b.type === 'component') {
      for (const field of b.fields) if (field.type === 'text' || field.type === 'richtext') add(`${b.id}#values.${field.key}`, componentValue(field, b.values))
    }
  })
  return out
}

/** The document with `strings` in place of the matching words. Pure: the input is not changed. */
export function localizeEmail(doc: EmailDocument, strings: EmailStrings): EmailDocument {
  const next: EmailDocument = JSON.parse(JSON.stringify(doc))
  const settings = next.settings as unknown as Record<string, unknown>
  for (const [key, field] of Object.entries(SETTINGS_KEYS)) if (strings[key]) settings[field] = strings[key]
  walkBlocks(next.blocks, (b) => {
    const at = (field: string) => strings[`${b.id}#${field}`]
    if (b.type === 'heading' && at('text')) b.text = at('text')!
    else if (b.type === 'text' && at('html')) b.html = at('html')!
    else if (b.type === 'button' && at('label')) b.label = at('label')!
    else if (b.type === 'image' && at('alt')) b.alt = at('alt')!
    else if (b.type === 'component') {
      for (const field of b.fields) {
        const value = at(`values.${field.key}`)
        if (value) b.values = { ...b.values, [field.key]: value }
      }
    }
  })
  return next
}
