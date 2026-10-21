import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { createError } from 'h3'
import { IMPORT_ORDER, NOT_PORTABLE, PROJECT_PINNED, EXPORT_FORMAT } from '#shared/transfer'

// Everything a workspace owns, in one map: what its export reads and what
// deleting it removes. It follows scripts/ensure-schema.mjs class by class,
// and tests/workspacePurge.test.ts fails when a class there is missing here,
// so a new class has to say how it belongs to a workspace before it ships.
//
//   workspace  the row has a `workspace` pointer
//   project    a `project` pointer, to one of the workspace's projects
//   parent     found through the row it hangs off (a model's FAQs)
//   none       not the workspace's data
//
// Deleting happens in the background (the `workspace.purge` job): rows found
// through a parent go while the parent is still there, projects' rows before
// the projects, so a run that dies halfway finds everything left when it runs
// again.

export type DataScope = 'workspace' | 'project' | 'parent' | 'none'
export type DataRule = {
  scope: DataScope
  /** `parent`: the pointer the row hangs off. `project`: where rows without a project of their own are found. */
  parent?: { field: string, className: string }
  /** `project`: rows without a project carry the workspace instead. */
  orWorkspace?: boolean
  /** false: deleted with the workspace, but not part of its export. */
  exported?: boolean
}

type ParseQuery = InstanceType<ReturnType<typeof useParse>['Query']>
type Holdings = { workspaceId: string, projectIds: string[], /** A project export: only this project and what is pinned to it. */ onlyProject?: string }

const KNOWLEDGE = { field: 'knowledgeModel', className: 'KnowledgeModel' }

export const WORKSPACE_DATA: Record<string, DataRule> = {
  // Stays behind as a tombstone.
  Workspace: { scope: 'none' },
  // Accounts outlive their workspaces.
  _User: { scope: 'none' },
  _Session: { scope: 'none' },
  // An operator's phone, for push.
  Device: { scope: 'none' },
  // What was done to the workspace, its deletion included: kept with the tombstone.
  AuditLog: { scope: 'none' },
  WorkspaceUsage: { scope: 'workspace' },
  // The queue's own bookkeeping.
  Job: { scope: 'workspace', exported: false },
  // Imports into the workspace, with their summary: the transfer's own bookkeeping.
  DataTransfer: { scope: 'workspace', exported: false },
  WorkspaceMember: { scope: 'workspace' },
  WorkspaceInvite: { scope: 'workspace' },
  // The cloud edition's sending domains (removed at Mailgun by its onWorkspaceDeleting hook).
  WorkspaceDomain: { scope: 'workspace' },
  Project: { scope: 'workspace' },
  AdminApiKey: { scope: 'workspace' },
  EndUser: { scope: 'project' },
  EndUserSession: { scope: 'project' },
  ContactSource: { scope: 'project' },
  StripeAccount: { scope: 'project' },
  StripePayment: { scope: 'project' },
  StripeSubscription: { scope: 'project' },
  Campaign: { scope: 'project' },
  WebhookEndpoint: { scope: 'project' },
  WebhookDelivery: { scope: 'project' },
  Sequence: { scope: 'project' },
  SequenceEnrollment: { scope: 'project' },
  ContactSegment: { scope: 'project' },
  Conversation: { scope: 'project' },
  ConversationType: { scope: 'project' },
  SavedReply: { scope: 'project' },
  KnowledgeModel: { scope: 'workspace' },
  KnowledgeNode: { scope: 'parent', parent: KNOWLEDGE },
  KnowledgeDocument: { scope: 'parent', parent: KNOWLEDGE },
  Faq: { scope: 'parent', parent: KNOWLEDGE },
  SupportAgent: { scope: 'workspace' },
  AgentKnowledgeAssignment: { scope: 'parent', parent: { field: 'supportAgent', className: 'SupportAgent' } },
  // Messages from before they carried their project are found through their conversation.
  Message: { scope: 'project', parent: { field: 'conversation', className: 'Conversation' } },
  FeedbackPost: { scope: 'project' },
  FeedbackVote: { scope: 'project' },
  FeedbackComment: { scope: 'project' },
  FeedbackSubscription: { scope: 'project' },
  BoardItem: { scope: 'project' },
  ChangelogRelease: { scope: 'project' },
  ChangelogEntry: { scope: 'project' },
  ChangelogComment: { scope: 'project' },
  ChangelogSubscription: { scope: 'project' },
  ChangelogNotifyRun: { scope: 'project' },
  GithubRef: { scope: 'project' },
  BlogPost: { scope: 'project' },
  BlogComment: { scope: 'project' },
  LegalDocument: { scope: 'project' },
  LegalDocumentVersion: { scope: 'parent', parent: { field: 'document', className: 'LegalDocument' } },
  OnboardingFlow: { scope: 'project' },
  OnboardingCompletion: { scope: 'project' },
  LeadForm: { scope: 'project' },
  PricingTable: { scope: 'project' },
  PricingStat: { scope: 'project' },
  // Its file goes with the project's `<projectId>/` prefix.
  LeadFile: { scope: 'project' },
  // Its file goes with the project's `<projectId>/` prefix.
  BrandAsset: { scope: 'project' },
  CmsComponent: { scope: 'project' },
  CmsEntry: { scope: 'project' },
  CmsAsset: { scope: 'project' },
  CmsChatMessage: { scope: 'project' },
  EmailFolder: { scope: 'workspace' },
  EmailComponent: { scope: 'workspace' },
  EmailTemplate: { scope: 'workspace' },
  EmailChatMessage: { scope: 'parent', parent: { field: 'template', className: 'EmailTemplate' } },
  // Mail a workspace sends without a project (a master's test) carries the workspace instead.
  EmailLog: { scope: 'project', orWorkspace: true },
  EmailSuppression: { scope: 'project' },
  ErrorAnalysis: { scope: 'project' }
}

