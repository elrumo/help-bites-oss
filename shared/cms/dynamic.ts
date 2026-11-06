import { childFields, type CmsBlock, type CmsLibrary } from './content'

/**
 * Built-in blocks that show the project's own HelpBites content (the blog, the
 * changelog, the pricing table). Their data is what the public API answers
 * (`/v1/blog`, `/v1/changelog`, `/v1/pricing/{pk}`), so a page shows exactly
 * what the same URL shows anyone, and one loader serves both sides:
 *
 *   server (hosted pages, `format=html`): `get` is an in-process request
 *   editor preview:                       `get` is a `fetch` from the browser
 *
 * `loadCmsData` asks each block which paths it needs, fetches them and returns
 * `{ [path]: answer | null }`; the renderer reads from it. A path missing from
 * the data was never loaded (a hover preview): the block shows sample content.
 * `null` is "asked, nothing there" (no blog, nothing published): a hosted page
 * leaves the block out, the editor says why.
 */

export type CmsData = Record<string, unknown>
export type Read = (key: string) => unknown
export type DynamicEnv = { esc: (v: unknown) => string, safeUrl: (url: string) => string, editor: boolean }

export type Dynamic = {
  /** The public API paths this block reads (the answers so far in `data`, for a second round). */
  want: (read: Read, pk: string, data: CmsData) => string[]
  /** The block's HTML for `{{$data}}`, or null when there is nothing to show. */
  render: (read: Read, data: CmsData, pk: string, env: DynamicEnv) => string | null
  /** Shown in the editor in place of nothing. */
  empty: string
}

const MAX_PATHS = 24
const num = (v: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v)) || fallback))
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [])
const web = (url: unknown) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '')
const q = (params: Record<string, string>) => Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

const DATE = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
function when(iso: unknown): string {
  const d = new Date(String(iso || ''))
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d)
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount)
  } catch {
    return `${amount} ${currency.toUpperCase()}`
  }
}

// ---- blog ------------------------------------------------------------------------

const blogList = (read: Read, pk: string) => `/v1/blog?${q({ pk, limit: String(num(read('count'), 3, 1, 12)), tag: text(read('tag')), featured: read('featuredOnly') === true ? 'true' : '' })}`
const blogPost = (pk: string, slug: string) => `/v1/blog/${encodeURIComponent(slug)}?${q({ pk })}`

const SAMPLE_POSTS = [0, 1, 2].map(i => ({ slug: '', title: ['How we ship every week', 'What changed in this release', 'Notes from building in public'][i], excerpt: 'A short summary of the post shows here, taken from the blog.', coverImageUrl: '', coverImageAlt: '', publishedAt: '2026-01-15T00:00:00Z', authorName: 'Your name', readingMinutes: 4, url: '#', locked: false }))

const BLOG_LIST: Dynamic = {
  empty: 'No published posts yet. Turn the blog on and publish a post under Blog to see them here.',
  want: (read, pk) => [blogList(read, pk)],
  render(read, data, pk, { esc, safeUrl }) {
    const answer = data[blogList(read, pk)]
    if (answer === null) return null
    const posts = answer === undefined ? SAMPLE_POSTS : list(rec(answer).posts)
    if (!posts.length) return null
    const image = read('showImage') !== false, excerpt = read('showExcerpt') !== false, date = read('showDate') !== false, author = read('showAuthor') === true
    return posts.map((p) => {
      const cover = web(p.coverImageUrl)
      const meta = [date ? when(p.publishedAt) : '', author ? text(p.authorName) : ''].filter(Boolean).map(esc).join(' · ')
      return `<a class="hb-blog__post" href="${esc(safeUrl(String(p.url || '#')))}">${image && cover ? `<img src="${esc(cover)}" alt="${esc(p.coverImageAlt || '')}" loading="lazy">` : ''}<span class="hb-blog__body">${meta ? `<small class="hb-muted">${meta}</small>` : ''}<strong>${esc(p.title)}</strong>${excerpt && p.excerpt ? `<span class="hb-muted">${esc(p.excerpt)}</span>` : ''}</span></a>`
    }).join('')
  }
}

