// What moves between HelpBites instances (server/utils/transfer.ts): the file
// an export writes and an import reads, or the same stream pulled straight
// from another instance. Plain data, so tests/transfer.test.ts can hold it
// against scripts/ensure-schema.mjs and the workspace data map.

/**
 * The order classes are written and created in: whatever a row points at comes
 * before it. Pointers to rows that come later (a post's pinned comment) and a
 * class's pointers to itself (a reply's parent) are fixed up once everything
 * exists. A class missing here is not part of a transfer.
 */
export const IMPORT_ORDER = [
  'Project',
  // Before the contacts and segments that name its id; its own references are fixed up at the end.
  'LeadForm',
  'EndUser',
  'ContactSegment',
  'ConversationType',
  'SavedReply',
  'KnowledgeModel',
  'KnowledgeNode',
  'KnowledgeDocument',
  'Faq',
  'SupportAgent',
  'AgentKnowledgeAssignment',
  // Before the conversations that link it (Conversation.feedbackPostIds).
  'FeedbackPost',
  'Conversation',
  'Message',
  'FeedbackComment',
  'FeedbackVote',
  'FeedbackSubscription',
  'BoardItem',
  'BoardItemHistory',
  'BoardItemComment',
  'ChangelogRelease',
  'ChangelogEntry',
  'ChangelogComment',
  'ChangelogSubscription',
  'ChangelogNotifyRun',
  'BlogPost',
  'BlogComment',
  'LegalDocument',
  'LegalDocumentVersion',
  'OnboardingFlow',
  'OnboardingCompletion',
  'PricingTable',
  'PricingStat',
  'CmsComponent',
  'CmsEntry',
  'CmsChatMessage',
  'EmailFolder',
  'EmailComponent',
  'EmailTemplate',
  'EmailChatMessage',
  'EmailLog',
  'EmailSuppression',
  'Sequence',
  'ErrorAnalysis',
  'ErrorReport',
  // Connections and files come last: they only point at a project, a form or a contact.
  'ContactSource',
  'StripeAccount',
  'RevenueSource',
  'WebhookEndpoint',
  'StripePayment',
  'StripeSubscription',
  'BrandAsset',
  'CmsAsset',
  'LeadFile'
] as const

/** Connections that hold a credential: in an export only when the person asks for credentials. */
export const CREDENTIAL_CLASSES: readonly string[] = ['ContactSource', 'StripeAccount', 'RevenueSource', 'WebhookEndpoint']

/**
 * The field of a class that names a file in the bucket by key (not by URL). A binary export carries the file and
 * the importer stores it again; a links export cannot, so the importer clears the key and the file is not offered.
 */
export const FILE_KEY_FIELDS: Record<string, string> = {
  KnowledgeDocument: 'storageKey',
  LeadFile: 'storageKey',
  BrandAsset: 'storageKey',
  CmsAsset: 'storageKey'
}

/** How uploaded files (the bucket's contents) travel: as the links they have now, or as the files themselves. */
export const TRANSFER_FILES = ['urls', 'binary'] as const
export type TransferFiles = typeof TRANSFER_FILES[number]
export const readTransferFiles = (value: unknown): TransferFiles => value === 'binary' ? 'binary' : 'urls'

/** What the first line of an export says about the choices made when it was written. */
export type TransferOptions = { files: TransferFiles, secrets: boolean }

/** A file inside the export, as one or more `{ class: '_File', data }` lines, before the rows that point at it. */
export const FILE_CLASS = '_File'
/** The workspace's own AI providers and settings, with credentials only when the export carries them. */
export const WORKSPACE_SETTINGS_CLASS = '_WorkspaceSettings'
/** A sealed credential in an export, opened: `{ "$sealed": "<plain>" }`. The importer seals it again with its own key. */
export const SEALED_KEY = '$sealed'
/** Raw bytes of a file per line: base64 of it stays well under the 16 MB line limit. */
export const FILE_CHUNK_BYTES = 4 * 1024 * 1024
/** The largest single file a binary export carries or an import accepts. */
export const FILE_MAX_BYTES = 100 * 1024 * 1024

/**
 * Exported (the archive keeps everything) but never imported or pulled, with
 * the reason: credentials the export leaves out, files that stay in the old
 * bucket, accounts that live on an instance, or work that would start by itself.
 */
export const NOT_PORTABLE: Record<string, string> = {
  WorkspaceUsage: 'counters of the old instance',
  WorkspaceMember: 'accounts live on one instance; invite the team again',
  WorkspaceInvite: 'an invite is a mailed link into one instance; invite the team again',
  WorkspaceDomain: 'a sending domain is verified per instance',
  AdminApiKey: 'a key belongs to an operator account on one instance; make new ones',
  EndUserSession: 'people sign in again',
  ProjectDomain: 'a host is verified and routed per instance; add it again',
  InboundAddress: 'an address is verified and routed per instance; add it again',
  WebhookDelivery: 'the old instance\'s outbox',
  Campaign: 'could send again; recreate it from the template',
  SequenceEnrollment: 'would send the next step again',
  DataTransfer: 'the old instance\'s own bookkeeping',
  GithubRef: 'rebuilt from new pushes and merges: the repos a project reads are not carried over either'
}

/** Workspace-level classes that belong to one project when they carry its pointer: what a project export takes besides its project-scoped rows. */
export const PROJECT_PINNED = ['KnowledgeModel', 'SupportAgent', 'EmailFolder', 'EmailComponent', 'EmailTemplate'] as const

