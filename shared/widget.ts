import { DEFAULT_STYLE_CHOICE, validateStyleChoice, type StyleChoice } from './projectStyle'

// The chat widget's own settings (`Project.widget`): today how it takes its
// style, the project's or its own over it. Pure, so the panel and the server share it.

export type WidgetConfig = { style: StyleChoice }

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = { style: DEFAULT_STYLE_CHOICE }

export function normalizeWidgetConfig(value: unknown): WidgetConfig {
  return validateWidgetConfig(value).config
}

/** A (partial) config on top of `base`: only the keys sent change. */
export function validateWidgetConfig(value: unknown, base: WidgetConfig = DEFAULT_WIDGET_CONFIG): { config: WidgetConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('widget must be an object')
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const config: WidgetConfig = { ...base }
  if (raw.style !== undefined) {
    const style = validateStyleChoice(raw.style, base.style)
    errors.push(...style.errors)
    config.style = style.choice
  }
  return { config, errors }
}
