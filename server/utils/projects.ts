import { randomBytes } from 'node:crypto'
import { createError } from 'h3'
import type { PoweredBy } from './branding'
import { invalidate, onInvalidate } from './cacheBus'
import type { ErrorLinkView } from './errorTracking'
import { safeHttpUrl } from '#shared/support'
import { normalizeFeedbackConfig, validateFeedbackConfig, type FeedbackBoardConfig } from '#shared/feedback'
import { normalizeBoardConfig, validateBoardConfig, type BoardConfig } from '#shared/board'
import { normalizeChangelogConfig, validateChangelogConfig, type ChangelogConfig } from '#shared/changelog'
import { normalizeLegalConfig, validateLegalConfig, type LegalConfig } from '#shared/legal/config'
import { normalizeBlogConfig, validateBlogConfig, type BlogConfig } from '#shared/blog'
import { normalizeFlags, validateFlags, type FeatureFlag } from '#shared/flags'
import { normalizeMarketingConfig, validateMarketingConfig, type MarketingConfig } from '#shared/marketing'
import { normalizeBrandConfig, validateBrandConfig } from '#shared/brand'
import { normalizeHubConfig, validateHubConfig, type HubConfig } from '#shared/hub'
import { companyEntity, type CompanyProfile } from '#shared/company'
import { applyCompany, companyOf } from './company'
import { legalLinksOf, type LegalLinks } from './legalLinks'
import { legacyTheme, projectLook, type ProjectLook, type ProjectLookInput } from '#shared/projectLook'
import { normalizeHiddenSections, validateHiddenSections } from '#shared/projectSections'

export type ProjectTheme = { accent?: string, dark?: boolean }

/** Trimmed conversation type the embed offers as a "request type" choice. */
export type PublicConversationType = { key: string, name: string, description: string, icon: string }

export type PublicProject = {
  publicKey: string
  name: string
  allowedOrigins: string[]
  /** The accent (and dark flag) as older clients read it; always the same colour as `look.accent`. */
  theme: ProjectTheme
  /** The project's look, built from its Brand kit (shared/projectLook.ts): accent, logo, fonts, radius. Embeds wear this. */
  look: ProjectLook
  allowAttachments: boolean
  /** Chat and feedback work with only an email address, no host-signed identity token (POST /v1/anonymous/session). */
  allowAnonymousUsers: boolean
  /** Fixed informational line shown centered at the top of a new chat; '' hides it. */
  chatNotice: string
  /** Optional project brand logo and assistant/bot avatar (public image URLs); '' when unset. */
  brandLogoUrl: string
  assistantLogoUrl: string
  /** Offer a request-type picker in the embed's new-message form. */
  letUsersChooseType: boolean
  /** Add an "Other" choice to that picker (creates a plain support ticket). */
  allowOtherType: boolean
  /** Present only when letUsersChooseType — the types the embed may offer. */
  types?: PublicConversationType[]
  /** The project's feedback board; `enabled: false` when it has none. */
  feedback: FeedbackBoardConfig
  /** The chat embed shows a Home tab (read from GET /v1/hub/{pk}); the hub settings turn it on. */
  widgetHome: boolean
  /** The "Powered by HelpBites" link, null when the plan removes it. Set by the public routes, since it needs the workspace's plan. */
  poweredBy?: PoweredBy | null
}

