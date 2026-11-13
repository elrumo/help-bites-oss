import { describe, expect, test } from 'bun:test'
import { JEV_NEIGHBOURS, jevPairRequest, mergeCandidatePairs, mergeFallback, mergeGroups, mergePrompt, readMergeSuggestions, type MergeEntryInfo } from '../shared/changelogMerge'

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

describe('Jev merge pipeline', () => {
  test('a short list is compared in full, once per pair', () => {
    expect(mergeCandidatePairs([e('a', 'Dates'), e('b', 'Crop'), e('c', 'Grain')])).toEqual([[0, 1], [0, 2], [1, 2]])
  })
  test('a long list compares each entry with its most alike by wording only', () => {
    const many = [...Array.from({ length: 40 }, (_, i) => e(`n${i}`, `Unrelated topic${i} thing${i}`)), e('x', 'Histogram clipping warning colours'), e('y', 'Histogram clipping warning fix', 'fix')]
    const pairs = mergeCandidatePairs(many)
    expect(pairs).toContainEqual([40, 41])
    expect(pairs.length).toBeLessThan(many.length * JEV_NEIGHBOURS)
    expect(new Set(pairs.map(p => p.join())).size).toBe(pairs.length)
  })
  test('one request per entry: its later partners as questions over a shared state', () => {
    const req = jevPairRequest(entries, 0, [1, 3])
    expect(Object.keys(req.questions)).toEqual(['p1', 'p3'])
    expect(req.state.others.map(o => o.title)).toEqual(['Dates fix', 'Grain'])
    expect(req.questions.p3.instructions).toContain('`others[1]`')
  })
  test('groups join by average, so a chain of yeses cannot glue different changes together', () => {
    // 0-1 and 1-2 are sure, but 0-2 was judged no: 2 does not join {0,1} (average 0.52 < 0.85).
    expect(mergeGroups(3, [{ a: 0, b: 1, p: 0.95 }, { a: 1, b: 2, p: 0.9 }, { a: 0, b: 2, p: 0.1 }])).toEqual([[0, 1]])
    // a pair never judged does not count against the group
    expect(mergeGroups(3, [{ a: 0, b: 1, p: 0.95 }, { a: 1, b: 2, p: 0.9 }])).toEqual([[0, 1, 2]])
    expect(mergeGroups(3, [])).toEqual([])
  })
  test('groups never exceed the cap and a pair below the threshold is not joined', () => {
    const all = Array.from({ length: 5 }, (_, a) => Array.from({ length: 5 - a - 1 }, (_, k) => ({ a, b: a + k + 1, p: 0.95 }))).flat()
    expect(mergeGroups(5, all, 0.85, 3).map(g => g.length).sort()).toEqual([2, 3])
    expect(mergeGroups(2, [{ a: 0, b: 1, p: 0.84 }])).toEqual([])
  })
  test('a group the model could not write keeps the first title and every source text', () => {
    const f = mergeFallback([{ ...e('a', 'Dates', 'new'), summary: 'Pick one.' }, { ...e('b', 'Dates fix', 'fix'), body: 'Fixed.' }])
    expect(f).toMatchObject({ refs: ['a', 'b'], title: 'Dates', body: 'Pick one.\n\nFixed.', tag: 'new' })
  })
})
