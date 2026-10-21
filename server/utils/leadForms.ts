import { randomUUID } from 'node:crypto'
import { createError, getHeader, getQuery, getRouterParam, type H3Event } from 'h3'
import { extractTemplateVariables } from '#shared/email/placeholders'
import {
  DEFAULT_LEAD_SETTINGS, LEAD_FIELD_LABELS, LEAD_FILE_EXTENSIONS, LEAD_FORM_KEY, LEAD_FORM_WORDS, LEAD_FORM_LIMITS, LEAD_FORM_MAX_LOCALES, LEAD_FORM_PRESETS, checkLeadFiles, fillWords, leadFieldsOf,
  leadFormKeyFrom, leadFormLocaleOf, leadFormTexts, leadFormWords, leadOptionAliases, leadTranslationFromTexts, leadTranslationTexts, leadTranslationsOf, localizeLeadForm,
  normalizeLeadContent, normalizeLeadSettings, normalizeLeadStyle, presetForm, readLeadSubmission, validateLeadContent, validateLeadFields, validateLeadSettings, validateLeadStyle,
  validateLeadTranslations, type AcceptedLeadFile, type LeadFile, type LeadForm, type LeadFormPreset, type LeadFormSettings, type LeadFormWords, type PublicLeadField,
  type PublicLeadForm, type UploadedLeadFile
} from '#shared/leadForms'
import { matchLocale, normalizeLocale, parseAcceptLanguage } from '#shared/locales'
import { ALL_LEADS_SEGMENT, leadFormSegmentFilter } from '#shared/segments'
import type { PoweredBy } from './branding'
import { campaignEmails, publicBaseUrl, snapshotCampaign } from './campaigns'
import { contactQuery, findContactBy, saveContact, upsertContacts } from './contacts'
import { deliverEmails, type EmailActor } from './emailDelivery'
import { findProjectEmail } from './emails'
import { escapeHtml } from './messageEmail'
import { messagePage, pageBrand, renderMarketingPage, type PageBrand } from './marketingPages'
import { MASTER, iso, pointerId, useParse, type ParseObject } from './parse'
import { loadProjectUnscoped } from './projects'
import { LIMITS, rateLimit } from './rateLimit'
import { runExclusive } from './redis'
import { deleteDocumentObject, getDocumentBuffer, s3Configured, storeHiddenFile } from './s3'
import { readLinkToken, signLinkToken } from './secrets'
import { enrollContact, getProjectSequence } from './sequences'
import { projectConfirmTemplate, sendConfirmationEmail } from './signup'
import { readTargetLocales, translateMissing } from './translate'

// Lead forms: the store behind /v1/admin/lead-forms, the public form at
// /v1/forms/{pk}/{key} (read it, post to it), the hosted page at /f/{pk}/{key},
// and what happens once someone signs up. Every lead is a contact (through
// upsertContacts, so the consent rules are the sign-up form's): new people
// remember the form as their origin, everyone keeps the form's id in
// `leadForms`, and each form gets a segment of its own. With double opt-in a
// lead is `pending` until they press the button behind the link in the
// confirmation email; then (or right away without it) the form's welcome email
// goes out once and they start its sequence.
//
// A form is written in one language (`locale`) and may carry a translation per
// language: visitors get the one they ask for (`?locale=`, `locale` in the
// body, else the browser's), and so do its pages, its errors and its emails.
// Files sent through a file field are kept as LeadFile rows: the object sits
// under `<projectId>/forms/<formId>/` by an unguessable name and only goes out
// through the authenticated download route.

const CONFIRM_DAYS = 7
const FORM_ACTOR: EmailActor = { type: 'system', id: '', name: 'Lead form' }

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** The project an operator names with `?project=` (or `project` in a JSON body). */
export async function leadFormProject(ctx: MemberContext, event: H3Event, body?: Record<string, unknown>): Promise<ParseObject> {
  const named = String(getQuery(event).project || body?.project || '')
  if (!named) badRequest('Pass ?project=<projectId>')
  return await requireProject(ctx, named)
}

export async function getLeadForm(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('LeadForm').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Form not found' })
  }
}

export async function scopedLeadForm(ctx: MemberContext, event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  const row = await scoped.leadForm(ctx, getRouterParam(event, 'id') || '')
  return { row, project: await requireProject(ctx, pointerId(row.get('project'))) }
}

export async function listLeadForms(project: ParseObject): Promise<ParseObject[]> {
  return await new (useParse()).Query('LeadForm').equalTo('project', project).ascending('createdAt').limit(LEAD_FORM_LIMITS.forms).find(MASTER)
}

async function findFormByKey(project: ParseObject, key: string): Promise<ParseObject | null> {
  return await new (useParse()).Query('LeadForm').equalTo('project', project).equalTo('key', key).first(MASTER) || null
}

function readKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!LEAD_FORM_KEY.test(key)) badRequest('key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit')
  return key
}

async function assertKeyFree(project: ParseObject, key: string, exceptId?: string): Promise<void> {
  const taken = await findFormByKey(project, key)
  if (taken && taken.id !== exceptId) throw createError({ statusCode: 409, statusMessage: `Another form already uses the key "${key}"` })
}

/** The settings, with the ids that live in columns of their own (so a transfer can map them). */
function settingsOf(row: ParseObject): LeadFormSettings {
  return { ...normalizeLeadSettings(row.get('settings')), confirmTemplate: String(row.get('confirmTemplate') || ''), welcomeTemplate: String(row.get('welcomeTemplate') || ''), sequence: String(row.get('sequence') || '') }
}

export function serializeLeadForm(project: ParseObject, row: ParseObject, stats = { leads: 0, confirmed: 0 }): LeadForm {
  const pk = String(project.get('publicKey') || '')
  const key = String(row.get('key') || '')
  return {
    id: row.id || '',
    projectId: pointerId(row.get('project')),
    key,
    name: String(row.get('name') || ''),
    active: row.get('active') !== false,
    fields: leadFieldsOf(row.get('fields')),
    content: normalizeLeadContent(row.get('content')),
    style: normalizeLeadStyle(row.get('style')),
    settings: settingsOf(row),
    locale: leadFormLocaleOf(row.get('locale')),
    translations: leadTranslationsOf(row.get('translations')),
    segment: String(row.get('segment') || ''),
    stats,
    path: `/v1/forms/${pk}/${key}`,
    pagePath: `/f/${pk}/${key}`,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

/** Counted live from the contacts: erasing someone takes them out of the numbers too. */
export async function leadFormStats(project: ParseObject, formId: string): Promise<{ leads: number, confirmed: number }> {
  const [leads, confirmed] = await Promise.all([
    contactQuery(project).equalTo('leadForms', formId).count(MASTER),
    contactQuery(project).equalTo('leadForms', formId).equalTo('subscription', 'subscribed').count(MASTER)
  ])
  return { leads, confirmed }
}

export async function serializeLeadForms(project: ParseObject, rows: ParseObject[]): Promise<LeadForm[]> {
  return Promise.all(rows.map(async row => serializeLeadForm(project, row, await leadFormStats(project, row.id || ''))))
}

/** A template's send key (or id when it has none), after checking it exists and has a design. */
async function templateRef(project: ParseObject, ref: string, label: string, errors: string[], needs?: string): Promise<string> {
  try {
    const snapshot = await snapshotCampaign(project, ref)
    if (needs && !extractTemplateVariables(snapshot.document).includes(needs)) errors.push(`${label} needs a button or link to {{${needs}}}`)
    return snapshot.templateKey || snapshot.templateId
  } catch (error) {
    errors.push(`${label}: ${(error as { statusMessage?: string }).statusMessage || (error as Error).message}`)
    return ''
  }
}

/** Applies a create or PATCH body; only the keys present change. */
async function applyInput(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const errors: string[] = []
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > LEAD_FORM_LIMITS.name) errors.push(`name is 1 to ${LEAD_FORM_LIMITS.name} characters`)
    else row.set('name', name)
  }
  if (body.key !== undefined) {
    const key = readKey(body.key)
    await assertKeyFree(project, key, row.id)
    row.set('key', key)
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') errors.push('active must be true or false')
    else row.set('active', body.active)
  }
  if (body.locale !== undefined) {
    const locale = normalizeLocale(body.locale)
    if (!locale) errors.push('locale must be a language tag, such as "en" or "pt-BR"')
    else row.set('locale', locale)
  }
  if (body.fields !== undefined) {
    const result = validateLeadFields(body.fields)
    errors.push(...result.errors)
    if (result.fields.some(f => f.type === 'file') && !s3Configured()) errors.push('File fields need file storage: set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET on the server')
    if (!errors.length) row.set('fields', result.fields)
  }
  // Translations follow the fields and the language: a removed field's words go
  // with it, and a language the form is now written in is no longer a translation.
  if (body.translations !== undefined || body.fields !== undefined || body.locale !== undefined) {
    const fields = leadFieldsOf(row.get('fields'))
    const locale = leadFormLocaleOf(row.get('locale'))
    const ids = new Set(fields.map(f => f.id))
    const kept = Object.fromEntries(Object.entries(leadTranslationsOf(row.get('translations')))
      .filter(([tag]) => tag.toLowerCase() !== locale.toLowerCase())
      .map(([tag, t]) => [tag, { content: t.content, fields: Object.fromEntries(Object.entries(t.fields).filter(([id]) => ids.has(id))) }]))
    const result = body.translations === undefined ? { translations: kept, errors: [] } : validateLeadTranslations(body.translations, fields, locale, kept)
    errors.push(...result.errors)
    if (!errors.length) row.set('translations', result.translations)
  }
  if (body.content !== undefined) {
    const result = validateLeadContent(body.content, normalizeLeadContent(row.get('content')))
    errors.push(...result.errors)
    if (!result.errors.length) row.set('content', result.content)
  }
  if (body.style !== undefined) {
    const result = validateLeadStyle(body.style, normalizeLeadStyle(row.get('style')))
    errors.push(...result.errors)
    if (!result.errors.length) row.set('style', result.style)
  }
  if (body.settings !== undefined) {
    const before = settingsOf(row)
    const result = validateLeadSettings(body.settings, before)
    errors.push(...result.errors)
    const next = result.settings
    // Only what changed is looked up: a template deleted since keeps the form saveable.
    if (next.confirmTemplate && next.confirmTemplate !== before.confirmTemplate) next.confirmTemplate = await templateRef(project, next.confirmTemplate, 'The confirmation email', errors, 'confirmUrl')
    if (next.welcomeTemplate && next.welcomeTemplate !== before.welcomeTemplate) next.welcomeTemplate = await templateRef(project, next.welcomeTemplate, 'The welcome email', errors)
    if (next.sequence && next.sequence !== before.sequence) await getProjectSequence(project, next.sequence).catch(() => errors.push('No such sequence in this project'))
    if (!errors.length) {
      row.set('settings', { doubleOptIn: next.doubleOptIn, tags: next.tags, redirectUrl: next.redirectUrl })
      row.set('confirmTemplate', next.confirmTemplate)
      row.set('welcomeTemplate', next.welcomeTemplate)
      row.set('sequence', next.sequence)
    }
  }
  if (errors.length) badRequest(errors.join('; '))
}

