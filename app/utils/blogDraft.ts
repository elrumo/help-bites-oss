import type { BlogBodyFormat, BlogPost, BlogPostStatus, BlogPostType, BlogVisibility } from '#shared/blog'

// The editor's copy of a post, and what changed against the saved one: the
// editor sends only that, so two tabs editing different fields never undo
// each other. Dates are local "YYYY-MM-DDTHH:mm" strings, what
// <input type="datetime-local"> reads and writes.

export type BlogPostDraft = {
  type: BlogPostType
  title: string
  /** Markdown, or HTML for a post imported as HTML (`bodyFormat`), which the editor keeps as HTML. */
  body: string
  bodyFormat: BlogBodyFormat
  slug: string
  /** '' when the post's excerpt follows its body. */
  excerpt: string
  coverImageUrl: string
  coverImageAlt: string
  tags: string[]
  featured: boolean
  visibility: BlogVisibility
  status: BlogPostStatus
  publishedAt: string
  commentsOpen: boolean
  authorName: string
  metaTitle: string
  metaDescription: string
  ogImageUrl: string
  canonicalUrl: string
}

/** The text fields a draft trims and sends as `null` when emptied. */
const CLEARABLE = ['coverImageUrl', 'coverImageAlt', 'metaTitle', 'metaDescription', 'ogImageUrl', 'canonicalUrl'] as const

export function emptyBlogDraft(type: BlogPostType = 'post'): BlogPostDraft {
  return { type, title: '', body: '', bodyFormat: 'markdown', slug: '', excerpt: '', coverImageUrl: '', coverImageAlt: '', tags: [], featured: false, visibility: 'public', status: 'draft', publishedAt: '', commentsOpen: true, authorName: '', metaTitle: '', metaDescription: '', ogImageUrl: '', canonicalUrl: '' }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function toLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function draftFromPost(post: BlogPost): BlogPostDraft {
  return {
    type: post.type,
    title: post.title,
    body: post.body,
    bodyFormat: post.bodyFormat,
    slug: post.slug,
    excerpt: post.excerptWritten ? post.excerpt : '',
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: post.coverImageAlt,
    tags: [...post.tags],
    featured: post.featured,
    visibility: post.visibility,
    status: post.status,
    publishedAt: toLocalInput(post.publishedAt),
    commentsOpen: post.commentsOpen,
    authorName: post.authorName,
    metaTitle: post.metaTitle,
    metaDescription: post.metaDescription,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl
  }
}

/** The fields of `draft` that differ from `post`, as the PATCH body. */
export function blogPostPatch(draft: BlogPostDraft, post: BlogPost): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const saved = draftFromPost(post)
  if (draft.title.trim() && draft.title.trim() !== saved.title) out.title = draft.title.trim()
  if (draft.body !== saved.body) out.body = draft.body
  if (draft.slug.trim() && draft.slug.trim() !== saved.slug) out.slug = draft.slug.trim()
  if (draft.excerpt.trim() !== saved.excerpt) out.excerpt = draft.excerpt.trim() || null
  for (const key of CLEARABLE) if (draft[key].trim() !== saved[key]) out[key] = draft[key].trim() || null
  if (draft.tags.join('\n') !== saved.tags.join('\n')) out.tags = draft.tags
  if (draft.type !== saved.type) out.type = draft.type
  if (draft.featured !== saved.featured) out.featured = draft.featured
  if (draft.visibility !== saved.visibility) out.visibility = draft.visibility
  if (draft.status !== saved.status) out.status = draft.status
  if (draft.publishedAt !== saved.publishedAt) out.publishedAt = fromLocalInput(draft.publishedAt)
  if (draft.commentsOpen !== saved.commentsOpen) out.commentsOpen = draft.commentsOpen
  if (draft.authorName.trim() !== saved.authorName) out.authorName = draft.authorName.trim()
  return out
}

/** A new post's whole body, for the create call. */
export function blogPostCreateBody(draft: BlogPostDraft, projectId: string): Record<string, unknown> {
  return {
    project: projectId,
    type: draft.type,
    title: draft.title.trim(),
    body: draft.body,
    bodyFormat: draft.bodyFormat,
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    ...(draft.excerpt.trim() ? { excerpt: draft.excerpt.trim() } : {}),
    ...Object.fromEntries(CLEARABLE.filter(key => draft[key].trim()).map(key => [key, draft[key].trim()])),
    tags: draft.tags,
    featured: draft.featured,
    visibility: draft.visibility,
    status: draft.status,
    ...(draft.publishedAt ? { publishedAt: fromLocalInput(draft.publishedAt) } : {}),
    commentsOpen: draft.commentsOpen,
    ...(draft.authorName.trim() ? { authorName: draft.authorName.trim() } : {})
  }
}

/** What `POST /admin/blog/ai` proposes; fields a mode does not produce are empty. */
export type BlogAiResult = { body: string, title: string, excerpt: string, metaDescription: string, tags: string[], notes: string, repos: { repo: string, read: boolean }[] }
