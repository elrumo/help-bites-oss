import { describe, expect, test } from 'bun:test'
import { RELEASE_SUMMARY_MAX, RELEASE_TITLE_MAX, readReleaseCopy, releasePrompt } from '../shared/changelogRelease'

describe('readReleaseCopy', () => {
  test('reads a fenced reply and trims to the field limits', () => {
    const reply = '```json\n' + JSON.stringify({ title: `  Sidebar\n dates ${'x'.repeat(300)}`, summary: ` By Date opens. ${'y'.repeat(3000)}` }) + '\n```'
    const copy = readReleaseCopy(reply)!
    expect(copy.title.startsWith('Sidebar dates')).toBe(true)
    expect(copy.title.length).toBe(RELEASE_TITLE_MAX)
    expect(copy.summary.length).toBe(RELEASE_SUMMARY_MAX)
  })
  test('one field is enough; nothing usable is null', () => {
    expect(readReleaseCopy('{"title":"Only a title"}')).toEqual({ title: 'Only a title', summary: '' })
    expect(readReleaseCopy('{"title":3,"summary":""}')).toBeNull()
    expect(readReleaseCopy('sorry')).toBeNull()
  })
})

describe('releasePrompt', () => {
  test('lists each entry with its tag, area and summary on one line', () => {
    const out = releasePrompt('0.7.1', [{ title: 'Grain\nlooks right', tag: 'improved', summary: 'Like Lightroom.', area: 'Engine' }, { title: 'Crash', tag: 'fix', summary: '', area: '' }])
    expect(out).toBe('Release 0.7.1. Entries:\n- [improved] (Engine) Grain looks right: Like Lightroom.\n- [fix] Crash')
  })
})
