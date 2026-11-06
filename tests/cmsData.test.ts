import { describe, expect, test } from 'bun:test'
import { newBlock, normalizeContent, type CmsBlock } from '../shared/cms/content'
import { dataPaths, loadCmsData } from '../shared/cms/dynamic'
import { BUILTIN_COMPONENTS, libraryOf } from '../shared/cms/library'
import { pageCsp, renderBlocks } from '../shared/cms/render'

const lib = libraryOf()
const ctx = { library: lib, pk: 'pk_test', host: 'https://hb.test' }
const style = { accent: '', mode: 'light', radius: 'soft', headingFont: '', bodyFont: '', width: 'normal' } as const
const page = (...body: CmsBlock[]): CmsBlock => ({ _uid: 'root', component: 'page', body })
const block = (key: string, values: Record<string, unknown> = {}) => newBlock(lib.get(key)!, values)
const html = (content: CmsBlock, data?: Record<string, unknown>, editor = false) => renderBlocks(content, style, '#3b82f6', { ...ctx, data, editor }).html

const POSTS = { posts: [{ slug: 'hello', title: 'Hello <b>world</b>', excerpt: 'First post', coverImageUrl: 'https://img.test/a.png', coverImageAlt: 'Cover', publishedAt: '2026-03-04T10:00:00Z', authorName: 'Ada', readingMinutes: 3, url: 'https://hb.test/blog/pk_test/hello' }, { slug: 'x', title: 'Bad link', excerpt: '', coverImageUrl: 'javascript:alert(1)', publishedAt: '', url: 'javascript:alert(1)' }] }

