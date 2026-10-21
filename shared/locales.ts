// Languages for the content HelpBites serves to end users (onboarding, legal pages,
// emails). Not the panel's own languages: those are the i18n/locales files.
// A locale is a BCP 47 tag kept in one spelling: "es", "pt-BR", "zh-Hant".

/** Offered by the pickers; any well-formed tag is accepted. */
export const COMMON_LOCALES = ['en', 'es', 'ca', 'fr', 'de', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'zh', 'zh-TW'] as const

export const DEFAULT_CONTENT_LOCALE = 'en'

const TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i

/** "pt_br" → "pt-BR", "ZH-hant" → "zh-Hant"; null when it is not a language tag. */
export function normalizeLocale(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().replace(/_/g, '-') : ''
  if (!raw || raw.length > 20 || !TAG.test(raw)) return null
  const [lang, ...rest] = raw.split('-')
  return [lang!.toLowerCase(), ...rest.map(part => (part.length === 2 ? part.toUpperCase() : part.length === 4 ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase()))].join('-')
}

/** The language's own name for itself ("Español"), or in `inLocale`; the tag when the runtime does not know it. */
export function localeName(locale: string, inLocale = locale): string {
  try {
    return new Intl.DisplayNames([inLocale], { type: 'language' }).of(locale) || locale
  } catch {
    return locale
  }
}

/** The tags of an Accept-Language header, best first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return String(header || '').split(',').map((part, index) => {
    const [tag = '', ...params] = part.trim().split(';')
    const q = Number(params.map(p => p.trim()).find(p => p.startsWith('q='))?.slice(2) ?? 1)
    return { tag: normalizeLocale(tag), q: Number.isFinite(q) ? q : 0, index }
  }).filter((entry): entry is { tag: string, q: number, index: number } => !!entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index).map(entry => entry.tag)
}

/** The first wanted language that `available` has: the exact tag, then the same language ("es-MX" gets "es"). Null when none. */
export function matchLocale(wanted: unknown[], available: string[]): string | null {
  const have = available.map(tag => ({ tag, key: tag.toLowerCase() }))
  for (const item of wanted) {
    const tag = normalizeLocale(item)
    if (!tag) continue
    const exact = have.find(h => h.key === tag.toLowerCase())
    if (exact) return exact.tag
    const base = tag.split('-')[0]!.toLowerCase()
    const near = have.find(h => h.key.split('-')[0] === base)
    if (near) return near.tag
  }
  return null
}
