import type { Feature } from '#shared/entitlements'
import { groupSections } from '#shared/projectSections'

// A project's sections, nested under it in the sidebar like a Linear team's and
// grouped as shared/projectSections.ts says.
// `feature`: the plan feature the section needs (shared/entitlements.ts); the
// sidebar marks it when the workspace's plan leaves it out.
export type ProjectSection = { path: string, label: string, icon: string, feature?: Feature }

export const projectSections: ProjectSection[] = [
  { path: 'overview', label: 'Overview', icon: 'i-lucide-layout-dashboard' },
  { path: 'conversations', label: 'Conversations', icon: 'i-lucide-inbox' },
  { path: 'knowledge', label: 'Knowledge base', icon: 'i-lucide-book-open' },
  { path: 'assistants', label: 'Assistants', icon: 'i-lucide-sparkles' },
  { path: 'types', label: 'Ticket types', icon: 'i-lucide-ticket' },
  { path: 'feedback', label: 'Feedback', icon: 'i-lucide-lightbulb' },
  { path: 'board', label: 'Planning', icon: 'i-lucide-square-kanban' },
  { path: 'changelog', label: 'Changelog', icon: 'i-lucide-scroll-text' },
  { path: 'onboarding', label: 'Onboarding', icon: 'i-lucide-gallery-horizontal-end' },
  { path: 'contacts', label: 'Contacts', icon: 'i-lucide-users' },
  { path: 'forms', label: 'Forms', icon: 'i-lucide-clipboard-list' },
  { path: 'email', label: 'Email', icon: 'i-lucide-mail' },
  { path: 'revenue', label: 'Revenue', icon: 'i-lucide-circle-dollar-sign' },
  { path: 'pricing', label: 'Pricing', icon: 'i-lucide-tags' },
  { path: 'pages', label: 'Pages', icon: 'i-lucide-layout-template' },
  { path: 'blog', label: 'Blog', icon: 'i-lucide-newspaper' },
  { path: 'legal', label: 'Legal', icon: 'i-lucide-scale', feature: 'legalDocs' },
  { path: 'brand', label: 'Brand', icon: 'i-lucide-swatch-book' },
  { path: 'errors', label: 'Errors', icon: 'i-lucide-bug' },
  { path: 'flags', label: 'Flags', icon: 'i-lucide-toggle-right' },
  { path: 'dev', label: 'Install & API', icon: 'i-lucide-code-xml' },
  { path: 'settings', label: 'Settings', icon: 'i-lucide-settings' }
]

/** A project's sections in sidebar order, without the ones it hid: what the ⌘K palette lists. */
export function visibleSections(hidden: readonly string[] | undefined): ProjectSection[] {
  const { top, groups, bottom } = groupSections(projectSections, hidden || [])
  return [...top, ...groups.flatMap(entry => entry.sections), ...bottom]
}