describe('the HelpBites content blocks', () => {
  test('they are built-ins, and the data ones are the only ones that read from the API', () => {
    const keys = ['blog_list', 'blog_post', 'changelog', 'pricing_table', 'feedback', 'chat', 'form', 'notify']
    for (const key of keys) expect(BUILTIN_COMPONENTS.find(d => d.key === key)?.nestable).toBe(true)
    const tree = page(...keys.map(k => block(k)))
    expect(dataPaths(tree, lib, 'pk_test').sort()).toEqual([
      '/v1/blog?pk=pk_test&limit=1', '/v1/blog?pk=pk_test&limit=3', '/v1/changelog?pk=pk_test&limit=5', '/v1/pricing/pk_test'
    ])
  })

  test('a hidden block asks for nothing, and what is loaded is not asked again', async () => {
    const tree = page({ ...block('blog_list'), _hidden: true }, block('changelog'))
    expect(dataPaths(tree, lib, 'pk_test')).toEqual(['/v1/changelog?pk=pk_test&limit=5'])
    const asked: string[] = []
    const first = await loadCmsData(tree, lib, 'pk_test', async (p) => { asked.push(p); return { entries: [] } })
    await loadCmsData(tree, lib, 'pk_test', async (p) => { asked.push(p); return null }, first)
    expect(asked).toEqual(['/v1/changelog?pk=pk_test&limit=5'])
  })

  test('the latest post is found in a second round; a failed read is null', async () => {
    const tree = page(block('blog_post'), block('pricing_table'))
    const data = await loadCmsData(tree, lib, 'pk_test', async (p) => {
      if (p.startsWith('/v1/pricing')) throw new Error('404')
      return p.includes('limit=1') ? { posts: [{ slug: 'hello' }] } : { post: { title: 'Hello', bodyHtml: '<p>Body</p>' } }
    })
    expect(data['/v1/blog/hello?pk=pk_test']).toMatchObject({ post: { title: 'Hello' } })
    expect(data['/v1/pricing/pk_test']).toBeNull()
  })

  test('counts and keys are cleaned before they reach a path', () => {
    const tree = page(block('blog_list', { count: 999, tag: 'a&b' }), block('pricing_table', { table: 'pro/../x' }))
    expect(dataPaths(tree, lib, 'pk_test')).toEqual(['/v1/blog?pk=pk_test&limit=12&tag=a%26b', '/v1/pricing/pk_test/pro%2F..%2Fx'])
  })

  test('the blog list escapes text, drops unsafe links and pictures, and honours the switches', () => {
    const out = html(page(block('blog_list', { showAuthor: true })), { '/v1/blog?pk=pk_test&limit=3': POSTS })
    expect(out).toContain('Hello &lt;b&gt;world&lt;/b&gt;')
    expect(out).toContain('href="https://hb.test/blog/pk_test/hello"')
    expect(out).toContain('Mar 4, 2026 · Ada')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('<b>world')
    const bare = html(page(block('blog_list', { showImage: false, showExcerpt: false, showDate: false })), { '/v1/blog?pk=pk_test&limit=3': POSTS })
    expect(bare).not.toContain('<img')
    expect(bare).not.toContain('First post')
    expect(bare).not.toContain('Mar 4')
  })

  test('nothing to show: a hosted page leaves the block out, the editor says why, a hover preview shows a sample', () => {
    const tree = page(block('blog_list'), block('changelog'))
    const gone = { '/v1/blog?pk=pk_test&limit=3': null, '/v1/changelog?pk=pk_test&limit=5': { entries: [] } }
    expect(html(tree, gone)).not.toContain('hb-blog')
    expect(html(tree, gone)).not.toContain('hb-clog')
    expect(html(tree, gone, true)).toContain('hb-dynamic__empty')
    expect(html(tree, {})).toContain('How we ship every week')
  })

  test('a post keeps the body HelpBites sanitised, and a locked one shows as its excerpt', () => {
    const data = { '/v1/blog/hello?pk=pk_test': { post: { title: 'Hello', bodyHtml: '<p>{{$pk}} {{$data}}</p>', publishedAt: '2026-03-04T00:00:00Z', authorName: 'Ada', readingMinutes: 2 } } }
    const out = html(page(block('blog_post', { slug: 'hello' })), data)
    // Its own `{{$data}}` is not filled a second time.
    expect(out).toContain('<p>pk_test {{$data}}</p>')
    expect(out).toContain('2 min read')
    const locked = html(page(block('blog_post', { slug: 'hello' })), { '/v1/blog/hello?pk=pk_test': { post: { title: 'Hello', excerpt: 'Teaser', locked: true } } })
    expect(locked).toContain('Teaser')
    expect(locked).toContain('Members only')
  })

  test('the changelog shows the summary, or the whole text, with tag and version', () => {
    const entry = { tag: 'fix', title: 'Fixed it', summary: 'A short one', bodyHtml: '<p>The long one</p>', version: '1.2.0', publishedAt: '2026-01-02T00:00:00Z' }
    const data = { '/v1/changelog?pk=pk_test&limit=5': { entries: [entry] } }
    const short = html(page(block('changelog')), data)
    expect(short).toContain('A short one')
    expect(short).toContain('Fixed</span>')
    expect(short).toContain('1.2.0 · Jan 2, 2026')
    expect(short).not.toContain('The long one')
    expect(html(page(block('changelog', { showBody: true, showTag: false })), data)).toContain('<p>The long one</p>')
  })

  test('pricing cards show the right interval, the badge, the lines and a safe button', () => {
    const table = {
      currency: 'usd', intervals: ['month', 'year'], options: { defaultInterval: 'year', yearlyAs: 'monthly' },
      plans: [
        { name: 'Pro', description: 'For teams', badge: 'Popular', highlighted: true, customPrice: '', priceNote: '', prices: { month: { amount: 12, currency: 'usd', href: '/checkout/m' }, year: { amount: 120, currency: 'usd', monthly: 10, href: '/checkout/y' } }, action: { label: 'Go Pro', href: null }, lines: [{ text: 'Seats', value: '10', included: true }, { text: 'SSO', included: false }] },
        { name: 'Custom', description: '', badge: '', highlighted: false, customPrice: 'Talk to us', prices: {}, action: { label: 'Contact', href: 'javascript:alert(1)' }, lines: [] }
      ]
    }
    const data = { '/v1/pricing/pk_test': { table } }
    const yearly = html(page(block('pricing_table')), data)
    expect(yearly).toContain('$10<small')
    expect(yearly).toContain('/month')
    expect(yearly).toContain('href="/checkout/y"')
    expect(yearly).toContain('Popular')
    expect(yearly).toContain('10 Seats')
    expect(yearly).toContain('hb-ptable__off')
    expect(yearly).toContain('Talk to us')
    expect(yearly).not.toContain('javascript:')
    const monthly = html(page(block('pricing_table', { interval: 'month', showFeatures: false })), data)
    expect(monthly).toContain('$12')
    expect(monthly).not.toContain('Seats')
  })

  test('embeds frame only HelpBites\' own pages, and the page policy lets exactly those in', async () => {
    const out = html(page(block('feedback', { view: 'roadmap' }), block('chat'), block('form', { form: 'contact' })))
    expect(out).toContain('src="https://hb.test/embed/feedback?inline=1&amp;pk=pk_test&amp;view=roadmap&amp;theme=light"')
    expect(out).toContain('src="https://hb.test/embed?inline=1&amp;pk=pk_test&amp;theme=light"')
    expect(out).toContain('src="https://hb.test/f/pk_test/contact"')
    const csp = await pageCsp('https://hb.test')
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://hb.test/embed https://hb.test/embed/ https://hb.test/f/;')
  })

  test('the notify form posts to the changelog sign-up with a honeypot and a frequency', () => {
    const asks = html(page(block('notify', { askFrequency: true })))
    expect(asks).toContain('action="https://hb.test/v1/changelog/subscribe?pk=pk_test"')
    expect(asks).toContain('name="website"')
    expect(asks).toContain('<select')
    const fixed = html(page(block('notify', { frequency: 'weekly' })))
    expect(fixed).toContain('<input type="hidden" name="frequency" value="weekly">')
    expect(fixed).not.toContain('<select')
  })

  test('the new blocks survive saving: normalize keeps their fields', () => {
    const { content, issues } = normalizeContent(page(block('blog_list', { count: 6, tag: 'news' })), lib, 'page')
    expect(issues).toEqual([])
    expect((content.body as CmsBlock[])[0]).toMatchObject({ component: 'blog_list', count: 6, tag: 'news' })
  })
})
