import { safeHttpUrl } from './support'

// The public hub (`Project.hub`): one page per project at /hub/<publicKey> that
// gathers what the project already publishes, its changelog, roadmap and
// feedback board, blog, legal documents and brand kit, with a way to chat and
// a few links of its own. It owns no content: a section shows only when its
// feature has something public to show. The chat widget's Home tab reads the
// same data (`widgetHome`).

export const HUB_SECTIONS = ['about', 'changelog', 'roadmap', 'feedback', 'blog', 'legal', 'brand', 'contact'] as const
export type HubSection = (typeof HUB_SECTIONS)[number]

/** What the chat widget's Home tab can show. */
export const HUB_HOME_SECTIONS = ['changelog', 'feedback', 'onboarding'] as const
export type HubHomeSection = (typeof HUB_HOME_SECTIONS)[number]

export const HUB_LIMITS = { title: 80, tagline: 200, links: 8, label: 60, url: 500 } as const

export type HubLink = { label: string, url: string }

export type HubConfig = {
  /** Turns the page at /hub/<pk> on. Off, it answers 404. */
  enabled: boolean
  /** '' uses the project's name. */
  title: string
  /** '' uses the Brand kit's tagline. */
  tagline: string
  /** Which sections the page lists, in this order; one with nothing to show is left out. */
  sections: HubSection[]
  /** Extra links of your own, shown after the sections. */
  links: HubLink[]
  /** The chat widget's Home tab (default off). It works without the page being on. */
  widgetHome: { enabled: boolean, sections: HubHomeSection[] }
}

export const DEFAULT_HUB_CONFIG: HubConfig = {
  enabled: false,
  title: '',
  tagline: '',
  sections: [...HUB_SECTIONS],
  links: [],
  widgetHome: { enabled: false, sections: [...HUB_HOME_SECTIONS] }
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})

function pickList<T extends string>(value: unknown, allowed: readonly T[], name: string, errors: string[]): T[] | null {
  if (!Array.isArray(value) || value.some(item => !allowed.includes(item as T))) {
    errors.push(`${name} is a list of ${allowed.join(', ')}`)
    return null
  }
  return [...new Set(value as T[])]
}

export function normalizeHubConfig(value: unknown): HubConfig {
  return validateHubConfig(value).config
}

/** Validate a (partial) config on top of `base`: only the keys sent change; `sections` and `links` are whole lists. */
export function validateHubConfig(value: unknown, base: HubConfig = DEFAULT_HUB_CONFIG): { config: HubConfig, errors: string[] } {
  const errors: string[] = []
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) errors.push('hub must be an object')
  const raw = record(value)
  const config: HubConfig = { ...base, sections: [...base.sections], links: base.links.map(l => ({ ...l })), widgetHome: { ...base.widgetHome, sections: [...base.widgetHome.sections] } }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') errors.push('enabled must be true or false')
    else config.enabled = raw.enabled
  }
  for (const key of ['title', 'tagline'] as const) {
    if (raw[key] === undefined) continue
    const text = typeof raw[key] === 'string' ? (raw[key] as string).trim() : null
    if (text === null || text.length > HUB_LIMITS[key]) errors.push(`${key} is up to ${HUB_LIMITS[key]} characters`)
    else config[key] = text
  }
  if (raw.sections !== undefined) {
    const sections = pickList(raw.sections, HUB_SECTIONS, 'sections', errors)
    if (sections) config.sections = sections
  }
  if (raw.links !== undefined) {
    if (!Array.isArray(raw.links) || raw.links.length > HUB_LIMITS.links) errors.push(`links is a list of up to ${HUB_LIMITS.links}`)
    else {
      const links: HubLink[] = []
      for (const item of raw.links) {
        const entry = record(item)
        const label = typeof entry.label === 'string' ? entry.label.trim() : ''
        const url = typeof entry.url === 'string' ? entry.url.trim() : ''
        if (!label || label.length > HUB_LIMITS.label) errors.push(`a link label is 1 to ${HUB_LIMITS.label} characters`)
        else if (url.length > HUB_LIMITS.url || !safeHttpUrl(url)) errors.push(`the link "${label}" needs an http(s) URL`)
        else links.push({ label, url: safeHttpUrl(url) })
      }
      config.links = links
    }
  }
  if (raw.widgetHome !== undefined) {
    const home = record(raw.widgetHome)
    if (typeof raw.widgetHome !== 'object' || Array.isArray(raw.widgetHome) || raw.widgetHome === null) errors.push('widgetHome must be an object')
    if (home.enabled !== undefined) {
      if (typeof home.enabled !== 'boolean') errors.push('widgetHome.enabled must be true or false')
      else config.widgetHome.enabled = home.enabled
    }
    if (home.sections !== undefined) {
      const sections = pickList(home.sections, HUB_HOME_SECTIONS, 'widgetHome.sections', errors)
      if (sections) config.widgetHome.sections = sections
    }
  }
  return { config, errors }
}

/** The page's heading: the title set, else the project's name. */
export const hubTitle = (config: Pick<HubConfig, 'title'>, projectName: string): string => config.title || projectName

/** Whether the page lists `section` at all (it still needs content to appear). */
export const hubShows = (config: HubConfig, section: HubSection): boolean => config.sections.includes(section)
