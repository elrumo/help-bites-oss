// A project's sections as the sidebar groups them, and which of them a project
// may hide. The panel's copy is app/utils/projectSections.ts (icons, plan locks);
// the native app's is Shell/Workspace.swift (`ProjectSection`), kept in step by
// tests/projectSectionsNativeParity.test.ts. Hiding only takes a section out of
// navigation: its pages and API keep working.

export const SECTION_GROUPS = ['support', 'product', 'grow', 'site', 'build'] as const
export type SectionGroup = typeof SECTION_GROUPS[number]

/** In sidebar order. A section with no group stands outside the groups: Overview above them, Settings below. */
export const PROJECT_SECTION_GROUPS: Record<string, SectionGroup | null> = {
  overview: null,
  conversations: 'support',
  knowledge: 'support',
  assistants: 'support',
  types: 'support',
  feedback: 'product',
  board: 'product',
  changelog: 'product',
  onboarding: 'product',
  contacts: 'grow',
  forms: 'grow',
  email: 'grow',
  revenue: 'grow',
  pages: 'site',
  blog: 'site',
  legal: 'site',
  brand: 'site',
  errors: 'build',
  flags: 'build',
  dev: 'build',
  settings: null
}

export const PROJECT_SECTION_PATHS = Object.keys(PROJECT_SECTION_GROUPS)

/** Where you land and where this is undone: a project cannot hide its way out of either. */
export const ALWAYS_SHOWN_SECTIONS = ['overview', 'settings']

export const HIDEABLE_SECTIONS = PROJECT_SECTION_PATHS.filter(path => !ALWAYS_SHOWN_SECTIONS.includes(path))

/** The sections to hide, as stored: known and hideable paths, once each, in sidebar order. Anything else is dropped. */
export function normalizeHiddenSections(value: unknown): string[] {
  const asked = new Set(Array.isArray(value) ? value.map(item => String(item)) : [])
  return HIDEABLE_SECTIONS.filter(path => asked.has(path))
}

/** Like normalizeHiddenSections, but names what it would drop, so a PATCH can say no instead of quietly ignoring it. */
export function validateHiddenSections(value: unknown): { hidden: string[], errors: string[] } {
  if (!Array.isArray(value)) return { hidden: [], errors: ['hiddenSections must be a list of section names'] }
  const unknown = value.map(item => String(item)).filter(path => !HIDEABLE_SECTIONS.includes(path))
  return { hidden: normalizeHiddenSections(value), errors: unknown.length ? [`hiddenSections cannot include ${[...new Set(unknown)].join(', ')}`] : [] }
}

/** The sidebar's layout: Overview, each group's visible sections (an empty group is left out), then Settings. */
export function groupSections<T extends { path: string }>(sections: T[], hidden: readonly string[] = []): { top: T[], groups: { group: SectionGroup, sections: T[] }[], bottom: T[] } {
  const shown = sections.filter(section => !hidden.includes(section.path) || ALWAYS_SHOWN_SECTIONS.includes(section.path))
  return {
    top: shown.filter(section => section.path === 'overview'),
    groups: SECTION_GROUPS.map(group => ({ group, sections: shown.filter(section => PROJECT_SECTION_GROUPS[section.path] === group) })).filter(entry => entry.sections.length),
    bottom: shown.filter(section => section.path === 'settings')
  }
}
