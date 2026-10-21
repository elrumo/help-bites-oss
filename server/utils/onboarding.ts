import { createError, getHeader, getQuery, getRouterParam, setResponseHeader, type H3Event } from 'h3'
import { matchLocale, normalizeLocale, parseAcceptLanguage } from '#shared/locales'
import {
  DEFAULT_ONBOARDING_OPTIONS, DEFAULT_ONBOARDING_STYLE, ONBOARDING_KEY, ONBOARDING_LIMITS, localizeOnboarding, normalizeOnboardingOptions, normalizeOnboardingStyle,
  onboardingKeyFrom, onboardingLocaleOf, onboardingStepsOf, onboardingTexts, onboardingTranslationsOf, starterSteps, translationFromTexts, translationTexts,
  validateOnboardingOptions, validateOnboardingStyle, validateOnboardingSteps, validateOnboardingTranslations,
  type OnboardingOptions, type OnboardingStep, type OnboardingStyle, type OnboardingTranslations, type PublicOnboardingFlow
} from '#shared/onboarding'
import { readTargetLocales, translateMissing } from './translate'
import { lookOf } from './projects'

// Onboarding flows: the store behind /v1/admin/onboarding and the public read.
// A flow keeps a working copy (steps, style, options) and, once published, a
// frozen `published` copy with a version number: editing never changes what
// apps see until the operator publishes again.

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** The project an operator names with `?project=` (or `project` in a JSON body). */
export async function onboardingProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

export async function getOnboardingFlow(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('OnboardingFlow').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Flow not found' })
  }
}

export async function scopedOnboardingFlow(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.onboardingFlow(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listOnboardingFlows(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('OnboardingFlow').equalTo('project', project).ascending('createdAt').limit(ONBOARDING_LIMITS.flows).find(MASTER)
}

async function findFlowByKey(project: ParseObject, key: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('OnboardingFlow').equalTo('project', project).equalTo('key', key).first(MASTER) || null
}

function readKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!ONBOARDING_KEY.test(key)) badRequest('key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit')
  return key
}

async function assertKeyFree(project: ParseObject, key: string, exceptId?: string): Promise<void> {
  const taken = await findFlowByKey(project, key)
  if (taken && taken.id !== exceptId) throw createError({ statusCode: 409, statusMessage: `Another flow already uses the key "${key}"` })
}

const contentOf = (row: ParseObject) => ({
  steps: onboardingStepsOf(row.get('steps')),
  style: normalizeOnboardingStyle(row.get('style')),
  options: normalizeOnboardingOptions(row.get('options')),
  locale: onboardingLocaleOf(row.get('locale')),
  translations: onboardingTranslationsOf(row.get('translations'))
})

/** The project's look (Brand kit) fills what a flow leaves to it. */
export function flowProjectLook(project: ParseObject) {
  const look = lookOf(project)
  return { name: look.name, accent: look.accent, logoUrl: look.logoUrl || look.iconUrl }
}

type Snapshot = { name: string, steps: OnboardingStep[], style: OnboardingStyle, options: OnboardingOptions, locale: string, translations: OnboardingTranslations }

/** What an app receives for a published snapshot, in the first of `wanted` the flow has (its own language otherwise). */
function toPublicFlow(project: ParseObject, row: ParseObject, snapshot: Snapshot, wanted: unknown[] = []): PublicOnboardingFlow {
  const look = flowProjectLook(project)
  // A language added but not yet written has nothing to show: it is not offered.
  const locales = [snapshot.locale, ...Object.entries(snapshot.translations).filter(([, t]) => t.name || Object.keys(t.steps).length).map(([tag]) => tag)]
  const locale = matchLocale(wanted, locales) || snapshot.locale
  const { name, steps } = localizeOnboarding(snapshot.name, snapshot.steps, snapshot.translations[locale])
  return {
    key: String(row.get('key') || ''),
    name,
    locale,
    locales,
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    publishedAt: iso(row.get('publishedAt')),
    project: { name: look.name, logoUrl: look.logoUrl },
    style: { ...snapshot.style, accent: snapshot.style.accent || look.accent },
    options: snapshot.options,
    steps
  }
}