/**
 * Machine-translates the form's words into each language (saved as a
 * translation the operator can edit). What is already translated stays unless
 * `overwrite`, so a person's edits survive a re-run.
 */
export async function translateLeadForm(ctx: MemberContext, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const fields = leadFieldsOf(row.get('fields'))
  const locale = leadFormLocaleOf(row.get('locale'))
  const translations = leadTranslationsOf(row.get('translations'))
  const source = leadFormTexts(normalizeLeadContent(row.get('content')), fields)
  if (!Object.keys(source).length) badRequest('The form has no text to translate')
  const next = { ...translations }
  for (const to of readTargetLocales(body.locales, locale)) {
    const texts = await translateMissing(ctx, source, leadTranslationTexts(translations[to]), { from: locale, to, context: 'form', overwrite: body.overwrite === true })
    next[to] = leadTranslationFromTexts(texts, fields)
  }
  if (Object.keys(next).length > LEAD_FORM_MAX_LOCALES) badRequest(`A form has at most ${LEAD_FORM_MAX_LOCALES} translations`)
  row.set('translations', next)
  await row.save(null, MASTER)
}

const segmentName = (formName: string) => `Leads · ${formName}`.slice(0, 80)

/**
 * The form's own segment (everyone who came through it) and, with the
 * project's first form, one of every lead. Both are ordinary segments the
 * operator can rename, edit or delete; a deleted form's segment stays, since
 * its people are still there.
 */
async function ensureLeadSegments(project: ParseObject, row: ParseObject, first: boolean): Promise<void> {
  const Parse = useParse()
  const make = async (name: string, filter: unknown, auto: string) => {
    const segment = new (Parse.Object.extend('ContactSegment'))() as ParseObject
    segment.set('project', project)
    segment.set('name', name)
    segment.set('filter', filter)
    segment.set('auto', auto)
    await segment.save(null, MASTER)
    return segment
  }
  if (!row.get('segment')) {
    const segment = await make(segmentName(String(row.get('name') || '')), leadFormSegmentFilter(row.id || ''), 'lead_form')
    row.set('segment', segment.id)
    await row.save(null, MASTER)
  }
  if (first && !await new Parse.Query('ContactSegment').equalTo('project', project).equalTo('auto', 'leads').first(MASTER)) await make('All leads', ALL_LEADS_SEGMENT, 'leads')
}

