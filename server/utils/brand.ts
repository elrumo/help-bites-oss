import { randomUUID } from 'node:crypto'
import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import {
  BRAND_ASSET_BACKGROUNDS, BRAND_ASSET_KINDS, BRAND_LIMITS, normalizeBrandConfig, validateBrandConfig,
  type BrandAssetBackground, type BrandAssetKind, type BrandConfig
} from '#shared/brand'
import type { BrandPageData } from './brandPage'
import { renderChangelogBody } from './changelogRender'
import { forgetProject, lookOf } from './projects'
import { detectImageMime } from './s3'

// A project's brand kit: the config on `Project.brand` and its files, one
// BrandAsset row each, stored in the bucket under `<projectId>/brand/`. The
// public page (brandPage.ts) and GET /v1/brand/{pk} show only what the kit marks
// public, and only while `brand.page.public` is on.

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

export async function brandProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

export const brandConfigOf = (project: ParseObject): BrandConfig => normalizeBrandConfig(project.get('brand'))

const looksLikeImage = (mime: unknown) => typeof mime === 'string' && mime.startsWith('image/') && mime !== 'image/x-icon'

/**
 * Keep the kit's own logo and icon on the project (`Project.brandLook`), so
 * the pages that wear the project's look need no file query: the first logo
 * (one drawn for dark backgrounds fills `logoDarkUrl`) and the first icon.
 * Called after a file is added, changed or removed.
 */
export async function refreshBrandLook(project: ParseObject): Promise<void> {
  const assets = (await listBrandAssets(project)).map(row => serializeBrandAsset(project, row)).filter(a => looksLikeImage(a.mime))
  const logos = assets.filter(a => a.kind === 'logo')
  const logo = logos.find(a => a.background !== 'dark') || logos[0]
  const dark = logos.find(a => a.background === 'dark')
  const icon = assets.find(a => a.kind === 'icon')
  const look = { logoUrl: logo?.url || '', logoDarkUrl: dark?.url || '', iconUrl: icon?.url || '' }
  const before = (project.get('brandLook') || {}) as Record<string, string>
  if (look.logoUrl === (before.logoUrl || '') && look.logoDarkUrl === (before.logoDarkUrl || '') && look.iconUrl === (before.iconUrl || '')) return
  project.set('brandLook', look)
  await project.save(null, MASTER)
  forgetProject(String(project.get('publicKey') || ''))
}

export async function saveBrandConfig(project: ParseObject, input: unknown): Promise<BrandConfig> {
  const { config, errors } = validateBrandConfig(input, brandConfigOf(project))
  if (errors.length) badRequest(errors.join('; '))
  project.set('brand', config)
  await project.save(null, MASTER)
  // The public page reads the project through the public-key cache.
  forgetProject(String(project.get('publicKey') || ''))
  return config
}

// ---- files -----------------------------------------------------------------------

const TYPES: Record<string, { ext: string, image: boolean }> = {
  'image/png': { ext: 'png', image: true },
  'image/jpeg': { ext: 'jpg', image: true },
  'image/gif': { ext: 'gif', image: true },
  'image/webp': { ext: 'webp', image: true },
  'image/svg+xml': { ext: 'svg', image: true },
  'image/x-icon': { ext: 'ico', image: true },
  'application/pdf': { ext: 'pdf', image: false }
}

// An SVG opened on its own runs its scripts, so anything that could run is refused rather than cleaned up.
const SVG_ACTIVE = /<script|<foreignobject|<iframe|<embed|<object|<!entity|\bon[a-z]+\s*=|javascript:|data:text\/html/i

export const svgIsActive = (data: Buffer) => SVG_ACTIVE.test(data.toString('utf8'))

/** The file's real type from its bytes; '' for anything a brand kit does not take. */
export function detectBrandMime(data: Buffer): string {
  const image = detectImageMime(data)
  if (image) return image
  if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) return 'image/x-icon'
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  const head = data.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return ''
}

/** Width and height in pixels when the header says; null otherwise. */
export function imageSize(data: Buffer, mime: string): { width: number, height: number } | null {
  try {
    if (mime === 'image/png' && data.length >= 24) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    if (mime === 'image/gif' && data.length >= 10) return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
    if (mime === 'image/x-icon' && data.length >= 8) return { width: data[6] || 256, height: data[7] || 256 }
    if (mime === 'image/webp' && data.length >= 30) {
      const chunk = data.subarray(12, 16).toString('ascii')
      if (chunk === 'VP8X') return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) }
      if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3FFF, height: data.readUInt16LE(28) & 0x3FFF }
      if (chunk === 'VP8L') {
        const bits = data.readUInt32LE(21)
        return { width: 1 + (bits & 0x3FFF), height: 1 + ((bits >> 14) & 0x3FFF) }
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < data.length && data[i] === 0xFF) {
        const marker = data[i + 1]!
        // Start-of-frame markers carry the size; C4, C8 and CC are other tables.
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) }
        i += 2 + data.readUInt16BE(i + 2)
      }
    }
    if (mime === 'image/svg+xml') {
      const tag = /<svg\b[^>]*>/i.exec(data.subarray(0, 4096).toString('utf8'))?.[0] || ''
      const attr = (name: string) => Number.parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag)?.[1] || '')
      const box = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag)
      const width = attr('width') || Number(box?.[1])
      const height = attr('height') || Number(box?.[2])
      if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) }
    }
  } catch {}
  return null
}

