import { readableOn } from './brand'
import { safeHttpUrl } from './support'

// A project's style: the look every styled feature can share. The project holds
// one (`Project.style`); a feature's style panel either uses it as it is or
// overlays its own choices on top (`changelog.style`). Every field is optional:
// '' (null for the radius) means "not set here, take it from the layer below",
// and the bottom layer is the Brand kit's look (shared/projectLook.ts), then
// the defaults below. So a project that sets nothing still gets a good style,
// and one that sets only an accent gets it in light and dark.
//
// Pure, so the panel, the server and the tests share it.

export const STYLE_SCHEMES = ['auto', 'light', 'dark'] as const
export const STYLE_SHADOWS = ['none', 'soft', 'medium', 'strong'] as const
export const STYLE_FONTS = ['system', 'serif', 'mono'] as const
export const STYLE_PALETTE_KEYS = ['accent', 'background', 'surface', 'text', 'muted', 'border'] as const
export const STYLE_RADIUS_MAX = 32

export type StyleScheme = (typeof STYLE_SCHEMES)[number]
export type StyleShadow = (typeof STYLE_SHADOWS)[number]
export type StyleFont = (typeof STYLE_FONTS)[number]
export type StylePaletteKey = (typeof STYLE_PALETTE_KEYS)[number]

/** One scheme's colours, each '#rrggbb' or '' for "inherit". */
export type StylePalette = Record<StylePaletteKey, string>

export type ProjectStyle = {
  /** Which scheme the pages use: '' (or `auto`) follows the visitor. */
  scheme: StyleScheme | ''
  light: StylePalette
  dark: StylePalette
  /** Corner radius in CSS pixels, 0 to 32; null inherits. */
  radius: number | null
  shadow: StyleShadow | ''
  /** '' uses the Brand kit's body font. */
  font: StyleFont | ''
  /** The wordmark or logo, the one drawn for dark backgrounds, and the square app icon ('' inherits the Brand kit's). */
  logoUrl: string
  logoDarkUrl: string
  iconUrl: string
}

export type FullPalette = Record<StylePaletteKey, string>

export type ResolvedStyle = {
  scheme: StyleScheme
  radius: number
  shadow: StyleShadow
  shadowCss: string
  fontFamily: string
  light: FullPalette
  dark: FullPalette
  logoUrl: string
  logoDarkUrl: string
  iconUrl: string
}

const EMPTY_PALETTE: StylePalette = { accent: '', background: '', surface: '', text: '', muted: '', border: '' }
export const DEFAULT_PROJECT_STYLE: ProjectStyle = { scheme: '', light: { ...EMPTY_PALETTE }, dark: { ...EMPTY_PALETTE }, radius: null, shadow: '', font: '', logoUrl: '', logoDarkUrl: '', iconUrl: '' }

/** What a palette key falls back to when no layer sets it; the accent falls back to the project's. */
export const DEFAULT_PALETTES: { light: Omit<FullPalette, 'accent'>, dark: Omit<FullPalette, 'accent'> } = {
  light: { background: '#ffffff', surface: '#fafaf9', text: '#1c1917', muted: '#78716c', border: '#e7e5e4' },
  dark: { background: '#0c0a09', surface: '#1c1917', text: '#f5f5f4', muted: '#a8a29e', border: '#292524' }
}

export const STYLE_SHADOW_CSS: Record<StyleShadow, string> = {
  none: 'none',
  soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
  medium: '0 4px 12px rgb(0 0 0 / 0.1)',
  strong: '0 12px 32px rgb(0 0 0 / 0.18)'
}

const FONT_STACKS: Record<StyleFont, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
}

const HEX = /^#[0-9a-f]{6}$/i
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

/**
 * A (partial) style on top of `base`: the keys sent change, `light` and `dark`
 * merge colour by colour. Bad values are reported and not applied.
 */
export function validateProjectStyle(value: unknown, base: ProjectStyle = DEFAULT_PROJECT_STYLE): { style: ProjectStyle, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('style must be an object')
  const raw = record(value)
  const style: ProjectStyle = { ...base, light: { ...base.light }, dark: { ...base.dark } }

  if (raw.scheme !== undefined) {
    if (raw.scheme === '' || (STYLE_SCHEMES as readonly unknown[]).includes(raw.scheme)) style.scheme = raw.scheme as ProjectStyle['scheme']
    else errors.push(`scheme is one of ${STYLE_SCHEMES.join(', ')}, or empty`)
  }
  if (raw.shadow !== undefined) {
    if (raw.shadow === '' || (STYLE_SHADOWS as readonly unknown[]).includes(raw.shadow)) style.shadow = raw.shadow as ProjectStyle['shadow']
    else errors.push(`shadow is one of ${STYLE_SHADOWS.join(', ')}, or empty`)
  }
  if (raw.font !== undefined) {
    if (raw.font === '' || (STYLE_FONTS as readonly unknown[]).includes(raw.font)) style.font = raw.font as ProjectStyle['font']
    else errors.push(`font is one of ${STYLE_FONTS.join(', ')}, or empty`)
  }
  if (raw.radius !== undefined) {
    if (raw.radius === null || raw.radius === '') style.radius = null
    else if (typeof raw.radius === 'number' && Number.isInteger(raw.radius) && raw.radius >= 0 && raw.radius <= STYLE_RADIUS_MAX) style.radius = raw.radius
    else errors.push(`radius is a whole number from 0 to ${STYLE_RADIUS_MAX}, or null`)
  }
  for (const key of ['logoUrl', 'logoDarkUrl', 'iconUrl'] as const) {
    if (raw[key] === undefined) continue
    const url = typeof raw[key] === 'string' ? safeHttpUrl(raw[key]) : ''
    if (raw[key] && !url) errors.push(`${key} must be an http(s) URL, or empty`)
    else style[key] = url || ''
  }
  for (const scheme of ['light', 'dark'] as const) {
    if (raw[scheme] === undefined) continue
    const palette = record(raw[scheme])
    for (const key of STYLE_PALETTE_KEYS) {
      if (palette[key] === undefined) continue
      const colour = typeof palette[key] === 'string' ? (palette[key] as string).trim() : null
      if (colour === null || (colour && !HEX.test(colour))) errors.push(`${scheme}.${key} must be a #rrggbb colour, or empty`)
      else style[scheme][key] = colour.toLowerCase()
    }
  }
  return { style, errors }
}