const PAGE = 500

function pointer(className: string, id: string): ParseObject {
  return useParse().Object.extend(className).createWithoutData(id) as ParseObject
}

/** A query's rows a page at a time, by objectId (safe to delete each page as it comes). */
export async function* pagedRows(make: () => ParseQuery, keys?: string[]): AsyncGenerator<ParseObject[]> {
  let after = ''
  for (;;) {
    const query = make()
    if (after) query.greaterThan('objectId', after)
    if (keys) query.select(...keys)
    const rows = await query.ascending('objectId').limit(PAGE).find(MASTER)
    if (rows.length) yield rows
    if (rows.length < PAGE) return
    after = rows.at(-1)!.id || ''
  }
}

/** One class's rows in the workspace, every way the map says they belong to it. */
async function* classPages(className: string, holdings: Holdings, keys?: string[]): AsyncGenerator<ParseObject[]> {
  const rule = WORKSPACE_DATA[className]
  if (!rule || rule.scope === 'none') return
  const Parse = useParse()
  const workspace = pointer('Workspace', holdings.workspaceId)
  if (rule.scope === 'workspace') {
    const only = holdings.onlyProject
    // A project export takes the project itself and the workspace-level rows pinned to it, nothing else.
    if (only && className !== 'Project' && !(PROJECT_PINNED as readonly string[]).includes(className)) return
    yield* pagedRows(() => {
      const query = new Parse.Query(className).equalTo('workspace', workspace)
      if (only) className === 'Project' ? query.equalTo('objectId', only) : query.equalTo('project', pointer('Project', only))
      return query
    }, keys)
  }
  if (rule.scope === 'project') {
    for (const projectId of holdings.projectIds) yield* pagedRows(() => new Parse.Query(className).equalTo('project', pointer('Project', projectId)), keys)
    if (rule.orWorkspace && !holdings.onlyProject) yield* pagedRows(() => new Parse.Query(className).equalTo('workspace', workspace).doesNotExist('project'), keys)
  }
  const parent = rule.parent
  if (!parent) return
  // A project-scoped class takes only its rows without a project here (the rest came above); the parents pin the workspace.
  const ownProject = rule.scope === 'project' ? 'project' : ''
  for await (const parents of classPages(parent.className, holdings, ['objectId'])) {
    yield* pagedRows(() => {
      const query = new Parse.Query(className).containedIn(parent.field, parents)
      if (ownProject) query.doesNotExist(ownProject)
      return query
    }, keys)
  }
}

