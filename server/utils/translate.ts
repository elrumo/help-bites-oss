import { createError } from 'h3'
import { extractJson } from '#shared/legal/compose'
import { normalizeLocale } from '#shared/locales'
import { isFaithful, mergeTranslated, parseTranslation, translatable, translationBatches, translationSystemPrompt, TRANSLATE_LIMITS, type TranslateContext } from '#shared/translate'

// Auto-translation for onboarding flows, legal documents and emails. It runs through
// resolveAi like every other AI feature: the workspace's own provider when it has one,
// else the server's gateway, metered in credits. 501 when no AI is configured.
// shared/translate.ts decides what a safe answer looks like.

const TRANSLATE_TIMEOUT_MS = 120_000

async function routeFor(ctx: MemberContext) {
  await rateLimit(`sb:rl:translate:${ctx.agentId}`, LIMITS.translatePerAgent.limit, LIMITS.translatePerAgent.window)
  const route = await resolveAi(ctx.workspace)
  if (!route) throw createError({ statusCode: 501, statusMessage: 'No AI provider is configured. Add one in the workspace AI settings, or set LITELLM_API_BASE_URL on the server.' })
  return route
}

/** The locales of a request body (`locales: ['es', 'fr']`), cleaned, without the source language. */
export function readTargetLocales(value: unknown, source: string): string[] {
  const list = Array.isArray(value) ? value : []
  const out = [...new Set(list.map(normalizeLocale).filter((tag): tag is string => !!tag && tag.toLowerCase() !== source.toLowerCase()))]
  if (!out.length) throw createError({ statusCode: 400, statusMessage: `Pass "locales": a list of language tags other than ${source}, such as ["es", "fr"]` })
  if (out.length > TRANSLATE_LIMITS.locales) throw createError({ statusCode: 400, statusMessage: `At most ${TRANSLATE_LIMITS.locales} languages per request` })
  return out
}

/**
 * `source` translated from one language into another, key for key. A string that is not
 * worth translating (no letters) or whose answer lost a placeholder, URL or tag is left
 * out of the result, so the caller's fallback (the source text) applies.
 */
export async function translateStrings(ctx: MemberContext, source: Record<string, string>, opts: { from: string, to: string, context: TranslateContext }): Promise<Record<string, string>> {
  const entries = Object.entries(source).filter(([, text]) => translatable(text))
  if (entries.length > TRANSLATE_LIMITS.strings) throw createError({ statusCode: 400, statusMessage: `Too much to translate at once (${TRANSLATE_LIMITS.strings} strings at most)` })
  if (!entries.length) return {}
  const route = await routeFor(ctx)
  const system = translationSystemPrompt(opts.from, opts.to, opts.context)
  const out: Record<string, string> = {}

  for (const batch of translationBatches(entries)) {
    let translated: string[] | null = null
    // One retry: a model that returns the wrong number of strings usually gets it right the second time.
    for (let attempt = 0; attempt < 2 && !translated; attempt++) {
      const { text } = await chatCompletion(route, {
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(batch.map(([, text]) => text)) }],
        temperature: 0.2,
        max_tokens: 8000
      }, { timeoutMs: TRANSLATE_TIMEOUT_MS })
      translated = parseTranslation(extractJson(text), batch.length)
    }
    if (!translated) throw createError({ statusCode: 502, statusMessage: 'The AI provider returned something that could not be used. Try again.' })
    batch.forEach(([key, original], i) => {
      const value = translated![i]!.trim()
      if (isFaithful(original, value)) out[key] = value
    })
  }
  return out
}

/**
 * The translation of `source` into `to`, keeping what is already translated unless
 * `overwrite`: only the missing strings are sent, so a person's edits survive a re-run.
 */
export async function translateMissing(ctx: MemberContext, source: Record<string, string>, existing: Record<string, string>, opts: { from: string, to: string, context: TranslateContext, overwrite?: boolean }): Promise<Record<string, string>> {
  const todo = Object.fromEntries(Object.entries(source).filter(([key]) => opts.overwrite || !existing[key]))
  return mergeTranslated(source, existing, await translateStrings(ctx, todo, opts))
}