/** Read a stored style leniently. */
export function normalizeProjectStyle(value: unknown): ProjectStyle {
  return validateProjectStyle(value).style
}

/** `over` on top of `base`: what `over` leaves empty comes from `base`. */
export function overlayStyle(base: ProjectStyle, over: ProjectStyle): ProjectStyle {
  const palette = (a: StylePalette, b: StylePalette): StylePalette => Object.fromEntries(STYLE_PALETTE_KEYS.map(key => [key, b[key] || a[key]])) as StylePalette
  return {
    scheme: over.scheme || base.scheme,
    light: palette(base.light, over.light),
    dark: palette(base.dark, over.dark),
    radius: over.radius ?? base.radius,
    shadow: over.shadow || base.shadow,
    font: over.font || base.font,
    logoUrl: over.logoUrl || base.logoUrl,
    logoDarkUrl: over.logoDarkUrl || base.logoDarkUrl,
    iconUrl: over.iconUrl || base.iconUrl
  }
}

/**
 * What a feature's own style fields offer the project style ("Save as project
 * style"). Each feature names things its own way (a `rounded` font, a `sharp`
 * radius); only what maps onto a project style is offered, and colours left
 * empty stay unset so they keep the project's.
 */
export function styleFrom(own: { accent?: string, background?: string, text?: string, radius?: number, font?: string, scheme?: string, logoUrl?: string }): Partial<ProjectStyle> {
  return {
    light: { ...EMPTY_PALETTE, accent: own.accent || '', background: own.background || '', text: own.text || '' },
    ...(own.radius !== undefined ? { radius: own.radius } : {}),
    ...((STYLE_FONTS as readonly string[]).includes(own.font || '') ? { font: own.font as StyleFont } : {}),
    ...((STYLE_SCHEMES as readonly string[]).includes(own.scheme || '') ? { scheme: own.scheme as StyleScheme } : {}),
    ...(own.logoUrl ? { logoUrl: own.logoUrl } : {})
  }
}

/** True when nothing is set. */
export function isEmptyStyle(style: ProjectStyle): boolean {
  return JSON.stringify(style) === JSON.stringify(DEFAULT_PROJECT_STYLE)
}

/** The bottom layer: what the Brand kit gives when no style sets a thing. */
export type StyleBase = { accent: string, radiusPx: number, fontFamily: string, logoUrl: string, logoDarkUrl: string, iconUrl: string }

/** Layers laid over the base, first layer lowest (the project's style, then a feature's own), with every gap filled. */
export function resolveStyle(base: StyleBase, ...layers: ProjectStyle[]): ResolvedStyle {
  const style = layers.reduce(overlayStyle, DEFAULT_PROJECT_STYLE)
  const full = (scheme: 'light' | 'dark'): FullPalette => {
    const own = style[scheme]
    return {
      accent: own.accent || style.light.accent || base.accent,
      background: own.background || DEFAULT_PALETTES[scheme].background,
      surface: own.surface || DEFAULT_PALETTES[scheme].surface,
      text: own.text || DEFAULT_PALETTES[scheme].text,
      muted: own.muted || DEFAULT_PALETTES[scheme].muted,
      border: own.border || DEFAULT_PALETTES[scheme].border
    }
  }
  const shadow = style.shadow || 'soft'
  return {
    scheme: style.scheme || 'auto',
    radius: style.radius ?? base.radiusPx,
    shadow,
    shadowCss: STYLE_SHADOW_CSS[shadow],
    fontFamily: style.font ? FONT_STACKS[style.font] : base.fontFamily,
    light: full('light'),
    dark: full('dark'),
    logoUrl: style.logoUrl || base.logoUrl,
    logoDarkUrl: style.logoDarkUrl || style.logoUrl || base.logoDarkUrl,
    iconUrl: style.iconUrl || base.iconUrl || style.logoUrl || base.logoUrl
  }
}

/** The CSS variables a page sets on its root for one scheme (`--hb-*`). */
export function styleVars(style: ResolvedStyle, mode: 'light' | 'dark'): Record<string, string> {
  const palette = style[mode]
  return {
    '--hb-accent': palette.accent,
    '--hb-accent-text': readableOn(palette.accent),
    '--hb-bg': palette.background,
    '--hb-surface': palette.surface,
    '--hb-text': palette.text,
    '--hb-muted': palette.muted,
    '--hb-border': palette.border,
    '--hb-radius': `${style.radius}px`,
    '--hb-shadow': style.shadowCss,
    '--hb-font': style.fontFamily
  }
}
