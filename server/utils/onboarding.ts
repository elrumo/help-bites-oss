import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import {
  DEFAULT_ONBOARDING_OPTIONS, DEFAULT_ONBOARDING_STYLE, ONBOARDING_KEY, ONBOARDING_LIMITS, normalizeOnboardingOptions, normalizeOnboardingStyle,
  onboardingKeyFrom, onboardingStepsOf, starterSteps, validateOnboardingOptions, validateOnboardingStyle, validateOnboardingSteps,
  type OnboardingOptions, type OnboardingStep, type OnboardingStyle, type PublicOnboardingFlow
} from '#shared/onboarding'

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
  options: normalizeOnboardingOptions(row.get('options'))
})

/** The project's accent and logo fill what a flow leaves to them. */
function projectLook(project: ParseObject) {
  const theme = (project.get('theme') || {}) as { accent?: string }
  return {
    name: String(project.get('name') || ''),
    accent: /^#[0-9a-f]{6}$/i.test(String(theme.accent || '')) ? String(theme.accent).toLowerCase() : '#5e6ad2',
    logoUrl: [String(project.get('iconUrl') || ''), String(project.get('brandLogoUrl') || '')].find(url => /^https?:\/\//.test(url)) || ''
  }
}

type Snapshot = { name: string, steps: OnboardingStep[], style: OnboardingStyle, options: OnboardingOptions }

/** What an app receives for a published snapshot. */
function toPublicFlow(project: ParseObject, row: ParseObject, snapshot: Snapshot): PublicOnboardingFlow {
  const look = projectLook(project)
  return {
    key: String(row.get('key') || ''),
    name: snapshot.name,
    version: typeof row.get('version') === 'number' ? row.get('version') as number : 0,
    publishedAt: iso(row.get('publishedAt')),
    project: { name: look.name, logoUrl: look.logoUrl },
    style: { ...snapshot.style, accent: snapshot.style.accent || look.accent },
    options: snapshot.options,
    steps: snapshot.steps
  }
}

function publishedOf(row: ParseObject): Snapshot | null {
  const raw = row.get('published') as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  return { name: String(raw.name || ''), steps: onboardingStepsOf(raw.steps), style: normalizeOnboardingStyle(raw.style), options: normalizeOnboardingOptions(raw.options) }
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
  return toPublicFlow(project, row, published)
}
