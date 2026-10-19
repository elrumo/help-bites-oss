import { describe, expect, test } from 'bun:test'
import { CHANGELOG_SLUG_MAX_LENGTH } from '../shared/changelog'
import { changelogCommentText, changelogSlugify, checkChangelogComment, deriveChangelogExcerpt, nextChangelogSlug, renderChangelogBody, renderChangelogComment } from '../server/utils/changelogRender'

describe('changelogSlugify', () => {
  test('degrades accents to their base letter and joins words with hyphens', () => {
    expect(changelogSlugify('Cómo exportar a CSV')).toBe('como-exportar-a-csv')
    expect(changelogSlugify('  New — editor material!  ')).toBe('new-editor-material')
  })

  test('caps the length and never ends on a hyphen', () => {
    const slug = changelogSlugify(`${'a'.repeat(30)} ${'b'.repeat(60)}`)
    expect(slug.length).toBeLessThanOrEqual(CHANGELOG_SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('a title with nothing to slugify (or no title at all) still gets a key', () => {
    expect(changelogSlugify('✨🎉').startsWith('entry-')).toBe(true)
    expect(changelogSlugify(undefined as unknown as string).startsWith('entry-')).toBe(true)
  })
})

describe('nextChangelogSlug', () => {
  test('returns the root slug when it is free', async () => {
    expect(await nextChangelogSlug('New editor material', async () => false)).toBe('new-editor-material')
  })

  test('suffixes until it finds a free slug', async () => {
    const taken = new Set(['release-notes', 'release-notes-2'])
    expect(await nextChangelogSlug('Release notes', async s => taken.has(s))).toBe('release-notes-3')
  })

  test('skips reserved slugs, as the project reserves them', async () => {
    expect(await nextChangelogSlug('Admin', async () => false, new Set(['admin']))).toBe('admin-2')
    expect(await nextChangelogSlug('Subscribe', async () => false, new Set(['subscribe', 'subscribe-2']))).toBe('subscribe-3')
  })

  test('stays within the length cap while suffixing', async () => {
    const taken = new Set([changelogSlugify('x'.repeat(80))])
    const slug = await nextChangelogSlug('x'.repeat(80), async s => taken.has(s))
    expect(slug.length).toBeLessThanOrEqual(CHANGELOG_SLUG_MAX_LENGTH)
    expect(slug.endsWith('-2')).toBe(true)
  })

  test('gives up on a timestamp rather than looping forever', async () => {
    expect((await nextChangelogSlug('always taken', async () => true, new Set(), 3)).startsWith('always-taken-')).toBe(true)
  })
})

describe('renderChangelogBody (markdown)', () => {
  test('renders Markdown', () => {
    expect(renderChangelogBody('Some **bold** text.')).toBe('<p>Some <strong>bold</strong> text.</p>')
  })

  test('strips script tags that slipped into a Markdown body', () => {
    const html = renderChangelogBody('Before\n\n<script>alert(1)</script>\n\nAfter')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  test('refuses to build a javascript: link', () => {
    const html = renderChangelogBody('[click me](javascript:alert(1))')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href')
    expect(html).toContain('click me')
  })

  test('marks external links but leaves internal ones alone', () => {
    const html = renderChangelogBody('[docs](https://example.com) and [editor](/editor)')
    expect(html).toContain('rel="nofollow noopener ugc"')
    expect(html).toContain('href="/editor"')
    const internal = html.slice(html.indexOf('href="/editor"'))
    expect(internal.slice(0, internal.indexOf('>'))).not.toContain('target')
  })
})

describe('renderChangelogBody (html)', () => {
  test('strips a javascript: href written as raw HTML', () => {
    const html = renderChangelogBody('<a href="javascript:alert(1)">click me</a>', 'html')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click me')
  })

  test('drops event handlers, style and id', () => {
    const html = renderChangelogBody('<img src="https://x.test/a.png" onerror="alert(1)" style="position:fixed" id="x">', 'html')
    for (const bad of ['onerror', 'style', 'id=']) expect(html).not.toContain(bad)
    expect(html).toContain('src="https://x.test/a.png"')
  })

  test('allows data:image but not other data URIs on images', () => {
    expect(renderChangelogBody('<img src="data:image/png;base64,AAAA" alt="a">', 'html')).toContain('data:image/png')
    expect(renderChangelogBody('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="a">', 'html')).not.toContain('data:text/html')
  })

  test('drops iframes, forms and objects', () => {
    const html = renderChangelogBody('<iframe src="https://x.test"></iframe><form action="/x"><input></form><object data="x"></object>ok', 'html')
    for (const tag of ['<iframe', '<form', '<input', '<object']) expect(html).not.toContain(tag)
    expect(html).toContain('ok')
  })
})

describe('deriveChangelogExcerpt', () => {
  test('strips markup and collapses whitespace', () => {
    expect(deriveChangelogExcerpt('## Title\n\nSome **bold** text.')).toBe('Title Some bold text.')
  })

  test('truncates on a word boundary with an ellipsis', () => {
    const excerpt = deriveChangelogExcerpt('word '.repeat(80), 'markdown', 40)
    expect(excerpt.length).toBeLessThanOrEqual(41)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).not.toContain('wor…')
  })

  test('leaves short bodies untouched and decodes entities', () => {
    expect(deriveChangelogExcerpt('Short one.')).toBe('Short one.')
    expect(deriveChangelogExcerpt('Rock &amp; roll')).toBe('Rock & roll')
  })
})

describe('renderChangelogComment', () => {
  test('escapes raw HTML instead of parsing it', () => {
    const html = renderChangelogComment('Hi <script>alert(1)</script> <b onclick="x()">there</b>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b ')
    expect(html).toContain('&lt;script&gt;')
  })

  test('no images, headings or tables: only what a plain composer makes', () => {
    const html = renderChangelogComment('# Loud\n\n![pixel](https://x.test/p.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**bold** and `code`')
    for (const tag of ['<img', '<h1', '<table']) expect(html).not.toContain(tag)
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })

  test('links open elsewhere and are marked as reader-contributed', () => {
    const html = renderChangelogComment('[docs](https://example.com) and [here](/changelog/x)')
    expect(html).toContain('rel="nofollow noopener ugc"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('href="/changelog/x"')
  })

  test('refuses a javascript: link', () => {
    const html = renderChangelogComment('[click](javascript:alert(1))')
    expect(html).not.toContain('<a ')
  })
})

describe('checkChangelogComment', () => {
  test('a usable comment comes back rendered, with its plain text', () => {
    const out = checkChangelogComment('Great **work**')
    expect(out).toEqual({ bodyHtml: '<p>Great <strong>work</strong></p>', text: 'Great work', error: null })
  })

  test('too short, too long and too many links are refused with a message for the writer', () => {
    expect(checkChangelogComment('').error).toBe('Write something first')
    expect(checkChangelogComment('*').error).toBe('Write something first')
    expect(checkChangelogComment('x'.repeat(4001)).error).toContain('4000 characters')
    const links = Array.from({ length: 7 }, (_, i) => `[l${i}](https://x.test/${i})`).join(' ')
    expect(checkChangelogComment(links).error).toBe('Comments can hold at most 6 links')
    expect(checkChangelogComment(links.split(' ').slice(0, 6).join(' ')).error).toBeNull()
  })

  test('the plain text is what the duplicate guard compares', () => {
    expect(changelogCommentText('Same **text**')).toBe(changelogCommentText('Same text'))
    expect(changelogCommentText('Rock &amp; roll')).toBe('Rock & roll')
  })
})
