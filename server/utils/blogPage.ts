import { blogTitle, type BlogConfig, type BlogSocialNetwork, type PublicBlogPost } from '#shared/blog'
import { poweredByHtml, type PoweredBy } from './branding'
import { escapeHtml } from './messageEmail'
import { lookOf } from './projects'

// The hosted blog at /blog/<pk>, as plain server-rendered HTML in the style of
// legalPage.ts: readable without JavaScript and by crawlers, and meant to be
// indexed. Its look is the blog's design settings (layout, type, colours,
// navigation, social links, footer). The one script is blog.js under a post,
// for its reactions, comments, sign-up and members sign-in (the same embed a
// host site uses). All text is escaped here; `bodyHtml` is the one raw value,
// sanitised when it was saved.

export type BlogPageProject = { name: string, publicKey: string, accent: string, logo: string }
export type BlogListItem = Pick<PublicBlogPost, 'title' | 'excerpt' | 'coverImageUrl' | 'coverImageAlt' | 'publishedAt' | 'readingMinutes' | 'tags' | 'authorName' | 'featured' | 'locked'> & { path: string }
export type BlogPageView = BlogListItem & Pick<PublicBlogPost, 'type' | 'slug' | 'metaTitle' | 'metaDescription' | 'ogImageUrl'> & { bodyHtml: string, canonical: string, commentsOpen: boolean }

