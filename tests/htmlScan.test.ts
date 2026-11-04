import { describe, expect, test } from 'bun:test'
import { findElement, replaceBetween, replaceElements, stripTags } from '../shared/htmlScan'
import { deriveBlogExcerpt } from '../server/utils/blogRender'
import { htmlToMarkdown, parseImported } from '../shared/legal/import'
import { htmlToEmailDocument } from '../shared/email/import'
import { emptyDocument } from '../shared/email/blocks'
import { conversionGaps } from '../shared/email/convert'
import { htmlToText } from '../shared/email/resolve'
import { feedbackPlainText, parseFeedbackRefs } from '../shared/feedback'

describe('linear HTML scanning', () => {
  test('replaceElements does what the lazy regex did, where that was right', () => {
    const html = '<p>a</p><H1 class="x">Title</H1><b>one</b> <b>two <i>x</i></b>'
    const regex = (s: string) => s.replace(/<(h1|b)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, name: string, _attrs: string, inner: string) => `[${name.toLowerCase()}:${inner}]`)
    expect(replaceElements(html, ['h1', 'b'], ({ name, inner }) => `[${name}:${inner}]`)).toBe(regex(html))
  })

  test('a name is a whole name, an element is the first one to close, an opener with no closer stays', () => {
    expect(replaceElements('<br>x<b>y</b>', ['b'], ({ inner }) => `*${inner}*`)).toBe('<br>x*y*')
    expect(replaceElements('<b><b>x</b></b>', ['b'], ({ inner }) => `[${inner}]`)).toBe('[<b>x]</b>')
    expect(replaceElements('<b>x <b>y</b>', ['b'], ({ inner }) => `[${inner}]`)).toBe('[x <b>y]')
    expect(replaceElements('<a href="x">no end <b>y</b>', ['a'], () => 'GONE')).toBe('<a href="x">no end <b>y</b>')
    expect(replaceElements('<A HREF="x">y</a>', ['a'], ({ whole }) => `(${whole})`)).toBe('(<A HREF="x">y</a>)')
  })

  test('`when` leaves other elements alone and the scan goes on inside them', () => {
    const html = '<div><span style="display:none">x</span>y</div>'
    expect(replaceElements(html, ['div', 'span'], () => '', (_name, attrs) => /display:none/.test(attrs))).toBe('<div>y</div>')
  })

  test('replaceBetween, stripTags and findElement', () => {
    expect(replaceBetween('a<!-- x -->b<!-- y', '<!--', '-->', ' ')).toBe('a b<!-- y')
    expect(stripTags('a <b>b</b> <<i>c</i> < d')).toBe('a b <c < d')
    expect(findElement('<html><body class="m">hi<b></b></body> tail </body>', 'body', { last: true })).toEqual({ attrs: ' class="m"', inner: 'hi<b></b></body> tail ' })
    expect(findElement('<head><title>t</title></head>', 'head')?.inner).toBe('<title>t</title>')
    expect(findElement('<body>no end', 'body')).toBeNull()
  })
})

// Each of these cost the square (or the cube) of the input before: a request of 200 KB froze the server for seconds to minutes.
describe('hostile markup is read in linear time', () => {
  const N = 50_000
  const within = (ms: number, work: () => unknown) => {
    const start = performance.now()
    work()
    expect(performance.now() - start).toBeLessThan(ms)
  }

  test('blog excerpt', () => {
    // Unclosed `<h1>` / `<figcaption>` reach sanitize-html as 50,000 open elements: linear, but 0.3 to 1.5 s (more on a busy machine).
    // A quadratic scan would take minutes, so the bound is loose on purpose.
    for (const opener of ['<h1>', '<h1 ', '<figcaption>', '<figcaption']) within(6000, () => deriveBlogExcerpt(opener.repeat(N), 200, 'html'))
  })

  test('legal import', () => {
    for (const opener of ['<svg', '<h1>', '<h2 ', '<a href="x"', '<a ', '<b>', '<i>', '<li', '<!--', '<style', '<head']) {
      within(1500, () => htmlToMarkdown(opener.repeat(N)))
    }
    within(1500, () => parseImported(`# a${' '.repeat(100_000)}b`, { format: 'markdown', max: 1e9 }))
  })

  test('email import and conversion', () => {
    for (const opener of ['<body', '<body>', '<span', '<div', '<!doctype', '<head', '<style', '<title', '<img', '<!--', '<td']) {
      within(1500, () => htmlToEmailDocument(opener.repeat(N)))
      within(1500, () => conversionGaps(opener.repeat(N), emptyDocument()))
    }
  })

  test('plain text of an email', () => {
    for (const opener of ['<span', '<div', '<a ', '<a href="x"', '<a href="x">', '<!--', '<style', '<title', '<head', '<br']) within(1500, () => htmlToText(opener.repeat(N)))
  })

  test('feedback text', () => {
    for (const body of ['`'.repeat(200_000), '```'.repeat(60_000), '<a href="x"'.repeat(20_000), '<'.repeat(200_000)]) {
      within(1500, () => parseFeedbackRefs(body))
      within(1500, () => feedbackPlainText(body))
    }
  })
})
