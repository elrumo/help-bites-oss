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
  'ErrorReport'
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
  RevenueSource: 'its credentials are not exported; connect the source again',
  StripePayment: 'comes from the revenue sources (Stripe and the others)',
  StripeSubscription: 'comes from the revenue sources (Stripe and the others)',
  WebhookEndpoint: 'its signing secret is not exported; add the endpoint again',
  ProjectDomain: 'a host is verified and routed per instance; add it again',
  InboundAddress: 'an address is verified and routed per instance; add it again',
  WebhookDelivery: 'the old instance\'s outbox',
  BrandAsset: 'a file in the old bucket',
  CmsAsset: 'a file in the old bucket; pages keep linking to it there',
  LeadFile: 'a file in the old bucket; download it there before you move',
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
  BoardItem: { feedbackPostIds: 'FeedbackPost', conversationIds: 'Conversation' },
  ChangelogEntry: { feedbackPostIds: 'FeedbackPost', boardItemIds: 'BoardItem', conversationIds: 'Conversation' },
  ChangelogNotifyRun: { entryIds: 'ChangelogEntry' },
  BlogComment: { parentId: 'BlogComment' },
  Sequence: { 'steps.*.template': 'EmailTemplate' },
  LeadForm: { segment: 'ContactSegment', sequence: 'Sequence', welcomeTemplate: 'EmailTemplate', confirmTemplate: 'EmailTemplate' },
  EndUser: { 'leadForms.*': 'LeadForm', 'origin.id': 'LeadForm' },
  ContactSegment: { 'filter.rules.*.value': 'LeadForm' },
  // Its pointers move by themselves; the copies the reports query by need the same new ids.
  PricingStat: { tableId: 'PricingTable', projectId: 'Project' }
}

/** Fields that mean something only on the instance they came from. */
export const DROP_FIELDS: Record<string, string[]> = {
  // legalLinks holds absolute URLs on the source instance; the next legal publish rebuilds them here.
  Project: ['repos', 'repoIds', 'telegram', 'changelogRun', 'legalLinks'],
  EmailTemplate: ['lastActorId'],
  EmailLog: ['actorId'],
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
  /** The projects that came in; `keptKey` is false when their public key was taken and a new one was issued. */
  projects: { name: string, publicKey: string, keptKey: boolean }[]
  /** Anything the person should do next. */
  notes: string[]
}

export const EXPORT_FORMAT = 'helpbites-export'
export const EXPORT_VERSIONS = [1, 2]
