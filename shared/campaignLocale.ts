// Which language a mass email goes out in. A campaign, a sequence step or a lead
// form's welcome email is one frozen design (server/utils/campaigns.ts
// snapshotCampaign) plus the translations its template has. Each recipient gets
// the best match for their own language (Contact.language); anyone whose
// language the template lacks, or who has none, gets the template's own.
// Pure, so the choice is tested without a database.

import type { EmailDocument } from './email/blocks'
import { localizeEmail, type EmailStrings } from './email/translate'
import { DEFAULT_CONTENT_LOCALE, matchLocale } from './locales'

/** The part of a campaign snapshot that decides the language. Snapshots from before translations have neither field. */
export type LocalizableSnapshot = { document: EmailDocument, locale?: string, translations?: Record<string, EmailStrings> }

/** The template's own language. */
export const snapshotLocale = (snapshot: LocalizableSnapshot): string => snapshot.locale || DEFAULT_CONTENT_LOCALE

/** The translations that have words in them; a language added but not yet written is not offered. */
function written(snapshot: LocalizableSnapshot): [string, EmailStrings][] {
  return Object.entries(snapshot.translations || {}).filter(([tag, strings]) => tag !== snapshotLocale(snapshot) && Object.values(strings).some(Boolean))
}

/** Every language the email can go out in, its own first. */
export const snapshotLocales = (snapshot: LocalizableSnapshot): string[] => [snapshotLocale(snapshot), ...written(snapshot).map(([tag]) => tag)]

/** The language a person's email goes out in: the closest the template has to theirs ("es-MX" gets "es"), else its own. */
export function localeForLanguage(language: string, snapshot: LocalizableSnapshot): string {
  const available = snapshotLocales(snapshot)
  return matchLocale([language], available) || available[0]!
}

/** People grouped by the language they get, in the order each language first appears. */
export function groupByLocale<T>(items: T[], languageOf: (item: T) => string, snapshot: LocalizableSnapshot): { locale: string, items: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const locale = localeForLanguage(languageOf(item), snapshot)
    const group = groups.get(locale)
    if (group) group.push(item)
    else groups.set(locale, [item])
  }
  return [...groups].map(([locale, list]) => ({ locale, items: list }))
}

/** The design in `locale`: the snapshot's own, or with that translation's words in place. */
export function snapshotDocument(snapshot: LocalizableSnapshot, locale: string): EmailDocument {
  const strings = locale === snapshotLocale(snapshot) ? null : snapshot.translations?.[locale]
  return strings ? localizeEmail(snapshot.document, strings) : snapshot.document
}

/** Every translated design, by language, to check each one before anything is sent. */
export function translatedDocuments(snapshot: LocalizableSnapshot): { locale: string, document: EmailDocument }[] {
  return written(snapshot).map(([locale]) => ({ locale, document: snapshotDocument(snapshot, locale) }))
}

/**
 * The subject to put on a message in `locale`. A campaign's own subject line is
 * written in the template's language, so a translation that carries a subject
 * of its own replaces it; with none, the campaign's line is used as it is.
 */
export function subjectForLocale(snapshot: LocalizableSnapshot, locale: string, subject: string): string {
  return locale !== snapshotLocale(snapshot) && snapshot.translations?.[locale]?.subject ? '' : subject
}
