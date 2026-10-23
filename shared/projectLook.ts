import { normalizeBrandConfig, readableOn, type BrandColor, type BrandFont, type BrandRadius, type BrandTheme } from './brand'
import { normalizeProjectStyle, resolveStyle, type ProjectStyle, type ResolvedStyle, type StyleBase } from './projectStyle'
import { safeHttpUrl } from './support'

// A project's look, read one way everywhere. The Brand kit (`Project.brand`)
// is the source: its accent, logo, fonts and corner radius. The older
// per-feature fields (`theme.accent`, `brandLogoUrl`, `iconUrl`) are only
// fallbacks for projects that never filled the kit in. Every surface that
// wears the project's look (the chat widget, boards, forms, onboarding, legal
// and blog pages, campaign mail, the public hub) calls this instead of
// reading those fields itself, so changing the kit changes all of them.
//
// Pure, so the panel, the server and the tests share it. The native app reads
// the result from the API (`look` on the project DTOs).

export const DEFAULT_ACCENT = '#4f46e5'

/** The raw project fields the look is built from. All optional: a project that set nothing still gets a look. */
export type ProjectLookInput = {
  name?: unknown
  /** Older: `{ accent, dark }` from Settings. */
  theme?: unknown
  /** The Brand kit config. */
  brand?: unknown
  brandLogoUrl?: unknown
  assistantLogoUrl?: unknown
  iconUrl?: unknown
  /** The kit's own logo and icon files, kept on the project when a file is added or changed (server/utils/brand.ts). */
  brandLook?: unknown
  /** The project's own style (shared/projectStyle.ts); it wins over the kit where it sets something. */
  style?: unknown
}

export type ProjectLook = {
  name: string
  /** '#rrggbb' */
  accent: string
  /** Black or white, whichever reads on the accent. */
  accentText: '#000000' | '#ffffff'
  /** The kit's palette, first colour first; empty before the kit has any. */
  colors: BrandColor[]
  /** Which scheme the project's own pages use. */
  scheme: BrandTheme
  radius: BrandRadius
  /** CSS pixels for `radius`. */
  radiusPx: number
  fonts: { display: BrandFont | null, body: BrandFont | null, mono: BrandFont | null }
  /** Google Fonts stylesheets to load for `fonts`; [] when none is linked. */
  fontCssUrls: string[]
  /** CSS `font-family` values, ending in a safe fallback. */
  fontFamily: { display: string, body: string, mono: string }
  tagline: string
  /** The wordmark or logo, '' when the project has none. */
  logoUrl: string
  /** A logo drawn for dark backgrounds, or the same as `logoUrl`. */
  logoDarkUrl: string
  /** The square app icon, falling back to the logo. */
  iconUrl: string
  /** The project's style resolved: light and dark colours, shadow, radius, font, logos. Features overlay their own on `projectStyle`. */
  style: ResolvedStyle
  /** The style as the project saved it (gaps empty), to layer a feature's own style over with `resolveStyle`. */
  projectStyle: ProjectStyle
  /** What the Brand kit alone gives, under the project style: the bottom layer for `resolveStyle`. */
  kit: StyleBase
}

const HEX = /^#[0-9a-f]{6}$/i
const RADIUS_PX: Record<BrandRadius, number> = { sharp: 2, soft: 8, round: 16 }
const SYSTEM = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const url = (value: unknown): string => safeHttpUrl(value) || ''

function family(font: BrandFont | null, fallback: string): string {
  return font ? `"${font.name.replace(/["\\]/g, '')}", ${fallback}` : fallback
}

export function projectLook(project: ProjectLookInput | null | undefined): ProjectLook {
  const p = project || {}
  const brand = normalizeBrandConfig(p.brand)
  const legacyAccent = text(record(p.theme).accent)
  const files = record(p.brandLook)
  const font = (role: BrandFont['role']) => brand.fonts.find(f => f.role === role) || null
  const display = font('display')
  const body = font('body') || display
  const mono = font('mono')
  const fontFamily = { display: family(display, SYSTEM), body: family(body, SYSTEM), mono: family(mono, MONO) }
  // What the Brand kit alone gives: the kit's page accent, its first colour, then the older Settings accent, then ours.
  const logo = url(files.logoUrl) || url(p.brandLogoUrl) || url(p.assistantLogoUrl)
  const kit: StyleBase = {
    accent: (brand.page.accent || brand.colors[0]?.hex || (HEX.test(legacyAccent) ? legacyAccent : '') || DEFAULT_ACCENT).toLowerCase(),
    radiusPx: RADIUS_PX[brand.page.radius],
    fontFamily: fontFamily.body,
    logoUrl: logo,
    logoDarkUrl: url(files.logoDarkUrl) || logo,
    iconUrl: url(files.iconUrl) || url(p.iconUrl)
  }
  // The project's own style wins over the kit wherever it sets something.
  const projectStyle = normalizeProjectStyle(p.style)
  const style = resolveStyle(kit, projectStyle)
  const accent = style.light.accent
  return {
    name: text(p.name),
    accent,
    accentText: readableOn(accent),
    colors: brand.colors,
    scheme: projectStyle.scheme || brand.page.theme,
    radius: brand.page.radius,
    radiusPx: style.radius,
    fonts: { display, body, mono },
    fontCssUrls: [...new Set([display, body, mono].map(f => f?.cssUrl || '').filter(Boolean))],
    fontFamily: { ...fontFamily, body: style.fontFamily },
    tagline: brand.tagline,
    logoUrl: style.logoUrl,
    logoDarkUrl: style.logoDarkUrl,
    iconUrl: style.iconUrl,
    style,
    projectStyle,
    kit
  }
}

/** The older `theme` object, derived from the look, for clients that still read `project.theme`. */
export function legacyTheme(look: ProjectLook, theme: unknown): { accent: string, dark?: boolean } {
  const dark = record(theme).dark
  return { accent: look.accent, ...(typeof dark === 'boolean' ? { dark } : {}) }
}