async function holdingsOf(workspaceId: string, onlyProject = ''): Promise<Holdings> {
  const holdings: Holdings = { workspaceId, projectIds: [], ...(onlyProject ? { onlyProject } : {}) }
  for await (const rows of classPages('Project', holdings, ['objectId'])) holdings.projectIds.push(...rows.map(row => row.id || ''))
  return holdings
}

// In import order (shared/transfer.ts), so a file can be read once from top to bottom; the classes that never travel come last.
const rank = (name: string) => { const at = (IMPORT_ORDER as readonly string[]).indexOf(name); return at < 0 ? IMPORT_ORDER.length : at }
const EXPORTED = Object.keys(WORKSPACE_DATA).filter(name => WORKSPACE_DATA[name]!.scope !== 'none' && WORKSPACE_DATA[name]!.exported !== false).sort((a, b) => rank(a) - rank(b))
/** What another instance can take in. */
const PORTABLE = EXPORTED.filter(name => !NOT_PORTABLE[name])

/** Everything a workspace owns (or one of its projects), a class at a time, in batches of at most 500 rows. */
export async function* workspaceRows(workspaceId: string, classes: string[] = EXPORTED, onlyProject = ''): AsyncGenerator<{ className: string, rows: ParseObject[] }> {
  const holdings = await holdingsOf(workspaceId, onlyProject)
  for (const className of classes) {
    for await (const rows of classPages(className, holdings)) yield { className, rows }
  }
}

/** The order deleting goes in: rows found through a parent while it is still there, then projects' rows, then the workspace's, the projects last. */
export function purgeOrder(): string[] {
  const rule = (name: string) => WORKSPACE_DATA[name]!
  const classes = Object.keys(WORKSPACE_DATA).filter(name => rule(name).scope !== 'none')
  return [
    ...classes.filter(name => rule(name).parent),
    ...classes.filter(name => rule(name).scope === 'project' && !rule(name).parent),
    ...classes.filter(name => rule(name).scope === 'workspace' && name !== 'Project'),
    'Project'
  ]
}

function isGone(workspace: ParseObject): boolean {
  const status = String(workspace.get('status') || 'active')
  return status === 'deleting' || status === 'deleted'
}

// ---- export ---------------------------------------------------------------------

const EXPORT_LINK_SECONDS = 7 * 24 * 3600

// Credentials, not data: an export ends up in someone's downloads folder.
const SECRET_FIELDS: Record<string, string[]> = {
  Project: ['secret', 'telegram.tokenSealed', 'actionWebhookSecret', 'eventWebhookSecret', 'errors.webhookToken', 'errors.more.*.webhookToken', 'errorTrackers.*.token'],
  AdminApiKey: ['hash'],
  EndUserSession: ['hash'],
  EndUser: ['verifyCodeHash'],
  WorkspaceInvite: ['tokenHash'],
  ContactSource: ['secretSealed'],
  StripeAccount: ['secretSealed'],
  SupportAgent: ['apiKey'],
  WebhookEndpoint: ['secret'],
  EmailTemplate: ['shareToken']
}
const ACCOUNT_SECRETS = ['_hashed_password', '_password_history', '_email_verify_token', '_perishable_token', 'sessionToken', 'authData']
// sealSecret's output (secrets.ts): `v1.<12-byte iv>.<16-byte tag>.<ciphertext>`, base64url.
const SEALED = /^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]*$/

const isSealed = (value: unknown) => typeof value === 'string' && SEALED.test(value)

function withoutSealed(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter(item => !isSealed(item)).map(withoutSealed)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => !isSealed(item)).map(([key, item]) => [key, withoutSealed(item)]))
  return value
}

function dropPath(value: unknown, path: string[]): void {
  if (!value || typeof value !== 'object') return
  const [head = '', ...rest] = path
  const target = value as Record<string, unknown>
  for (const key of head === '*' ? Object.keys(target) : [head]) {
    if (rest.length) dropPath(target[key], rest)
    else delete target[key]
  }
}

export function exportHeader(workspaceId: string, exportedAt: Date, projectId = '') {
  // Version 2 adds `scope`; an importer reads 1 the same way (a workspace).
  return { format: EXPORT_FORMAT, version: 2, scope: projectId ? 'project' : 'workspace', workspaceId, ...(projectId ? { projectId } : {}), exportedAt: exportedAt.toISOString() }
}

