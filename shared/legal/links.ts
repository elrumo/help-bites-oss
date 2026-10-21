import { LEGAL_DOC_TYPES, type LegalDocType } from './types'

// The public addresses of a project's published legal documents, kept on the
// project (`Project.legalLinks`) so an email can say `{{project.privacyUrl}}`
// without a query. Refreshed whenever a document is published, unpublished,
// renamed or deleted (server/utils/legalLinks.ts).

export type LegalLinks = { privacyUrl: string, termsUrl: string, cookiesUrl: string, refundUrl: string }

export const EMPTY_LEGAL_LINKS: LegalLinks = { privacyUrl: '', termsUrl: '', cookiesUrl: '', refundUrl: '' }

export const LEGAL_LINK_KEY: Record<LegalDocType, keyof LegalLinks> = { privacy: 'privacyUrl', terms: 'termsUrl', cookies: 'cookiesUrl', refund: 'refundUrl' }

export function normalizeLegalLinks(value: unknown): LegalLinks {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>
  const out = { ...EMPTY_LEGAL_LINKS }
  for (const key of Object.keys(out) as (keyof LegalLinks)[]) {
    const url = typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
    if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) out[key] = url
  }
  return out
}

export type PublishedLegalDoc = { type: string, slug: string, translationOf?: string | null, publishedAt?: string | Date | null }

const time = (value: PublishedLegalDoc['publishedAt']) => (value ? new Date(value).getTime() || 0 : 0)

/**
 * One link per document type: the original-language document (not a
 * translation) published last, else any published one. `base` is the app's
 * public origin; with none there is nothing absolute to link to, so all blank.
 */
export function buildLegalLinks(docs: PublishedLegalDoc[], base: string, publicKey: string): LegalLinks {
  const origin = String(base || '').trim().replace(/\/+$/, '')
  const out = { ...EMPTY_LEGAL_LINKS }
  if (!origin || !publicKey) return out
  for (const type of LEGAL_DOC_TYPES) {
    const ofType = docs.filter(d => d.type === type && d.slug)
    const best = [...ofType].sort((a, b) => Number(!a.translationOf) === Number(!b.translationOf) ? time(b.publishedAt) - time(a.publishedAt) : Number(!b.translationOf) - Number(!a.translationOf))[0]
    if (best) out[LEGAL_LINK_KEY[type]] = `${origin}/legal/${encodeURIComponent(publicKey)}/${encodeURIComponent(best.slug)}`
  }
  return out
}
