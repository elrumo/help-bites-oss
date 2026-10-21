import { randomUUID } from 'node:crypto'
import { createError, getQuery, getRequestURL, getRouterParam, type H3Event } from 'h3'
import {
  CMS_LIMITS, CMS_SLUG, DEFAULT_STYLE, contentTooLarge, newBlock, normalizeBrief, normalizeComponentInput, normalizeContent, normalizeSettings,
  normalizeStyle, validPreviewUrl, type CmsBlock, type CmsComponentDef, type CmsLibrary, type CmsSettings, type CmsStyle
} from '#shared/cms/content'
import { BUILTIN_COMPONENTS, BUILTIN_KEYS, libraryOf, templateContent } from '#shared/cms/library'
import { pageCsp, renderBlocks, renderPage } from '#shared/cms/render'

// Pages and the headless CMS: the store behind /v1/admin/cms (the management
// API the panel uses too), the delivery API (/v1/cms/{pk}) and the hosted
// pages (/p/{pk}/{slug}). An entry keeps a working copy and, once published, a
// frozen `published` copy with a version number: edits never reach visitors
// until the next publish. Built-in components live in shared/cms/library.ts;
// CmsComponent rows are a project's own.

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** The project an operator names with `?project=` (or `project` in a JSON body). */
export async function cmsProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

/** Where this HelpBites answers, as the browser sees it: forms post here, pages load Motion from here. */
export function cmsHost(event: H3Event): string {
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

// ---- components ------------------------------------------------------------------

export async function getCmsComponent(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('CmsComponent').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Component not found' })
  }
}

export async function scopedCmsComponent(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.cmsComponent(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listCmsComponents(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('CmsComponent').equalTo('project', project).ascending('name').limit(CMS_LIMITS.components).find(MASTER)
}

export function cmsComponentDef(row: ParseObject): CmsComponentDef {
  return {
    id: row.id || '',
    key: String(row.get('key') || ''),
    name: String(row.get('name') || ''),
    description: String(row.get('description') || ''),
    root: row.get('root') === true,
    nestable: row.get('nestable') !== false,
    fields: Array.isArray(row.get('fields')) ? row.get('fields') : [],
    html: String(row.get('html') || ''),
    css: String(row.get('css') || ''),
    updatedAt: iso(row.updatedAt) || undefined
  }
}

/** The built-ins and the project's own components, by key. */
export async function cmsLibrary(project: ParseObject): Promise<CmsLibrary> {
  return libraryOf((await listCmsComponents(project)).map(cmsComponentDef))
}

/** Every component the project can use: built-ins first. */
export async function cmsComponentList(project: ParseObject): Promise<CmsComponentDef[]> {
  return [...BUILTIN_COMPONENTS, ...(await listCmsComponents(project)).map(cmsComponentDef)]
}

async function findComponentByKey(project: ParseObject, key: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('CmsComponent').equalTo('project', project).equalTo('key', key).first(MASTER) || null
}

export async function saveCmsComponent(project: ParseObject, body: Record<string, unknown>, row?: ParseObject): Promise<ParseObject> {
  const current = row ? cmsComponentDef(row) : null
  const result = normalizeComponentInput(current ? { ...current, ...body } : body, BUILTIN_KEYS)
  if (!result.ok) badRequest(result.error)
  const taken = await findComponentByKey(project, result.value.key)
  if (taken && taken.id !== row?.id) throw createError({ statusCode: 409, statusMessage: `Another component already uses the key "${result.value.key}"` })
  if (!row) {
    const count = await new (useParse()).Query('CmsComponent').equalTo('project', project).count(MASTER)
    if (count >= CMS_LIMITS.components) badRequest(`A project has at most ${CMS_LIMITS.components} components`)
    row = new (useParse().Object.extend('CmsComponent'))() as ParseObject
    row.set('project', project)
  }
  for (const [k, v] of Object.entries(result.value)) row.set(k, v)
  await row.save(null, MASTER)
  return row
}

// ---- entries ---------------------------------------------------------------------

export async function getCmsEntry(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('CmsEntry').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  }
}

export async function scopedCmsEntry(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.cmsEntry(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listCmsEntries(project: ParseObject, type?: string): Promise<ParseObject[]> {
  const query = new (useParse()).Query('CmsEntry').equalTo('project', project).descending('updatedAt').limit(CMS_LIMITS.entries)
  if (type) query.equalTo('type', type)
  return await query.find(MASTER)
}

async function findEntryBySlug(project: ParseObject, slug: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('CmsEntry').equalTo('project', project).equalTo('slug', slug).first(MASTER) || null
}

export function cmsSlugFrom(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

type Snapshot = { name: string, slug: string, content: CmsBlock, style: CmsStyle }

function publishedOf(row: ParseObject): Snapshot | null {
  const raw = row.get('published') as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object' || !raw.content) return null
  return { name: String(raw.name || ''), slug: String(raw.slug || ''), content: raw.content as CmsBlock, style: normalizeStyle(raw.style) }
}

const workingOf = (row: ParseObject): Snapshot => ({
  name: String(row.get('name') || ''),
  slug: String(row.get('slug') || ''),
  content: (row.get('content') || {}) as CmsBlock,
  style: normalizeStyle(row.get('style'))
})

/** Where a page is served: /p/<pk> for `home`, /p/<pk>/<slug> otherwise. */
export function cmsPagePath(project: ParseObject, slug: string): string {
  const pk = encodeURIComponent(String(project.get('publicKey') || ''))
  return slug === 'home' ? `/p/${pk}` : `/p/${pk}/${slug}`
}

export function serializeCmsEntry(project: ParseObject, row: ParseObject, full = true) {
  const working = workingOf(row)
  const published = publishedOf(row)
  const status = row.get('status') === 'published' && published ? 'published' : 'draft'
  return {
    id: row.id || '',
    name: working.name,
    slug: working.slug,
    type: String(row.get('type') || 'page'),
    status,
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    /** The working copy differs from what visitors get. */
    changed: status === 'published' && JSON.stringify({ ...working }) !== JSON.stringify(published),
    ...(full ? { content: working.content, style: working.style } : {}),
    path: cmsPagePath(project, working.slug),
    publishedAt: iso(row.get('publishedAt')),
    updatedAt: iso(row.updatedAt)
  }
}

export type CmsEntryView = ReturnType<typeof serializeCmsEntry>

/** Applies a create or PATCH body; only the keys sent change. Returns what normalizing the content changed. */
async function applyEntryInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>, library: CmsLibrary): Promise<string[]> {
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > CMS_LIMITS.name) badRequest(`name is 1 to ${CMS_LIMITS.name} characters`)
    row.set('name', name)
  }
  if (body.slug !== undefined) {
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '') : ''
    if (!CMS_SLUG.test(slug) || slug.length > CMS_LIMITS.slug) badRequest('slug is lowercase words and dashes, with / between folders (blog/hello-world); home is the site\'s root')
    const taken = await findEntryBySlug(project, slug)
    if (taken && taken.id !== row.id) throw createError({ statusCode: 409, statusMessage: `Another entry already uses the slug "${slug}"` })
    row.set('slug', slug)
  }
  if (body.style !== undefined) row.set('style', normalizeStyle(body.style, normalizeStyle(row.get('style'))))
  if (body.content === undefined) return []
  const { content, issues } = normalizeContent(body.content, library, String(row.get('type') || 'page'))
  if (contentTooLarge(content)) throw createError({ statusCode: 413, statusMessage: `An entry's content is at most ${CMS_LIMITS.contentBytes / 1000} KB` })
  row.set('content', content)
  return issues
}