/** One row of the export, its credentials taken out. The row's own JSON is left as it was. */
export function exportLine(className: string, data: Record<string, unknown>): { class: string, data: Record<string, unknown> } {
  const copy = withoutSealed(JSON.parse(JSON.stringify(data))) as Record<string, unknown>
  for (const path of [...ACCOUNT_SECRETS, ...(SECRET_FIELDS[className] || [])]) dropPath(copy, path.split('.'))
  return { class: className, data: copy }
}

/** Where an export is stored. The random part keeps it unguessable when the bucket is public-read. */
export function exportKey(workspaceId: string, at: Date, nonce = randomBytes(8).toString('hex')): string {
  return `exports/${workspaceId}/${at.toISOString().replace(/[:.]/g, '-')}-${nonce}.jsonl.gz`
}

async function* exportLines(workspaceId: string, exportedAt: Date, options: { classes?: string[], projectId?: string } = {}): AsyncGenerator<string> {
  yield `${JSON.stringify(exportHeader(workspaceId, exportedAt, options.projectId))}\n`
  for await (const { className, rows } of workspaceRows(workspaceId, options.classes, options.projectId)) {
    yield rows.map(row => `${JSON.stringify(exportLine(className, row.toJSON() as Record<string, unknown>))}\n`).join('')
  }
}

/**
 * What another instance can import, as a gzipped JSON Lines stream: the whole
 * workspace, or one project. Credentials are left out and so is everything in
 * NOT_PORTABLE. Served to a download and to an importing instance alike.
 */
export function portableExport(workspaceId: string, projectId = ''): Readable {
  const gzip = createGzip()
  const lines = Readable.from(exportLines(workspaceId, new Date(), { classes: PORTABLE, projectId }))
  lines.on('error', error => gzip.destroy(error))
  return lines.pipe(gzip)
}

/** Queue an export of the caller's workspace; the link is mailed to them. */
export async function requestWorkspaceExport(ctx: MemberContext, ip = ''): Promise<void> {
  if (isGone(ctx.workspace)) throw createError({ statusCode: 403, statusMessage: 'This workspace is being deleted', data: { code: 'workspace_suspended' } })
  if (!s3Configured()) throw createError({ statusCode: 503, statusMessage: 'Exports need file storage: set the server\'s S3_* settings' })
  await rateLimit(`sb:rl:export:${ctx.workspaceId}`, 5, 3600)
  await enqueueJob('workspace.export', { workspaceId: ctx.workspaceId, requestedBy: ctx.agentId }, { workspaceId: ctx.workspaceId, dedupeKey: `workspace.export:${ctx.workspaceId}:${ctx.agentId}` })
  await audit({ action: 'workspace.export', actor: ctx.agent, workspace: ctx.workspace, ip })
}

/** The last export, with a fresh download link that works for an hour. */
export async function lastWorkspaceExport(workspace: ParseObject): Promise<{ at: string, url: string } | null> {
  const last = workspace.get('lastExport') as { at?: string, key?: string } | undefined
  if (!last?.key || !s3Configured()) return null
  return { at: String(last.at || ''), url: exportDownloadUrl(last.key, 3600) }
}

/**
 * A link that downloads an export for `seconds`, through the app rather than
 * S3: the bucket's address is often internal to the stack, and the token
 * names the one file it opens (server/routes/v1/exports/[token].get.ts).
 */
export function exportDownloadUrl(key: string, seconds: number, now = Date.now()): string {
  const base = String(process.env.ADMIN_URL || process.env.APP_URL || '').replace(/\/+$/, '')
  return `${base}/v1/exports/${signLinkToken('workspace-export', JSON.stringify({ k: key, x: now + seconds * 1000 }))}`
}

/** The export a download link opens, or null when it is forged, expired or not an export. */
export function readExportDownload(token: string, now = Date.now()): string | null {
  const payload = readLinkToken('workspace-export', token)
  if (!payload) return null
  try {
    const { k, x } = JSON.parse(payload) as { k?: string, x?: number }
    return typeof k === 'string' && /^exports\/[\w-]+\/[\w.-]+\.jsonl\.gz$/.test(k) && typeof x === 'number' && x > now ? k : null
  } catch {
    return null
  }
}