export async function createLeadForm(project: ParseObject, body: Record<string, unknown>): Promise<ParseObject> {
  const existing = await listLeadForms(project)
  if (existing.length >= LEAD_FORM_LIMITS.forms) badRequest(`A project has at most ${LEAD_FORM_LIMITS.forms} forms`)
  const preset = (LEAD_FORM_PRESETS as readonly string[]).includes(String(body.preset)) ? body.preset as LeadFormPreset : 'email'
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Waitlist'
  const start = presetForm(preset)
  const row = new (useParse().Object.extend('LeadForm'))() as ParseObject
  row.set('project', project)
  row.set('name', name.slice(0, LEAD_FORM_LIMITS.name))
  row.set('active', true)
  row.set('fields', start.fields)
  row.set('content', start.content)
  row.set('style', start.style)
  row.set('settings', { doubleOptIn: DEFAULT_LEAD_SETTINGS.doubleOptIn, tags: [], redirectUrl: '' })
  // A key derived from the name gets a number until it is free; one sent explicitly must be free.
  if (body.key === undefined) {
    const base = leadFormKeyFrom(name)
    let key = base
    for (let n = 2; await findFormByKey(project, key); n++) key = `${base.slice(0, 36)}-${n}`
    row.set('key', key)
  }
  await applyInput(project, row, { ...body, name: undefined })
  await row.save(null, MASTER)
  await ensureLeadSegments(project, row, !existing.length)
  return row
}

export async function updateLeadForm(project: ParseObject, row: ParseObject, body: Record<string, unknown>): Promise<void> {
  const before = String(row.get('name') || '')
  await applyInput(project, row, body)
  await row.save(null, MASTER)
  // The form's segment follows a rename, unless the operator named it themselves.
  const name = String(row.get('name') || '')
  if (name !== before && row.get('segment')) {
    const segment = await new (useParse()).Query('ContactSegment').equalTo('project', project).equalTo('objectId', String(row.get('segment'))).first(MASTER)
    if (segment && segment.get('name') === segmentName(before)) {
      segment.set('name', segmentName(name))
      await segment.save(null, MASTER)
    }
  }
}

// ---- the public form ---------------------------------------------------------------

/** The project's accent and logo fill what a form leaves to them. */
function projectLook(project: ParseObject) {
  const theme = (project.get('theme') || {}) as { accent?: string }
  return {
    name: String(project.get('name') || ''),
    accent: /^#[0-9a-f]{6}$/i.test(String(theme.accent || '')) ? String(theme.accent).toLowerCase() : '#5e6ad2',
    logoUrl: [String(project.get('iconUrl') || ''), String(project.get('brandLogoUrl') || '')].find(url => /^https?:\/\//.test(url)) || ''
  }
}

/** The languages a visitor asks for, best first: `locale` in the body, then in the query, then the browser's. */
export function wantedLocales(event: H3Event, body: Record<string, unknown> = {}): unknown[] {
  return [body.locale, getQuery(event).locale, ...parseAcceptLanguage(getHeader(event, 'accept-language'))]
}

/** The form in the first wanted language it has (its own otherwise): its words, and the built-in words around them. */
export function localizedLeadForm(form: LeadForm, wanted: unknown[]): { locale: string, locales: string[], content: LeadForm['content'], fields: PublicLeadField[], words: LeadFormWords } {
  const locales = [form.locale, ...Object.keys(form.translations)]
  const locale = matchLocale(wanted, locales) || form.locale
  return { locale, locales, ...localizeLeadForm(form.content, form.fields, form.translations[locale]), words: leadFormWords(locale) }
}

export function toPublicLeadForm(project: ParseObject, row: ParseObject, wanted: unknown[] = []): PublicLeadForm {
  const form = serializeLeadForm(project, row)
  const look = projectLook(project)
  const { locale, locales, content, fields } = localizedLeadForm(form, wanted)
  return {
    key: form.key,
    name: form.name,
    locale,
    locales,
    fields,
    content,
    style: { ...form.style, accent: form.style.accent || look.accent },
    doubleOptIn: form.settings.doubleOptIn,
    project: { name: look.name, logoUrl: look.logoUrl }
  }
}

/**
 * An active form of the project with this public key: by its key, or with no
 * key the project's first (so an embed works with nothing but the public key).
 * Anything else is a 404, the same answer as a form that does not exist.
 */
export async function findPublicLeadForm(pk: string, key: string): Promise<{ project: ParseObject, row: ParseObject }> {
  const project = await findProjectByPublicKey(pk)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })
  const wanted = key.trim().toLowerCase()
  const row = !wanted
    ? await new (useParse()).Query('LeadForm').equalTo('project', project).notEqualTo('active', false).ascending('createdAt').first(MASTER)
    : LEAD_FORM_KEY.test(wanted) ? await findFormByKey(project, wanted) : null
  if (!row || row.get('active') === false) throw createError({ statusCode: 404, statusMessage: 'Form not found' })
  return { project, row }
}

export async function readPublicLeadForm(event: H3Event): Promise<{ project: ParseObject, row: ParseObject }> {
  await rateLimit(`sb:rl:formread:${clientIp(event) || 'ip'}`, LIMITS.leadFormReadsPerIp.limit, LIMITS.leadFormReadsPerIp.window)
  return findPublicLeadForm(getRouterParam(event, 'pk') || '', getRouterParam(event, 'key') || '')
}

