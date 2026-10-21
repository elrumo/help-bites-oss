import type { Conversation } from '#shared/support'
import type { Faq } from '~~/server/utils/faqs'

// ⌘K searches what is written, not only where things are: conversations and
// knowledge answers, from GET /v1/admin/search (Meilisearch; empty without it).
// These turn that response into palette rows.

export type SearchHits = {
  conversations: Conversation[]
  endUsers: Record<string, { name?: string, email?: string, externalId?: string }>
  faqs: Faq[]
}

export type PaletteHit = { id: string, label: string, suffix: string, icon: string, to: string }

/** Shorter terms match too much to be worth a request. */
export const MIN_SEARCH_LENGTH = 2

export const searchTerm = (raw: string) => raw.trim()
export const hasSearchTerm = (raw: string) => searchTerm(raw).length >= MIN_SEARCH_LENGTH

const oneLine = (text: string, max = 90) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** A conversation row: who it is with, and what it says, in the project it belongs to. */
export function conversationHits(hits: SearchHits | null, labels: { project: (id: string) => string, unknownCustomer: string }): PaletteHit[] {
  return (hits?.conversations || []).map((conversation) => {
    const user = hits?.endUsers[conversation.endUserId]
    const who = user?.name || user?.email || user?.externalId || labels.unknownCustomer
    const said = oneLine(conversation.subject || conversation.lastMessagePreview || '')
    const project = labels.project(conversation.projectId)
    return { id: `c:${conversation.id}`, label: who, suffix: [project, said].filter(Boolean).join(' · '), icon: 'i-lucide-message-square', to: `/inbox?c=${conversation.id}` }
  })
}

/** A knowledge answer row, opening the model it lives in. */
export function faqHitsOf(hits: SearchHits | null): PaletteHit[] {
  return (hits?.faqs || []).map(faq => ({ id: `f:${faq.id}`, label: oneLine(faq.question, 120), suffix: oneLine(faq.answer), icon: 'i-lucide-book-open', to: `/knowledge/models/${faq.modelId}` }))
}
