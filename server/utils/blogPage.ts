import { blogTitle, type BlogConfig } from '#shared/blog'
import { poweredByHtml, type PoweredBy } from './branding'
import { escapeHtml } from './messageEmail'

// The hosted blog at /blog/<pk>, as plain server-rendered HTML in the style of
// legalPage.ts: readable without JavaScript and by crawlers, and meant to be
// indexed. The one script is blog.js under a post, for its reactions,
// comments and sign-up (the same embed a host site uses). All text is
// escaped here; `bodyHtml` is the one raw value, sanitised when it was saved.

export type BlogPageProject = { name: string, publicKey: string, accent: string, logo: string }
export type BlogListItem = { title: string, path: string, excerpt: string, coverImageUrl: string, publishedAt: string, readingMinutes: number, tags: string[], authorName: string }
export type BlogPageView = BlogListItem & { bodyHtml: string, canonical: string, commentsOpen: boolean }

export function blogPageProject(project: ParseObject): BlogPageProject {
  const theme = (project.get('theme') || {}) as { accent?: string }
  return {
    name: String(project.get('name') || ''),
    publicKey: String(project.get('publicKey') || ''),
    accent: /^#[0-9a-f]{6}$/i.test(String(theme.accent || '')) ? String(theme.accent) : '#4f46e5',
    logo: [String(project.get('brandLogoUrl') || ''), String(project.get('iconUrl') || '')].find(url => /^https?:\/\//.test(url)) || ''
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

const CSS = `
:root { --accent: var(--brand); --bg: #fafafa; --card: #fff; --text: #1c1c21; --muted: #62626d; --line: #e6e6ea; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --card: #19191c; --text: #ececf0; --muted: #a2a2ad; --line: #2b2b31; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
a { color: var(--accent); text-underline-offset: 2px; }
.wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
.top { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; font-weight: 600; font-size: 15px; }
.top a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 12px; }
.top img { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; }
.top .rss { margin-left: auto; font-weight: 500; color: var(--muted); font-size: 14px; }
.intro h1 { font-size: 2.2rem; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.02em; }
.intro p { margin: 0 0 32px; color: var(--muted); }
.posts { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.card { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; color: inherit; text-decoration: none; transition: border-color .15s ease; }
.card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.card img { display: block; width: 100%; aspect-ratio: 2 / 1; object-fit: cover; background: var(--line); }
.card div { padding: 20px 24px 22px; }
.card h2 { font-size: 1.3rem; line-height: 1.3; margin: 0 0 6px; letter-spacing: -0.01em; }
.card p { margin: 8px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
.meta { color: var(--muted); font-size: 14px; margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; padding: 0; list-style: none; }
.tags a { display: inline-block; font-size: 13px; line-height: 1; padding: 6px 10px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 10%, transparent); text-decoration: none; }
.filter { margin: -16px 0 24px; font-size: 14px; color: var(--muted); }
.pager { display: flex; justify-content: space-between; margin-top: 28px; font-size: 15px; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
article > img { display: block; width: 100%; max-height: 420px; object-fit: cover; }
article .body { padding: 36px 44px 40px; }
article h1 { font-size: 2.2rem; line-height: 1.15; margin: 0 0 10px; letter-spacing: -0.02em; }
article .meta { margin-bottom: 28px; }
.content h2 { font-size: 1.45rem; line-height: 1.3; margin: 2.2rem 0 0.6rem; letter-spacing: -0.01em; }
.content h3 { font-size: 1.2rem; line-height: 1.35; margin: 1.8rem 0 0.5rem; }
.content h4 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
.content p, .content ul, .content ol, .content figure { margin: 0 0 1.1rem; }
.content li { margin: 0.3rem 0; }
.content img { max-width: 100%; height: auto; border-radius: 10px; }
.content figcaption { text-align: center; color: var(--muted); font-size: 14px; margin-top: 6px; }
.content blockquote { margin: 0 0 1.1rem; padding-left: 16px; border-left: 3px solid var(--accent); color: var(--muted); }
.content code { font-size: 0.88em; background: color-mix(in srgb, var(--text) 8%, transparent); padding: 1px 5px; border-radius: 5px; }
.content pre { background: color-mix(in srgb, var(--text) 6%, transparent); border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-size: 14px; line-height: 1.55; }
.content pre code { background: none; padding: 0; }
.content table { border-collapse: collapse; width: 100%; margin: 0 0 1.1rem; font-size: 15px; }
.content th, .content td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
.content hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
.extras { margin-top: 24px; }
.back { display: inline-block; margin-bottom: 20px; font-size: 15px; text-decoration: none; }
.empty { color: var(--muted); text-align: center; padding: 48px 0; }
footer.foot { margin-top: 32px; text-align: center; color: var(--muted); font-size: 14px; }
@media (max-width: 640px) { article .body { padding: 24px 20px 28px; } .card div { padding: 16px 18px 18px; } .intro h1, article h1 { font-size: 1.7rem; } }
@media print { body { background: #fff; color: #000; } article { border: 0; } .extras, .top .rss { display: none; } }
`

function shell(p: BlogPageProject, config: BlogConfig, page: { title: string, description: string, head: string, body: string, feedUrl: string, blogPath: string }, poweredBy: PoweredBy | null): string {
  const name = blogTitle(config, p.name)
  const logo = p.logo ? `<img src="${escapeHtml(p.logo)}" alt="" width="32" height="32">` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title === name ? name : `${page.title} · ${name}`)}</title>
${page.description ? `<meta name="description" content="${escapeHtml(page.description)}">` : ''}
<meta name="robots" content="index,follow">
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(name)}" href="${escapeHtml(page.feedUrl)}">
${page.head}
<style>:root { --brand: ${p.accent}; }${CSS}</style>
</head>
<body>
<div class="wrap">
<div class="top"><a href="${escapeHtml(page.blogPath)}">${logo}<span>${escapeHtml(name)}</span></a><a class="rss" href="${escapeHtml(page.feedUrl)}">RSS</a></div>
${page.body}
<footer class="foot">${poweredByHtml(poweredBy)}</footer>
</div>
</body>
</html>`
}

function meta(item: BlogListItem): string {
  return [formatDate(item.publishedAt), item.authorName, `${item.readingMinutes} min read`].filter(Boolean).map(escapeHtml).join(' · ')
}

function tagList(tags: string[], blogPath: string): string {
  return tags.length ? `<ul class="tags">${tags.map(tag => `<li><a href="${escapeHtml(`${blogPath}?tag=${encodeURIComponent(tag)}`)}">${escapeHtml(tag)}</a></li>`).join('')}</ul>` : ''
}

export function renderBlogIndex(p: BlogPageProject, config: BlogConfig, view: { posts: BlogListItem[], tag: string, page: number, hasMore: boolean, blogPath: string, feedUrl: string, canonical: string }, poweredBy: PoweredBy | null): string {
  const name = blogTitle(config, p.name)
  const cards = view.posts.map(post => `<li><a class="card" href="${escapeHtml(post.path)}">${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="" loading="lazy">` : ''}<div><h2>${escapeHtml(post.title)}</h2><p class="meta">${meta(post)}</p>${post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : ''}</div></a></li>`).join('')
  const query = (page: number) => `${view.blogPath}?${new URLSearchParams({ ...(view.tag ? { tag: view.tag } : {}), page: String(page) }).toString()}`
  const pager = view.page > 1 || view.hasMore
    ? `<nav class="pager"><span>${view.page > 1 ? `<a href="${escapeHtml(query(view.page - 1))}">← Newer</a>` : ''}</span><span>${view.hasMore ? `<a href="${escapeHtml(query(view.page + 1))}">Older →</a>` : ''}</span></nav>`
    : ''
  const filter = view.tag ? `<p class="filter">Posts tagged “${escapeHtml(view.tag)}” · <a href="${escapeHtml(view.blogPath)}">All posts</a></p>` : ''
  const body = `<div class="intro"><h1>${escapeHtml(name)}</h1>${config.description ? `<p>${escapeHtml(config.description)}</p>` : '<p></p>'}</div>${filter}${cards ? `<ul class="posts">${cards}</ul>` : '<p class="empty">Nothing here yet.</p>'}${pager}`
  return shell(p, config, { title: name, description: config.description, head: `<link rel="canonical" href="${escapeHtml(view.canonical)}">\n<meta property="og:title" content="${escapeHtml(name)}">\n<meta property="og:type" content="website">`, body, feedUrl: view.feedUrl, blogPath: view.blogPath }, poweredBy)
}