/**
 * At the plan's contact or storage limit the form closes for everyone alike,
 * so its answer never tells who is already a contact.
 */
function closedAtLimit(words: LeadFormWords) {
  return (error: { statusCode?: number }): never => {
    throw error.statusCode === 402 ? createError({ statusCode: 402, statusMessage: words.closedTitle }) : error
  }
}

/**
 * Take one submission (`files` are the file parts of a multipart one, by
 * field key). Invalid answers are a 400 listing what to fix, in the visitor's
 * language; after that the answer is the same whether or not the address was
 * known (`pending` is whether the form asks people to confirm).
 */
export async function submitLeadForm(event: H3Event, project: ParseObject, row: ParseObject, body: Record<string, unknown>, files: Record<string, UploadedLeadFile> = {}): Promise<{ pending: boolean }> {
  const form = serializeLeadForm(project, row)
  // Checked against the fields as the visitor saw them, so errors name them in their language.
  const { locale, fields, words } = localizedLeadForm(form, wantedLocales(event, body))
  const { submission, errors } = readLeadSubmission(fields, body, { words, aliases: leadOptionAliases(form.fields, form.translations) })
  const uploads = checkLeadFiles(fields, files, words)
  errors.push(...uploads.errors)
  const pending = form.settings.doubleOptIn
  if (submission.bot) return { pending }
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; '), data: { code: 'invalid_lead', errors } })
  const ip = clientIp(event) || ''
  await rateLimit(`sb:rl:signup:${ip || 'ip'}`, LIMITS.signupsPerIp.limit, LIMITS.signupsPerIp.window)
  await rateLimit(`sb:rl:signup:p:${project.id}`, LIMITS.signupsPerProject.limit, LIMITS.signupsPerProject.window)
  const workspaceId = await projectWorkspaceId(project)
  await checkGauge(workspaceId, 'contacts').catch(closedAtLimit(words))
  // Files go up first: when storage is full nobody is saved half.
  const stored = uploads.files.length ? await putLeadFiles(project, form, workspaceId, uploads.files).catch(closedAtLimit(words)) : []
  const consent = { ip, ua: String(getHeader(event, 'user-agent') || '').slice(0, 300), formUrl: String(getHeader(event, 'referer') || getHeader(event, 'origin') || '').slice(0, 300) }

  const existing = await findContactBy(project, { email: submission.email })
  const current = String(existing?.get('subscription') || 'none')
  // Anyone can type an address into a form: a subscriber stays as they are, and
  // someone who unsubscribed comes back only through the confirmation email.
  const subscription = current === 'subscribed' ? undefined : form.settings.doubleOptIn || current === 'unsubscribed' ? 'pending' as const : 'subscribed' as const
  const attributes = Object.keys(submission.attributes).length ? submission.attributes : undefined
  const [result] = await upsertContacts(project, [{ email: submission.email, ...(submission.name ? { name: submission.name } : {}), ...(attributes ? { attributes } : {}), tags: form.settings.tags, subscription, leadForms: [form.id] }], { via: 'lead_form', explicit: true, fillOnly: true, consent, origin: { type: 'lead_form', id: form.id } })
    .catch(async (error) => {
      await dropLeadObjects(workspaceId, stored)
      return closedAtLimit(words)(error)
    })
  const contact = result && result.status !== 'failed' ? await findContactBy(project, { email: submission.email }) : null
  if (!contact) {
    console.error('[forms] a lead was not saved:', result?.error)
    await dropLeadObjects(workspaceId, stored)
    return { pending }
  }
  if (stored.length) await saveLeadFiles(project, row, contact, stored)
  if (contact.get('subscription') === 'subscribed') void welcomeLead(project, form, contact, locale).catch(error => console.error('[forms] welcome failed:', (error as Error).message))
  else if (contact.get('subscription') === 'pending') void sendLeadConfirmation(project, form, contact, locale).catch(error => console.error('[forms] confirmation failed:', (error as Error).message))
  return { pending }
}

// ---- files ---------------------------------------------------------------------------

type StoredLeadFile = AcceptedLeadFile & { storageKey: string }

async function putLeadFiles(project: ParseObject, form: LeadForm, workspaceId: string, files: AcceptedLeadFile[]): Promise<StoredLeadFile[]> {
  const stored: StoredLeadFile[] = []
  try {
    for (const file of files) {
      const storageKey = `${project.id}/forms/${form.id}/${randomUUID()}.${file.ext}`
      await storeHiddenFile(storageKey, Buffer.from(file.data), file.mime, workspaceId)
      stored.push({ ...file, storageKey })
    }
  } catch (error) {
    await dropLeadObjects(workspaceId, stored)
    throw error
  }
  return stored
}

