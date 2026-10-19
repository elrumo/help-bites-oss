/**
 * The theme designer's engine. A theme is a small set of design tokens
 * (EmailTheme in ./blocks). Applying one rewrites document settings and block
 * colors from the tokens — like changing Tailwind variables — while leaving
 * the layout (block structure, copy, images, spacing) completely untouched.
 */
import type { EmailBlock, EmailDocument, EmailTheme } from './blocks'
import { childLists, DEFAULT_SETTINGS, walkBlocks } from './blocks'

const FONT_SANS = '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif'
const FONT_SERIF = 'Georgia, \'Times New Roman\', Times, serif'
const FONT_VERDANA = 'Verdana, Geneva, Tahoma, sans-serif'
const FONT_TREBUCHET = '\'Trebuchet MS\', \'Lucida Grande\', Tahoma, sans-serif'
const FONT_MONO = '\'Courier New\', Courier, monospace'

export const FONT_STACKS: Array<{ label: string, value: string }> = [
  { label: 'System sans', value: FONT_SANS },
  { label: 'Georgia serif', value: FONT_SERIF },
  { label: 'Verdana humanist', value: FONT_VERDANA },
  { label: 'Trebuchet', value: FONT_TREBUCHET },
  { label: 'Courier mono', value: FONT_MONO }
]

export const DEFAULT_THEME: EmailTheme = {
  brand: '#2563eb',
  onBrand: '#ffffff',
  background: '#f4f4f5',
  surface: '#ffffff',
  heading: '#18181b',
  text: '#3f3f46',
  muted: '#e4e4e7',
  fontFamily: FONT_SANS,
  radius: 6
}

export const THEME_PRESETS: Array<{ id: string, name: string, theme: EmailTheme }> = [
  { id: 'classic', name: 'Classic', theme: { ...DEFAULT_THEME } },
  {
    id: 'midnight',
    name: 'Midnight',
    theme: { brand: '#8b5cf6', onBrand: '#ffffff', background: '#0b0b16', surface: '#171728', heading: '#ffffff', text: '#c7c7e1', muted: '#2e2e4a', fontFamily: FONT_SANS, radius: 10 }
  },
  {
    id: 'forest',
    name: 'Forest',
    theme: { brand: '#16a34a', onBrand: '#ffffff', background: '#f0f4ef', surface: '#ffffff', heading: '#14291a', text: '#3c4a3d', muted: '#d8e3d5', fontFamily: FONT_VERDANA, radius: 8 }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    theme: { brand: '#ea580c', onBrand: '#ffffff', background: '#fff7ed', surface: '#ffffff', heading: '#431407', text: '#57534e', muted: '#fed7aa', fontFamily: FONT_SANS, radius: 999 }
  },
  {
    id: 'ocean',
    name: 'Ocean',
    theme: { brand: '#0891b2', onBrand: '#ffffff', background: '#ecfeff', surface: '#ffffff', heading: '#164e63', text: '#33475b', muted: '#bae6fd', fontFamily: FONT_TREBUCHET, radius: 6 }
  },
  {
    id: 'editorial',
    name: 'Editorial',
    theme: { brand: '#111111', onBrand: '#ffffff', background: '#fafafa', surface: '#ffffff', heading: '#111111', text: '#3d3d3d', muted: '#e5e5e5', fontFamily: FONT_SERIF, radius: 0 }
  },
  {
    id: 'candy',
    name: 'Candy',
    theme: { brand: '#db2777', onBrand: '#ffffff', background: '#fdf2f8', surface: '#ffffff', heading: '#831843', text: '#4b5563', muted: '#fbcfe8', fontFamily: FONT_SANS, radius: 14 }
  }
]

/** The document's current tokens: last applied theme, else derived defaults. */
export function currentTheme(doc: EmailDocument): EmailTheme {
  if (doc.settings.theme) return { ...DEFAULT_THEME, ...doc.settings.theme }
  // Derive a best-effort theme from a document that predates themes.
  let brand: string | undefined, onBrand: string | undefined, radius: number | undefined
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'button' && !brand && String(b.backgroundColor).trim().toLowerCase() !== 'transparent') {
      brand = b.backgroundColor
      onBrand = b.color
      radius = b.radius
    }
  })
  return {
    ...DEFAULT_THEME,
    brand: brand ?? DEFAULT_THEME.brand,
    onBrand: onBrand ?? DEFAULT_THEME.onBrand,
    radius: radius ?? DEFAULT_THEME.radius,
    background: doc.settings.backgroundColor || DEFAULT_SETTINGS.backgroundColor,
    surface: doc.settings.contentBackground || DEFAULT_SETTINGS.contentBackground,
    text: doc.settings.textColor || DEFAULT_SETTINGS.textColor,
    heading: doc.settings.textColor || DEFAULT_THEME.heading,
    fontFamily: doc.settings.fontFamily || DEFAULT_THEME.fontFamily
  }
}

/**
 * Apply theme tokens to a document, returning a new document. Only colors,
 * font and radius change; structure, copy and spacing are preserved. Blocks
 * with a custom per-block background keep it (it's a deliberate accent), and
 * so do the blocks on it: whatever sits in a section or columns with its own
 * background (a dark hero, a gradient band) was coloured for that surface.
 * Transparent buttons are links, not buttons, and stay as they are.
 */
export function applyThemeToDocument(doc: EmailDocument, patch: Partial<EmailTheme>): EmailDocument {
  const theme: EmailTheme = { ...currentTheme(doc), ...patch }
  const next: EmailDocument = JSON.parse(JSON.stringify(doc))

  next.settings.backgroundColor = theme.background
  next.settings.contentBackground = theme.surface
  next.settings.textColor = theme.text
  next.settings.fontFamily = theme.fontFamily
  next.settings.theme = theme

  const restyle = (blocks: EmailBlock[]) => {
    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          b.color = theme.heading
          break
        case 'text':
          b.color = theme.text
          break
        case 'button':
          if (String(b.backgroundColor).trim().toLowerCase() === 'transparent') break
          b.backgroundColor = theme.brand
          b.color = theme.onBrand
          b.radius = theme.radius
          break
        case 'divider':
          b.color = theme.muted
          break
      }
      if (!b.background) childLists(b).forEach(restyle)
    }
  }
  restyle(next.blocks)

  return next
}
