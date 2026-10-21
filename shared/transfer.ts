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
  'EndUser',
  'ContactSegment',
  'ConversationType',
  'KnowledgeModel',
  'KnowledgeNode',
  'KnowledgeDocument',
  'Faq',
  'SupportAgent',
  'AgentKnowledgeAssignment',
  'Conversation',
  'Message',
  'FeedbackPost',
  'FeedbackComment',
  'FeedbackVote',
  'FeedbackSubscription',
  'BoardItem',
  'ChangelogRelease',
  'ChangelogEntry',
  'ChangelogComment',
  'ChangelogSubscription',
  'ChangelogNotifyRun',
  'LegalDocument',
  'LegalDocumentVersion',
  'OnboardingFlow',
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
  'ErrorAnalysis'
] as const

/**
 * Exported (the archive keeps everything) but never imported or pulled, with
 * the reason: credentials the export leaves out, files that stay in the old
 * bucket, accounts that live on an instance, or work that would start by itself.
 */
export const NOT_PORTABLE: Record<string, string> = {
  WorkspaceUsage: 'counters of the old instance',
  WorkspaceMember: 'accounts live on one instance; invite the team again',
  WorkspaceInvite: 'accounts live on one instance; invite the team again',
  WorkspaceDomain: 'a sending domain is verified per instance',
  AdminApiKey: 'credentials',
  EndUserSession: 'credentials; people sign in again',
  ContactSource: 'its database credentials are not exported',
  StripeAccount: 'its Stripe key is not exported; connect Stripe again',
  StripePayment: 'comes from the Stripe account',
  StripeSubscription: 'comes from the Stripe account',
  WebhookDelivery: 'the old instance\'s outbox',
  BrandAsset: 'a file in the old bucket',
  CmsAsset: 'a file in the old bucket; pages keep linking to it there',
  Campaign: 'could send again; recreate it from the template',
  SequenceEnrollment: 'would send the next step again',
  DataTransfer: 'the old instance\'s own bookkeeping'
}

/** Workspace-level classes that belong to one project when they carry its pointer: what a project export takes besides its project-scoped rows. */
export const PROJECT_PINNED = ['KnowledgeModel', 'SupportAgent', 'EmailFolder', 'EmailComponent', 'EmailTemplate'] as const

/**
 * Fields that hold the id of another imported row as text, by class: a path
 * (`*` for every item) and the class it points at. Ids found in the import are
 * replaced with the new ones; any other value stays as it was.
 */
export const ID_PATHS: Record<string, Record<string, string>> = {
  Conversation: { assistantId: 'SupportAgent' },
  Message: { replyToId: 'Message' },
  FeedbackPost: { pinnedCommentId: 'FeedbackComment' },
  FeedbackComment: { parentId: 'FeedbackComment', replyToId: 'FeedbackComment' },
  BoardItem: { feedbackPostIds: 'FeedbackPost', conversationIds: 'Conversation' },
  ChangelogEntry: { feedbackPostIds: 'FeedbackPost', boardItemIds: 'BoardItem', conversationIds: 'Conversation' },
  ChangelogNotifyRun: { entryIds: 'ChangelogEntry' },
  Sequence: { 'steps.*.template': 'EmailTemplate' }
}

/** Fields that mean something only on the instance they came from. */
export const DROP_FIELDS: Record<string, string[]> = {
  Project: ['repos', 'repoIds', 'telegram', 'changelogRun'],
  EmailTemplate: ['lastActorId'],
  EmailLog: ['actorId']
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
  /** The projects that came in; `keptKey` is false when their public key was taken and a new one was issued. */
  projects: { name: string, publicKey: string, keptKey: boolean }[]
  /** Anything the person should do next. */
  notes: string[]
}

export const EXPORT_FORMAT = 'helpbites-export'
export const EXPORT_VERSIONS = [1, 2]
