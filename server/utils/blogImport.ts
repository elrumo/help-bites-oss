import { createError } from 'h3'
import {
  BLOG_BODY_MAX_LENGTH,
  BLOG_EXCERPT_MAX_LENGTH,
  BLOG_META_DESCRIPTION_MAX_LENGTH,
  BLOG_META_TITLE_MAX_LENGTH,
  BLOG_TAG_MAX_LENGTH,
  BLOG_TAGS_MAX,
  BLOG_TITLE_MAX_LENGTH
} from '#shared/blog'
import { safeHttpUrl } from '#shared/support'

// Moving a blog over from Ghost: its JSON export (Settings → Advanced →
// Export content) becomes posts and pages here, with their HTML, tags,
// author, dates, cover, SEO fields, featured flag and visibility. The HTML is
// kept as HTML (`bodyFormat: "html"`) and goes through the same sanitiser as
// anything written here. Members are a CSV of their own (Members → Export),
// which the Contacts import reads.

/** A Ghost export is one file; a blog bigger than this imports in parts (export by date in Ghost, or use the API). */
export const GHOST_IMPORT_MAX_POSTS = 2000

type Row = Record<string, unknown>

/** One post as it goes to createBlogPost/updateBlogPost. */
export type GhostPostInput = { ghostId: string, payload: Record<string, unknown> }

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => !!row && typeof row === 'object') : []
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * The export's posts, as this blog's input. `siteUrl` is the Ghost site's
 * address: the export writes its own links and images as `__GHOST_URL__/…`.
 * Ghost's `paid` and `tiers` visibilities have no match here and become
 * members-only; email-only posts (`sent`) come in as drafts.
 */
export function readGhostExport(raw: unknown, siteUrl = ''): { posts: GhostPostInput[], warnings: string[] } {
  const file = (raw && typeof raw === 'object' ? raw : {}) as Row
  // `{ db: [{ data }] }` from the admin, `{ data }` from older versions.
  const db = rows(file.db)[0] || file
  const data = (db.data && typeof db.data === 'object' ? db.data : null) as Row | null
  if (!data || !Array.isArray(data.posts)) throw createError({ statusCode: 400, statusMessage: 'This is not a Ghost export: expected the .json file from Settings → Advanced → Export content' })

  const base = String(siteUrl || '').trim().replace(/\/+$/, '')
  const warnings: string[] = []
  let unresolved = 0
  const resolve = (value: unknown) => {
    const url = String(value ?? '')
    if (!url.includes('__GHOST_URL__')) return url
    if (!base) unresolved++
    return url.split('__GHOST_URL__').join(base)
  }

  const tagNames = new Map(rows(data.tags).map(tag => [String(tag.id), String(tag.name || '')]))
  const userNames = new Map(rows(data.users).map(user => [String(user.id), String(user.name || '')]))
  const tagsOf = new Map<string, string[]>()
  for (const link of rows(data.posts_tags).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const name = tagNames.get(String(link.tag_id)) || ''
    // `#hidden` and the like are Ghost's internal tags, for themes.
    if (!name || name.startsWith('#')) continue
    tagsOf.set(String(link.post_id), [...(tagsOf.get(String(link.post_id)) || []), name])
  }
  const authorOf = new Map<string, string>()
  for (const link of rows(data.posts_authors).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    if (!authorOf.has(String(link.post_id))) authorOf.set(String(link.post_id), userNames.get(String(link.author_id)) || '')
  }
  const metaOf = new Map(rows(data.posts_meta).map(meta => [String(meta.post_id), meta]))

  const all = rows(data.posts)
  if (all.length > GHOST_IMPORT_MAX_POSTS) throw createError({ statusCode: 413, statusMessage: `At most ${GHOST_IMPORT_MAX_POSTS} posts per import; this export has ${all.length}` })
  let paid = 0
  const posts: GhostPostInput[] = []
  for (const post of all) {
    const id = String(post.id || '')
    const title = text(post.title, BLOG_TITLE_MAX_LENGTH) || '(untitled)'
    const html = resolve(post.html) || (typeof post.plaintext === 'string' ? post.plaintext.split(/\n{2,}/).map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('') : '')
    if (!id) continue
    if (html.length > BLOG_BODY_MAX_LENGTH) { warnings.push(`“${title}” is longer than ${BLOG_BODY_MAX_LENGTH.toLocaleString('en')} characters and was skipped`); continue }
    // Ghost 5 keeps SEO fields in posts_meta; older exports on the post itself.
    const meta = { ...post, ...(metaOf.get(id) || {}) }
    const status = String(post.status || 'draft')
    const visibility = String(post.visibility || 'public')
    if (visibility === 'paid' || visibility === 'tiers') paid++
    const published = status === 'published' || status === 'scheduled'
    const tags = (tagsOf.get(id) || []).map(tag => tag.slice(0, BLOG_TAG_MAX_LENGTH)).slice(0, BLOG_TAGS_MAX)
    posts.push({
      ghostId: id,
      payload: {
        type: post.type === 'page' ? 'page' : 'post',
        title,
        slug: text(post.slug, 120),
        body: html,
        bodyFormat: 'html',
        excerpt: text(post.custom_excerpt, BLOG_EXCERPT_MAX_LENGTH),
        coverImageUrl: safeHttpUrl(resolve(post.feature_image)),
        coverImageAlt: text(meta.feature_image_alt, 300),
        tags,
        featured: post.featured === true || post.featured === 1,
        visibility: visibility === 'public' ? 'public' : 'members',
        status: published ? 'published' : 'draft',
        ...(post.published_at ? { publishedAt: new Date(String(post.published_at)).toISOString() } : {}),
        metaTitle: text(meta.meta_title, BLOG_META_TITLE_MAX_LENGTH),
        metaDescription: text(meta.meta_description, BLOG_META_DESCRIPTION_MAX_LENGTH),
        ogImageUrl: safeHttpUrl(resolve(meta.og_image)),
        canonicalUrl: safeHttpUrl(post.canonical_url),
        ...(authorOf.get(id) ? { authorName: authorOf.get(id) } : {})
      }
    })
  }
  if (paid) warnings.push(`${paid} paid or tier-only ${paid === 1 ? 'post is' : 'posts are'} members-only here: there are no paid tiers`)
  if (unresolved) warnings.push('Links and images pointing at your Ghost site were dropped: pass its address (siteUrl) to keep them')
  return { posts, warnings }
}

