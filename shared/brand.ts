import { safeHttpUrl } from './support'

// A project's brand kit (`Project.brand`): its words, colours, type and
// guidelines, and how its public page at /brand/<publicKey> looks. The files
// themselves are BrandAsset rows (server/utils/brand.ts). The native app ports
// the lists below by hand (tests/brandNativeParity.test.ts).

export const BRAND_TEMPLATES = ['minimal', 'editorial', 'split'] as const
export const BRAND_THEMES = ['auto', 'light', 'dark'] as const
export const BRAND_RADII = ['sharp', 'soft', 'round'] as const
export const BRAND_SECTIONS = ['colors', 'typography', 'logos', 'screenshots', 'assets', 'guidelines'] as const
export const BRAND_ASSET_KINDS = ['logo', 'icon', 'favicon', 'screenshot', 'social', 'other'] as const
/** What a logo is drawn to sit on, so its tile matches. */
export const BRAND_ASSET_BACKGROUNDS = ['light', 'dark', 'any'] as const
export const BRAND_FONT_ROLES = ['display', 'body', 'mono', 'other'] as const

export type BrandTemplate = (typeof BRAND_TEMPLATES)[number]
export type BrandTheme = (typeof BRAND_THEMES)[number]
export type BrandRadius = (typeof BRAND_RADII)[number]
export type BrandSection = (typeof BRAND_SECTIONS)[number]
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number]
export type BrandAssetBackground = (typeof BRAND_ASSET_BACKGROUNDS)[number]
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number]

export const BRAND_LIMITS = { colors: 24, fonts: 6, guidelines: 20, assets: 200, tagline: 160, about: 2000, name: 60, usage: 200, weights: 60, sample: 200, title: 120, body: 8000, headline: 120, intro: 600, assetName: 120, assetBytes: 20 * 1024 * 1024 } as const

export const BRAND_TEMPLATE_INFO: Record<BrandTemplate, { label: string, description: string }> = {
  minimal: { label: 'Minimal', description: 'Your logo on its colour, then everything else in a quiet grid.' },
  editorial: { label: 'Editorial', description: 'A centred, type-led page for kits with a lot to say.' },
  split: { label: 'Split', description: 'A panel in your colour beside the content, like a brand book.' }
}

export const BRAND_SECTION_LABELS: Record<BrandSection, string> = {
  colors: 'Colours',
  typography: 'Typography',
  logos: 'Logos and icons',
  screenshots: 'Screenshots',
  assets: 'Other files',
  guidelines: 'Guidelines'
}

export const BRAND_ASSET_KIND_LABELS: Record<BrandAssetKind, string> = {
  logo: 'Logo',
  icon: 'App icon',
  favicon: 'Favicon',
  screenshot: 'Screenshot',
  social: 'Social image',
  other: 'Other'
}

/** Which page section a file shows in. */
export function brandSectionOf(kind: BrandAssetKind): BrandSection {
  return kind === 'logo' || kind === 'icon' ? 'logos' : kind === 'screenshot' ? 'screenshots' : 'assets'
}

export type BrandColor = { name: string, hex: string, usage: string }
export type BrandFont = {
  name: string
  role: BrandFontRole
  /** A Google Fonts stylesheet (https://fonts.googleapis.com/css2?…) the page loads to show the face, or ''. */
  cssUrl: string
  /** Where to get the font files, or ''. */
  downloadUrl: string
  weights: string
  sample: string
}
export type BrandGuideline = { id: string, title: string, body: string }
export type BrandPage = {
  /** Off: the page and GET /v1/brand/{pk} answer 404. */
  public: boolean
  template: BrandTemplate
  theme: BrandTheme
  radius: BrandRadius
  /** '#rrggbb', or '' for the first colour, then the project's accent. */
  accent: string
  /** '' shows the project's name. */
  headline: string
  intro: string
  /** The sections shown, in order. */
  sections: BrandSection[]
}
export type BrandConfig = { tagline: string, about: string, colors: BrandColor[], fonts: BrandFont[], guidelines: BrandGuideline[], page: BrandPage }