function publishedOf(row: ParseObject): Snapshot | null {
  const raw = row.get('published') as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  return { name: String(raw.name || ''), steps: onboardingStepsOf(raw.steps), style: normalizeOnboardingStyle(raw.style), options: normalizeOnboardingOptions(raw.options), locale: onboardingLocaleOf(raw.locale), translations: onboardingTranslationsOf(raw.translations) }
}

export function serializeOnboardingFlow(project: ParseObject, row: ParseObject) {
  const content = contentOf(row)
  const published = publishedOf(row)
  const status = row.get('status') === 'published' && published ? 'published' : 'draft'
  return {
    id: row.id || '',
    key: String(row.get('key') || ''),
    name: String(row.get('name') || ''),
    status,
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    ...content,
    /** The working copy differs from what apps get. */
    changed: status === 'published' && JSON.stringify({ name: String(row.get('name') || ''), ...content }) !== JSON.stringify(published),
    /** What apps get now (with the project's accent filled in), or null while it is a draft. */
    published: status === 'published' && published ? toPublicFlow(project, row, published) : null,
    publishedAt: iso(row.get('publishedAt')),
    path: `/v1/onboarding/${String(project.get('publicKey') || '')}/${String(row.get('key') || '')}`,
    updatedAt: iso(row.updatedAt)
  }
}

/** Applies a create or PATCH body; only the keys present change. */
async function applyInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const errors: string[] = []
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > ONBOARDING_LIMITS.name) errors.push(`name is 1 to ${ONBOARDING_LIMITS.name} characters`)
    else row.set('name', name)
  }
  if (body.key !== undefined) {
    const key = readKey(body.key)
    await assertKeyFree(project, key, row.id)
    row.set('key', key)
  }
  if (body.steps !== undefined) {
    const result = validateOnboardingSteps(body.steps)
    errors.push(...result.errors)
    if (!result.errors.length) row.set('steps', result.steps)
  }
  if (body.style !== undefined) {
    const result = validateOnboardingStyle(body.style, normalizeOnboardingStyle(row.get('style')))
    errors.push(...result.errors)
    if (!result.errors.length) row.set('style', result.style)
  }
  if (body.options !== undefined) {
    const result = validateOnboardingOptions(body.options, normalizeOnboardingOptions(row.get('options')))
    errors.push(...result.errors)
    if (!result.errors.length) row.set('options', result.options)
  }
  if (body.locale !== undefined) {
    const locale = normalizeLocale(body.locale)
    if (!locale) errors.push('locale must be a language tag such as "en" or "pt-BR"')
    else row.set('locale', locale)
  }
  if (body.translations !== undefined) {
    const steps = body.steps !== undefined ? validateOnboardingSteps(body.steps).steps : onboardingStepsOf(row.get('steps'))
    const result = validateOnboardingTranslations(body.translations, steps, onboardingLocaleOf(row.get('locale')), onboardingTranslationsOf(row.get('translations')))
    errors.push(...result.errors)
    if (!result.errors.length) row.set('translations', result.translations)
  }
  if (errors.length) badRequest(errors.join('; '))
}

export async function createOnboardingFlow(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  if ((await listOnboardingFlows(project)).length >= ONBOARDING_LIMITS.flows) badRequest(`A project has at most ${ONBOARDING_LIMITS.flows} flows`)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Welcome'
  const row = new (useParse().Object.extend('OnboardingFlow'))() as ParseObject
  row.set('project', project)
  row.set('status', 'draft')
  row.set('version', 0)
  row.set('name', name.slice(0, ONBOARDING_LIMITS.name))
  row.set('steps', starterSteps(String(project.get('name') || '')))
  row.set('style', DEFAULT_ONBOARDING_STYLE)
  row.set('options', DEFAULT_ONBOARDING_OPTIONS)
  // A key derived from the name gets a number until it is free; one sent explicitly must be free.
  if (body.key === undefined) {
    const base = onboardingKeyFrom(name)
    let key = base
    for (let n = 2; await findFlowByKey(project, key); n++) key = `${base.slice(0, 36)}-${n}`
    row.set('key', key)
  }
  await applyInput(project, row, { ...body, name: undefined })
  await row.save(null, MASTER)
  return row
}

