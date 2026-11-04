import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_COPY_SECTIONS, errorDetailOf, errorDetailText } from '../shared/errors'

// The native error card hand-ports the Copy menu: the parts it offers and the text it writes (ErrorsModels.swift `ErrorDetail.text`).

const root = join(import.meta.dir, '..')
const models = readFileSync(join(root, 'helpbites-native/App/Features/Errors/ErrorsModels.swift'), 'utf8')
const card = readFileSync(join(root, 'helpbites-native/App/Features/Errors/ErrorIssueCard.swift'), 'utf8')

describe('native error copy parity', () => {
  test('offers the same parts in the same order', () => {
    expect(models).toContain(`case ${ERROR_COPY_SECTIONS.join(', ')}`)
  })

  test('writes the same headings and labels', () => {
    const detail = errorDetailOf({ friendly_id: 'HB-1' }, { event_id: 'e', timestamp: 't', exception: { values: [{ type: 'E', value: 'v', stacktrace: { frames: [{ filename: 'a.ts', function: 'f', in_app: false }] } }] }, tags: [['k', 'v']], breadcrumbs: [{ message: 'm', level: 'info' }], environment: 'prod' })
    const text = errorDetailText(detail, ERROR_COPY_SECTIONS, { title: 'T', culprit: 'c', url: 'u', provider: 'p', analysis: 'a' })
    const written = [...text.matchAll(/^## (.+)$/gm)].map(m => m[1]!).concat([...text.matchAll(/^([A-Z][A-Za-z ]+): /gm)].map(m => m[1]!)).filter(label => label !== 'Environment')
    expect(written).toContain('Stack trace')
    expect(written).toContain('Latest event')
    for (const label of written) expect(models).toContain(`"${label}"`)
    // The frame markers, the empty-part text and the title line.
    for (const piece of [' (library)', '">   \\(', '"    \\(', '"(none)"', '"# \\(title)"']) expect(models).toContain(piece)
  })

  test('the card offers copy all and copy selected', () => {
    expect(card).toContain('Label("Copy all"')
    expect(card).toContain('Label("Copy selected"')
    expect(card).toContain('detail.text(parts')
  })
})