/**
 * Fields that hold the id of another imported row as text, by class: a path
 * (`*` for every item) and the class it points at. Ids found in the import are
 * replaced with the new ones; any other value stays as it was.
 */
export const ID_PATHS: Record<string, Record<string, string>> = {
  Conversation: { assistantId: 'SupportAgent', feedbackPostIds: 'FeedbackPost' },
  Faq: { conversationId: 'Conversation' },
  Message: { replyToId: 'Message' },
  FeedbackPost: { pinnedCommentId: 'FeedbackComment' },
  FeedbackComment: { parentId: 'FeedbackComment', replyToId: 'FeedbackComment' },
  BoardItem: { feedbackPostIds: 'FeedbackPost', conversationIds: 'Conversation', epicId: 'BoardItem', releaseId: 'BoardItem' },
  BoardItemHistory: { itemId: 'BoardItem' },
  BoardItemComment: { parentId: 'BoardItemComment', replyToId: 'BoardItemComment' },
  ChangelogEntry: { feedbackPostIds: 'FeedbackPost', boardItemIds: 'BoardItem', conversationIds: 'Conversation' },
  ChangelogNotifyRun: { entryIds: 'ChangelogEntry' },
  BlogComment: { parentId: 'BlogComment' },
  Sequence: { 'steps.*.template': 'EmailTemplate' },
  LeadForm: { segment: 'ContactSegment', sequence: 'Sequence', welcomeTemplate: 'EmailTemplate', confirmTemplate: 'EmailTemplate' },
  EndUser: { 'leadForms.*': 'LeadForm', 'origin.id': 'LeadForm' },
  ContactSegment: { 'filter.rules.*.value': 'LeadForm' },
  // Its pointers move by themselves; the copies the reports query by need the same new ids.
  PricingStat: { tableId: 'PricingTable', projectId: 'Project' },
  // The project's id beside its pointer, which the revenue reports query by.
  StripeAccount: { projectId: 'Project' },
  RevenueSource: { projectId: 'Project' },
  StripePayment: { projectId: 'Project' },
  StripeSubscription: { projectId: 'Project' }
}

/** Fields that mean something only on the instance they came from. */
export const DROP_FIELDS: Record<string, string[]> = {
  // legalLinks holds absolute URLs on the source instance; the next legal publish rebuilds them here.
  Project: ['repos', 'repoIds', 'telegram', 'changelogRun', 'legalLinks'],
  EmailTemplate: ['lastActorId'],
  EmailLog: ['actorId'],
  BoardItemComment: ['actorId'],
  // The old instance's Stripe refusal; the next checkout tells the new one.
  PricingTable: ['checkoutError']
}

/** A plan feature a class needs: without it the class is left out of the import, with a note. */
export const CLASS_FEATURES: Record<string, 'legalDocs' | 'sequences'> = {
  LegalDocument: 'legalDocs',
  Sequence: 'sequences'
}

/** A plan limit a class counts against: over it, the whole import is refused. */
export const CLASS_GAUGES: Record<string, 'projects' | 'contacts' | 'knowledgeModels' | 'assistants' | 'faqs'> = {
  Project: 'projects',
  EndUser: 'contacts',
  KnowledgeModel: 'knowledgeModels',
  SupportAgent: 'assistants',
  Faq: 'faqs'
}

export type TransferScope = 'workspace' | 'project'
export type TransferStatus = 'queued' | 'running' | 'done' | 'failed'

export type TransferSummary = {
  /** Rows created, by class. */
  rows: Record<string, number>
  /** Rows left out, by class, with why (a class that does not travel, a plan that lacks the feature). */
  skipped: Record<string, { count: number, reason: string }>
  /** The projects that came in; `keptKey` is false when their public key was taken and a new one was issued, `keptSecret` when the project got a new secret. */
  projects: { name: string, publicKey: string, keptKey: boolean, keptSecret?: boolean }[]
  /** Anything the person should do next. */
  notes: string[]
  /** Files put in this instance's bucket (a binary export), and their size. */
  files?: { stored: number, bytes: number }
}

export const EXPORT_FORMAT = 'helpbites-export'
// 3: the file carries the bucket's files and/or credentials (`files`, `secrets` in its first line); 1 and 2 stay readable.
export const EXPORT_VERSIONS = [1, 2, 3]

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A key as it ends a URL in prose: a full stop or slash after it is punctuation, not part of the name. */
const trimKey = (raw: string) => raw.replace(/[./-]+$/, '')

/** The bucket keys that URLs under `base` (the exporter's S3_PUBLIC_URL) name anywhere in a value: text, HTML, nested objects. */
export function fileKeysIn(value: unknown, base: string, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (base) for (const match of value.matchAll(new RegExp(`${escapeRe(base)}/([\\w./-]+)`, 'g'))) out.add(trimKey(match[1]!))
  } else if (Array.isArray(value)) {
    for (const item of value) fileKeysIn(item, base, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) fileKeysIn(item, base, out)
  }
  return out
}

/** The same value with every URL under `from` whose key is in `keys` pointing at `to/<its new key>` instead. */
export function rewriteFileUrls(value: unknown, from: string, to: string, keys: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    if (!from) return value
    return value.replace(new RegExp(`${escapeRe(from)}/([\\w./-]+)`, 'g'), (whole, raw: string) => {
      const key = trimKey(raw)
      const moved = keys.get(key)
      return moved ? `${to}/${moved}${raw.slice(key.length)}` : whole
    })
  }
  if (Array.isArray(value)) return value.map(item => rewriteFileUrls(item, from, to, keys))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rewriteFileUrls(item, from, to, keys)]))
  return value
}
