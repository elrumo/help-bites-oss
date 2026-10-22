import { describe, expect, test } from 'bun:test'
import {
  blogReadingMinutes,
  blogSlugify,
  blogTitle,
  fillBlogPostUrl,
  isBlogPostLive,
  normalizeBlogConfig,
  readBlogCommentInput,
  readBlogData,
  readBlogPostInput,
  summarizeBlogReactions,
  threadBlogComments,
  validateBlogConfig
} from '../shared/blog'
import { blogEmailHtml, blogPlainText, deriveBlogExcerpt, literalBraceText, renderBlogBody } from '../server/utils/blogRender'
import { blogNewsletterDocument } from '../server/utils/blogNewsletter'
import { blogPageProject, renderBlogIndex, renderBlogPost, renderBlogSitemap } from '../server/utils/blogPage'
import { readGhostExport } from '../server/utils/blogImport'
import { complianceProblems } from '../server/utils/campaigns'
import { renderEmailHtml } from '../shared/email/render'
import { extractTemplateVariables } from '../shared/email/placeholders'

process.env.APP_URL = 'https://support.example.com'

const fake = (fields: Record<string, unknown>, id = 'x') => ({ id, get: (k: string) => fields[k] }) as any

describe('blog rules', () => {
  test('a title becomes a slug: accents keep their letter, the rest is hyphens', () => {
    expect(blogSlugify('Cómo empezar: ¡rápido!')).toBe('como-empezar-rapido')
    expect(blogSlugify('  Hello,   World!!  ')).toBe('hello-world')
    expect(blogSlugify('🎉🎉')).toBe('')
    expect(blogSlugify('x'.repeat(100)).length).toBe(80)
    expect(blogSlugify(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79))
  })

  test('a create needs a title and starts as a draft; only the keys sent change on an update', () => {
    expect(readBlogPostInput({}, { create: true }).errors).toContain('A title is required')
    const created = readBlogPostInput({ title: '  Hello   there ' }, { create: true })
    expect(created.values).toEqual({ title: 'Hello there', tags: [], status: 'draft', type: 'post', visibility: 'public', bodyFormat: 'markdown' })
    expect(readBlogPostInput({ excerpt: null }, { create: false }).values).toEqual({ excerpt: '' })
    expect(readBlogPostInput({ status: 'live' }, { create: false }).errors[0]).toMatch(/status must be one of/)
    // `data` is an object of the caller's own, or null to clear it
    expect(readBlogPostInput({ data: { steps: [1, 2] } }, { create: false }).values.data).toEqual({ steps: [1, 2] })
    expect(readBlogPostInput({ data: null }, { create: false }).values.data).toBeNull()
    // stored as text, so keys with dots (which the database refuses in objects) survive
    const settings = { set: { 'light.exposure': 0.5, '$odd': 1 } }
    expect(readBlogData(JSON.stringify(settings))).toEqual(settings)
    expect(readBlogData(settings)).toEqual(settings)
    expect(readBlogData('not json')).toBeNull()
    expect(readBlogData('[1]')).toBeNull()
    expect(readBlogData(undefined)).toBeNull()
    expect(readBlogPostInput({ data: [1] }, { create: false }).errors[0]).toMatch(/data must be a JSON object/)
    expect(readBlogPostInput({ data: { big: 'x'.repeat(200_001) } }, { create: false }).errors[0]).toMatch(/data is up to/)
    expect(readBlogPostInput({ coverImageUrl: 'javascript:alert(1)' }, { create: false }).errors[0]).toMatch(/http/)
    expect(readBlogPostInput({ publishedAt: 'not a date' }, { create: false }).errors[0]).toMatch(/publishedAt/)
    expect(readBlogPostInput({ slug: 'Mi Entrada' }, { create: false }).values.slug).toBe('mi-entrada')
  })

  test('pages, featured, members-only, HTML bodies and the SEO fields', () => {
    expect(readBlogPostInput({ title: 'About', type: 'page' }, { create: true }).values.type).toBe('page')
    const update = readBlogPostInput({ featured: true, visibility: 'members', metaTitle: '  Short   title ', ogImageUrl: null, canonicalUrl: 'https://first.example/post' }, { create: false })
    expect(update.values).toEqual({ featured: true, visibility: 'members', metaTitle: 'Short title', ogImageUrl: '', canonicalUrl: 'https://first.example/post' })
    // An update leaves what it does not send alone: no defaults sneak in.
    expect(readBlogPostInput({ featured: false }, { create: false }).values).toEqual({ featured: false })
    expect(readBlogPostInput({ visibility: 'paid' }, { create: false }).errors[0]).toMatch(/visibility must be one of public, members/)
    expect(readBlogPostInput({ type: 'newsletter' }, { create: false }).errors[0]).toMatch(/type must be one of/)
    expect(readBlogPostInput({ featured: 'yes' }, { create: false }).errors[0]).toMatch(/featured must be true or false/)
    expect(readBlogPostInput({ canonicalUrl: 'ftp://x' }, { create: false }).errors[0]).toMatch(/canonicalUrl must be an http/)
    expect(readBlogPostInput({ metaDescription: 'x'.repeat(501) }, { create: false }).errors[0]).toMatch(/metaDescription is up to 500/)
  })

  test('tags: trimmed, each once whatever its case, at most ten', () => {
    expect(readBlogPostInput({ tags: ['News', ' news ', 'Engineering', ''] }, { create: false }).values.tags).toEqual(['News', 'Engineering'])
    expect(readBlogPostInput({ tags: 'a, b,a' }, { create: false }).values.tags).toEqual(['a', 'b'])
    expect(readBlogPostInput({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { create: false }).errors[0]).toMatch(/at most 10 tags/)
  })

  test('a published post is live once its date passes', () => {
    const now = Date.parse('2026-10-21T12:00:00Z')
    expect(isBlogPostLive({ status: 'published', publishedAt: '2026-10-21T11:59:00Z' }, now)).toBe(true)
    expect(isBlogPostLive({ status: 'published', publishedAt: '2026-10-21T12:01:00Z' }, now)).toBe(false)
    expect(isBlogPostLive({ status: 'draft', publishedAt: '2026-10-01T00:00:00Z' }, now)).toBe(false)
  })

  test('design: partial like the rest, and checked', () => {
    const base = normalizeBlogConfig({ design: { layout: 'grid', navigation: [{ label: 'About', url: '/About' }], social: { github: 'https://github.com/acme' } } })
    expect(base.design).toMatchObject({ layout: 'grid', font: 'sans', colorScheme: 'auto', navigation: [{ label: 'About', url: '/about' }], social: { github: 'https://github.com/acme' } })
    // A font change keeps the navigation; a social link merges, and "" removes one.
    const next = validateBlogConfig({ design: { font: 'serif', social: { x: 'https://x.com/acme', github: '' } } }, base)
    expect(next.errors).toEqual([])
    expect(next.config.design).toMatchObject({ layout: 'grid', font: 'serif', navigation: [{ label: 'About', url: '/about' }], social: { x: 'https://x.com/acme' } })
    expect(next.config.design.social.github).toBeUndefined()
    const bad = validateBlogConfig({ design: { layout: 'masonry', accent: 'red', navigation: [{ label: 'x', url: 'javascript:alert(1)' }], social: { myspace: 'https://myspace.com' }, logoUrl: 'data:image/png;base64,AA' } }, base)
    expect(bad.errors).toHaveLength(5)
    expect(bad.config.design).toEqual(base.design)
    expect(validateBlogConfig({ design: { navigation: Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, url: '/' })) } }).errors[0]).toMatch(/up to 8 links/)
  })

  test('settings: partial, checked, and off by default', () => {
    expect(normalizeBlogConfig(undefined)).toMatchObject({ enabled: false, comments: true, reactions: true, subscribeForm: false })
    const { config, errors } = validateBlogConfig({ enabled: true, commentNotify: 'A@x.com, b@y.com a@x.com', newsletterTopic: 'Blog' }, normalizeBlogConfig({ title: 'Kept' }))
    expect(errors).toEqual([])
    expect(config).toMatchObject({ enabled: true, title: 'Kept', commentNotify: ['a@x.com', 'b@y.com'], newsletterTopic: 'blog' })
    expect(validateBlogConfig({ postUrl: 'https://acme.test/blog' }).errors[0]).toMatch(/\{slug\}/)
    expect(validateBlogConfig({ postUrl: '{siteUrl}/blog/{slug}' }).errors).toEqual([])
    expect(validateBlogConfig({ enabled: 'yes' }).errors[0]).toMatch(/enabled/)
  })

  test('the post address on the project\'s own site, and the blog\'s name', () => {
    expect(fillBlogPostUrl('{siteUrl}/blog/{slug}', 'https://acme.test/', 'hello')).toBe('https://acme.test/blog/hello')
    expect(fillBlogPostUrl('{siteUrl}/blog/{slug}', '', 'hello')).toBe('')
    expect(fillBlogPostUrl('', 'https://acme.test', 'hello')).toBe('')
    expect(blogTitle({ title: '' }, 'Acme')).toBe('Acme blog')
    expect(blogTitle({ title: 'Field notes' }, 'Acme')).toBe('Field notes')
  })

  test('reactions add up per key, in a fixed order, with the viewer\'s own marked', () => {
    const entries = ['heart:u1', 'heart:u2', 'rocket:u1', 'nope:u3', ':u4']
    expect(summarizeBlogReactions(entries)).toEqual([{ key: 'heart', count: 2 }, { key: 'rocket', count: 1 }])
    expect(summarizeBlogReactions(entries, 'u2')).toEqual([{ key: 'heart', count: 2, reacted: true }, { key: 'rocket', count: 1, reacted: false }])
  })

  test('a thread reads top-level comments with their replies under them', () => {
    const thread = threadBlogComments([
      { id: 'a', parentId: null }, { id: 'b', parentId: null }, { id: 'r1', parentId: 'a' }, { id: 'orphan', parentId: 'gone' }, { id: 'r2', parentId: 'a' }
    ])
    expect(thread.map(c => `${c.id}:${c.depth}`)).toEqual(['a:0', 'r1:1', 'r2:1', 'b:0', 'orphan:0'])
  })

  test('a comment body is read, never a deletion', () => {
    expect(readBlogCommentInput({ body: 'hi', parentId: 'c1' })).toEqual({ body: 'hi', parentId: 'c1', errors: [] })
    expect(readBlogCommentInput({ status: 'gone' }).errors[0]).toMatch(/status/)
  })

  test('reading time: whole minutes, never under one', () => {
    expect(blogReadingMinutes('')).toBe(1)
    expect(blogReadingMinutes('word '.repeat(221))).toBe(2)
  })
})

