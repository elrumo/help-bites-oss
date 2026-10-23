import { STYLE_RADIUS_MAX, STYLE_SHADOWS, STYLE_SHADOW_CSS, resolveStyle, styleVars, type ResolvedStyle, type StyleShadow } from '#shared/projectStyle'

// The inline style that makes a public page wear a resolved style (see
// shared/projectStyle.ts), in one scheme. Set it on the page's root element:
//
// - the `--hb-*` variables carry the palette, radius, shadow and font;
// - Nuxt UI's tokens (`--ui-text`, `--ui-border`, `--ui-radius`…) point at them;
// - Tailwind's `stone` scale, which the embeds' markup is written in, is
//   remapped per scheme, so `bg-stone-50 dark:bg-stone-950` and the rest become
//   the style's background, card, text, muted and border colours without
//   touching the markup.
const STONE: Record<'light' | 'dark', Record<number, string>> = {
  light: { 50: 'bg', 100: 'surface', 200: 'border', 300: 'border', 400: 'muted', 500: 'muted', 600: 'muted', 700: 'text', 800: 'text', 900: 'text', 950: 'text' },
  dark: { 50: 'text', 100: 'text', 200: 'text', 300: 'muted', 400: 'muted', 500: 'muted', 600: 'border', 700: 'border', 800: 'border', 900: 'surface', 950: 'bg' }
}

export function styleRootStyle(style: ResolvedStyle, mode: 'light' | 'dark'): Record<string, string> {
  return {
    ...styleVars(style, mode),
    background: 'var(--hb-bg)',
    color: 'var(--hb-text)',
    fontFamily: 'var(--hb-font)',
    '--ui-bg': 'var(--hb-bg)',
    '--ui-bg-elevated': 'var(--hb-surface)',
    '--ui-bg-muted': 'var(--hb-surface)',
    '--ui-text': 'var(--hb-text)',
    '--ui-text-highlighted': 'var(--hb-text)',
    '--ui-text-muted': 'var(--hb-muted)',
    '--ui-text-dimmed': 'var(--hb-muted)',
    '--ui-border': 'var(--hb-border)',
    '--ui-border-muted': 'var(--hb-border)',
    '--ui-border-accented': 'var(--hb-border)',
    // Nuxt UI's radii are multiples of this (4px by default, 8px for the soft look).
    '--ui-radius': 'calc(var(--hb-radius) / 2)',
    ...Object.fromEntries(Object.entries(STONE[mode]).map(([shade, role]) => [`--color-stone-${shade}`, `var(--hb-${role === 'bg' ? 'bg' : role})`]))
  }
}

// Until the page has its style (or when loading it fails) it wears our defaults.
const FALLBACK = { accent: '#4f46e5', radiusPx: 8, fontFamily: 'ui-sans-serif, system-ui, sans-serif', logoUrl: '', logoDarkUrl: '', iconUrl: '' }

/**
 * The style an embed shows: its resolved style, with the script tag's own
 * choices (?accent=#rrggbb, ?radius=0-32, ?shadow=none|soft|medium|strong) laid
 * over it for this one embed.
 */
export function embedStyle(base: ResolvedStyle | null | undefined, query: Record<string, unknown>): ResolvedStyle {
  const style = base || resolveStyle(FALLBACK)
  const accent = /^#[0-9a-f]{6}$/i.test(String(query.accent || '')) ? String(query.accent).toLowerCase() : ''
  const radius = query.radius === undefined ? NaN : Number(query.radius)
  const shadow = (STYLE_SHADOWS as readonly string[]).includes(String(query.shadow)) ? String(query.shadow) as StyleShadow : style.shadow
  const palette = (colours: ResolvedStyle['light']) => ({ ...colours, accent: accent || colours.accent })
  return { ...style, radius: Number.isInteger(radius) && radius >= 0 && radius <= STYLE_RADIUS_MAX ? radius : style.radius, shadow, shadowCss: STYLE_SHADOW_CSS[shadow], light: palette(style.light), dark: palette(style.dark) }
}