export const DEFAULT_BRAND_PAGE: BrandPage = { public: false, template: 'minimal', theme: 'auto', radius: 'soft', accent: '', headline: '', intro: '', sections: [...BRAND_SECTIONS] }
export const DEFAULT_BRAND_CONFIG: BrandConfig = { tagline: '', about: '', colors: [], fonts: [], guidelines: [], page: DEFAULT_BRAND_PAGE }

const HEX = /^#[0-9a-f]{6}$/i

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** A Google Fonts stylesheet URL, or '' for anything else (the page's CSP only lets that host in). */
export function googleFontsCssUrl(value: unknown): string {
  const url = safeHttpUrl(value)
  if (!url) return ''
  const parsed = new URL(url)
  return parsed.protocol === 'https:' && parsed.hostname === 'fonts.googleapis.com' && /^\/css2?$/.test(parsed.pathname) ? parsed.toString() : ''
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

let counter = 0
export function newGuidelineId(): string {
  counter += 1
  return `g_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeBrandConfig(value: unknown): BrandConfig {
  return validateBrandConfig(value, DEFAULT_BRAND_CONFIG).config
}

/**
 * A (partial) kit on top of `base`. Top-level keys sent replace theirs (a list
 * is the full list); `page` merges key by key. Bad values are reported and not
 * applied.
 */
export function validateBrandConfig(value: unknown, base: BrandConfig = DEFAULT_BRAND_CONFIG): { config: BrandConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('brand must be an object')
  const raw = record(value)
  const config: BrandConfig = { ...base, page: { ...base.page, sections: [...base.page.sections] } }
  const text = (from: Record<string, unknown>, key: string, max: number, label: string, fallback: string): string => {
    if (from[key] === undefined) return fallback
    if (typeof from[key] !== 'string' || (from[key] as string).trim().length > max) { errors.push(`${label} is text of up to ${max} characters`); return fallback }
    return (from[key] as string).trim()
  }

  config.tagline = text(raw, 'tagline', BRAND_LIMITS.tagline, 'tagline', base.tagline)
  config.about = text(raw, 'about', BRAND_LIMITS.about, 'about', base.about)

  if (raw.colors !== undefined) {
    if (!Array.isArray(raw.colors) || raw.colors.length > BRAND_LIMITS.colors) errors.push(`colors is a list of up to ${BRAND_LIMITS.colors}`)
    else {
      const colors = raw.colors.map((item, i) => {
        const c = record(item)
        const hex = typeof c.hex === 'string' ? c.hex.trim().toLowerCase() : ''
        if (!HEX.test(hex)) errors.push(`colors[${i}].hex must be a #rrggbb colour`)
        return { name: text(c, 'name', BRAND_LIMITS.name, `colors[${i}].name`, ''), hex, usage: text(c, 'usage', BRAND_LIMITS.usage, `colors[${i}].usage`, '') }
      })
      if (colors.every(c => HEX.test(c.hex))) config.colors = colors
    }
  }

  if (raw.fonts !== undefined) {
    if (!Array.isArray(raw.fonts) || raw.fonts.length > BRAND_LIMITS.fonts) errors.push(`fonts is a list of up to ${BRAND_LIMITS.fonts}`)
    else {
      const before = errors.length
      const fonts = raw.fonts.map((item, i): BrandFont => {
        const f = record(item)
        const name = text(f, 'name', BRAND_LIMITS.name, `fonts[${i}].name`, '')
        if (!name) errors.push(`fonts[${i}].name is required`)
        const role = BRAND_FONT_ROLES.includes(f.role as BrandFontRole) ? f.role as BrandFontRole : 'other'
        if (f.role !== undefined && role !== f.role) errors.push(`fonts[${i}].role is one of ${BRAND_FONT_ROLES.join(', ')}`)
        const cssUrl = f.cssUrl ? googleFontsCssUrl(f.cssUrl) : ''
        if (f.cssUrl && !cssUrl) errors.push(`fonts[${i}].cssUrl must be a https://fonts.googleapis.com/css2 link`)
        const downloadUrl = f.downloadUrl ? safeHttpUrl(f.downloadUrl) : ''
        if (f.downloadUrl && !downloadUrl) errors.push(`fonts[${i}].downloadUrl must be an http(s) URL`)
        return { name, role, cssUrl, downloadUrl, weights: text(f, 'weights', BRAND_LIMITS.weights, `fonts[${i}].weights`, ''), sample: text(f, 'sample', BRAND_LIMITS.sample, `fonts[${i}].sample`, '') }
      })
      if (errors.length === before) config.fonts = fonts
    }
  }

  if (raw.guidelines !== undefined) {
    if (!Array.isArray(raw.guidelines) || raw.guidelines.length > BRAND_LIMITS.guidelines) errors.push(`guidelines is a list of up to ${BRAND_LIMITS.guidelines}`)
    else {
      const before = errors.length
      const seen = new Set<string>()
      const guidelines = raw.guidelines.map((item, i) => {
        const g = record(item)
        let id = typeof g.id === 'string' && /^[\w-]{1,40}$/.test(g.id) ? g.id : ''
        if (!id || seen.has(id)) id = newGuidelineId()
        seen.add(id)
        const title = text(g, 'title', BRAND_LIMITS.title, `guidelines[${i}].title`, '')
        if (!title) errors.push(`guidelines[${i}].title is required`)
        return { id, title, body: text(g, 'body', BRAND_LIMITS.body, `guidelines[${i}].body`, '') }
      })
      if (errors.length === before) config.guidelines = guidelines
    }
  }

  if (raw.page !== undefined) {
    const p = record(raw.page)
    const page = config.page
    if (p.public !== undefined) {
      if (typeof p.public !== 'boolean') errors.push('page.public must be true or false')
      else page.public = p.public
    }
    const pick = <T extends string>(key: 'template' | 'theme' | 'radius', list: readonly T[]) => {
      if (p[key] === undefined) return
      if (!list.includes(p[key] as T)) errors.push(`page.${key} is one of ${list.join(', ')}`)
      else (page as Record<string, unknown>)[key] = p[key]
    }
    pick('template', BRAND_TEMPLATES)
    pick('theme', BRAND_THEMES)
    pick('radius', BRAND_RADII)
    if (p.accent !== undefined) {
      const accent = typeof p.accent === 'string' ? p.accent.trim().toLowerCase() : null
      if (accent === null || (accent && !HEX.test(accent))) errors.push('page.accent must be a #rrggbb colour or empty')
      else page.accent = accent
    }
    page.headline = text(p, 'headline', BRAND_LIMITS.headline, 'page.headline', page.headline)
    page.intro = text(p, 'intro', BRAND_LIMITS.intro, 'page.intro', page.intro)
    if (p.sections !== undefined) {
      if (!Array.isArray(p.sections) || p.sections.some(s => !BRAND_SECTIONS.includes(s as BrandSection))) errors.push(`page.sections is a list of ${BRAND_SECTIONS.join(', ')}`)
      else page.sections = [...new Set(p.sections as BrandSection[])]
    }
  }
  return { config, errors }
}

/** The page's accent: the one picked, else the first brand colour, else the project's, else the default. Same order as projectLook() (shared/projectLook.ts, which builds on this file, so the default is repeated here). */
export function brandAccent(config: BrandConfig, projectAccent = ''): string {
  return config.page.accent || config.colors[0]?.hex || (HEX.test(projectAccent) ? projectAccent.toLowerCase() : '') || '#4f46e5'
}
