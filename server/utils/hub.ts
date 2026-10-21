import { createError, getRequestURL, getRouterParam, type H3Event } from 'h3'
import { composeHubSections, hubTitle, HUB_SECTION_TITLES, normalizeHubConfig, type HubHome, type HubHomeSection, type HubItem, type HubLink, type HubLoader, type HubSectionContent, type HubSectionView } from '#shared/hub'
import type { ProjectLook } from '#shared/projectLook'
import { brandConfigOf } from './brand'
import { getBlogConfig, listPublicBlog } from './blog'
import { changelogIsPublic, listPublicChangelogEntries } from './changelog'
import { getFeedbackConfig, listFeedbackPosts, readFeedbackListQuery } from './feedback'
import { listLegalDocuments } from './legal'
import { listOnboardingFlows } from './onboarding'
import { roadmapSourceOf } from './board'
import { findProjectByPublicKey, lookOf } from './projects'
import { LIMITS, clientIp, rateLimit } from './rateLimit'
import type { ParseObject } from './parse'

// The public hub (shared/hub.ts): one read that gathers what a project already
// publishes. /hub/<pk> draws it, GET /v1/hub/<pk> returns it, the chat widget's
// Home tab and the native and web snippets read it. A section appears only when
// its feature has something public to show, so a half-set-up project gets a
// short page rather than empty headings.

export type HubData = {
  project: { name: string, publicKey: string }
  /** Accent, logo, fonts and radius from the Brand kit (shared/projectLook.ts): draw with these to wear the project. */
  look: ProjectLook
  hub: { enabled: boolean, title: string, tagline: string, url: string }
  /** Empty while the page is off. */
  sections: HubSectionView[]
  links: HubLink[]
  /** The Home tab's data; null while `widgetHome` is off. */
  home: HubHome | null
}