/** The project's look, with the blog's own accent and logo over it. */
export function blogPageProject(project: ParseObject, config: BlogConfig): BlogPageProject {
  const look = lookOf(project)
  return {
    name: look.name,
    publicKey: String(project.get('publicKey') || ''),
    accent: /^#[0-9a-f]{6}$/i.test(config.design.accent) ? config.design.accent : look.accent,
    logo: [config.design.logoUrl, look.logoUrl, look.iconUrl].find(url => /^https?:\/\//.test(url)) || ''
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

const SOCIAL_LABELS: Record<BlogSocialNetwork, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', github: 'GitHub', linkedin: 'LinkedIn', instagram: 'Instagram', youtube: 'YouTube', website: 'Website' }

const FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Georgia, Cambria, "Times New Roman", serif'
}

const DARK = '--bg: #111113; --card: #19191c; --text: #ececf0; --muted: #a2a2ad; --line: #2b2b31;'

const CSS = `
:root { --accent: var(--brand); --bg: #fafafa; --card: #fff; --text: #1c1c21; --muted: #62626d; --line: #e6e6ea; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root:not([data-scheme="light"]) { ${DARK} } }
:root[data-scheme="dark"] { ${DARK} color-scheme: dark; }
:root[data-scheme="light"] { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 17px; line-height: 1.7; -webkit-text-size-adjust: 100%; }
a { color: var(--accent); text-underline-offset: 2px; }
.wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 64px; }
.wide .wrap { max-width: 1120px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; margin-bottom: 32px; font-size: 15px; }
.brand { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 12px; font-weight: 650; }
.brand img { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; }
.nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.nav a { color: var(--muted); text-decoration: none; font-weight: 500; }
.nav a:hover, .nav a[aria-current] { color: var(--text); }
.tools { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.tools a { color: var(--muted); text-decoration: none; font-weight: 500; font-size: 14px; }
.search input { font: inherit; font-size: 14px; color: inherit; width: 160px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); }
.hero-cover { display: block; width: 100%; max-height: 360px; aspect-ratio: 3 / 1; object-fit: cover; border-radius: 16px; margin: 0 0 28px; background: var(--line); }
.intro h1 { font-size: 2.2rem; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.02em; }
.intro p { margin: 0 0 32px; color: var(--muted); }
.posts { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.layout-grid .posts, .layout-magazine .posts { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
.card { display: flex; flex-direction: column; height: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; color: inherit; text-decoration: none; transition: border-color .15s ease; }
.card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.card img { display: block; width: 100%; aspect-ratio: 2 / 1; object-fit: cover; background: var(--line); }
.card div { padding: 20px 24px 22px; }
.card h2 { font-size: 1.3rem; line-height: 1.3; margin: 0 0 6px; letter-spacing: -0.01em; }
.card p { margin: 8px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
.lead { margin: 0 0 24px; }
.lead .card { display: grid; grid-template-columns: 3fr 2fr; }
.lead .card img { height: 100%; aspect-ratio: auto; min-height: 280px; }
.lead .card div { padding: 32px 36px; align-self: center; }
.lead .card h2 { font-size: 2rem; line-height: 1.15; letter-spacing: -0.02em; }
.badges { display: flex; gap: 6px; margin: 0 0 8px; }
.badge { font-size: 12px; font-weight: 600; line-height: 1; padding: 5px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
.meta { color: var(--muted); font-size: 14px; margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; padding: 0; list-style: none; }
.tags a { display: inline-block; font-size: 13px; line-height: 1; padding: 6px 10px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 10%, transparent); text-decoration: none; }
.filter { margin: -16px 0 24px; font-size: 14px; color: var(--muted); }
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 28px; font-size: 15px; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
article > img { display: block; width: 100%; max-height: 440px; object-fit: cover; }
article .body { padding: 36px 44px 40px; }
article h1 { font-size: 2.2rem; line-height: 1.15; margin: 0 0 10px; letter-spacing: -0.02em; }
article .meta { margin-bottom: 28px; }
.content h2 { font-size: 1.45rem; line-height: 1.3; margin: 2.2rem 0 0.6rem; letter-spacing: -0.01em; }
.content h3 { font-size: 1.2rem; line-height: 1.35; margin: 1.8rem 0 0.5rem; }
.content h4 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
.content p, .content ul, .content ol, .content figure { margin: 0 0 1.1rem; }
.content li { margin: 0.3rem 0; }
.content img { max-width: 100%; height: auto; border-radius: 10px; }
.content iframe { display: block; width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; border-radius: 10px; margin: 0 0 1.1rem; }
.content figcaption { text-align: center; color: var(--muted); font-size: 14px; margin-top: 6px; }
.content blockquote { margin: 0 0 1.1rem; padding-left: 16px; border-left: 3px solid var(--accent); color: var(--muted); }
.content code { font-size: 0.88em; background: color-mix(in srgb, var(--text) 8%, transparent); padding: 1px 5px; border-radius: 5px; }
.content pre { background: color-mix(in srgb, var(--text) 6%, transparent); border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-size: 14px; line-height: 1.55; }
.content pre code { background: none; padding: 0; }
.content table { border-collapse: collapse; width: 100%; margin: 0 0 1.1rem; font-size: 15px; }
.content th, .content td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
.content hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
.gate { margin-top: 8px; padding: 20px 22px; border-radius: 12px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--line)); text-align: center; }
.gate strong { display: block; font-size: 1.1rem; }
.gate p { margin: 6px 0 0; color: var(--muted); font-size: 15px; }
.extras { margin-top: 24px; }
.more { margin-top: 40px; }
.more h2 { font-size: 1.1rem; margin: 0 0 14px; }
.more .posts { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.more .card h2 { font-size: 1.05rem; }
.more .card div { padding: 16px 18px 18px; }
.back { display: inline-block; margin-bottom: 20px; font-size: 15px; text-decoration: none; }
.empty { color: var(--muted); text-align: center; padding: 48px 0; }
footer.foot { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); text-align: center; color: var(--muted); font-size: 14px; }
footer.foot p { margin: 0 0 10px; }
.social { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; margin: 0 0 12px; }
.social a { color: var(--muted); text-decoration: none; }
.social a:hover { color: var(--text); }
@media (max-width: 720px) { .lead .card { display: flex; } .lead .card img { min-height: 0; aspect-ratio: 2 / 1; } .lead .card div { padding: 20px 24px 22px; } .lead .card h2 { font-size: 1.5rem; } }
@media (max-width: 640px) { article .body { padding: 24px 20px 28px; } .card div { padding: 16px 18px 18px; } .intro h1, article h1 { font-size: 1.7rem; } .tools { margin-left: 0; width: 100%; } .search { flex: 1; } .search input { width: 100%; } }
@media print { body { background: #fff; color: #000; } article { border: 0; } .extras, .tools, .nav, .more, .pager { display: none; } }
`

/** A navigation target as an href: `/` is the blog, `/about` its page, anything else as written. */
function navHref(url: string, blogPath: string): string {
  if (url === '/') return blogPath
  return url.startsWith('/') ? `${blogPath}${url}` : url
}

type Shell = { title: string, description: string, head: string, body: string, feedUrl: string, blogPath: string, current: string, wide: boolean, q?: string }

function shell(p: BlogPageProject, config: BlogConfig, page: Shell, poweredBy: PoweredBy | null): string {
  const name = blogTitle(config, p.name)
  const design = config.design
  const logo = p.logo ? `<img src="${escapeHtml(p.logo)}" alt="" width="32" height="32">` : ''
  const nav = design.navigation.length
    ? `<nav class="nav" aria-label="Blog">${design.navigation.map((link) => {
      const href = navHref(link.url, page.blogPath)
      const external = /^https?:/.test(href)
      return `<a href="${escapeHtml(href)}"${href === page.current ? ' aria-current="page"' : ''}${external ? ' rel="noopener"' : ''}>${escapeHtml(link.label)}</a>`
    }).join('')}</nav>`
    : ''
  // rel="me" lets Mastodon verify the link back to the profile.
  const social = Object.entries(design.social).filter(([, url]) => url).map(([key, url]) => `<a href="${escapeHtml(url!)}" rel="${key === 'mastodon' ? 'me noopener' : 'noopener'}">${escapeHtml(SOCIAL_LABELS[key as BlogSocialNetwork] || key)}</a>`).join('')
  return `<!doctype html>
<html lang="en"${design.colorScheme === 'auto' ? '' : ` data-scheme="${design.colorScheme}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title === name ? name : `${page.title} · ${name}`)}</title>
${page.description ? `<meta name="description" content="${escapeHtml(page.description)}">` : ''}
<meta name="robots" content="index,follow">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(name)}" href="${escapeHtml(page.feedUrl)}">
${page.head}
<style>:root { --brand: ${p.accent}; --font: ${FONTS[design.font]}; }${CSS}</style>
</head>
<body class="${page.wide ? 'wide ' : ''}layout-${design.layout}">
<div class="wrap">
<header class="top"><a class="brand" href="${escapeHtml(page.blogPath)}">${logo}<span>${escapeHtml(name)}</span></a>${nav}<div class="tools"><form class="search" action="${escapeHtml(page.blogPath)}" method="get" role="search"><input type="search" name="q" value="${escapeHtml(page.q || '')}" placeholder="Search" aria-label="Search posts"></form><a href="${escapeHtml(page.feedUrl)}">RSS</a></div></header>
${page.body}
<footer class="foot">${social ? `<div class="social">${social}</div>` : ''}${design.footer ? `<p>${escapeHtml(design.footer)}</p>` : ''}${poweredByHtml(poweredBy)}</footer>
</div>
</body>
</html>`
}

function meta(item: BlogListItem): string {
  return [formatDate(item.publishedAt), item.authorName, `${item.readingMinutes} min read`].filter(Boolean).map(escapeHtml).join(' · ')
}

function badges(item: BlogListItem): string {
  const list = [item.featured ? 'Featured' : '', item.locked ? 'Members' : ''].filter(Boolean)
  return list.length ? `<p class="badges">${list.map(text => `<span class="badge">${text}</span>`).join('')}</p>` : ''
}

function card(post: BlogListItem): string {
  return `<a class="card" href="${escapeHtml(post.path)}">${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.coverImageAlt)}" loading="lazy">` : ''}<div>${badges(post)}<h2>${escapeHtml(post.title)}</h2><p class="meta">${meta(post)}</p>${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}</div></a>`
}

