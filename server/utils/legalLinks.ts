import { buildLegalLinks, normalizeLegalLinks, type LegalLinks } from '#shared/legal/links'
import { forgetProject } from './projects'
import { MASTER, iso, useParse, type ParseObject } from './parse'

export type { LegalLinks }

/** The saved links (see shared/legal/links.ts); blank for a type with no published document. */
export const legalLinksOf = (project: { get: (key: string) => unknown }): LegalLinks => normalizeLegalLinks(project.get('legalLinks'))

/**
 * Recompute `Project.legalLinks` from the published documents. Call it after a
 * document is published, unpublished, renamed or deleted, so email can read the
 * links synchronously (emails.ts brandOf). Writes only when something changed.
 */
export async function refreshLegalLinks(project: ParseObject): Promise<LegalLinks> {
  const rows = await new (useParse()).Query('LegalDocument').equalTo('project', project).equalTo('status', 'published').limit(200).find(MASTER)
  const docs = rows.map(r => ({ type: String(r.get('type') || ''), slug: String(r.get('slug') || ''), translationOf: String(r.get('translationOf') || ''), publishedAt: iso(r.get('publishedAt')) }))
  const next = buildLegalLinks(docs, String(process.env.APP_URL || ''), String(project.get('publicKey') || ''))
  const before = legalLinksOf(project)
  if ((Object.keys(next) as (keyof LegalLinks)[]).every(key => next[key] === before[key])) return before
  project.set('legalLinks', next)
  await project.save(null, MASTER)
  forgetProject(String(project.get('publicKey') || ''))
  return next
}