async function dropLeadObjects(workspaceId: string, stored: StoredLeadFile[]): Promise<void> {
  for (const file of stored) {
    await deleteDocumentObject(file.storageKey)
    await chargeUsage(workspaceId, 'storageBytes', -file.data.length)
  }
}

async function saveLeadFiles(project: ParseObject, form: ParseObject, contact: ParseObject, stored: StoredLeadFile[]): Promise<void> {
  const Parse = useParse()
  await Parse.Object.saveAll(stored.map((file) => {
    const row = new (Parse.Object.extend('LeadFile'))() as ParseObject
    row.set('project', project)
    row.set('form', form)
    row.set('contact', contact)
    row.set('field', file.field.key)
    row.set('name', file.name)
    row.set('mime', file.mime)
    row.set('size', file.data.length)
    row.set('storageKey', file.storageKey)
    return row
  }), MASTER)
}

export function serializeLeadFile(row: ParseObject): LeadFile {
  return {
    id: row.id || '',
    formId: pointerId(row.get('form')),
    contactId: pointerId(row.get('contact')),
    field: String(row.get('field') || ''),
    name: String(row.get('name') || ''),
    mime: String(row.get('mime') || ''),
    size: Number(row.get('size') || 0),
    createdAt: iso(row.createdAt)
  }
}