function tagList(tags: string[], blogPath: string): string {
  return tags.length ? `<ul class="tags">${tags.map(tag => `<li><a href="${escapeHtml(`${blogPath}?tag=${encodeURIComponent(tag)}`)}">${escapeHtml(tag)}</a></li>`).join('')}</ul>` : ''
}

/** Structured data for search engines; `<` escaped so nothing in it can close the tag. */
function jsonLd(data: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

export type BlogIndexView = { posts: BlogListItem[], lead: BlogListItem | null, tag: string, q: string, page: number, hasMore: boolean, blogPath: string, feedUrl: string, canonical: string }

export function renderBlogIndex(p: BlogPageProject, config: BlogConfig, view: BlogIndexView, poweredBy: PoweredBy | null): string {
  const name = blogTitle(config, p.name)
  const design = config.design
  const query = (page: number) => `${view.blogPath}?${new URLSearchParams({ ...(view.tag ? { tag: view.tag } : {}), ...(view.q ? { q: view.q } : {}), page: String(page) }).toString()}`
  const pager = view.page > 1 || view.hasMore
    ? `<nav class="pager"><span>${view.page > 1 ? `<a href="${escapeHtml(query(view.page - 1))}">← Newer</a>` : ''}</span><span>${view.hasMore ? `<a href="${escapeHtml(query(view.page + 1))}">Older →</a>` : ''}</span></nav>`
    : ''
  const filter = view.q
    ? `<p class="filter">Posts matching “${escapeHtml(view.q)}” · <a href="${escapeHtml(view.blogPath)}">All posts</a></p>`
    : view.tag ? `<p class="filter">Posts tagged “${escapeHtml(view.tag)}” · <a href="${escapeHtml(view.blogPath)}">All posts</a></p>` : ''
  const front = !view.tag && !view.q && view.page === 1
  const cover = front && design.coverImageUrl ? `<img class="hero-cover" src="${escapeHtml(design.coverImageUrl)}" alt="">` : ''
  const lead = view.lead ? `<div class="lead">${card(view.lead)}</div>` : ''
  const cards = view.posts.map(post => `<li>${card(post)}</li>`).join('')
  const empty = view.q ? 'No posts match that.' : 'Nothing here yet.'
  const body = `${cover}<div class="intro"><h1>${escapeHtml(name)}</h1>${config.description ? `<p>${escapeHtml(config.description)}</p>` : '<p></p>'}</div>${filter}${lead}${cards ? `<ul class="posts">${cards}</ul>` : lead ? '' : `<p class="empty">${empty}</p>`}${pager}`
  const head = [
    `<link rel="canonical" href="${escapeHtml(view.canonical)}">`,
    // A search result page is for the reader, not for an index.
    view.q ? '<meta name="robots" content="noindex,follow">' : '',
    `<meta property="og:title" content="${escapeHtml(name)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${escapeHtml(view.canonical)}">`,
    config.description ? `<meta property="og:description" content="${escapeHtml(config.description)}">` : '',
    design.coverImageUrl ? `<meta property="og:image" content="${escapeHtml(design.coverImageUrl)}">\n<meta name="twitter:card" content="summary_large_image">` : '',
    jsonLd({ '@context': 'https://schema.org', '@type': 'Blog', 'name': name, 'url': view.canonical, ...(config.description ? { description: config.description } : {}) })
  ].filter(Boolean).join('\n')
  // Grid and magazine need the room; a single column reads better narrow.
  return shell(p, config, { title: view.q ? `Search: ${view.q}` : name, description: config.description, head, body, feedUrl: view.feedUrl, blogPath: view.blogPath, current: view.blogPath, wide: design.layout !== 'list', q: view.q }, poweredBy)
}

export type BlogPostPageView = { blogPath: string, feedUrl: string, scriptSrc: string, blogUrl: string, related: BlogListItem[], newer: BlogListItem | null, older: BlogListItem | null, members: boolean }

export function renderBlogPost(p: BlogPageProject, config: BlogConfig, post: BlogPageView, view: BlogPostPageView, poweredBy: PoweredBy | null): string {
  const name = blogTitle(config, p.name)
  const isPage = post.type === 'page'
  const title = post.metaTitle || post.title
  const description = post.metaDescription || post.excerpt
  const image = post.ogImageUrl || post.coverImageUrl
  const head = [
    `<link rel="canonical" href="${escapeHtml(post.canonical)}">`,
    `<meta property="og:type" content="${isPage ? 'website' : 'article'}">`,
    `<meta property="og:site_name" content="${escapeHtml(name)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:url" content="${escapeHtml(post.canonical)}">`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}">` : '',
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    !isPage && post.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">` : '',
    ...(isPage ? [] : post.tags.map(tag => `<meta property="article:tag" content="${escapeHtml(tag)}">`)),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': isPage ? 'WebPage' : 'BlogPosting',
      ...(isPage ? { name: title } : { headline: title }),
      'url': post.canonical,
      'mainEntityOfPage': post.canonical,
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
      ...(!isPage && post.publishedAt ? { datePublished: post.publishedAt } : {}),
      ...(!isPage && post.authorName ? { author: { '@type': 'Person', 'name': post.authorName } } : {}),
      ...(!isPage && post.tags.length ? { keywords: post.tags.join(', ') } : {}),
      // Google's markup for content behind a sign-in, so the gate is not read as cloaking.
      ...(post.locked ? { isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', 'isAccessibleForFree': false, 'cssSelector': '.content' } } : {}),
      'publisher': { '@type': 'Organization', 'name': name, 'url': view.blogUrl, ...(p.logo ? { logo: { '@type': 'ImageObject', 'url': p.logo } } : {}) }
    })
  ].filter(Boolean).join('\n')
  // A members-only post shows its lead-in; blog.js signs the reader in and puts the body here.
  const content = post.locked
    ? `<div class="content" id="hb-blog-body">${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}<div class="gate"><strong>This post is for members</strong><p>${view.members ? 'Sign in below to read the rest.' : 'Only members can read the rest.'}</p></div></div>`
    : `<div class="content">${post.bodyHtml}</div>`
  // Reactions, comments, the sign-up form and the members sign-in: the embed, drawn under the article.
  const wantsExtras = post.locked ? view.members : !isPage && (config.reactions || (config.comments && post.commentsOpen) || config.subscribeForm)
  const extras = wantsExtras
    ? `<div id="hb-blog-extras" class="extras"></div><script src="${escapeHtml(view.scriptSrc)}" data-project="${escapeHtml(p.publicKey)}" data-post="${escapeHtml(post.slug)}" data-view="extras" data-target="#hb-blog-extras" data-accent="${escapeHtml(p.accent)}"${post.locked ? ' data-body="#hb-blog-body"' : ''} defer></script>`
    : ''
  const related = !isPage && view.related.length ? `<section class="more"><h2>Keep reading</h2><ul class="posts">${view.related.map(item => `<li>${card(item)}</li>`).join('')}</ul></section>` : ''
  const pager = !isPage && (view.newer || view.older)
    ? `<nav class="pager" aria-label="More posts"><span>${view.newer ? `<a href="${escapeHtml(view.newer.path)}" rel="next">← ${escapeHtml(view.newer.title)}</a>` : ''}</span><span>${view.older ? `<a href="${escapeHtml(view.older.path)}" rel="prev">${escapeHtml(view.older.title)} →</a>` : ''}</span></nav>`
    : ''
  const cover = post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="${escapeHtml(post.coverImageAlt)}">` : ''
  const back = isPage ? '' : `<a class="back" href="${escapeHtml(view.blogPath)}">← All posts</a>`
  const body = `${back}<article>${cover}<div class="body"><h1>${escapeHtml(post.title)}</h1>${isPage ? '' : `<p class="meta">${meta(post)}</p>`}${content}${isPage ? '' : tagList(post.tags, view.blogPath)}</div></article>${extras}${pager}${related}`
  return shell(p, config, { title, description, head, body, feedUrl: view.feedUrl, blogPath: view.blogPath, current: post.path, wide: false }, poweredBy)
}

/** Every live post and page whose canonical copy is the hosted one. */
export function renderBlogSitemap(urls: { loc: string, lastmod: string }[]): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url><loc>${escape(url.loc)}</loc>${url.lastmod ? `<lastmod>${escape(url.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`
}