export async function updateOnboardingFlow(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  await applyInput(project, row, body)
  await row.save(null, MASTER)
}

/**
 * Machine-translates the working copy into each language (saved as a translation the operator can edit).
 * Strings already translated are kept unless `overwrite`. Nothing reaches apps until the next publish.
 */
export async function translateOnboardingFlow(ctx: MemberContext, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const { steps, locale, translations } = contentOf(row)
  const source = onboardingTexts(String(row.get('name') || ''), steps)
  if (!Object.keys(source).length) badRequest('The flow has no text to translate')
  const next = { ...translations }
  for (const to of readTargetLocales(body.locales, locale)) {
    const texts = await translateMissing(ctx, source, translationTexts(translations[to]), { from: locale, to, context: 'onboarding', overwrite: body.overwrite === true })
    next[to] = translationFromTexts(texts, steps)
  }
  row.set('translations', next)
  await row.save(null, MASTER)
}

export async function publishOnboardingFlow(row: ParseObject): Promise<void> {
  const content = contentOf(row)
  if (!content.steps.length) badRequest('A flow with no steps cannot be published')
  row.set('published', { name: String(row.get('name') || ''), ...content })
  row.set('version', (typeof row.get('version') === 'number' ? row.get('version') as number : 0) + 1)
  row.set('status', 'published')
  row.set('publishedAt', new Date())
  await row.save(null, MASTER)
}

/** Apps get a 404 and stop showing it; the published copy is kept for the next publish to replace. */
export async function unpublishOnboardingFlow(row: ParseObject): Promise<void> {
  row.set('status', 'draft')
  await row.save(null, MASTER)
}

// ---- public reads ----------------------------------------------------------------

export async function publicOnboardingFlow(event: H3Event): Promise<PublicOnboardingFlow> {
  await rateLimit(`sb:rl:onboardingread:${clientIp(event) || 'ip'}`, LIMITS.onboardingReadsPerIp.limit, LIMITS.onboardingReadsPerIp.window)
  const project = await findProjectByPublicKey(getRouterParam(event, 'pk') || '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const key = String(getRouterParam(event, 'key') || '').toLowerCase()
  const row = ONBOARDING_KEY.test(key) ? await findFlowByKey(project, key) : null
  const published = row && row.get('status') === 'published' ? publishedOf(row) : null
  if (!row || !published) throw createError({ statusCode: 404, statusMessage: 'Flow not found' })
  setResponseHeader(event, 'Vary', 'Accept-Language')
  // ?locale=es wins over the browser's Accept-Language; a language the flow lacks gets the flow's own.
  const wanted = [getQuery(event).locale, ...parseAcceptLanguage(getHeader(event, 'accept-language'))]
  return toPublicFlow(project, row, published, wanted)
}

// ---- who finished it ---------------------------------------------------------------

/** Remember that a person finished or skipped a published flow; the latest outcome replaces the one before. */
export async function recordOnboardingOutcome(project: ParseObject, endUser: ParseObject, flowKey: string, outcome: 'completed' | 'skipped'): Promise<void> {
  const flow = ONBOARDING_KEY.test(flowKey) ? await findFlowByKey(project, flowKey) : null
  // Only a flow people can see: a draft's key is not confirmed to anyone.
  if (!flow || flow.get('status') !== 'published') throw createError({ statusCode: 404, statusMessage: 'Flow not found' })
  const Parse = useParse()
  const row = (await new Parse.Query('OnboardingCompletion').equalTo('project', project).equalTo('endUser', endUser).equalTo('flow', flowKey).first(MASTER)) || new (Parse.Object.extend('OnboardingCompletion'))() as ParseObject
  row.set('project', project)
  row.set('endUser', endUser)
  row.set('flow', flowKey)
  row.set('outcome', outcome)
  row.set('version', Number(flow.get('version') || 0))
  row.set('at', new Date())
  await row.save(null, MASTER)
  await emitDomainEvent(project, 'onboarding.completed', { flow: flowKey, outcome, contact: { id: endUser.id, externalId: endUser.get('externalId') || '', email: endUser.get('email') || '' } })
}
