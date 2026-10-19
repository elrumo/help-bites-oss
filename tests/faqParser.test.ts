import { describe, expect, test } from 'bun:test'
import { parseFaqMarkdown, extractInlineFaqs } from '../shared/knowledge'

const SUPPORT_FAQ = `# Product Support & FAQ

## Getting Started

### What is WebBites?

WebBites is a bookmarking app.

### How do I create a bookmark?

Click the **+** button and paste a URL.

## Account & Sign-In

### How do I reset my password?

Open Settings and choose *Reset password*.

## Troubleshooting

### Why am I seeing "Unable to save bookmark"?

The job hit a timeout. Try again.
`

describe('parseFaqMarkdown — the SUPPORT_FAQ.md target format', () => {
  const result = parseFaqMarkdown(SUPPORT_FAQ)

  test('unwraps the single top-level heading as the document title', () => {
    expect(result.title).toBe('Product Support & FAQ')
  })

  test('top-level categories become depth-0 nodes', () => {
    const top = result.nodes.filter(n => n.depth === 0).map(n => n.name)
    expect(top).toEqual(['Getting Started', 'Account & Sign-In', 'Troubleshooting'])
    expect(result.nodes.find(n => n.name === 'Getting Started')!.pathCache).toBe('Getting Started')
  })

  test('every leaf heading with a body becomes an FAQ under its category', () => {
    expect(result.faqs.length).toBe(4)
    const first = result.faqs.find(f => f.question === 'What is WebBites?')!
    expect(first.answer).toBe('WebBites is a bookmarking app.')
    expect(first.path).toEqual(['Getting Started'])
    expect(first.pathCache).toBe('Getting Started')
    expect(first.sourceSection).toBe('Getting Started')
  })

  test('answers keep their markdown; exact error strings survive verbatim', () => {
    expect(result.faqs.find(f => f.question === 'How do I create a bookmark?')!.answer).toBe('Click the **+** button and paste a URL.')
    const err = result.faqs.find(f => f.question.includes('Unable to save bookmark'))!
    expect(err.path).toEqual(['Troubleshooting'])
    expect(err.answer).toContain('timeout')
  })
})

describe('parseFaqMarkdown — defensive behaviour', () => {
  test('non-"?" leaf headings are still treated as FAQs, arbitrary depth', () => {
    const md = '## Account\n### Sign In\n#### Password reset\nUse the reset link.\n'
    const r = parseFaqMarkdown(md)
    expect(r.faqs.length).toBe(1)
    expect(r.faqs[0]!.question).toBe('Password reset')
    expect(r.faqs[0]!.pathCache).toBe('Account/Sign In')
    expect(r.nodes.map(n => n.pathCache).sort()).toEqual(['Account', 'Account/Sign In'])
  })

  test('empty sections are reported, answerless questions are flagged invalid', () => {
    const md = '# Doc\n## Empty\n## Real\n### No answer here?\n### Has answer?\nYes.\n'
    const r = parseFaqMarkdown(md)
    expect(r.warnings.some(w => w.includes('Empty'))).toBe(true)
    expect(r.invalid).toEqual([{ section: 'Real > No answer here?', reason: 'Question has no answer.' }])
    expect(r.faqs.map(f => f.question)).toEqual(['Has answer?'])
  })

  test('headings inside fenced code blocks are not parsed as structure', () => {
    const md = ['# Doc', '## Cat', '### How to comment?', 'Use:', '```', '# this is a comment', '## not a heading', '```', 'Done.'].join('\n')
    const r = parseFaqMarkdown(md)
    expect(r.faqs.length).toBe(1)
    expect(r.faqs[0]!.answer).toContain('# this is a comment')
    expect(r.nodes.some(n => n.name.includes('comment'))).toBe(false)
  })

  test('category bodies with Q:/A: yield FAQs alongside child headings', () => {
    const md = '# Doc\n## Billing\nQ: How do I pay?\nA: Use a card.\n### Refunds?\nWe refund within 30 days.\n'
    const r = parseFaqMarkdown(md)
    const questions = r.faqs.map(f => f.question).sort()
    expect(questions).toEqual(['How do I pay?', 'Refunds?'])
    expect(r.faqs.find(f => f.question === 'How do I pay?')!.pathCache).toBe('Billing')
  })

  test('text before the first heading is ignored with a warning', () => {
    const r = parseFaqMarkdown('Some intro prose.\n\n# Doc\n## Cat\n### Q?\nA.\n')
    expect(r.warnings.some(w => w.toLowerCase().includes('before the first heading'))).toBe(true)
    expect(r.faqs.length).toBe(1)
  })

  test('empty input yields empty, not a throw', () => {
    const r = parseFaqMarkdown('')
    expect(r).toEqual({ title: '', nodes: [], faqs: [], warnings: [], invalid: [] })
  })
})

describe('extractInlineFaqs', () => {
  test('parses Q:/A: pairs', () => {
    const out = extractInlineFaqs('Q: How do I x?\nA: You do x.\nQ: How do I y?\nA: You do y.')
    expect(out).toEqual([
      { question: 'How do I x?', answer: 'You do x.' },
      { question: 'How do I y?', answer: 'You do y.' }
    ])
  })

  test('parses bold **question?** blocks and ignores non-question bold', () => {
    const out = extractInlineFaqs('**How do I z?**\nDo z like this.\n**Note**\nstill z.')
    expect(out.length).toBe(1)
    expect(out[0]!.question).toBe('How do I z?')
    expect(out[0]!.answer).toContain('Do z like this.')
  })

  test('plain prose yields nothing', () => {
    expect(extractInlineFaqs('Just a paragraph with no questions.')).toEqual([])
  })
})
