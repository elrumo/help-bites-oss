import { createError } from 'h3'
import { DEFAULT_SETTINGS, type EmailBlock, type EmailDocument } from '#shared/email/blocks'
import { blogPostUrl } from './blog'
import { blogEmailHtml, literalBraceText } from './blogRender'
import type { CampaignSnapshot } from './campaigns'
import { escapeHtml } from './messageEmail'
import { lookOf } from './projects'
import { MASTER, useParse, type ParseObject } from './parse'

// A blog post as a campaign's email. Campaigns usually send a designed
// template; a blog campaign carries its post instead (Campaign.blogPost), and
// this builds the design from it when sending starts. The footer has what
// every campaign must: the unsubscribe link and the postal address.

/** `{{` in a post (a Vue template in a code sample) is text, not a placeholder to blank. */
function literalBraces(html: string): string {
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}

const pad = (top: number, bottom: number) => ({ top, right: 32, bottom, left: 32 })

export function blogNewsletterDocument(project: ParseObject, post: ParseObject): EmailDocument {
  const look = lookOf(project)
  const name = look.name
  const accent = look.accent
  const logo = look.logoUrl || look.iconUrl
  const title = literalBraceText(String(post.get('title') || ''))
  const cover = String(post.get('coverImageUrl') || '')
  const url = blogPostUrl(project, post)
  const date = (post.get('publishedAt') as Date | undefined) || new Date()
  const meta = `${new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(date)} · ${Number(post.get('readingMinutes') || 1)} min read`
  const blocks: (EmailBlock | null)[] = [
    logo ? { id: 'blog_logo', type: 'image', src: logo, alt: name, align: 'left', height: 32, padding: pad(28, 0) } : null,
    { id: 'blog_title', type: 'heading', text: title, level: 1, align: 'left', padding: pad(24, 4) },
    { id: 'blog_meta', type: 'text', html: escapeHtml(meta), align: 'left', fontSize: 13, color: '#71717a', padding: pad(0, 12) },
    cover ? { id: 'blog_cover', type: 'image', src: cover, alt: title, href: url, align: 'center', padding: pad(4, 12) } : null,
    { id: 'blog_body', type: 'html', html: `<div style="color:#18181b;">${literalBraces(blogEmailHtml(String(post.get('bodyHtml') || ''), accent))}</div>`, padding: pad(8, 0) },
    { id: 'blog_read', type: 'button', label: 'Read it on the blog', href: url, align: 'left', backgroundColor: accent, color: '#ffffff', radius: 8, padding: pad(8, 24) },
    { id: 'blog_rule', type: 'divider', color: '#e4e4e7', thickness: 1, padding: pad(0, 0) },
    { id: 'blog_footer', type: 'text', html: `${escapeHtml(name)} · {{project.address}}<br><a href="{{unsubscribeUrl}}">Unsubscribe</a> · <a href="{{preferencesUrl}}">Email preferences</a>`, align: 'center', fontSize: 12, color: '#71717a', padding: pad(16, 28) }
  ]
  return {
    settings: { ...DEFAULT_SETTINGS, title, preheader: String(post.get('excerpt') || '').slice(0, 150) },
    blocks: blocks.filter((block): block is EmailBlock => block !== null)
  }
}

/** What a blog campaign sends: built from its post, which must still exist. */
export async function blogNewsletterSnapshot(project: ParseObject, postId: string): Promise<CampaignSnapshot> {
  const post = await new (useParse()).Query('BlogPost').equalTo('project', project).equalTo('objectId', postId).first(MASTER)
  if (!post) throw createError({ statusCode: 400, statusMessage: 'The blog post this campaign sends was deleted' })
  return { document: blogNewsletterDocument(project, post), defaults: {}, templateId: '', templateKey: 'blog', templateName: `Blog: ${String(post.get('title') || '')}` }
}