export async function getLeadFile(id: string): Promise<ParseObject> {
  try {
    return await new (useParse()).Query('LeadFile').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
}

/** A project's uploads, newest first: one person's (`contactId`) or one form's (`formId`). `before` pages back by date. */
export async function listLeadFiles(project: ParseObject, filter: { contactId?: string, formId?: string, before?: Date | null, limit?: number }): Promise<LeadFile[]> {
  const Parse = useParse()
  const query = new Parse.Query('LeadFile').equalTo('project', project).descending('createdAt').limit(Math.min(Math.max(filter.limit || 100, 1), 200))
  if (filter.contactId) query.equalTo('contact', Parse.Object.extend('EndUser').createWithoutData(filter.contactId))
  if (filter.formId) query.equalTo('form', Parse.Object.extend('LeadForm').createWithoutData(filter.formId))
  if (filter.before) query.lessThan('createdAt', filter.before)
  return (await query.find(MASTER)).map(serializeLeadFile)
}

export async function readLeadFile(row: ParseObject): Promise<Buffer> {
  return await getDocumentBuffer(String(row.get('storageKey') || ''))
}

/** Removes uploads, their objects and their bytes from the workspace's storage. Returns how many went. */
export async function deleteLeadFiles(project: ParseObject, rows: ParseObject[]): Promise<number> {
  if (!rows.length) return 0
  const workspaceId = await projectWorkspaceId(project)
  for (const row of rows) {
    await deleteDocumentObject(String(row.get('storageKey') || ''))
    await chargeUsage(workspaceId, 'storageBytes', -Number(row.get('size') || 0))
  }
  await useParse().Object.destroyAll(rows, MASTER)
  return rows.length
}

/** Everything a person sent through any form, for erasure. */
export async function eraseLeadFiles(project: ParseObject, contact: ParseObject): Promise<number> {
  let count = 0
  for (;;) {
    const rows = await new (useParse()).Query('LeadFile').equalTo('project', project).equalTo('contact', contact).limit(500).find(MASTER)
    count += await deleteLeadFiles(project, rows)
    if (rows.length < 500) return count
  }
}

/**
 * Someone is on the list: the form's welcome email, once (its log batch id is
 * `lf_<form>_<contact>`), and its sequence. A draft or paused sequence holds
 * them at the first step until it is activated.
 */
export async function welcomeLead(project: ParseObject, form: LeadForm, contact: ParseObject, locale = ''): Promise<void> {
  const { welcomeTemplate, sequence } = form.settings
  if (welcomeTemplate && contact.get('email')) {
    const batchId = `lf_${form.id}_${contact.id}`
    await runExclusive(`sb:leadwelcome:${batchId}`, 60, async () => {
      if (await new (useParse()).Query('EmailLog').equalTo('batchId', batchId).notEqualTo('status', 'failed').first(MASTER)) return
      const snapshot = await snapshotCampaign(project, welcomeTemplate, locale)
      await deliverEmails(campaignEmails(project, snapshot, [contact], { batchId, subject: '', topic: '', testMode: false, source: 'form', actor: FORM_ACTOR, base: publicBaseUrl(), metadata: { form: form.id } }))
    }, { waitMs: 5000, failOpen: true })
  }
  if (sequence) {
    const row = await getProjectSequence(project, sequence).catch(() => null)
    if (row) await enrollContact(row, contact)
  }
}

// ---- confirming ----------------------------------------------------------------------

/** The link in the confirmation email. It carries the language the person signed up in (a tag has no colon), so the confirm page and the welcome email speak it too. */
export function leadConfirmToken(projectId: string, contactId: string, formId: string, locale = '', now = Date.now()): string {
  return signLinkToken('leadconfirm', [projectId, contactId, formId, Math.floor(now / 1000) + CONFIRM_DAYS * 86400, normalizeLocale(locale) || ''].join(':'))
}

export function readLeadConfirmToken(token: string, now = Date.now()): { projectId: string, contactId: string, formId: string, locale: string } | null {
  let payload: string | null = null
  try { payload = readLinkToken('leadconfirm', token) } catch { return null }
  const [projectId, contactId, formId, expires, locale] = String(payload || '').split(':')
  if (!projectId || !contactId || !formId || !(Number(expires) * 1000 > now)) return null
  return { projectId, contactId, formId, locale: normalizeLocale(locale) || '' }
}

async function sendLeadConfirmation(project: ParseObject, form: LeadForm, contact: ParseObject, locale: string): Promise<void> {
  const url = `${publicBaseUrl()}/f/confirm/${leadConfirmToken(project.id || '', contact.id || '', form.id, locale)}`
  const own = form.settings.confirmTemplate ? await findProjectEmail(project, form.settings.confirmTemplate).catch(() => null) : null
  const words = leadFormWords(locale)
  const name = String(project.get('name') || '') || localizedLeadForm(form, [locale]).content.title
  const first = String(contact.get('name') || '').trim().split(/\s+/)[0] || ''
  // All of it in their language: a sign-up confirmation is no conversation, so the layout's reply line goes.
  await sendConfirmationEmail(project, contact, url, own || await projectConfirmTemplate(project), {
    subject: fillWords(words.emailSubject, { name }),
    body: fillWords(words.emailBody, { name }),
    ctaLabel: words.confirmButton,
    greeting: first ? fillWords(words.hello, { name: first }) : words.helloThere,
    note: '',
    reason: fillWords(words.emailReason, { name })
  }, [locale])
}

/** The click in the confirmation email (a POST from the confirm page). The form may be gone by then: the person is still confirmed. */
export async function confirmLead(event: H3Event, token: string): Promise<{ project: ParseObject, form: LeadForm | null, locale: string } | null> {
  const link = readLeadConfirmToken(token)
  if (!link) return null
  const project = await loadProjectUnscoped(link.projectId).catch(() => null)
  if (!project) return null
  const Parse = useParse()
  const contact = await new Parse.Query('EndUser').equalTo('project', project).equalTo('objectId', link.contactId).first(MASTER)
  if (!contact) return null
  const row = await new Parse.Query('LeadForm').equalTo('project', project).equalTo('objectId', link.formId).first(MASTER)
  if (contact.get('subscription') === 'pending') {
    const consent = { ...(contact.get('consent') || {}), confirmedAt: new Date().toISOString(), ip: clientIp(event) || '' }
    await saveContact(project, contact, { subscription: 'subscribed' }, { via: 'lead_form', explicit: true, consent })
  }
  const form = row ? serializeLeadForm(project, row) : null
  if (form && contact.get('subscription') === 'subscribed') await welcomeLead(project, form, contact, link.locale).catch(error => console.error('[forms] welcome failed:', (error as Error).message))
  return { project, form, locale: link.locale }
}

// ---- pages ---------------------------------------------------------------------------

function fieldHtml(f: PublicLeadField, value: string, words: LeadFormWords): string {
  const label = escapeHtml(f.label || LEAD_FIELD_LABELS[f.type])
  const name = escapeHtml(f.key)
  const required = f.required ? ' required' : ''
  const placeholder = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''
  if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${name}" value="on"${required}${value ? ' checked' : ''}><span>${label}</span></label>`
  let input: string
  if (f.type === 'textarea') input = `<textarea name="${name}" rows="4"${placeholder}${required} maxlength="${LEAD_FORM_LIMITS.textarea}">${escapeHtml(value)}</textarea>`
  else if (f.type === 'select') input = `<select name="${name}"${required}><option value="">—</option>${f.options.map((o, i) => `<option value="${escapeHtml(o)}"${o === value ? ' selected' : ''}>${escapeHtml(f.optionLabels[i] || o)}</option>`).join('')}</select>`
  else if (f.type === 'file') {
    const accept = LEAD_FILE_EXTENSIONS[f.accept || 'any'].map(ext => `.${ext}`).join(',')
    input = `<input type="file" name="${name}" accept="${accept}"${required}><small class="hint">${escapeHtml(fillWords(words.fileHint, { mb: f.maxMB }))}</small>`
  } else {
    const type = { email: 'email', name: 'text', text: 'text', number: 'number', url: 'url', phone: 'tel' }[f.type as string] || 'text'
    const auto = { email: ' autocomplete="email"', name: ' autocomplete="name"', phone: ' autocomplete="tel"', url: ' autocomplete="url"' }[f.type as string] || ''
    input = `<input type="${type}" name="${name}" value="${escapeHtml(value)}"${placeholder}${auto}${required}${f.type === 'number' ? ' step="any"' : ''}>`
  }
  return `<label class="field"><span>${label}${f.required ? '' : ` <small>${escapeHtml(words.optional)}</small>`}</span>${input}</label>`
}

/**
 * The hosted form, for a link or an iframe: plain HTML, posting to the public
 * endpoint (as multipart when it has a file field), in the first of `wanted`
 * the form has.
 */
export function leadFormPage(project: ParseObject, row: ParseObject, options: { sent?: boolean, error?: string, values?: Record<string, unknown>, poweredBy?: PoweredBy | null, wanted?: unknown[] } = {}): string {
  const form = serializeLeadForm(project, row)
  const { locale, content, fields, words } = localizedLeadForm(form, options.wanted || [])
  const brand = { ...pageBrand(project, options.poweredBy), ...(form.style.accent ? { accent: form.style.accent } : {}), lang: locale }
  if (options.sent) {
    return renderMarketingPage(brand, content.successTitle, `<h1>${escapeHtml(content.successTitle)}</h1><p>${escapeHtml(form.settings.doubleOptIn ? content.confirmMessage : content.successMessage)}</p>`)
  }
  const values = options.values || {}
  const multipart = fields.some(f => f.type === 'file') ? ' enctype="multipart/form-data"' : ''
  return renderMarketingPage(brand, content.title || form.name, `${content.title ? `<h1>${escapeHtml(content.title)}</h1>` : ''}
${content.description ? `<p>${escapeHtml(content.description)}</p>` : ''}
${options.error ? `<div class="note">${escapeHtml(options.error)}</div>` : ''}
<form method="post" action="${escapeHtml(form.path)}"${multipart}>
${fields.map(f => fieldHtml(f, values[f.key] === undefined || f.type === 'file' ? '' : String(values[f.key]), words)).join('\n')}
<input type="hidden" name="locale" value="${escapeHtml(locale)}">
<div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">${escapeHtml(content.buttonLabel)}</button>
</form>
${content.footnote ? `<p class="small">${escapeHtml(content.footnote)}</p>` : ''}`)
}

/** A page with one message (a closed form, an expired link) in the first of `wanted` that has built-in words, else English. */
export function leadMessagePage(brand: PageBrand, wanted: unknown[], which: 'closed' | 'expired'): string {
  const lang = wanted.map(normalizeLocale).find(tag => tag && tag.split('-')[0]! in LEAD_FORM_WORDS) || 'en'
  const words = leadFormWords(lang)
  return messagePage({ ...brand, lang }, which === 'closed' ? words.closedTitle : words.expiredTitle, which === 'closed' ? words.closedBody : words.expiredBody)
}

export function leadConfirmPage(project: ParseObject, token: string, locale: string, poweredBy: PoweredBy | null = null): string {
  const words = leadFormWords(locale)
  return renderMarketingPage({ ...pageBrand(project, poweredBy), lang: normalizeLocale(locale) || 'en' }, words.confirmTitle, `<h1>${escapeHtml(words.confirmTitle)}</h1><p>${escapeHtml(words.confirmBody)}</p>
<form method="post" action="/f/confirm/${encodeURIComponent(token)}"><button type="submit">${escapeHtml(words.confirmButton)}</button></form>`)
}

/** After the confirmation click: the form's thank-you words in the person's language. */
export function leadConfirmedPage(project: ParseObject, form: LeadForm | null, locale: string, poweredBy: PoweredBy | null = null): string {
  const brand = { ...pageBrand(project, poweredBy), ...(form?.style.accent ? { accent: form.style.accent } : {}) }
  if (!form) return messagePage({ ...brand, lang: 'en' }, 'You are on the list', `Thanks for confirming. You will hear from ${project.get('name') || 'us'} soon.`)
  const { locale: lang, content } = localizedLeadForm(form, [locale])
  return messagePage({ ...brand, lang }, content.successTitle, content.successMessage)
}

/**
 * Where a plain form or the confirmation link sends people next: the form's
 * own page, else HelpBites' thank-you page (in the language they used).
 */
export function afterSignupUrl(project: ParseObject, form: LeadForm, locale = ''): string {
  if (form.settings.redirectUrl) return form.settings.redirectUrl
  const lang = locale && locale !== form.locale ? `&locale=${encodeURIComponent(locale)}` : ''
  return `/f/${encodeURIComponent(String(project.get('publicKey') || ''))}/${encodeURIComponent(form.key)}?sent=1${lang}`
}
