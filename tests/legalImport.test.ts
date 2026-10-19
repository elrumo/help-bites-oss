import { describe, expect, test } from 'bun:test'
import { htmlToMarkdown, parseImported } from '../shared/legal/import'

const MAX = 20_000

describe('parseImported', () => {
  test('a lone # is the title; ## headings are sections; text before them is an introduction', () => {
    const { title, sections } = parseImported('# Privacy Policy\n\nWe care.\n\n## Data\n\nWe collect email.\n\n### Why\n\nTo sign you in.\n\n## Contact\n\nmail us', { format: 'markdown', max: MAX })
    expect(title).toBe('Privacy Policy')
    expect(sections.map(s => s.heading)).toEqual(['Introduction', 'Data', 'Contact'])
    expect(sections[1]!.body).toContain('### Why')
  })

  test('several # headings are all sections and there is no title', () => {
    const { title, sections } = parseImported('# One\n\na\n\n# Two\n\nb', { max: MAX })
    expect(title).toBe('')
    expect(sections.map(s => s.heading)).toEqual(['One', 'Two'])
  })

  test('html is detected and converted, unsafe links keep only their text', () => {
    const html = '<h1>Terms</h1><p>Hi <a href="https://a.test">a</a> <a href="javascript:alert(1)">x</a> &amp; <b>bold</b></p><h2>Use</h2><ul><li>one</li><li>two</li></ul>'
    expect(htmlToMarkdown(html)).not.toContain('javascript')
    const { title, sections } = parseImported(html, { max: MAX })
    expect(title).toBe('Terms')
    expect(sections[0]!.body).toBe('Hi [a](https://a.test) x & **bold**')
    expect(sections[1]).toEqual({ heading: 'Use', body: '- one\n- two' })
  })

  test('plain text: numbered and ALL CAPS lines are headings, a punctuated numbered line is not', () => {
    const text = '1. Information we collect\n\nWe collect your email.\n\nSHARING\n\nWe share nothing.\n\n2. Contact us.\n\nWrite to us.'
    const { sections } = parseImported(text, { format: 'text', max: MAX })
    expect(sections.map(s => s.heading)).toEqual(['Information we collect', 'SHARING'])
    expect(sections[1]!.body).toContain('2. Contact us.')
  })

  test('a section longer than max is cut at paragraph breaks', () => {
    const para = 'x'.repeat(60)
    const { sections } = parseImported(`## Long\n\n${[para, para, para].join('\n\n')}`, { max: 130 })
    expect(sections.length).toBe(2)
    expect(sections.every(s => s.body.length <= 130)).toBe(true)
    expect(sections[1]!.heading).toBe('Long (continued)')
  })

  test('no headings still yields text; empty yields nothing', () => {
    expect(parseImported('Just a paragraph.', { max: MAX }).sections).toEqual([{ heading: 'Introduction', body: 'Just a paragraph.' }])
    expect(parseImported('   \n ', { max: MAX }).sections).toEqual([])
  })
})