describe('rendering a post', () => {
  test('Markdown becomes HTML through an allowlist; an h1 becomes an h2', () => {
    const html = renderBlogBody('# Title\n\nHi <script>alert(1)</script> <img src="x" onerror="alert(1)"> <a href="javascript:alert(1)">x</a> <span style="position:fixed">y</span>\n\n![ok](https://example.com/a.png)')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style=')
    expect(html).toContain('<img src="https://example.com/a.png" alt="ok" loading="lazy" />')
  })

  test('outside links open in a new tab; images only over http(s)', () => {
    expect(renderBlogBody('[out](https://example.com) [in](/docs)')).toBe('<p><a href="https://example.com" target="_blank" rel="noopener">out</a> <a href="/docs">in</a></p>')
    expect(renderBlogBody('<img src="data:image/png;base64,AAAA">')).not.toContain('data:')
  })

  test('the excerpt leaves headings out and cuts on a word', () => {
    expect(deriveBlogExcerpt('## Why\n\nBecause **it** works.')).toBe('Because it works.')
    const long = deriveBlogExcerpt(`## Head\n\n${'lorem ipsum '.repeat(40)}`, 50)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(51)
    expect(blogPlainText('## Why\n\nBecause')).toBe('Why Because')
  })

  test('HTML from an import goes through the same allowlist; YouTube and Vimeo players stay, sandboxed', () => {
    const html = renderBlogBody('<h1>T</h1><p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe><iframe src="https://evil.example/x"></iframe><iframe src="http://player.vimeo.com/video/1"></iframe>', 'html')
    expect(html).toContain('<h2>T</h2><p>Hi</p>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('evil.example')
    // A frame that lost its address is gone, not left empty.
    expect(html.match(/<iframe/g)).toHaveLength(1)
    expect(html).not.toContain('http://player.vimeo.com')
    expect(html).toContain('src="https://www.youtube.com/embed/abc123"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"')
    // Markdown is the default, and its raw HTML is filtered the same way.
    expect(renderBlogBody('<iframe src="https://evil.example/x"></iframe>')).toBe('')
    expect(blogPlainText('<h2>Why</h2><p>Because</p>', 'html')).toBe('Why Because')
    expect(deriveBlogExcerpt('<h2>Why</h2><figure><img src="https://x.test/a.png"><figcaption>A caption</figcaption></figure><p>Because it works.</p>', 200, 'html')).toBe('Because it works.')
  })

  test('the email copy carries our inline styles and nothing else', () => {
    const html = blogEmailHtml('<p style="color:red">Hi <a href="https://x.test">x</a></p><img src="https://x.test/a.png" alt="">', '#0f766e')
    expect(html).toContain('<p style="margin:0 0 16px 0;font-size:16px;line-height:1.65">')
    expect(html).toContain('color:#0f766e')
    expect(html).not.toContain('color:red')
    expect(html).toContain('max-width:100%')
  })
})

test('in an email, a video player becomes a link to the video', () => {
  const html = blogEmailHtml(renderBlogBody('<iframe src="https://www.youtube-nocookie.com/embed/abc_123?start=4"></iframe>', 'html'), '#123456')
  expect(html).not.toContain('<iframe')
  expect(html).toContain('<a href="https://www.youtube.com/watch?v=abc_123"')
  expect(html).toContain('Watch the video</a>')
})

describe('the newsletter email', () => {
  const project = fake({ name: 'Acme', publicKey: 'pk_test', theme: { accent: '#0f766e' }, brandLogoUrl: 'https://cdn.test/logo.png', marketing: { postalAddress: '1 Main St' } }, 'p1')
  const post = fake({ title: 'Release {{3}}', slug: 'release-3', excerpt: 'All new', readingMinutes: 4, publishedAt: new Date('2026-10-21T10:00:00Z'), coverImageUrl: 'https://cdn.test/cover.png', bodyHtml: '<p>Use <code>{{ value }}</code> in templates.</p>' }, 'post1')

  test('it has what every campaign must: an unsubscribe link and the postal address', () => {
    const document = blogNewsletterDocument(project, post)
    expect(complianceProblems(project, document)).toEqual([])
    expect(document.blocks.map(b => b.id)).toEqual(['blog_logo', 'blog_title', 'blog_meta', 'blog_cover', 'blog_body', 'blog_read', 'blog_rule', 'blog_footer'])
    expect(document.settings.preheader).toBe('All new')
  })

  test('braces in the post are text, not placeholders to blank', () => {
    const document = blogNewsletterDocument(project, post)
    expect(extractTemplateVariables(document).sort()).toEqual(['preferencesUrl', 'project.address', 'unsubscribeUrl'])
    const html = renderEmailHtml(document)
    expect(html).toContain('&#123;&#123; value &#125;&#125;')
    expect(html).toContain('Release {\u200B{3}\u200B}')
    expect(literalBraceText('{{firstName}} and {one}')).toBe('{\u200B{firstName}\u200B} and {one}')
  })

  test('the button and the cover link to the hosted post', () => {
    const document = blogNewsletterDocument(project, post)
    const button = document.blocks.find(b => b.id === 'blog_read') as { href: string }
    expect(button.href).toBe('https://support.example.com/blog/pk_test/release-3')
  })
})

describe('the hosted blog', () => {
  const project = fake({ name: 'Acme <b>', publicKey: 'pk_test', theme: { accent: '#0f766e' } }, 'p1')
  const config = normalizeBlogConfig({ enabled: true, title: 'Notes', reactions: true })
  const item = { title: 'A <post>', path: '/blog/pk_test/a-post', excerpt: 'Lead "in"', coverImageUrl: 'https://cdn.test/c.png', coverImageAlt: 'A cover', publishedAt: '2026-10-21T10:00:00Z', readingMinutes: 3, tags: ['News'], authorName: 'Ada', featured: false, locked: false }
  const post = { ...item, type: 'post' as const, slug: 'a-post', metaTitle: '', metaDescription: '', ogImageUrl: '', bodyHtml: '<p>Body</p>', canonical: 'https://acme.test/blog/a-post', commentsOpen: true }
  const view = { blogPath: '/blog/pk_test', feedUrl: 'https://support.example.com/v1/projects/pk_test/blog.rss', scriptSrc: '/blog.js', blogUrl: 'https://support.example.com/blog/pk_test', related: [], newer: null, older: null, members: true }
  const index = { posts: [item], lead: null, tag: '', q: '', page: 1, hasMore: true, blogPath: '/blog/pk_test', feedUrl: 'https://support.example.com/v1/projects/pk_test/blog.rss', canonical: 'https://support.example.com/blog/pk_test' }

  test('the index escapes what it shows and links the feed', () => {
    const html = renderBlogIndex(blogPageProject(project, config), config, index, null)
    expect(html).toContain('A &lt;post&gt;')
    expect(html).toContain('Lead &quot;in&quot;')
    expect(html).toContain('alt="A cover"')
    expect(html).toContain('type="application/rss+xml"')
    expect(html).toContain('Older →')
    expect(html).toContain('"@type":"Blog"')
    expect(html).toContain('<form class="search" action="/blog/pk_test" method="get" role="search">')
  })

  test('the design: layout, type, colours, logo, navigation, social links and footer', () => {
    const designed = normalizeBlogConfig({ enabled: true, design: { layout: 'magazine', font: 'serif', colorScheme: 'dark', accent: '#ff0066', logoUrl: 'https://cdn.test/logo.png', navigation: [{ label: 'About', url: '/about' }, { label: 'Home', url: '/' }, { label: 'Shop', url: 'https://shop.test' }], social: { mastodon: 'https://social.test/@acme' }, footer: '© Acme <3' } })
    const p = blogPageProject(project, designed)
    expect(p).toMatchObject({ accent: '#ff0066', logo: 'https://cdn.test/logo.png' })
    const html = renderBlogIndex(p, designed, { ...index, lead: { ...item, featured: true, title: 'Lead story' } }, null)
    expect(html).toContain('<html lang="en" data-scheme="dark">')
    expect(html).toContain('class="wide layout-magazine"')
    expect(html).toContain('--font: "Iowan Old Style"')
    expect(html).toContain('<a href="/blog/pk_test/about">About</a>')
    expect(html).toContain('<a href="/blog/pk_test" aria-current="page">Home</a>')
    expect(html).toContain('<a href="https://shop.test/" rel="noopener">Shop</a>')
    expect(html).toContain('rel="me noopener">Mastodon</a>')
    expect(html).toContain('© Acme &lt;3')
    expect(html).toContain('<div class="lead"><a class="card"')
    expect(html).toContain('<span class="badge">Featured</span>')
  })

  test('a search page says what it matched and stays out of the index', () => {
    const html = renderBlogIndex(blogPageProject(project, config), config, { ...index, posts: [], hasMore: false, q: 'offline <sync>' }, null)
    expect(html).toContain('Posts matching “offline &lt;sync&gt;”')
    expect(html).toContain('No posts match that.')
    expect(html).toContain('<meta name="robots" content="noindex,follow">')
    expect(html).toContain('value="offline &lt;sync&gt;"')
  })

  test('a post page has its link preview, its canonical copy, structured data and the embed under it', () => {
    const html = renderBlogPost(blogPageProject(project, config), config, post, { ...view, newer: { ...item, title: 'Newer one', path: '/blog/pk_test/newer' }, related: [{ ...item, title: 'Related one', path: '/blog/pk_test/related' }] }, null)
    expect(html).toContain('<link rel="canonical" href="https://acme.test/blog/a-post">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/c.png">')
    expect(html).toContain('<meta property="article:tag" content="News">')
    expect(html).toContain('data-view="extras"')
    expect(html).toContain('data-post="a-post"')
    expect(html).not.toContain('data-body')
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain('rel="next">← Newer one</a>')
    expect(html).toContain('Keep reading')
    // JSON-LD: the post as an article, and nothing in it can close the script tag.
    expect(html).toContain('"@type":"BlogPosting","headline":"A \\u003cpost>"')
    expect(html).not.toContain('"A <post>"')
  })

  test('what search engines and link previews see can differ from the page', () => {
    const html = renderBlogPost(blogPageProject(project, config), config, { ...post, metaTitle: 'SEO title', metaDescription: 'SEO description', ogImageUrl: 'https://cdn.test/og.png' }, view, null)
    expect(html).toContain('<title>SEO title · Notes</title>')
    expect(html).toContain('<meta name="description" content="SEO description">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/og.png">')
    expect(html).toContain('<h1>A &lt;post&gt;</h1>')
  })

  test('a members-only post shows its lead-in and a gate; the embed signs the reader in and fills the body', () => {
    const html = renderBlogPost(blogPageProject(project, config), config, { ...post, locked: true, bodyHtml: '' }, view, null)
    expect(html).toContain('<div class="content" id="hb-blog-body"><p>Lead &quot;in&quot;</p><div class="gate"><strong>This post is for members</strong>')
    expect(html).toContain('data-body="#hb-blog-body"')
    expect(html).toContain('"isAccessibleForFree":false')
    // A project that signs nobody in by email: the gate says so, and no script.
    const closed = renderBlogPost(blogPageProject(project, config), config, { ...post, locked: true, bodyHtml: '' }, { ...view, members: false }, null)
    expect(closed).toContain('Only members can read the rest.')
    expect(closed).not.toContain('<script src')
  })

  test('a page: no date, tags, back link, comments or related posts', () => {
    const html = renderBlogPost(blogPageProject(project, config), config, { ...post, type: 'page' }, { ...view, related: [{ ...item, path: '/x' }] }, null)
    expect(html).toContain('"@type":"WebPage"')
    expect(html).toContain('<meta property="og:type" content="website">')
    expect(html).not.toContain('min read')
    expect(html).not.toContain('All posts')
    expect(html).not.toContain('class="tags"')
    expect(html).not.toContain('<script src')
    expect(html).not.toContain('Keep reading')
  })

  test('no reactions, comments or sign-up: no script at all', () => {
    const quiet = normalizeBlogConfig({ enabled: true, reactions: false, comments: false, subscribeForm: false })
    const html = renderBlogPost(blogPageProject(project, quiet), quiet, { ...post, bodyHtml: '', canonical: '' }, view, null)
    expect(html).not.toContain('<script src')
  })

  test('the sitemap lists each address once, escaped', () => {
    const xml = renderBlogSitemap([{ loc: 'https://s.test/blog/pk?a=1&b=2', lastmod: '2026-10-21T10:00:00.000Z' }])
    expect(xml).toContain('<loc>https://s.test/blog/pk?a=1&amp;b=2</loc><lastmod>2026-10-21T10:00:00.000Z</lastmod>')
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })
})

describe('importing from Ghost', () => {
  const ghost = {
    db: [{
      meta: { version: '5.96.0' },
      data: {
        posts: [
          { id: 'g1', title: 'Hello', slug: 'hello', html: '<p>Hi <a href="__GHOST_URL__/about/">about</a></p><img src="__GHOST_URL__/content/images/a.png">', feature_image: '__GHOST_URL__/content/images/cover.png', featured: 1, type: 'post', status: 'published', visibility: 'public', published_at: '2024-01-02T03:04:05.000Z', custom_excerpt: 'Lead', canonical_url: null },
          { id: 'g2', title: 'Paid', slug: 'paid', html: '<p>Secret</p>', type: 'post', status: 'scheduled', visibility: 'paid', published_at: '2099-01-01T00:00:00.000Z' },
          { id: 'g3', title: 'About', slug: 'about', html: '<p>Us</p>', type: 'page', status: 'published', visibility: 'public', published_at: '2023-01-01T00:00:00.000Z' },
          { id: 'g4', title: 'Email only', slug: 'email-only', html: null, plaintext: 'Line one\n\nLine <two>', type: 'post', status: 'sent', visibility: 'members' }
        ],
        tags: [{ id: 't1', name: 'News' }, { id: 't2', name: '#hidden' }, { id: 't3', name: 'Engineering' }],
        posts_tags: [{ post_id: 'g1', tag_id: 't3', sort_order: 1 }, { post_id: 'g1', tag_id: 't1', sort_order: 0 }, { post_id: 'g1', tag_id: 't2', sort_order: 2 }],
        users: [{ id: 'u1', name: 'Ada Lovelace' }],
        posts_authors: [{ post_id: 'g1', author_id: 'u1', sort_order: 0 }],
        posts_meta: [{ post_id: 'g1', meta_title: 'Hello, SEO', meta_description: 'Desc', og_image: '__GHOST_URL__/content/images/og.png', feature_image_alt: 'A cover' }]
      }
    }]
  }

  test('posts, pages, tags, authors and SEO fields map across', () => {
    const { posts, warnings } = readGhostExport(ghost, 'https://old.example.com/')
    expect(posts.map(post => post.ghostId)).toEqual(['g1', 'g2', 'g3', 'g4'])
    expect(posts[0]!.payload).toMatchObject({
      type: 'post', title: 'Hello', slug: 'hello', bodyFormat: 'html', excerpt: 'Lead', featured: true, visibility: 'public', status: 'published',
      body: '<p>Hi <a href="https://old.example.com/about/">about</a></p><img src="https://old.example.com/content/images/a.png">',
      coverImageUrl: 'https://old.example.com/content/images/cover.png', coverImageAlt: 'A cover',
      tags: ['News', 'Engineering'], authorName: 'Ada Lovelace', publishedAt: '2024-01-02T03:04:05.000Z',
      metaTitle: 'Hello, SEO', metaDescription: 'Desc', ogImageUrl: 'https://old.example.com/content/images/og.png', canonicalUrl: ''
    })
    // Scheduled stays scheduled; paid becomes members-only; a page stays a page; email-only comes in as a draft.
    expect(posts[1]!.payload).toMatchObject({ status: 'published', visibility: 'members', publishedAt: '2099-01-01T00:00:00.000Z' })
    expect(posts[2]!.payload.type).toBe('page')
    expect(posts[3]!.payload).toMatchObject({ status: 'draft', visibility: 'members', body: '<p>Line one</p><p>Line &lt;two></p>' })
    expect(warnings).toEqual(['1 paid or tier-only post is members-only here: there are no paid tiers'])
  })

  test('without the site address its links are dropped, and it says so; anything else is refused', () => {
    const { posts, warnings } = readGhostExport(ghost)
    expect(posts[0]!.payload.coverImageUrl).toBe('')
    expect(warnings.at(-1)).toMatch(/pass its address/)
    expect(() => readGhostExport({ posts: [] })).toThrow(/not a Ghost export/)
    expect(() => readGhostExport({ data: { posts: [] } })).not.toThrow()
  })
})