/** A sensible kind for a file nobody labelled: tiny squares are favicons, tall images screenshots, big squares icons. */
export function guessAssetKind(mime: string, size: { width: number, height: number } | null): BrandAssetKind {
  if (mime === 'image/x-icon') return 'favicon'
  if (mime === 'application/pdf') return 'other'
  if (size) {
    const ratio = size.width / size.height
    if (Math.abs(ratio - 1) < 0.02 && size.width <= 64) return 'favicon'
    if (ratio < 0.8) return 'screenshot'
    if (Math.abs(ratio - 1) < 0.02 && size.width >= 180) return 'icon'
    if (ratio > 1.8 && ratio < 2.1 && size.width >= 1000) return 'social'
  }
  return 'logo'
}

const isKind = (value: unknown): value is BrandAssetKind => BRAND_ASSET_KINDS.includes(value as BrandAssetKind)
const isBackground = (value: unknown): value is BrandAssetBackground => BRAND_ASSET_BACKGROUNDS.includes(value as BrandAssetBackground)

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim().replace(/[\r\n\t]+/g, ' ') : ''
  return (name || fallback).slice(0, BRAND_LIMITS.assetName)
}

export async function listBrandAssets(project: ParseObject, onlyPublic = false): Promise<ParseObject[]> {
  const query = new (useParse()).Query('BrandAsset').equalTo('project', project).ascending('order').addAscending('createdAt').limit(BRAND_LIMITS.assets)
  if (onlyPublic) query.notEqualTo('public', false)
  return await query.find(MASTER)
}

export async function getBrandAsset(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('BrandAsset').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
}