/** Where this deployment is reached: APP_URL when set, else the address the request came in on. */
export function hubOrigin(event: H3Event): string {
  const configured = String(process.env.APP_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

const date = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '')

/** The project behind a public hub URL (`:pk`), after the per-IP read limit. 404 for an unknown key. */
export async function publicHubProject(event: H3Event): Promise<ParseObject> {
  await rateLimit(`sb:rl:hubread:${clientIp(event) || 'ip'}`, LIMITS.hubReadsPerIp.limit, LIMITS.hubReadsPerIp.window)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  return project
}

const paths = (origin: string, pk: string) => ({
  hub: `${origin}/hub/${encodeURIComponent(pk)}`,
  changelog: `${origin}/changelog/${encodeURIComponent(pk)}`,
  roadmap: `${origin}/roadmap/${encodeURIComponent(pk)}`,
  feedback: `${origin}/embed/feedback?pk=${encodeURIComponent(pk)}`,
  blog: `${origin}/blog/${encodeURIComponent(pk)}`,
  legal: `${origin}/legal/${encodeURIComponent(pk)}`,
  brand: `${origin}/brand/${encodeURIComponent(pk)}`
})

async function latestChangelog(project: ParseObject, limit: number) {
  if (!changelogIsPublic(project)) return []
  return (await listPublicChangelogEntries(project, { limit, skip: 0 })).entries
}

async function topFeedback(project: ParseObject, limit: number) {
  const config = getFeedbackConfig(project)
  if (!config.enabled) return null
  const ctx = { project, config, actor: { kind: 'anonymous' as const } }
  const { posts } = await listFeedbackPosts(ctx, readFeedbackListQuery({ sort: 'top', limit: String(limit) }, config))
  return posts
}

/** The hub as the project's visitors see it. `origin` is hubOrigin(event). */
export async function buildHub(project: ParseObject, origin: string): Promise<HubData> {
  const config = normalizeHubConfig(project.get('hub'))
  const look = lookOf(project)
  const pk = String(project.get('publicKey') || '')
  const url = paths(origin, pk)
  const home = config.widgetHome.enabled ? await buildHome(project, origin, config.widgetHome.sections) : null
  const hub: HubData['hub'] = { enabled: config.enabled, title: hubTitle(config, look.name), tagline: config.tagline || look.tagline, url: url.hub }
  const base = { project: { name: look.name, publicKey: pk }, look, hub, home }
  if (!config.enabled) return { ...base, sections: [], links: [] }

  const content: Partial<Record<keyof typeof HUB_SECTION_TITLES, HubSectionContent | null>> = {}
  const section = (key: keyof typeof HUB_SECTION_TITLES, part: Partial<HubSectionContent>): HubSectionContent => ({ title: HUB_SECTION_TITLES[key], url: '', text: '', items: [], action: '', ...part })

  const brand = brandConfigOf(project)
  if (brand.about) content.about = section('about', { text: brand.about })
  if (brand.page.public) content.brand = section('brand', { url: url.brand })
  content.contact = section('contact', { action: 'chat' })

  const [entries, board, roadmapFromBoard, blog, legal] = await Promise.all([
    config.sections.includes('changelog') ? latestChangelog(project, 5) : [],
    config.sections.includes('feedback') || config.sections.includes('roadmap') ? topFeedback(project, 3) : null,
    config.sections.includes('roadmap') ? roadmapSourceOf(project).then(source => source === 'board') : false,
    config.sections.includes('blog') && getBlogConfig(project).enabled ? listPublicBlog({ project, config: getBlogConfig(project), actor: { kind: 'anonymous' as const } }, { limit: 5, skip: 0 }) : null,
    config.sections.includes('legal') ? listLegalDocuments(project, true) : []
  ])

  if (entries.length) content.changelog = section('changelog', { url: url.changelog, items: entries.map<HubItem>(e => ({ title: e.title, url: url.changelog, meta: date(e.publishedAt) })) })
  const feedbackConfig = getFeedbackConfig(project)
  if (board) content.feedback = section('feedback', { url: url.feedback, items: board.map<HubItem>(post => ({ title: post.title, url: url.feedback, meta: `${post.voteCount} ${post.voteCount === 1 ? 'vote' : 'votes'}` })) })
  if (roadmapFromBoard || (feedbackConfig.enabled && feedbackConfig.roadmap)) content.roadmap = section('roadmap', { url: url.roadmap })
  if (blog?.posts.length) content.blog = section('blog', { url: url.blog, items: blog.posts.map<HubItem>(post => ({ title: post.title, url: `${url.blog}/${encodeURIComponent(post.slug)}`, meta: date(post.publishedAt) })) })
  // Each document once: a translation is reached from its original's page.
  const documents = legal.filter(row => !row.get('translationOf'))
  if (documents.length) content.legal = section('legal', { url: url.legal, items: documents.map<HubItem>(row => ({ title: String(row.get('title') || ''), url: `${url.legal}/${encodeURIComponent(String(row.get('slug') || ''))}`, meta: '' })) })

  return { ...base, sections: composeHubSections(config, content), links: config.links }
}

/** The chat widget's Home tab: the parts turned on, each only when it has something to show. */
export async function buildHome(project: ParseObject, origin: string, sections: HubHomeSection[]): Promise<HubHome> {
  const url = paths(origin, String(project.get('publicKey') || ''))
  const [entries, posts, flows] = await Promise.all([
    sections.includes('changelog') ? latestChangelog(project, 3) : [],
    sections.includes('feedback') ? topFeedback(project, 3) : null,
    sections.includes('onboarding') ? listOnboardingFlows(project) : []
  ])
  const published = flows.filter(row => row.get('status') === 'published' && row.get('published'))
  return {
    sections,
    changelog: entries.length ? { url: url.changelog, entries: entries.map(e => ({ title: e.title, summary: e.excerpt || e.summary, tag: e.tag, publishedAt: e.publishedAt, url: url.changelog })) } : null,
    feedback: posts ? { url: url.feedback, posts: posts.map(post => ({ title: post.title, votes: post.voteCount, url: url.feedback })) } : null,
    onboarding: published.length ? { flows: published.map(row => ({ key: String(row.get('key') || ''), name: String(row.get('name') || '') })) } : null
  }
}

/** What public/helpbites.js asks first: which modules this project has, so it injects only those. */
export async function buildLoader(project: ParseObject, origin: string): Promise<HubLoader> {
  const config = normalizeHubConfig(project.get('hub'))
  const pk = String(project.get('publicKey') || '')
  const flows = (await listOnboardingFlows(project)).filter(row => row.get('status') === 'published' && row.get('published')).map(row => String(row.get('key') || ''))
  return {
    project: { name: String(project.get('name') || ''), publicKey: pk },
    modules: {
      chat: { enabled: true, home: config.widgetHome.enabled },
      feedback: { enabled: getFeedbackConfig(project).enabled },
      changelog: { enabled: changelogIsPublic(project) },
      onboarding: { enabled: flows.length > 0, flows }
    },
    hub: { enabled: config.enabled, url: `${origin}/hub/${encodeURIComponent(pk)}` },
    accent: lookOf(project).accent
  }
}
