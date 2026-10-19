import { describe, expect, test } from 'bun:test'
import { normalizeQuestion, importKeyFor, detectDuplicates, buildIndexText, slugifyKnowledge, stripMarkdown } from '../shared/knowledge'

describe('normalizeQuestion', () => {
  test('collapses case, punctuation and whitespace to a comparable form', () => {
    expect(normalizeQuestion('How do I delete my account?')).toBe('how do i delete my account')
    expect(normalizeQuestion('  HOW   do I delete my account??? ')).toBe('how do i delete my account')
    expect(normalizeQuestion('**How** do I delete my account?')).toBe('how do i delete my account')
  })

  test('different intents stay different', () => {
    expect(normalizeQuestion('How do I delete my account?')).not.toBe(normalizeQuestion('Can I remove my account?'))
  })
})

describe('importKeyFor', () => {
  test('is stable for the same lineage, path and question', () => {
    const a = importKeyFor('lin1', 'Account/Deletion', 'How do I delete my account?')
    const b = importKeyFor('lin1', 'Account/Deletion', 'how do i DELETE my account')
    expect(a).toBe(b)
  })

  test('changes when the lineage, path or question changes', () => {
    const base = importKeyFor('lin1', 'Account/Deletion', 'How do I delete my account?')
    expect(importKeyFor('lin2', 'Account/Deletion', 'How do I delete my account?')).not.toBe(base)
    expect(importKeyFor('lin1', 'Account/Other', 'How do I delete my account?')).not.toBe(base)
    expect(importKeyFor('lin1', 'Account/Deletion', 'How do I close my account?')).not.toBe(base)
  })
})

describe('detectDuplicates', () => {
  test('groups FAQs that normalize to the same question', () => {
    const dups = detectDuplicates([
      { question: 'How do I delete my account?' },
      { question: 'Can I remove my account?' },
      { question: 'how do i DELETE my account' }
    ])
    expect(dups.length).toBe(1)
    expect(dups[0]!.indexes).toEqual([0, 2])
  })

  test('no collisions ⇒ empty', () => {
    expect(detectDuplicates([{ question: 'a?' }, { question: 'b?' }])).toEqual([])
  })
})

describe('buildIndexText', () => {
  test('produces a labelled, markdown-stripped representation', () => {
    const text = buildIndexText({
      product: 'WebBites',
      pathCache: 'Account/Account deletion',
      question: 'How do I delete my account?',
      aliases: ['How can I remove my account?', 'Delete profile'],
      answer: 'Open **Settings** and choose `Delete account`.',
      tags: ['account', 'gdpr']
    })
    expect(text).toContain('Product: WebBites')
    expect(text).toContain('Path: Account > Account deletion')
    expect(text).toContain('Question: How do I delete my account?')
    expect(text).toContain('Aliases: How can I remove my account?; Delete profile')
    expect(text).toContain('Tags: account, gdpr')
    expect(text).toContain('Answer: Open Settings and choose Delete account.')
  })
})

describe('small helpers', () => {
  test('slugifyKnowledge', () => {
    expect(slugifyKnowledge('WebBites Support!')).toBe('webbites-support')
    expect(slugifyKnowledge('  Über Café  ')).toBe('uber-cafe')
  })
  test('stripMarkdown flattens fences, lists and emphasis', () => {
    expect(stripMarkdown('# H\n- one\n- two\n\n**bold** and `code`')).toBe('H one two bold and code')
  })
})
