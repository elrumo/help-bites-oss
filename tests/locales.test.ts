import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectSections } from '../app/utils/projectSections'

// The sidebar and the palette name every project section in the panel's language;
// a missing one shows its raw key (sections.pages) to everyone reading that language.

const locales = ['en', 'es', 'ca', 'ja', 'ko', 'zh']
const words = (locale: string) => JSON.parse(readFileSync(join(import.meta.dir, '..', `i18n/locales/${locale}.json`), 'utf8'))

describe('panel languages', () => {
  test('every project section has a name in every language', () => {
    const missing = locales.flatMap(locale => projectSections.filter(section => typeof words(locale).sections?.[section.path] !== 'string').map(section => `${locale}: sections.${section.path}`))
    expect(missing).toEqual([])
  })
})