export function renderBlogPost(p: BlogPageProject, config: BlogConfig, post: BlogPageView, view: { blogPath: string, feedUrl: string, scriptSrc: string }, poweredBy: PoweredBy | null): string {
  const head = [
    `<link rel="canonical" href="${escapeHtml(post.canonical)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${escapeHtml(post.title)}">`,
    post.excerpt ? `<meta property="og:description" content="${escapeHtml(post.excerpt)}">` : '',
    post.coverImageUrl ? `<meta property="og:image" content="${escapeHtml(post.coverImageUrl)}">\n<meta name="twitter:card" content="summary_large_image">` : '',
    post.publishedAt ? `<meta property="article:published_time" content="${escapeHtml(post.publishedAt)}">` : ''
  ].filter(Boolean).join('\n')
  // Reactions, comments and the sign-up form: the embed, drawn under the article.
  const extras = config.reactions || (config.comments && post.commentsOpen) || config.subscribeForm
    ? `<div id="hb-blog-extras" class="extras"></div><script src="${escapeHtml(view.scriptSrc)}" data-project="${escapeHtml(p.publicKey)}" data-post="${escapeHtml(post.path.split('/').pop() || '')}" data-view="extras" data-target="#hb-blog-extras" data-accent="${escapeHtml(p.accent)}" defer></script>`
    : ''
  const body = `<a class="back" href="${escapeHtml(view.blogPath)}">← All posts</a><article>${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="">` : ''}<div class="body"><h1>${escapeHtml(post.title)}</h1><p class="meta">${meta(post)}</p><div class="content">${post.bodyHtml}</div>${tagList(post.tags, view.blogPath)}</div></article>${extras}`
  return shell(p, config, { title: post.title, description: post.excerpt, head, body, feedUrl: view.feedUrl, blogPath: view.blogPath }, poweredBy)
}