export type AdminProject = PublicProject & {
  id: string
  slug: string
  siteUrl: string
  inboxPath: string
  /** Admin-only: custom image shown for the project across the panel; '' falls back to the coloured initial. */
  iconUrl: string
  fromName: string
  /** Email sending: this project's own sender; blank uses the server's MAILGUN_* defaults. */
  fromEmail: string
  replyTo: string
  mailDomain: string
  /** Keep a copy of each sent message's HTML and text in the email log. */
  emailLogContent: boolean
  notifyEmails: string[]
  actionWebhookUrl: string
  hasActionWebhookSecret: boolean
  /** Admin-only: carries the allowlists, so never part of PublicProject. */
  flags: FeatureFlag[]
  /** The project board. Admin-only: its statuses and labels are internal until an item is made public. */
  board: BoardConfig
  /** Changelog options. Admin-only; what the changelog shows publicly is the entries themselves. */
  changelog: ChangelogConfig
  /** Legal pages: the look of the hosted pages (the operator's identity is `company`; `legal.entity` mirrors it). Admin-only. */
  legal: LegalConfig
  /** Who is behind the product, written once; Legal and campaigns read it (shared/company.ts). */
  company: CompanyProfile
  /** The public hub page and the chat widget's Home tab (shared/hub.ts). */
  hub: HubConfig
  /** The public pages of the published legal documents, as `{{project.privacyUrl}}` and friends; '' for a type with none. */
  legalLinks: LegalLinks
  /** Blog options. Admin-only; what readers see is the published posts and GET /v1/blog. */
  blog: BlogConfig
  /** `alertWebhookUrl` is set only for trackers whose alerts must be pointed at HelpBites by hand. */
  errors: { connected: boolean, provider: string, providerName: string, dsn: string, url: string, alertWebhookUrl: string }
  /** Every tracker project it reports to (`errors` is the first), each a pill on the Errors page. */
  errorLinks: ErrorLinkView[]
  /** Newsletter settings: topics, postal address, double opt-in, its own sender. */
  marketing: MarketingConfig
  /** Signed event webhooks (contact.subscription_changed, email.suppressed). */
  eventWebhookUrl: string
  hasEventWebhookSecret: boolean
  /** When the chat widget last loaded inside a host page (to the hour); null until it ever has. */
  widgetSeenAt: string | null
  /** When a host-signed identity token was last accepted for this project (to the hour); null until one has. */
  identitySeenAt: string | null
  /** Sections the project left out of its sidebar (shared/projectSections.ts); their pages and API still work. */
  hiddenSections: string[]
  createdAt: string | null
}

export function newPublicKey(): string {
  return `pk_${randomBytes(12).toString('hex')}`
}

export function newSecret(): string {
  return `sk_${randomBytes(32).toString('hex')}`
}

// Project rows are read on every request; they change roughly never.
const CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { project: ParseObject, expiresAt: number }>()

export function forgetProject(publicKey: string): void {
  void invalidate('projectKey', publicKey)
}

onInvalidate('projectKey', publicKey => cache.delete(publicKey))

/** A project by its public key; null when there is none, or its workspace is suspended or being deleted. */
export async function findProjectByPublicKey(publicKey: string): Promise<ParseObject | null> {
  const key = String(publicKey || '').trim()
  if (!key) return null
  const hit = cache.get(key)
  let project = hit && hit.expiresAt > Date.now() ? hit.project : null
  if (!project) {
    project = await new (useParse()).Query('Project').equalTo('publicKey', key).first(MASTER) || null
    if (project) cache.set(key, { project, expiresAt: Date.now() + CACHE_TTL_MS })
  }
  // Checked on every call (the workspace is cached on its own): a suspension closes the widget, feedback and changelog at once.
  if (project && !(await workspaceIsActive(pointerId(project.get('workspace'))))) return null
  return project
}

/**
 * Any project by id, whoever's it is. Workers and public routes (which have
 * already resolved the project from a key) use it; an operator's route uses
 * requireProject (tenancy.ts), which also checks the workspace.
 */
export async function loadProjectUnscoped(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('Project').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }
}

function stringList(value: unknown, map: (v: string) => string = v => v): string[] {
  if (!Array.isArray(value)) return []
  return value.map(v => map(String(v || '').trim())).filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).slice(0, 20)
}

export function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

/** Accepts bare addresses and `Name <addr@host>`; keeps only the addr-spec. */
export function parseRecipientList(value: unknown): string[] {
  const list = typeof value === 'string' ? value.split(/[,;]/) : Array.isArray(value) ? value : []
  return list
    .map((entry) => {
      const trimmed = String(entry || '').trim()
      const angled = trimmed.match(/<([^>]+)>/)
      return (angled ? angled[1] : trimmed)!.trim()
    })
    .filter(isProbablyEmail)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 5)
}

export function isProbablyEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  const at = trimmed.indexOf('@')
  return at > 0 && at < trimmed.length - 1 && trimmed.lastIndexOf('@') === at && trimmed.includes('.', at)
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

