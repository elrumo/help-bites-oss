import { createError } from 'h3'
import { emailTexts } from '#shared/email/translate'
import { readTargetLocales, translateMissing } from './translate'
import { EMAIL_MAX_TRANSLATIONS, readTranslations, serializeEmailTemplate, storeTranslations } from './emails'

/**
 * Machine-translates a template's words (subject, preheader, headings, text, buttons,
 * image descriptions, component text) into each language and saves them next to the design.
 * Strings already translated are kept unless `overwrite`. The caller saves the row. A linked row has no design of its
 * own: translate its master.
 */
export async function translateEmailTemplate(ctx: MemberContext, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const template = serializeEmailTemplate(row)
  if (template.masterId) throw createError({ statusCode: 400, statusMessage: 'A linked template uses its master\'s translations. Translate the master instead.' })
  const source = template.document ? emailTexts(template.document) : {}
  if (!Object.keys(source).length) throw createError({ statusCode: 400, statusMessage: 'The template has no text to translate' })
  const targets = readTargetLocales(body.locales, template.locale)
  const next = readTranslations(row.get('translations'))
  if (Object.keys({ ...next, ...Object.fromEntries(targets.map(t => [t, 1])) }).length > EMAIL_MAX_TRANSLATIONS) throw createError({ statusCode: 400, statusMessage: `A template has at most ${EMAIL_MAX_TRANSLATIONS} translations` })
  for (const to of targets) {
    next[to] = await translateMissing(ctx, source, next[to] || {}, { from: template.locale, to, context: 'email', overwrite: body.overwrite === true })
  }
  storeTranslations(row, next)
}