export async function createCmsEntry(project: ParseObject, body: Record<string, unknown>): Promise<{ row: ParseObject, issues: string[] }> {
  const count = await new (useParse()).Query('CmsEntry').equalTo('project', project).count(MASTER)
  if (count >= CMS_LIMITS.entries) badRequest(`A project has at most ${CMS_LIMITS.entries} entries`)
  const library = await cmsLibrary(project)
  const type = typeof body.type === 'string' && body.type ? body.type : 'page'
  const root = library.get(type)
  if (!root?.root) badRequest(`"${type}" is not an entry type; pick a component marked as root`)

  let start: { content: CmsBlock, style: Partial<CmsStyle> } = { content: newBlock(root), style: {} }
  if (typeof body.template === 'string' && body.template) {
    if (type !== 'page') badRequest('Templates are pages; leave type out or set it to page')
    start = templateContent(body.template, String(project.get('name') || '')) || badRequest(`There is no template "${body.template}"`)
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, CMS_LIMITS.name) : String(start.content.title || root.name)
  const row = new (useParse().Object.extend('CmsEntry'))() as ParseObject
  row.set('project', project)
  row.set('type', type)
  row.set('status', 'draft')
  row.set('version', 0)
  row.set('name', name.slice(0, CMS_LIMITS.name))
  row.set('style', normalizeStyle({ ...DEFAULT_STYLE, ...start.style }))
  // A slug made from the name gets a number until it is free; one sent explicitly must be free.
  if (body.slug === undefined) {
    const base = (await listCmsEntries(project)).length ? cmsSlugFrom(name) : 'home'
    let slug = base
    for (let n = 2; await findEntryBySlug(project, slug); n++) slug = `${base.slice(0, 56)}-${n}`
    row.set('slug', slug)
  }
  const issues = await applyEntryInput(project, row, { content: start.content, ...body, name: undefined }, library)
  await row.save(null, MASTER)
  return { row, issues }
}

