import { describe, expect, test } from 'bun:test'
import { importKeyFor, outdatedImportKeys, type PriorImportedFaq } from '../shared/knowledge'

// Reprocessing must be deterministic: the same source content maps to the same
// importKeys (so FAQs update in place, never duplicate), and only FAQs that
// truly vanished from the source — and were not admin-edited — become outdated.

describe('deterministic re-import matching', () => {
  test('same lineage + path + question ⇒ same importKey (update, not duplicate)', () => {
    const first = importKeyFor('doc-1', 'Account/Deletion', 'How do I delete my account?')
    const rerun = importKeyFor('doc-1', 'Account/Deletion', 'How do I delete my account?')
    expect(rerun).toBe(first)
  })

  test('an edited question yields a new key (old one can go outdated)', () => {
    const before = importKeyFor('doc-1', 'Account', 'How do I reset my password?')
    const after = importKeyFor('doc-1', 'Account', 'How do I change my password?')
    expect(after).not.toBe(before)
  })
})

describe('outdatedImportKeys', () => {
  const key = (q: string) => importKeyFor('doc-1', 'Account', q)
  const prior: PriorImportedFaq[] = [
    { importKey: key('keep me?'), detached: false, status: 'active' },
    { importKey: key('gone from source?'), detached: false, status: 'active' },
    { importKey: key('edited by admin?'), detached: true, status: 'active' },
    { importKey: key('already archived?'), detached: false, status: 'archived' }
  ]

  test('marks only FAQs absent from the new source, keeping detached/archived ones', () => {
    const incoming = [key('keep me?'), key('a brand new one?')]
    const outdated = outdatedImportKeys(prior, incoming)
    expect(outdated).toEqual([key('gone from source?')])
  })

  test('a full re-import of identical content marks nothing outdated (idempotent)', () => {
    const incoming = prior.map(p => p.importKey)
    expect(outdatedImportKeys(prior, incoming)).toEqual([])
  })

  test('an admin-detached FAQ is never auto-outdated even when gone from source', () => {
    expect(outdatedImportKeys(prior, [])).not.toContain(key('edited by admin?'))
  })
})
