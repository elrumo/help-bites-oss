import type { BlogPost, BlogPostStatus } from '#shared/blog'

// The editor's copy of a post, and what changed against the saved one: the
// editor sends only that, so two tabs editing different fields never undo
// each other. Dates are local "YYYY-MM-DDTHH:mm" strings, what
// <input type="datetime-local"> reads and writes.

export type BlogPostDraft = {
  title: string
  body: string
  slug: string
  /** '' when the post's excerpt follows its body. */
  excerpt: string
  coverImageUrl: string
  tags: string[]
  status: BlogPostStatus
  publishedAt: string
  commentsOpen: boolean
  authorName: string
}

export function emptyBlogDraft(): BlogPostDraft {
  return { title: '', body: '', slug: '', excerpt: '', coverImageUrl: '', tags: [], status: 'draft', publishedAt: '', commentsOpen: true, authorName: '' }
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
    title: post.title,
    body: post.body,
    slug: post.slug,
    excerpt: post.excerptWritten ? post.excerpt : '',
    coverImageUrl: post.coverImageUrl,
    tags: [...post.tags],
    status: post.status,
    publishedAt: toLocalInput(post.publishedAt),
    commentsOpen: post.commentsOpen,
    authorName: post.authorName
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
  if (draft.coverImageUrl.trim() !== saved.coverImageUrl) out.coverImageUrl = draft.coverImageUrl.trim() || null
  if (draft.tags.join('\n') !== saved.tags.join('\n')) out.tags = draft.tags
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
    title: draft.title.trim(),
    body: draft.body,
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    ...(draft.excerpt.trim() ? { excerpt: draft.excerpt.trim() } : {}),
    ...(draft.coverImageUrl.trim() ? { coverImageUrl: draft.coverImageUrl.trim() } : {}),
    tags: draft.tags,
    status: draft.status,
    ...(draft.publishedAt ? { publishedAt: fromLocalInput(draft.publishedAt) } : {}),
    commentsOpen: draft.commentsOpen,
    ...(draft.authorName.trim() ? { authorName: draft.authorName.trim() } : {})
  }
}