export async function scopedBrandAsset(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.brandAsset(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export function brandDownloadPath(project: ParseObject, row: ParseObject): string {
  return `/brand/${String(project.get('publicKey') || '')}/files/${row.id}`
}

/** A file's name for a download: its name plus the extension its type has. */
export function brandDownloadName(row: ParseObject): string {
  const ext = TYPES[String(row.get('mime') || '')]?.ext || 'bin'
  const base = String(row.get('name') || 'file').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-') || 'file'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

export function serializeBrandAsset(project: ParseObject, row: ParseObject) {
  return {
    id: row.id || '',
    kind: isKind(row.get('kind')) ? row.get('kind') as BrandAssetKind : 'other',
    name: String(row.get('name') || ''),
    description: String(row.get('description') || ''),
    url: String(row.get('url') || ''),
    downloadUrl: brandDownloadPath(project, row),
    mime: String(row.get('mime') || ''),
    size: Number(row.get('size') || 0),
    width: typeof row.get('width') === 'number' ? row.get('width') as number : null,
    height: typeof row.get('height') === 'number' ? row.get('height') as number : null,
    background: isBackground(row.get('background')) ? row.get('background') as BrandAssetBackground : 'any',
    public: row.get('public') !== false,
    order: Number(row.get('order') || 0),
    createdAt: iso(row.createdAt)
  }
}

export type BrandAssetView = ReturnType<typeof serializeBrandAsset>

/** Validates and stores an uploaded file, then records it. */
export async function createBrandAsset(project: ParseObject, workspaceId: string, file: UploadedFile, fields: Record<string, string>): Promise<ParseObject> {
  if (file.data.length > BRAND_LIMITS.assetBytes) throw createError({ statusCode: 413, statusMessage: `A file is at most ${BRAND_LIMITS.assetBytes / 1024 / 1024} MB` })
  const mime = detectBrandMime(file.data)
  if (!mime) throw createError({ statusCode: 415, statusMessage: 'A brand kit takes PNG, JPEG, GIF, WebP, SVG, ICO and PDF files' })
  if (mime === 'image/svg+xml' && svgIsActive(file.data)) throw createError({ statusCode: 415, statusMessage: 'This SVG contains scripts or embedded content; export it again as a plain SVG' })
  const count = await new (useParse()).Query('BrandAsset').equalTo('project', project).count(MASTER)
  if (count >= BRAND_LIMITS.assets) badRequest(`A brand kit holds at most ${BRAND_LIMITS.assets} files`)
  if (fields.kind && !isKind(fields.kind)) badRequest(`kind is one of ${BRAND_ASSET_KINDS.join(', ')}`)
  if (fields.background && !isBackground(fields.background)) badRequest(`background is one of ${BRAND_ASSET_BACKGROUNDS.join(', ')}`)

  const size = imageSize(file.data, mime)
  const key = `${project.id}/brand/${randomUUID()}.${TYPES[mime]!.ext}`
  const url = await storePublicFile(key, file.data, mime, workspaceId)
  const row = new (useParse().Object.extend('BrandAsset'))() as ParseObject
  row.set('project', project)
  row.set('kind', isKind(fields.kind) ? fields.kind : guessAssetKind(mime, size))
  row.set('name', cleanName(fields.name, file.filename.replace(/\.[a-z0-9]+$/i, '')))
  row.set('description', cleanName(fields.description, '').slice(0, 300))
  row.set('background', isBackground(fields.background) ? fields.background : 'any')
  row.set('public', fields.public !== 'false')
  row.set('order', count)
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

export async function updateBrandAsset(row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const errors: string[] = []
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) errors.push('name cannot be empty')
    else row.set('name', cleanName(body.name, ''))
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') errors.push('description must be text')
    else row.set('description', body.description.trim().slice(0, 300))
  }
  if (body.kind !== undefined) {
    if (!isKind(body.kind)) errors.push(`kind is one of ${BRAND_ASSET_KINDS.join(', ')}`)
    else row.set('kind', body.kind)
  }
  if (body.background !== undefined) {
    if (!isBackground(body.background)) errors.push(`background is one of ${BRAND_ASSET_BACKGROUNDS.join(', ')}`)
    else row.set('background', body.background)
  }
  if (body.public !== undefined) {
    if (typeof body.public !== 'boolean') errors.push('public must be true or false')
    else row.set('public', body.public)
  }
  if (body.order !== undefined) {
    if (!Number.isInteger(body.order) || (body.order as number) < 0) errors.push('order must be a whole number')
    else row.set('order', body.order)
  }
  if (errors.length) badRequest(errors.join('; '))
  await row.save(null, MASTER)
}

export async function deleteBrandAsset(row: ParseObject, workspaceId: string): Promise<void> {
  await row.destroy(MASTER)
  await deleteDocumentObject(String(row.get('storageKey') || ''))
  await chargeUsage(workspaceId, 'storageBytes', -Number(row.get('size') || 0))
}

// ---- public reads ----------------------------------------------------------------

/** The project behind a public brand URL (`:pk`), after the per-IP read limit; 404 unless its page is public. */
export async function publicBrandProject(event: H3Event): Promise<ParseObject> {
  await rateLimit(`sb:rl:brandread:${clientIp(event) || 'ip'}`, LIMITS.brandReadsPerIp.limit, LIMITS.brandReadsPerIp.window)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project || !brandConfigOf(project).page.public) throw createError({ statusCode: 404, statusMessage: 'No public brand kit' })
  return project
}

/** The project's accent as every surface shows it (Brand kit first, see shared/projectLook.ts). */
export function projectAccent(project: ParseObject): string {
  return lookOf(project).accent
}

/** Everything the page renders, from a kit and the files it may show. */
export function brandPageData(project: ParseObject, config: BrandConfig, assets: BrandAssetView[]): BrandPageData {
  const shown = assets.filter(a => a.public)
  // The look is read from the config being shown (a preview carries unsaved edits), like every other surface.
  const look = lookOf(project, { brand: config })
  const icon = shown.find(a => a.kind === 'icon' && a.mime.startsWith('image/'))?.url || look.iconUrl
  return {
    name: look.name,
    iconUrl: /^https?:\/\//.test(icon) ? icon : '',
    tagline: config.tagline,
    about: config.about,
    accent: look.accent,
    config,
    guidelines: config.guidelines.map(g => ({ id: g.id, title: g.title, html: renderChangelogBody(g.body, 'markdown') })),
    assets: shown
  }
}

/** What anyone may read: the kit, its public files and where the page is. Guidelines carry sanitised `html` beside their Markdown. */
export function toPublicBrand(project: ParseObject, config: BrandConfig, assets: BrandAssetView[]) {
  const pk = String(project.get('publicKey') || '')
  return {
    name: String(project.get('name') || ''),
    tagline: config.tagline,
    about: config.about,
    accent: lookOf(project, { brand: config }).accent,
    colors: config.colors,
    fonts: config.fonts,
    guidelines: config.guidelines.map(g => ({ ...g, html: renderChangelogBody(g.body, 'markdown') })),
    assets: assets.filter(a => a.public).map(({ public: _public, order: _order, ...asset }) => asset),
    page: { url: `/brand/${pk}`, template: config.page.template, theme: config.page.theme }
  }
}