export async function updateCmsEntry(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<string[]> {
  if (body.type !== undefined && body.type !== row.get('type')) badRequest('An entry keeps its type; create a new entry for another type')
  const issues = await applyEntryInput(project, row, body, await cmsLibrary(project))
  await row.save(null, MASTER)
  return issues
}

export async function publishCmsEntry(project: ParseObject, row: ParseObject): Promise<void> {
  row.set('published', workingOf(row))
  row.set('version', (typeof row.get('version') === 'number' ? row.get('version') as number : 0) + 1)
  row.set('status', 'published')
  row.set('publishedAt', new Date())
  await row.save(null, MASTER)
  await emitDomainEvent(project, 'cms.entry.published', { entry: { id: row.id, slug: row.get('slug'), type: row.get('type'), version: row.get('version'), publishedAt: iso(row.get('publishedAt')) } })
}

/** Visitors get a 404; the published copy is kept for the next publish to replace. */
export async function unpublishCmsEntry(project: ParseObject, row: ParseObject): Promise<void> {
  row.set('status', 'draft')
  await row.save(null, MASTER)
  await emitDomainEvent(project, 'cms.entry.unpublished', { entry: { id: row.id, slug: row.get('slug'), type: row.get('type') } })
}

// ---- settings --------------------------------------------------------------------

export const cmsSettingsOf = (project: ParseObject): CmsSettings => normalizeSettings(project.get('cms'))

export async function saveCmsSettings(project: ParseObject, body: Record<string, unknown>): Promise<CmsSettings> {
  const current = cmsSettingsOf(project)
  if (body.previewUrl !== undefined && !validPreviewUrl(body.previewUrl)) badRequest('previewUrl is an http(s) URL; {slug} in it becomes the entry\'s slug')
  const next: CmsSettings = {
    previewUrl: body.previewUrl !== undefined ? String(body.previewUrl) : current.previewUrl,
    brief: body.brief !== undefined ? normalizeBrief(body.brief, current.brief) : current.brief
  }
  project.set('cms', next)
  await project.save(null, MASTER)
  forgetProject(String(project.get('publicKey') || ''))
  return next
}

// ---- assets ----------------------------------------------------------------------

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm'
}

