import { renderChangelogBody } from './changelogRender'
import { escapeHtml } from './messageEmail'
import type { LegalSection } from '#shared/legal/types'

// A legal document's sections → the HTML the hosted page serves. Each section's
// Markdown goes through the changelog's sanitiser (one allowlist, no `id`
// attribute, no scripts); the wrapper — the `<section id>` and its heading — is
// built here from plain text, so a heading can never inject markup. Pure, so it
// unit-tests without a database.

/** One URL fragment per section, unique within the document. */
export function sectionAnchors(sections: Pick<LegalSection, 'heading'>[]): string[] {
  const seen = new Map<string, number>()
  return sections.map((section, index) => {
    const base = section.heading.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `section-${index + 1}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  })
}

export function legalToc(sections: LegalSection[]): { id: string, title: string }[] {
  const ids = sectionAnchors(sections)
  return sections.map((section, i) => ({ id: ids[i]!, title: section.heading }))
}

export function renderLegalHtml(sections: LegalSection[]): string {
  const ids = sectionAnchors(sections)
  return sections
    .map((section, i) => `<section id="${ids[i]}"><h2>${escapeHtml(section.heading)}</h2>${renderChangelogBody(section.body, 'markdown')}</section>`)
    .join('\n')
}