export type GhostImportResult = { created: number, updated: number, skipped: number, warnings: string[] }

/**
 * Import a Ghost export into a project's blog. A post imported before (matched
 * by its Ghost id) is skipped, or overwritten with `update`. Quiet: no
 * webhooks, and nothing is emailed. One post that fails does not stop the rest.
 */
export async function importGhostExport(project: ParseObject, agent: ParseObject | null, raw: unknown, options: { siteUrl?: string, update?: boolean } = {}): Promise<GhostImportResult> {
  const { posts, warnings } = readGhostExport(raw, options.siteUrl)
  const result: GhostImportResult = { created: 0, updated: 0, skipped: 0, warnings }
  const Parse = useParse()
  const ids = posts.map(post => `ghost:${post.ghostId}`)
  const existing = new Map<string, ParseObject>()
  for (let i = 0; i < ids.length; i += 500) {
    const found = await new Parse.Query('BlogPost').equalTo('project', project).containedIn('externalId', ids.slice(i, i + 500)).limit(500).find(MASTER)
    for (const row of found) existing.set(String(row.get('externalId')), row)
  }
  for (const post of posts) {
    const key = `ghost:${post.ghostId}`
    try {
      const row = existing.get(key)
      if (row && !options.update) { result.skipped++; continue }
      if (row) {
        await updateBlogPost(project, row, post.payload, { quiet: true })
        result.updated++
      } else {
        const created = await createBlogPost(project, agent, post.payload, { quiet: true, externalId: key })
        existing.set(key, created)
        result.created++
      }
    } catch (error) {
      result.skipped++
      warnings.push(`“${String(post.payload.title)}”: ${(error as { statusMessage?: string }).statusMessage || (error as Error).message}`)
    }
  }
  return result
}
