import { describe, expect, test } from 'bun:test'
import { mergePrompt, readMergeSuggestions, type MergeEntryInfo } from '../shared/changelogMerge'

const e = (id: string, title: string, tag = 'improved'): MergeEntryInfo => ({ id, title, tag, summary: '', body: '', area: '' })
const entries = [e('a', 'Dates'), e('b', 'Dates fix', 'fix'), e('c', 'Crop'), e('d', 'Grain')]

describe('readMergeSuggestions', () => {
  test('reads a fenced reply, falling back to the first source\'s tag', () => {
    const reply = '```json\n' + JSON.stringify({ merges: [{ ids: ['a', 'b'], title: ' Dates\nwork ', body: 'Pick a date.', tag: 'nope', reason: 'Same screen' }] }) + '\n```'
    expect(readMergeSuggestions(reply, entries)).toEqual([{ refs: ['a', 'b'], title: 'Dates work', body: 'Pick a date.', tag: 'improved', reason: 'Same screen' }])
  })
  test('nothing to merge is an empty list', () => {
    expect(readMergeSuggestions('{"merges":[]}', entries)).toEqual([])
    expect(readMergeSuggestions('sorry', entries)).toEqual([])
  })
  test('drops made-up ids, single-entry groups, untitled groups and an entry used twice', () => {
    const reply = JSON.stringify({ merges: [
      { ids: ['a', 'zzz'], title: 'Made up' }, { ids: ['c'], title: 'Single' }, { ids: ['c', 'd'], title: '' },
      { ids: ['a', 'b'], title: 'First' }, { ids: ['b', 'c'], title: 'Reuses b' }, { ids: ['c', 'd'], title: 'Last' }
    ] })
    expect(readMergeSuggestions(reply, entries).map(m => m.title)).toEqual(['First', 'Last'])
  })
})

describe('mergePrompt', () => {
  test('one line per entry with its id, tag and text', () => {
    expect(mergePrompt([{ ...e('a', 'Grain\nlooks right', 'new'), area: 'Engine', summary: 'Like Lightroom.' }])).toBe('Entries:\n- id a [new] (Engine) Grain looks right: Like Lightroom.')
  })
})