const BLOG_POST: Dynamic = {
  empty: 'No published post to show. Publish one under Blog, or name the slug of an existing post.',
  want(read, pk, data) {
    const slug = text(read('slug'))
    if (slug) return [blogPost(pk, slug)]
    const first = list(rec(data[`/v1/blog?${q({ pk, limit: '1' })}`]).posts)[0]
    return [`/v1/blog?${q({ pk, limit: '1' })}`, ...(first?.slug ? [blogPost(pk, String(first.slug))] : [])]
  },
  render(read, data, pk, { esc }) {
    const slug = text(read('slug'))
    const latest = `/v1/blog?${q({ pk, limit: '1' })}`
    const key = blogPost(pk, slug || String(list(rec(data[latest]).posts)[0]?.slug || ''))
    if (data[slug ? key : latest] === undefined) return '<h2>An example post title</h2><p class="hb-muted">Your post shows here in the look of this page: headings, text, lists and pictures.</p>'
    const post = rec(rec(data[key]).post)
    if (!post.title) return null
    const cover = web(post.coverImageUrl)
    const meta = read('showMeta') === false ? [] : [when(post.publishedAt), text(post.authorName), post.readingMinutes ? `${post.readingMinutes} min read` : ''].filter(Boolean)
    return `${read('showTitle') !== false ? `<h2>${esc(post.title)}</h2>` : ''}${meta.length ? `<p class="hb-muted hb-bpost__meta">${meta.map(esc).join(' · ')}</p>` : ''}${read('showCover') !== false && cover ? `<img class="hb-bpost__cover" src="${esc(cover)}" alt="${esc(post.coverImageAlt || '')}" loading="lazy">` : ''}${post.locked ? `<p class="hb-muted">${esc(post.excerpt)}</p><p class="hb-muted"><em>Members only.</em></p>` : `<div class="hb-bpost__body">${typeof post.bodyHtml === 'string' ? post.bodyHtml : ''}</div>`}`
  }
}

// ---- changelog -------------------------------------------------------------------

const changelogPath = (read: Read, pk: string) => `/v1/changelog?${q({ pk, limit: String(num(read('count'), 5, 1, 20)), tag: text(read('tag')).replace(/^all$/, '') })}`

const SAMPLE_ENTRIES = [['new', 'A new thing you asked for'], ['improved', 'Something faster'], ['fix', 'A bug, gone']].map(([tag, title]) => ({ tag, title, summary: 'What changed, in a sentence.', bodyHtml: '', version: '', publishedAt: '2026-01-15T00:00:00Z', slug: '' }))
const TAGS: Record<string, string> = { new: 'New', improved: 'Improved', fix: 'Fixed', removed: 'Removed', breaking: 'Breaking' }

const CHANGELOG: Dynamic = {
  empty: 'Nothing published yet. Publish a changelog entry (and turn the public changelog on) to see it here.',
  want: (read, pk) => [changelogPath(read, pk)],
  render(read, data, pk, { esc }) {
    const answer = data[changelogPath(read, pk)]
    if (answer === null) return null
    const entries = answer === undefined ? SAMPLE_ENTRIES : list(rec(answer).entries)
    if (!entries.length) return null
    const body = read('showBody') === true
    return entries.map((e) => {
      const tag = String(e.tag || '')
      const meta = [read('showVersion') !== false ? text(e.version) : '', read('showDate') !== false ? when(e.publishedAt) : ''].filter(Boolean).map(esc).join(' · ')
      const inner = body && typeof e.bodyHtml === 'string' && e.bodyHtml ? `<div class="hb-clog__text hb-prose">${e.bodyHtml}</div>` : e.summary ? `<p class="hb-muted hb-clog__text">${esc(e.summary)}</p>` : ''
      return `<article class="hb-clog__entry">${meta ? `<small class="hb-muted hb-clog__meta">${meta}</small>` : ''}<div><h3>${read('showTag') !== false && TAGS[tag] ? `<span class="hb-pill hb-clog__tag hb-clog__tag--${esc(tag)}">${esc(TAGS[tag])}</span> ` : ''}${esc(e.title)}</h3>${inner}</div></article>`
    }).join('')
  }
}

// ---- pricing ---------------------------------------------------------------------

const pricingPath = (read: Read, pk: string) => `/v1/pricing/${encodeURIComponent(pk)}${text(read('table')) ? `/${encodeURIComponent(text(read('table')))}` : ''}`

const PER: Record<string, string> = { week: '/week', month: '/month', year: '/year', once: '' }
const SAMPLE_TABLE = {
  currency: 'usd', intervals: ['month'], options: { defaultInterval: 'month', yearlyAs: 'total' },
  plans: [['Starter', 9], ['Pro', 29], ['Team', 79]].map(([name, amount], i) => ({ name, description: 'What the plan is for.', badge: '', highlighted: i === 1, customPrice: '', priceNote: '', prices: { month: { amount, currency: 'usd', interval: 'month', monthly: null, href: '#' } }, action: { label: 'Choose', href: null }, lines: [{ text: 'A feature', included: true, value: '' }, { text: 'Another feature', included: true, value: '' }] }))
}