function emailSetting(value: unknown, name: string): string {
  const email = String(value || '').trim()
  if (email && !isProbablyEmail(email)) throw createError({ statusCode: 400, statusMessage: `${name} must be an email address` })
  return email.slice(0, 200)
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Apply an admin PATCH/POST body onto a project row; unknown keys are ignored. */
export async function applyProjectInput(project: ParseObject, input: Record<string, unknown>): Promise<void> {
  if (typeof input.name === 'string' && input.name.trim()) {
    project.set('name', input.name.trim().slice(0, 80))
    if (!project.get('slug')) project.set('slug', slugify(input.name))
  }
  if (typeof input.slug === 'string' && input.slug.trim()) project.set('slug', slugify(input.slug))
  if ('allowedOrigins' in input) project.set('allowedOrigins', stringList(input.allowedOrigins, normalizeOrigin))
  if ('siteUrl' in input) project.set('siteUrl', safeHttpUrl(input.siteUrl).replace(/\/+$/, ''))
  if ('inboxPath' in input) project.set('inboxPath', String(input.inboxPath || '').trim().slice(0, 200))
  if ('fromName' in input) project.set('fromName', String(input.fromName || '').trim().slice(0, 80))
  if ('fromEmail' in input) project.set('fromEmail', emailSetting(input.fromEmail, 'fromEmail'))
  if ('replyTo' in input) project.set('replyTo', emailSetting(input.replyTo, 'replyTo'))
  if ('mailDomain' in input) {
    const domain = String(input.mailDomain || '').trim().toLowerCase()
    if (domain && !DOMAIN_RE.test(domain)) throw createError({ statusCode: 400, statusMessage: 'mailDomain must be a domain such as mail.example.com' })
    project.set('mailDomain', domain)
  }
  if ('emailLogContent' in input) project.set('emailLogContent', Boolean(input.emailLogContent))
  if ('hiddenSections' in input) {
    const { hidden, errors } = validateHiddenSections(input.hiddenSections)
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('hiddenSections', hidden)
  }
  if ('chatNotice' in input) project.set('chatNotice', String(input.chatNotice || '').trim().slice(0, 500))
  if ('brandLogoUrl' in input) project.set('brandLogoUrl', safeHttpUrl(input.brandLogoUrl))
  if ('iconUrl' in input) project.set('iconUrl', safeHttpUrl(input.iconUrl))
  if ('assistantLogoUrl' in input) project.set('assistantLogoUrl', safeHttpUrl(input.assistantLogoUrl))
  if ('notifyEmails' in input) project.set('notifyEmails', parseRecipientList(input.notifyEmails))
  if ('allowAttachments' in input) project.set('allowAttachments', Boolean(input.allowAttachments))
  if ('allowAnonymousUsers' in input) project.set('allowAnonymousUsers', Boolean(input.allowAnonymousUsers))
  if ('letUsersChooseType' in input) project.set('letUsersChooseType', Boolean(input.letUsersChooseType))
  if ('allowOtherType' in input) project.set('allowOtherType', Boolean(input.allowOtherType))
  if ('actionWebhookUrl' in input) project.set('actionWebhookUrl', safeHttpUrl(input.actionWebhookUrl))
  if (typeof input.actionWebhookSecret === 'string') {
    const secret = input.actionWebhookSecret.trim()
    if (secret && secret.length < 16) throw createError({ statusCode: 400, statusMessage: 'Webhook secret must be at least 16 characters' })
    if (secret) project.set('actionWebhookSecret', secret)
    else project.unset('actionWebhookSecret')
  }
  if (input.feedback !== undefined) {
    // Partial: only the keys sent change, so a toggle does not resend the statuses.
    const { config, errors } = validateFeedbackConfig(input.feedback, normalizeFeedbackConfig(project.get('feedback')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('feedback', config)
  }
  if (input.board !== undefined) {
    // Partial, like `feedback`: a toggle does not resend the statuses.
    const { config, errors } = validateBoardConfig(input.board, normalizeBoardConfig(project.get('board')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('board', config)
  }
  if (input.changelog !== undefined) {
    // Partial, like `board`: only the keys sent change.
    const { config, errors } = validateChangelogConfig(input.changelog, normalizeChangelogConfig(project.get('changelog')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('changelog', config)
  }
  if (input.blog !== undefined) {
    // Partial, like `changelog`: only the keys sent change.
    const { config, errors } = validateBlogConfig(input.blog, normalizeBlogConfig(project.get('blog')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('blog', config)
  }
  if (input.legal !== undefined) {
    // Partial, like `changelog`: only the keys sent change.
    const { config, errors } = validateLegalConfig(input.legal, normalizeLegalConfig(project.get('legal')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('legal', config)
    // Who the operator is lives in the company profile; this older way of setting it writes there too.
    const entity = (input.legal as { entity?: Record<string, unknown> }).entity
    if (entity && typeof entity === 'object') {
      const sent = (key: 'name' | 'address' | 'email' | 'dpo') => (key in entity ? { [key === 'name' ? 'legalName' : key]: config.entity[key] } : {})
      applyCompany(project, { ...sent('name'), ...sent('address'), ...sent('email'), ...sent('dpo') })
    }
  }
  if (input.marketing !== undefined) {
    // Partial, like `feedback`.
    const { config, errors } = validateMarketingConfig(input.marketing, normalizeMarketingConfig(project.get('marketing')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('marketing', config)
    // The postal address campaigns carry is the company's.
    if (input.marketing && typeof input.marketing === 'object' && 'postalAddress' in input.marketing) applyCompany(project, { address: config.postalAddress })
  }
  if (input.hub !== undefined) {
    // Partial: only the keys sent change (`sections` and `links` are whole lists).
    const { config, errors } = validateHubConfig(input.hub, normalizeHubConfig(project.get('hub')))
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('hub', config)
  }
  // Last, so a request that sends both the older fields and the profile gets the profile.
  if (input.company !== undefined) applyCompany(project, input.company)
  if ('eventWebhookUrl' in input) {
    const url = safeHttpUrl(input.eventWebhookUrl)
    // Clearing it is always allowed, and so is resending the saved URL: a workspace that lost the feature can still save its other settings.
    if (url && url !== project.get('eventWebhookUrl')) await assertFeature(await projectWorkspaceId(project), 'eventWebhooks')
    project.set('eventWebhookUrl', url)
  }
  if (typeof input.eventWebhookSecret === 'string') {
    const secret = input.eventWebhookSecret.trim()
    if (secret && secret.length < 16) throw createError({ statusCode: 400, statusMessage: 'Webhook secret must be at least 16 characters' })
    if (secret) project.set('eventWebhookSecret', secret)
    else project.unset('eventWebhookSecret')
  }
  if (input.flags !== undefined) {
    // Whole list: the panel saves every flag at once.
    const { flags, errors } = validateFlags(input.flags)
    if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })
    project.set('flags', flags)
  }
  if (input.theme && typeof input.theme === 'object') {
    const theme = input.theme as Record<string, unknown>
    const accent = typeof theme.accent === 'string' && /^#[0-9a-f]{6}$/i.test(theme.accent.trim()) ? theme.accent.trim() : ''
    project.set('theme', { ...(accent ? { accent } : {}), ...(typeof theme.dark === 'boolean' ? { dark: theme.dark } : {}) })
    // The Brand kit is where the accent lives; Settings edits it from here.
    // An empty accent clears it; one that is not a colour is ignored rather than read as a clear.
    if ('accent' in theme && (accent || !theme.accent)) {
      const { config } = validateBrandConfig({ page: { accent } }, normalizeBrandConfig(project.get('brand')))
      project.set('brand', config)
    }
  }
}

/** The look of a project row: one read of the Brand kit, shared by every surface (shared/projectLook.ts). */
export function lookOf(project: { get: (key: string) => unknown }, overrides: ProjectLookInput = {}): ProjectLook {
  return projectLook({
    name: project.get('name'),
    theme: project.get('theme'),
    brand: project.get('brand'),
    brandLogoUrl: project.get('brandLogoUrl'),
    assistantLogoUrl: project.get('assistantLogoUrl'),
    iconUrl: project.get('iconUrl'),
    brandLook: project.get('brandLook'),
    ...overrides
  })
}

export function serializePublicProject(project: ParseObject): PublicProject {
  const look = lookOf(project)
  return {
    publicKey: String(project.get('publicKey') || ''),
    name: String(project.get('name') || ''),
    allowedOrigins: stringList(project.get('allowedOrigins')),
    theme: legacyTheme(look, project.get('theme')),
    look,
    allowAttachments: project.get('allowAttachments') !== false,
    allowAnonymousUsers: project.get('allowAnonymousUsers') === true,
    chatNotice: String(project.get('chatNotice') || ''),
    brandLogoUrl: look.logoUrl,
    assistantLogoUrl: String(project.get('assistantLogoUrl') || ''),
    letUsersChooseType: project.get('letUsersChooseType') === true,
    allowOtherType: project.get('allowOtherType') === true,
    feedback: normalizeFeedbackConfig(project.get('feedback')),
    widgetHome: normalizeHubConfig(project.get('hub')).widgetHome.enabled
  }
}

/** The chat widget loaded inside a host page. One write an hour at most: this runs on every page view. */
export async function markWidgetSeen(project: ParseObject): Promise<void> {
  await stampSeen(project, 'widgetSeenAt')
}

/** The host's backend signed an identity token we accepted. One write an hour at most: this runs on every signed request. */
export async function markIdentitySeen(project: ParseObject): Promise<void> {
  await stampSeen(project, 'identitySeenAt')
}

async function stampSeen(project: ParseObject, field: 'widgetSeenAt' | 'identitySeenAt'): Promise<void> {
  const seen = project.get(field) as Date | undefined
  if (seen && Date.now() - seen.getTime() < 60 * 60 * 1000) return
  project.set(field, new Date())
  await project.save(null, MASTER)
}

export function serializeAdminProject(project: ParseObject): AdminProject {
  const errors = errorConfigOf(project)
  const tracker = providerOf(errors)
  const company = companyOf(project)
  return {
    ...serializePublicProject(project),
    // Settings edits the stored setting, not the kit's logo the embeds show.
    brandLogoUrl: String(project.get('brandLogoUrl') || ''),
    id: project.id || '',
    slug: String(project.get('slug') || ''),
    siteUrl: String(project.get('siteUrl') || ''),
    inboxPath: String(project.get('inboxPath') || ''),
    iconUrl: String(project.get('iconUrl') || ''),
    fromName: String(project.get('fromName') || ''),
    fromEmail: String(project.get('fromEmail') || ''),
    replyTo: String(project.get('replyTo') || ''),
    mailDomain: String(project.get('mailDomain') || ''),
    emailLogContent: project.get('emailLogContent') === true,
    notifyEmails: stringList(project.get('notifyEmails')),
    actionWebhookUrl: String(project.get('actionWebhookUrl') || ''),
    hasActionWebhookSecret: Boolean(project.get('actionWebhookSecret')),
    flags: normalizeFlags(project.get('flags')),
    board: normalizeBoardConfig(project.get('board')),
    changelog: normalizeChangelogConfig(project.get('changelog')),
    legal: { ...normalizeLegalConfig(project.get('legal')), entity: companyEntity(company) },
    company,
    legalLinks: legalLinksOf(project),
    hub: normalizeHubConfig(project.get('hub')),
    blog: normalizeBlogConfig(project.get('blog')),
    errors: { connected: Boolean(errors.dsn), provider: errors.dsn ? tracker.id : '', providerName: errors.dsn ? tracker.name : '', dsn: String(errors.dsn || ''), url: issuesUrlOf(errors), alertWebhookUrl: errors.dsn && tracker.manualAlerts ? errorWebhookUrl(project, errors) : '' },
    errorLinks: errorLinksOf(project).map(link => errorLinkView(project, link)),
    marketing: { ...normalizeMarketingConfig(project.get('marketing')), postalAddress: company.address },
    eventWebhookUrl: String(project.get('eventWebhookUrl') || ''),
    hasEventWebhookSecret: Boolean(project.get('eventWebhookSecret')),
    widgetSeenAt: iso(project.get('widgetSeenAt')),
    identitySeenAt: iso(project.get('identitySeenAt')),
    hiddenSections: normalizeHiddenSections(project.get('hiddenSections')),
    createdAt: iso(project.createdAt)
  }
}