/** The file's real type from its bytes: a brand kit's types, plus MP4 and WebM video; '' for anything else. */
export function detectCmsMime(data: Buffer): string {
  const brand = detectBrandMime(data)
  if (brand) return brand
  if (data.length > 12 && data.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4'
  if (data.length > 4 && data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) return 'video/webm'
  return ''
}

export async function getCmsAsset(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('CmsAsset').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
}

export async function scopedCmsAsset(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.cmsAsset(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listCmsAssets(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('CmsAsset').equalTo('project', project).descending('createdAt').limit(CMS_LIMITS.assets).find(MASTER)
}

/** An asset as an entry's asset field stores it (`{ id, url, alt, mime, width, height }`), plus its name and size. */
export function serializeCmsAsset(row: ParseObject) {
  return {
    id: row.id || '',
    name: String(row.get('name') || ''),
    alt: String(row.get('alt') || ''),
    url: String(row.get('url') || ''),
    mime: String(row.get('mime') || ''),
    size: Number(row.get('size') || 0),
    ...(row.get('width') ? { width: Number(row.get('width')), height: Number(row.get('height')) } : {}),
    createdAt: iso(row.createdAt)
  }
}

const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().replace(/[\r\n\t]+/g, ' ').slice(0, max) : ''

export async function createCmsAsset(project: ParseObject, workspaceId: string, file: UploadedFile, fields: Record<string, string>): Promise<ParseObject> {
  if (file.data.length > CMS_LIMITS.assetBytes) throw createError({ statusCode: 413, statusMessage: `A file is at most ${CMS_LIMITS.assetBytes / 1024 / 1024} MB` })
  const mime = detectCmsMime(file.data)
  if (!mime) throw createError({ statusCode: 415, statusMessage: 'Pages take PNG, JPEG, GIF, WebP, SVG, ICO, PDF, MP4 and WebM files' })
  if (mime === 'image/svg+xml' && svgIsActive(file.data)) throw createError({ statusCode: 415, statusMessage: 'This SVG contains scripts or embedded content; export it again as a plain SVG' })
  const count = await new (useParse()).Query('CmsAsset').equalTo('project', project).count(MASTER)
  if (count >= CMS_LIMITS.assets) badRequest(`A project holds at most ${CMS_LIMITS.assets} files`)

  const size = mime.startsWith('image/') ? imageSize(file.data, mime) : null
  const key = `${project.id}/cms/${randomUUID()}.${EXT[mime]}`
  const url = await storePublicFile(key, file.data, mime, workspaceId)
  const row = new (useParse().Object.extend('CmsAsset'))() as ParseObject
  row.set('project', project)
  row.set('name', cleanText(fields.name, CMS_LIMITS.assetName) || file.filename.replace(/\.[a-z0-9]+$/i, '').slice(0, CMS_LIMITS.assetName) || 'File')
  row.set('alt', cleanText(fields.alt, CMS_LIMITS.alt))
  row.set('storageKey', key)
  row.set('url', url)
  row.set('mime', mime)
  row.set('size', file.data.length)
  if (size) {
    row.set('width', size.width)
    row.set('height', size.height)
  }
  try {
    await row.save(null, MASTER)
  } catch (error) {
    await deleteDocumentObject(key)
    await chargeUsage(workspaceId, 'storageBytes', -file.data.length)
    throw error
  }
  return row
}

export async function updateCmsAsset(row: ParseObject, body: Record<string, unknown>): Promise<void> {
  if (body.name !== undefined) {
    const name = cleanText(body.name, CMS_LIMITS.assetName)
    if (!name) badRequest('name cannot be empty')
    row.set('name', name)
  }
  if (body.alt !== undefined) {
    if (typeof body.alt !== 'string') badRequest('alt must be text')
    row.set('alt', cleanText(body.alt, CMS_LIMITS.alt))
  }
  await row.save(null, MASTER)
}

/** Pages that use the file keep its URL and show it broken from then on. */
export async function deleteCmsAsset(row: ParseObject, workspaceId: string): Promise<void> {
  await row.destroy(MASTER)
  await deleteDocumentObject(String(row.get('storageKey') || ''))
  await chargeUsage(workspaceId, 'storageBytes', -Number(row.get('size') || 0))
}

// ---- public reads ----------------------------------------------------------------

/** The project behind a public CMS URL (`:pk`), after the per-IP read limit; 404 when there is none. */
export async function cmsPublicProject(event: H3Event): Promise<ParseObject> {
  await rateLimit(`sb:rl:cmsread:${clientIp(event) || 'ip'}`, LIMITS.cmsReadsPerIp.limit, LIMITS.cmsReadsPerIp.window)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  return project
}

/** A published entry by slug, or null. */
export async function publishedCmsEntry(project: ParseObject, slug: string): Promise<ParseObject | null> {
  const clean = slug.toLowerCase().replace(/^\/+|\/+$/g, '') || 'home'
  if (!CMS_SLUG.test(clean)) return null
  const row = await findEntryBySlug(project, clean)
  return row && row.get('status') === 'published' && publishedOf(row) ? row : null
}

/** What the delivery API returns for a published entry. */
export function toPublicCmsEntry(row: ParseObject) {
  const snapshot = publishedOf(row)!
  return {
    id: row.id || '',
    slug: String(row.get('slug') || ''),
    name: snapshot.name,
    type: String(row.get('type') || 'page'),
    version: Number(row.get('version') || 0),
    content: snapshot.content,
    style: snapshot.style,
    publishedAt: iso(row.get('publishedAt'))
  }
}

export async function listPublishedCmsEntries(project: ParseObject, options: { type?: string, startsWith?: string, page: number, perPage: number }) {
  const query = new (useParse()).Query('CmsEntry').equalTo('project', project).equalTo('status', 'published')
  if (options.type) query.equalTo('type', options.type)
  if (options.startsWith) query.startsWith('slug', options.startsWith)
  const total = await query.count(MASTER)
  const rows = await query.descending('publishedAt').skip((options.page - 1) * options.perPage).limit(options.perPage).find(MASTER)
  return { entries: rows.filter(r => publishedOf(r)).map(toPublicCmsEntry), total, page: options.page, perPage: options.perPage }
}

/** A published entry's body as HTML and the CSS it needs, for a site that shows it as is. */
export function cmsEntryHtml(project: ParseObject, entry: ReturnType<typeof toPublicCmsEntry>, library: CmsLibrary, host: string) {
  return renderBlocks(entry.content, entry.style, entry.style.accent || projectAccent(project), { library, pk: String(project.get('publicKey') || ''), host })
}

/** A hosted page: the whole HTML document and its CSP, or null for a 404. */
export async function hostedCmsPage(event: H3Event, project: ParseObject, slug: string): Promise<{ html: string, csp: string } | null> {
  const row = await publishedCmsEntry(project, slug)
  if (!row) return null
  const entry = toPublicCmsEntry(row)
  const host = cmsHost(event)
  const html = renderPage({
    name: entry.name,
    content: entry.content,
    style: entry.style,
    projectAccent: projectAccent(project),
    projectName: String(project.get('name') || ''),
    url: host + cmsPagePath(project, entry.slug),
    poweredBy: poweredByHtml(await poweredByFor(project)),
    runtime: true
  }, { library: await cmsLibrary(project), pk: String(project.get('publicKey') || ''), host })
  return { html, csp: await pageCsp(host) }
}