const PRICING: Dynamic = {
  empty: 'No published pricing table. Publish one under Pricing to see its plans here.',
  want: (read, pk) => [pricingPath(read, pk)],
  render(read, data, pk, { esc, safeUrl }) {
    const answer = data[pricingPath(read, pk)]
    if (answer === null) return null
    const table = rec(answer === undefined ? SAMPLE_TABLE : rec(answer).table)
    const plans = list(table.plans)
    if (!plans.length) return null
    const options = rec(table.options)
    const intervals = Array.isArray(table.intervals) ? table.intervals.map(String) : []
    const asked = text(read('interval'))
    const want = intervals.includes(asked) ? asked : String(options.defaultInterval || intervals[0] || 'month')
    const features = read('showFeatures') !== false
    return plans.map((p) => {
      const prices = rec(p.prices)
      const slot = rec(prices[want]).amount !== undefined ? want : intervals.find(i => rec(prices[i]).amount !== undefined) || want
      const price = rec(prices[slot])
      const custom = text(p.customPrice)
      let amount = ''
      if (custom) amount = esc(custom)
      else if (typeof price.amount === 'number') {
        const monthly = slot === 'year' && options.yearlyAs === 'monthly' && typeof price.monthly === 'number'
        amount = `${esc(money(monthly ? price.monthly as number : price.amount, String(price.currency || table.currency || 'usd')))}<small class="hb-muted">${monthly ? '/month' : PER[slot] ?? ''}</small>`
      }
      const href = safeUrl(String(price.href || rec(p.action).href || '#'))
      const label = text(rec(p.action).label)
      const lines = list(p.lines).map(l => `<li${l.included === false ? ' class="hb-ptable__off"' : ''}>${esc(l.value ? `${l.value} ${l.text}` : l.text)}</li>`).join('')
      return `<div class="hb-card hb-ptable__plan${p.highlighted ? ' hb-ptable__plan--on' : ''}">${p.badge ? `<span class="hb-pill hb-ptable__badge">${esc(p.badge)}</span>` : ''}<h3>${esc(p.name)}</h3>${p.description ? `<p class="hb-muted">${esc(p.description)}</p>` : ''}<div class="hb-ptable__price">${amount}</div>${p.priceNote ? `<p class="hb-muted hb-ptable__note">${esc(p.priceNote)}</p>` : ''}${features && lines ? `<ul class="hb-ptable__lines">${lines}</ul>` : ''}${label && href !== '#' ? `<a class="hb-btn${p.highlighted ? '' : ' hb-btn--ghost'}" href="${esc(href)}">${esc(label)}</a>` : ''}</div>`
    }).join('')
  }
}

export const DYNAMIC: Record<string, Dynamic> = { blog_list: BLOG_LIST, blog_post: BLOG_POST, changelog: CHANGELOG, pricing_table: PRICING }

// ---- loading ---------------------------------------------------------------------

function readerOf(library: CmsLibrary, block: CmsBlock): Read {
  const fields = new Map((library.get(block.component)?.fields || []).map(f => [f.key, f]))
  return key => (Object.hasOwn(block, key) ? block[key] : fields.get(key)?.default)
}

function visit(block: CmsBlock, library: CmsLibrary, each: (block: CmsBlock, read: Read) => void) {
  if (block._hidden) return
  const def = library.get(block.component)
  if (def?.builtin && DYNAMIC[def.key]) each(block, readerOf(library, block))
  for (const field of childFields(block, library)) for (const child of Array.isArray(block[field]) ? block[field] as CmsBlock[] : []) visit(child, library, each)
}

/** The public API paths the page's data blocks read, given what has been loaded so far. */
export function dataPaths(content: CmsBlock, library: CmsLibrary, pk: string, data: CmsData = {}): string[] {
  const paths = new Set<string>()
  visit(content, library, (block, read) => DYNAMIC[block.component]!.want(read, pk, data).forEach(p => paths.add(p)))
  return [...paths]
}

/**
 * The answers to every path the page's data blocks read, on top of `have`
 * (already loaded paths are not asked again). `get` returns the JSON or
 * throws; a failure is `null`. Two rounds, for a block that needs the first
 * answer to know its second path (the latest post).
 */
export async function loadCmsData(content: CmsBlock, library: CmsLibrary, pk: string, get: (path: string) => Promise<unknown>, have: CmsData = {}): Promise<CmsData> {
  const data: CmsData = { ...have }
  for (let round = 0; round < 2; round++) {
    const todo = dataPaths(content, library, pk, data).filter(p => !(p in data)).slice(0, MAX_PATHS)
    if (!todo.length) break
    const answers = await Promise.all(todo.map(path => get(path).then(v => v ?? null, () => null)))
    todo.forEach((path, i) => { data[path] = answers[i] })
  }
  return data
}
