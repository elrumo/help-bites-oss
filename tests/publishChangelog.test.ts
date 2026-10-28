import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChangelog, tagOf } from '../scripts/publish-changelog.mjs'

const sample = `# Changelog

Intro that belongs to no release.

## Unreleased

## 0.2.0 — 2026-10-28

A lead paragraph.

- **Bold title** (web): what it does,
  on two lines.
- Name: plain bullet with a colon
- A plain sentence. And more words after it.
- **Breaking for keys.** The old call is gone.
- **Fixes the thing** by guarding it.

## 0.1.0

- **Old one** body
`

describe('parseChangelog', () => {
  const sections = parseChangelog(sample)

  test('sections, dates and the lead paragraph', () => {
    expect(sections.map(s => [s.version, s.date, s.entries.length])).toEqual([['Unreleased', '', 0], ['0.2.0', '2026-10-28', 5], ['0.1.0', '', 1]])
    expect(sections[1]!.summary).toBe('A lead paragraph.')
  })

  test('a bullet is an entry: bold lead, "name: text" or first sentence, continuation lines joined', () => {
    const [bold, colon, sentence] = sections[1]!.entries
    expect(bold).toMatchObject({ title: 'Bold title', body: '(web): what it does, on two lines.' })
    expect(colon).toMatchObject({ title: 'Name', body: 'plain bullet with a colon' })
    expect(sentence!.title).toBe('A plain sentence')
  })

  test('tags: breaking, fix and removed are called out', () => {
    expect(sections[1]!.entries.map(e => e.tag)).toEqual(['new', 'new', 'new', 'breaking', 'fix'])
    expect(tagOf('Removes the old widget')).toBe('removed')
  })
})

describe('the real CHANGELOG.md', () => {
  const { version } = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8'))
  const section = parseChangelog(readFileSync(join(import.meta.dir, '../CHANGELOG.md'), 'utf8')).find(s => s.version === version)

  test('has a section for the current version that the publisher can post', () => {
    expect(section?.entries.length).toBeGreaterThan(0)
    for (const e of section!.entries) {
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.title.length).toBeLessThanOrEqual(200)
      expect(e.body.length).toBeLessThanOrEqual(20000)
    }
  })
})