/** The `workspace.export` job: write the file, remember it, mail the link to whoever asked. */
export async function runWorkspaceExport(workspaceId: string, requestedBy: string): Promise<void> {
  const Parse = useParse()
  const workspace = await new Parse.Query('Workspace').get(workspaceId, MASTER).catch(() => null)
  // Asked for just before the workspace was deleted: its data is going, and the export with it.
  if (!workspace || isGone(workspace)) return
  const exportedAt = new Date()
  const key = exportKey(workspaceId, exportedAt)
  const file = join(tmpdir(), `helpbites-export-${randomBytes(8).toString('hex')}.jsonl.gz`)
  try {
    await pipeline(Readable.from(exportLines(workspaceId, exportedAt)), createGzip(), createWriteStream(file))
    await storePrivateFile(key, file, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="helpbites-export-${exportedAt.toISOString().slice(0, 10)}.jsonl.gz"` })
  } finally {
    await unlink(file).catch(() => {})
  }
  workspace.set('lastExport', { at: exportedAt.toISOString(), key, by: requestedBy })
  await workspace.save(null, MASTER)
  await invalidate('workspace', workspaceId)
  // Older files' links have run out, and a copy of the data should not linger.
  await removeObjectsUnder(`exports/${workspaceId}/`, new Date(Date.now() - EXPORT_LINK_SECONDS * 1000)).catch(error => console.warn('[export] old exports not removed:', (error as Error).message))
  // The file is there either way (the settings link it); a failed mail is not worth exporting again.
  await mailExportLink(workspace, requestedBy, key).catch(error => console.error('[export] link not mailed:', (error as Error).message))
}

async function mailExportLink(workspace: ParseObject, userId: string, key: string): Promise<void> {
  const Parse = useParse()
  const user = userId ? await new Parse.Query(Parse.User).get(userId, MASTER).catch(() => null) : null
  const email = String(user?.get('email') || '')
  if (!email || !isMailerConfigured()) return
  const url = exportDownloadUrl(key, EXPORT_LINK_SECONDS)
  const name = String(workspace.get('name') || 'your workspace')
  const html = `<p>The export of <strong>${escapeHtml(name)}</strong> is ready: everything in it, as one gzipped JSON Lines file.</p><p><a href="${escapeHtml(url)}">Download the export</a></p><p>The link works for 7 days. The file holds your customers' data, so keep it somewhere safe.</p>`
  const text = `The export of ${name} is ready: everything in it, as one gzipped JSON Lines file.\n\nDownload it (the link works for 7 days):\n\n${url}\n\nThe file holds your customers' data, so keep it somewhere safe.`
  const [result] = await deliverEmails([{
    project: null,
    to: { email, name: String(user?.get('name') || '') },
    subject: `Your ${name} export is ready`,
    html,
    text,
    sender: projectEmailSender(null, { fromName: 'HelpBites' }),
    log: { source: 'system', kind: 'message', templateName: 'Workspace export', batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
  }])
  if (result?.status === 'failed') console.error('[export] link not mailed:', result.error)
}

// ---- deletion --------------------------------------------------------------------

/** Whether `confirm` is the workspace's name, typed exactly as the panel shows it. */
export function confirmsDeletion(workspace: ParseObject, confirm: unknown): boolean {
  return typeof confirm === 'string' && confirm === String(workspace.get('name') || 'Workspace')
}

/** Close the caller's workspace at once; the `workspace.purge` job then empties it. */
export async function deleteWorkspace(ctx: MemberContext, ip = ''): Promise<void> {
  const workspace = ctx.workspace
  workspace.set('status', 'deleting')
  await workspace.save(null, MASTER)
  await invalidate('workspace', ctx.workspaceId)
  try {
    await edition().onWorkspaceDeleting?.(workspace)
  } catch (error) {
    console.error('[workspace] onWorkspaceDeleting failed:', (error as Error).message)
  }
  await audit({ action: 'workspace.delete', actor: ctx.agent, workspace, data: { name: String(workspace.get('name') || '') }, ip })
  await enqueueJob('workspace.purge', { workspaceId: ctx.workspaceId }, { workspaceId: ctx.workspaceId, dedupeKey: `workspace.purge:${ctx.workspaceId}` })
}

async function destroyRows(rows: ParseObject[]): Promise<void> {
  if (!rows.length) return
  const Parse = useParse()
  try {
    await Parse.Object.destroyAll(rows, MASTER)
  } catch {
    // Some were gone already (two runs at once): the rest one by one.
    for (const row of rows) {
      await row.destroy(MASTER).catch((error: { code?: number }) => {
        if (error?.code !== Parse.Error.OBJECT_NOT_FOUND) throw error
      })
    }
  }
}

/** The workspace's plan counters (usage.ts), so the flush can't write them back. */
async function dropUsageCounters(workspaceId: string): Promise<void> {
  const redis = useRedis()
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `sb:usage:${workspaceId}:*`, 'COUNT', 500)
    if (keys.length) await redis.del(...keys)
    cursor = next
  } while (cursor !== '0')
}

/**
 * The `workspace.purge` job: every row in the map, the workspace's files and
 * search documents, its usage counters, and anyone's default pointing at it.
 * The Workspace row stays as a tombstone. Safe to run again.
 */
export async function purgeWorkspace(workspaceId: string): Promise<void> {
  const Parse = useParse()
  if (!/^\w+$/.test(workspaceId)) return
  const workspace = await new Parse.Query('Workspace').get(workspaceId, MASTER).catch(() => null)
  // Only a workspace its owner deleted: a stray job never empties a live one.
  if (!workspace || !isGone(workspace)) return
  const holdings = await holdingsOf(workspaceId)
  const rowsOf = async (className: string, keys: string[]) => {
    const rows: ParseObject[] = []
    for await (const page of classPages(className, holdings, keys)) rows.push(...page)
    return rows
  }

  // Files first: where they are comes from rows deleted below.
  if (s3Configured()) {
    const models = await rowsOf('KnowledgeModel', ['objectId'])
    // A master template's images live under emails/<its id>/; a project's under the project.
    const masters = (await rowsOf('EmailTemplate', ['project'])).filter(row => !row.get('project'))
    const prefixes = [...holdings.projectIds.map(id => `${id}/`), ...models.map(row => `knowledge/${row.id}/`), ...masters.map(row => `emails/${row.id}/`), `exports/${workspaceId}/`]
    for (const prefix of prefixes) await removeObjectsUnder(prefix)
  }
  if (meiliConfigured()) {
    for (const index of [CONVERSATIONS_INDEX, ENDUSERS_INDEX, KNOWLEDGE_INDEX]) await deleteByFilter(index, `workspaceId = "${workspaceId}"`)
  }
  await dropUsageCounters(workspaceId)

  const projects = await rowsOf('Project', ['publicKey'])
  const members = await rowsOf('WorkspaceMember', ['user'])
  let removed = 0
  for (const className of purgeOrder()) {
    for await (const rows of classPages(className, holdings, className === 'Job' ? ['kind'] : ['objectId'])) {
      // This job's own row is the runner's to finish.
      const doomed = className === 'Job' ? rows.filter(row => row.get('kind') !== 'workspace.purge') : rows
      await destroyRows(doomed)
      removed += doomed.length
    }
  }

  for await (const users of pagedRows(() => new Parse.Query(Parse.User).equalTo('defaultWorkspace', pointer('Workspace', workspaceId)), ['objectId'])) {
    for (const user of users) user.unset('defaultWorkspace')
    await Parse.Object.saveAll(users, MASTER)
  }
  for (const member of members) await invalidate('members', pointerId(member.get('user')))
  for (const project of projects) if (project.get('publicKey')) forgetProject(String(project.get('publicKey')))
  await forgetWorkspaceProjects(workspaceId)

  workspace.set('status', 'deleted')
  if (!workspace.get('deletedAt')) workspace.set('deletedAt', new Date())
  for (const field of ['ai', 'settings', 'lastExport']) workspace.unset(field)
  await workspace.save(null, MASTER)
  await invalidate('workspace', workspaceId)
  await audit({ action: 'workspace.purged', workspace, data: { rows: removed } })
}
